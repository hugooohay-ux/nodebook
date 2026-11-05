// Graph of notes, drawn on a canvas. No dependencies.
const Graph = (() => {
  // Colours come from the CSS theme variables so the graph follows light/dark
  let COLORS = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    COLORS = { bg: v('--bg'), node: v('--node'), unresolved: v('--unresolved'), accent: v('--accent'), edge: v('--edge'), edgeHi: v('--accent'), label: v('--text') };
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let lastFrame = 0;
  let fade = 0; // 0..1, how strongly the rest of the graph is dimmed around the focused node
  let chain = null; // Map id -> steps below the hovered node
  let box = null; // right-drag selection box, in screen coordinates
  let boxed = false; // the last right-click was a box selection (so no menu)
  let searchFor = null; // the search the best match was picked for
  let searchNodes = null;
  let searchHit = null; // the note whose chain the search lights up
  let chainFor; // the node `chain` was computed for
  let chainSince = 0; // when hovering started, for the trickle
  const STEP_MS = 110; // delay between each step of the chain lighting up

  let canvas, ctx, opts;
  let nodes = [];
  let edges = [];
  let byId = new Map();
  const positions = new Map(); // survives rebuilds so the layout doesn't jump
  const pins = new Map(); // notes placed by hand: id -> { x, y }, saved with the vault
  const held = new Set(); // notes dropped somewhere by hand this session (stay put, not saved)
  const guide = new Map(); // while dragging: where notes are gliding to so lines stop overlapping (id -> [x, y])
  let lastLive = 0;
  let lineLen = 0; // the line length shapes are evened out to: the graph's typical one (follows Repel/Spacing)
  let dragRegion = null; // while dragging: the notes allowed to follow
  const cam = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  // distance; much faster than Math.hypot, which matters in the repair's thousands of checks a second
  const hyp = (x, y) => Math.sqrt(x * x + y * y);
  let deepJob = null; // the background repair running now, if any (see startDeepRepair)
  let visible = false;
  let raf = 0;
  let hover = null;
  let drag = null; // { node } | { pan, sx, sy, cx, cy }
  let downAt = null;
  let fitPending = true;

  const settings = { local: false, depth: 1, unresolved: true, orphans: true, repel: 500, dist: 80, filter: '', pull: true, sizeMul: 1, linkMul: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem('nodebook:graph'));
    settings.sizeMul = saved?.sizeMul ?? 1;
    settings.linkMul = saved?.linkMul ?? 1;
  } catch { /* storage blocked */ }
  const saveSettings = () => {
    try { localStorage.setItem('nodebook:graph', JSON.stringify({ sizeMul: settings.sizeMul, linkMul: settings.linkMul })); } catch { /* storage blocked */ }
  };
  let litGroup = null; // group being hovered in the legend

  // ---------- data ----------
  function rebuild() {
    stopDeepRepair();
    const { notes, links, related, critical, groups, current } = opts.getData();
    const map = new Map();
    // fwd/bwd: links written in the text (fwd = notes this one links to) — the hover chain follows these.
    // linked: "Related to" connections — hovering lights them one step, never further.
    const node = (id, label, unresolved) => ({ id, label, unresolved, deg: 0, nbrs: new Set(), fwd: new Set(), bwd: new Set(), linked: new Set() });
    for (const n of notes.values()) map.set(n.path, node(n.path, n.name, false));

    const es = [];
    const seen = new Set();
    const connect = (a, b) => {
      const key = a < b ? a + '\n' + b : b + '\n' + a;
      if (seen.has(key)) return;
      seen.add(key);
      es.push([a, b]);
      map.get(a).nbrs.add(b);
      map.get(b).nbrs.add(a);
    };
    for (const [src, outs] of links) {
      for (const l of outs) {
        let id = l.resolved;
        if (!id) {
          if (!settings.unresolved) continue;
          id = '?' + l.target.toLowerCase();
          if (!map.has(id)) map.set(id, node(id, l.target, true));
        }
        map.get(src).fwd.add(id);
        map.get(id).bwd.add(src);
        connect(src, id);
      }
    }
    // "Critical": the one note this note's chain must get to first on its way up. It doesn't add a line:
    // the highlight travels along existing links to get there.
    for (const [a, c] of critical || []) {
      if (map.has(a) && map.has(c)) map.get(a).critical = c;
    }
    for (const [a, rs] of related || []) {
      if (!map.has(a)) continue;
      for (const b of rs) {
        if (!map.has(b)) continue;
        map.get(a).linked.add(b);
        map.get(b).linked.add(a);
        connect(a, b);
      }
    }
    if (ctx) ctx.font = '12px "Segoe UI", sans-serif';
    for (const n of map.values()) {
      n.deg = n.nbrs.size;
      n.links = n.fwd.size + n.bwd.size + n.linked.size; // every connection it has
      n.labelW = ctx ? ctx.measureText(n.label).width : n.label.length * 6.5; // label width on screen, in px
    }

    let keep = [...map.values()];
    if (settings.local && current && map.has(current)) {
      const within = new Set([current]);
      let frontier = [current];
      for (let d = 0; d < settings.depth; d++) {
        const next = [];
        for (const id of frontier) for (const nb of map.get(id).nbrs) if (!within.has(nb)) { within.add(nb); next.push(nb); }
        frontier = next;
      }
      keep = keep.filter((n) => within.has(n.id));
    } else if (!settings.orphans) {
      keep = keep.filter((n) => n.deg > 0 || n.id === current);
    }

    // Group colour for each note in a group
    const groupList = new Map((groups?.list || []).map((g) => [g.id, g]));
    for (const n of keep) n.group = groupList.get(groups?.members?.[n.id]) || null;

    byId = new Map(keep.map((n) => [n.id, n]));
    nbrCache = new WeakMap();
    // notes that have each note as their critical note
    for (const n of keep) n.critKids = [];
    for (const n of keep) if (byId.has(n.critical)) byId.get(n.critical).critKids.push(n);

    // Which way is "down" the link chains: whichever direction has the clearest top note, so it works whether
    // a topic links to its subtopics (Associationsrätt → [[Bolagsformer]]) or the subtopics link back up to it.
    // Size = how much sits below a note (every note reachable going down), scaled from smallest (0) to biggest (1).
    const orient = (dir) => keep.forEach((n) => { n.down = dir === 'fwd' ? n.fwd : n.bwd; n.up = dir === 'fwd' ? n.bwd : n.fwd; });
    if (keep.length <= 1500) {
      orient('fwd');
      const viaFwd = keep.map((n) => walk(n, 'down').size - 1);
      orient('bwd');
      const viaBwd = keep.map((n) => walk(n, 'down').size - 1);
      const useFwd = Math.max(0, ...viaFwd) >= Math.max(0, ...viaBwd);
      orient(useFwd ? 'fwd' : 'bwd');
      const below = useFwd ? viaFwd : viaBwd;
      keep.forEach((n, i) => (n.below = below[i]));
    } else {
      orient('fwd');
      keep.forEach((n) => (n.below = n.links)); // very large vaults: plain link count is much cheaper
    }
    const lo = Math.min(...keep.map((n) => n.below));
    const hi = Math.max(...keep.map((n) => n.below));
    for (const n of keep) n.size = hi > lo ? (n.below - lo) / (hi - lo) : 0;

    // Distance to the top: the fewest link steps down from a top note (one with nothing above it).
    // Hover chains only climb to notes closer to the top, so they never take a detour.
    // A note with a critical note only gets its distance through that note.
    for (const n of keep) n.top = Infinity;
    let ring = keep.filter((n) => !byId.has(n.critical) && ![...n.up].some((id) => id !== n.id && byId.has(id)));
    if (!ring.length && keep.length) ring = [keep.reduce((a, b) => (b.below > a.below ? b : a))]; // everything in a loop
    for (const n of ring) n.top = 0;
    while (ring.length) {
      const next = [];
      for (const n of ring) {
        for (const m of below1(n)) {
          if (m.top === Infinity && !stopsAt(m, n)) { m.top = n.top + 1; next.push(m); }
        }
      }
      ring = next;
    }
    edges = es.filter(([a, b]) => byId.has(a) && byId.has(b)).map(([a, b]) => [byId.get(a), byId.get(b)]);
    nodes = keep;

    let added = false;
    for (const n of nodes) {
      const pin = pins.get(n.id);
      const p = positions.get(n.id);
      n.pinned = !!pin;
      if (pin) Object.assign(n, { x: pin.x, y: pin.y, vx: 0, vy: 0 });
      else if (p) Object.assign(n, p);
      else {
        // New note: start next to a note it links to, a little way out
        added = true;
        const nb = [...n.nbrs].map((id) => positions.get(id)).find(Boolean);
        const a = Math.random() * Math.PI * 2;
        const r = nb ? settings.dist : Math.sqrt(nodes.length) * 40 * Math.random();
        Object.assign(n, { x: (nb ? nb.x : 0) + Math.cos(a) * r, y: (nb ? nb.y : 0) + Math.sin(a) * r, vx: 0, vy: 0 });
      }
    }
    if (hover && !byId.has(hover.id)) hover = null;
    chainFor = undefined; // recompute the hover chain against the new nodes
    if (added) alpha = Math.max(alpha, 0.3); // let newcomers settle in; otherwise stay still
  }

  // The notes one step below n: the notes its links go down to, plus notes that have n as their critical note.
  // Used only for each note's distance to the top: a note with a critical note gets its distance through that note.
  function below1(n) {
    const out = [];
    for (const id of n.down) { const m = byId.get(id); if (m) out.push(m); }
    for (const m of n.critKids || []) if (!n.down.has(m.id)) out.push(m);
    return out;
  }
  // (for the distance to the top: a note with a critical note doesn't take its distance from any other note)
  const stopsAt = (m, from) => byId.has(m.critical) && m.critical !== from.id;

  // Notes reachable from `start` by following links in one direction only ('down' or 'up'), with steps away.
  // "Critical" plays no part here: it's one-way and only steers a note's own path up (see chainFrom).
  function walk(start, dir) {
    const depth = new Map([[start.id, 0]]);
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const n of frontier) {
        for (const id of n[dir]) {
          const m = byId.get(id);
          if (!m || depth.has(m.id)) continue;
          depth.set(m.id, depth.get(n.id) + 1);
          next.push(m);
        }
      }
      frontier = next;
    }
    return depth;
  }

  // Never sideways: a sibling (reached only by going up and then back down) stays dark.
  // Hovering a note lights, following links written in the text:
  //  - everything below it, directly or further down
  //  - above it, every route to the top where each step gets closer to the top. Several equally good routes all
  //    light up (Handelsbolag → Bolagsformer and → HandelsbL, both on to Associationsrätt); a detour doesn't
  //    (Juridisk person climbs through Rättskapacitet, not through Handelsbolag, which is further from the top).
  //    Notes directly above that aren't closer still light up one step, but the chain doesn't go on through them.
  // and its "Related to" notes, one step only.
  // The shortest chain of existing connections from a to b: the notes after a, ending with b (null if none)
  function pathBetween(a, b) {
    if (a === b) return [];
    const prev = new Map([[a.id, null]]);
    let ring = [a];
    while (ring.length && !prev.has(b.id)) {
      const next = [];
      for (const n of ring) {
        for (const id of n.nbrs) {
          if (prev.has(id) || !byId.has(id)) continue;
          prev.set(id, n.id);
          next.push(byId.get(id));
        }
      }
      ring = next;
    }
    if (!prev.has(b.id)) return null;
    const path = [];
    for (let id = b.id; id !== a.id; id = prev.get(id)) path.unshift(byId.get(id));
    return path;
  }

  function chainFrom(start) {
    const below = walk(start, 'down');
    const above = new Map([[start.id, 0]]);
    const upEdges = new Set(); // the steps actually taken going up: "lower\nhigher"
    const critEdges = new Set(); // the steps on the way to a critical note
    for (const id of start.up) {
      if (!byId.has(id) || id === start.id) continue;
      above.set(id, 1);
      upEdges.add(start.id + '\n' + id);
    }
    const visitedUp = new Set();
    let ring = [start];
    while (ring.length) {
      const next = [];
      for (const n of ring) {
        if (visitedUp.has(n.id)) continue;
        visitedUp.add(n.id);
        // A note with a critical note goes there first, whatever the distances — along the shortest chain of
        // existing links if they aren't linked directly — and on up from there.
        if (byId.has(n.critical)) {
          const path = pathBetween(n, byId.get(n.critical));
          if (!path) continue;
          let prev = n;
          for (const m of path) {
            upEdges.add(prev.id + '\n' + m.id);
            critEdges.add(prev.id + '\n' + m.id);
            const d = above.get(prev.id) + 1;
            if (!above.has(m.id) || (above.get(m.id) > d && m.id !== start.id)) above.set(m.id, d);
            prev = m;
          }
          const c = path[path.length - 1];
          if (above.get(c.id) !== 0 && !next.includes(c) && !visitedUp.has(c.id)) next.push(c);
          continue;
        }
        for (const id of n.up) {
          const m = byId.get(id);
          if (!m || above.get(m.id) === 0) continue;
          if (!(m.top < n.top)) continue; // otherwise only ever closer to the top
          upEdges.add(n.id + '\n' + m.id);
          const d = above.get(n.id) + 1;
          if (!above.has(m.id) || (above.get(m.id) > d && m.id !== start.id)) above.set(m.id, d);
          if (!next.includes(m) && !visitedUp.has(m.id)) next.push(m);
        }
      }
      ring = next;
    }
    const all = new Map(below);
    for (const [id, d] of above) all.set(id, Math.min(d, all.get(id) ?? Infinity));
    const linked = new Map();
    for (const id of start.linked) if (byId.has(id) && !all.has(id)) linked.set(id, 1);
    for (const [id, d] of linked) all.set(id, d);
    return { all, below, above, linked, upEdges, critEdges };
  }

  // ---------- motion: a calm free-form layout ----------
  // Notes push each other apart, links pull their two notes together, and everything slows to a stop.
  // Nothing keeps "correcting" afterwards, so the graph doesn't twitch.
  function tick() {
    const a = alpha;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const f = (settings.repel * a) / d2;
        p.vx += dx * f; p.vy += dy * f;
        q.vx -= dx * f; q.vy -= dy * f;
      }
    }
    for (const [p, q] of edges) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - settings.dist) / d) * 0.06 * settings.linkMul * a;
      p.vx += dx * f; p.vy += dy * f;
      q.vx -= dx * f; q.vy -= dy * f;
    }
    // Notes in the same group drift towards the group's middle
    if (settings.pull) {
      const centres = new Map();
      for (const p of nodes) {
        if (!p.group) continue;
        const c = centres.get(p.group.id) || { x: 0, y: 0, n: 0 };
        c.x += p.x; c.y += p.y; c.n++;
        centres.set(p.group.id, c);
      }
      for (const p of nodes) {
        const c = p.group && centres.get(p.group.id);
        if (!c || c.n < 2) continue;
        p.vx += (c.x / c.n - p.x) * 0.02 * a;
        p.vy += (c.y / c.n - p.y) * 0.02 * a;
      }
    }
    // Pull towards the middle of the graph: big notes strongly, small ones loosely, so the biggest note sits
    // in the centre with the rest spread around it like a web
    let mx = 0;
    let my = 0;
    for (const p of nodes) { mx += p.x; my += p.y; }
    mx /= nodes.length || 1;
    my /= nodes.length || 1;
    for (const p of nodes) {
      const g = 0.003 + 0.05 * (p.size || 0);
      p.vx -= (p.x - mx) * g * a;
      p.vy -= (p.y - my) * g * a;
      if (isHeld(p)) { p.vx = p.vy = 0; continue; }
      if (dragRegion && !dragRegion.has(p)) { p.vx = p.vy = 0; } // far from the dragged note: stays put
      p.vx *= 0.6;
      p.vy *= 0.6;
      const v = hyp(p.vx, p.vy);
      if (v > 40) { p.vx *= 40 / v; p.vy *= 40 / v; }
      p.x += p.vx;
      p.y += p.vy;
      const target = guide.get(p.id); // gliding out of the way of overlapping lines while you drag
      if (target) {
        p.x += (target[0] - p.x) * 0.035; // slow glide, not a jump
        p.y += (target[1] - p.y) * 0.035;
      }
    }
    // Notes never overlap: anything closer than their sizes allow is moved apart directly
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        const need = radius(p) + radius(q) + 10;
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        if (Math.abs(dx) > need || Math.abs(dy) > need) continue;
        let d = hyp(dx, dy);
        if (d >= need) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const fp = isHeld(p);
        const fq = isHeld(q);
        if (fp && fq) continue;
        const sp = fp ? 0 : fq ? 1 : 0.5;
        const move = need - d;
        p.x -= (dx / d) * move * sp; p.y -= (dy / d) * move * sp;
        q.x += (dx / d) * move * (1 - sp); q.y += (dy / d) * move * (1 - sp);
      }
    }
    for (const p of nodes) positions.set(p.id, { x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    alpha = Math.max(alpha * 0.985, drag?.node ? 0.3 : 0); // keep linked notes following while you drag
  }

  // Held notes don't move: the one being dragged, pinned ones, and the one you dropped last
  const isHeld = (p) => (drag && drag.node === p) || p.pinned || held.has(p.id);

  // ---------- choosing a clean starting layout ----------
  // Lines crossing, lines running through other notes, and labels on top of each other are what make a graph
  // look messy. We try many starting arrangements, let each settle, score it, and keep the cleanest one.
  const turn = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const segmentsCross = (p, q, r, s) => turn(p, q, r) * turn(p, q, s) < 0 && turn(r, s, p) * turn(r, s, q) < 0;
  // Does segment p–q pass through box b?
  function segmentHitsBox(p, q, b) {
    const inside = (pt) => pt.x > b.x0 && pt.x < b.x1 && pt.y > b.y0 && pt.y < b.y1;
    if (inside(p) || inside(q)) return true;
    const c = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
    return [0, 1, 2, 3].some((i) => segmentsCross(p, q, c[i], c[(i + 1) % 4]));
  }
  // Sweep from left to right so only lines whose boxes overlap get the exact test (fast for big vaults)
  function countCrossings() {
    const boxes = edges.map(([p, q]) => ({ p, q, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) }));
    boxes.sort((a, b) => a.x0 - b.x0);
    let k = 0;
    for (let i = 0; i < boxes.length; i++) {
      const A = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const B = boxes[j];
        if (B.x0 > A.x1) break;
        if (B.y0 > A.y1 || B.y1 < A.y0) continue;
        const { p, q } = A;
        const { p: r, q: s } = B;
        if (p !== r && p !== s && q !== r && q !== s && segmentsCross(p, q, r, s)) k++;
      }
    }
    return k;
  }
  function messiness() {
    let lineThroughNote = 0;
    for (const [p, q] of edges) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      const x0 = Math.min(p.x, q.x);
      const x1 = Math.max(p.x, q.x);
      const y0 = Math.min(p.y, q.y);
      const y1 = Math.max(p.y, q.y);
      for (const m of nodes) {
        if (m === p || m === q) continue;
        const reach = radius(m) + 10;
        if (m.x + reach < x0 || m.x - reach > x1 || m.y + reach < y0 || m.y - reach > y1) continue; // nowhere near
        const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
        if (t <= 0 || t >= 1) continue;
        // the note itself
        if (hyp(m.x - (p.x + t * dx), m.y - (p.y + t * dy)) < reach) lineThroughNote++;
      }
      // …and its label, drawn below it
      for (const m of nodes) {
        if (m === p || m === q) continue;
        const reach = m.labelW / 2 + 4;
        if (m.x + reach < x0 || m.x - reach > x1 || m.y + radius(m) + 17 < y0 || m.y > y1) continue; // nowhere near
        const half = m.labelW / 2 + 4;
        const top = m.y + radius(m) + 2;
        if (segmentHitsBox(p, q, { x0: m.x - half, x1: m.x + half, y0: top, y1: top + 15 })) lineThroughNote++;
      }
    }
    let labelsOverlap = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i];
        const q = nodes[j];
        if (Math.abs(p.x - q.x) < (p.labelW + q.labelW) / 2 + 6 && Math.abs(p.y + radius(p) - q.y - radius(q)) < 16) labelsOverlap++;
      }
    }
    return countCrossings() * 1000 + stackedNotes() * 500 + bunchedLines().length * 300 + labelsOnNotes().length * 50 + lineThroughNote * 50 + labelsOverlap * 5;
  }
  const snapshot = () => new Map(nodes.map((n) => [n.id, [n.x, n.y]]));
  const restore = (snap) => { for (const n of nodes) [n.x, n.y] = snap.get(n.id); };

  // Try many starting arrangements for the notes that may move, let each settle, keep the cleanest
  // (fewest crossings, lines through notes, overlapping labels and overly long lines)
  function searchLayout(budgetMs) {
    const until = performance.now() + budgetMs;
    const free = nodes.filter((n) => !n.pinned && !held.has(n.id));
    if (!free.length) return;
    const spread = Math.sqrt(nodes.length) * 60;
    // centre the search on any notes that are fixed, so the rest grows around them
    const fixed = nodes.filter((n) => n.pinned || held.has(n.id));
    const cx = fixed.length ? fixed.reduce((s, n) => s + n.x, 0) / fixed.length : 0;
    const cy = fixed.length ? fixed.reduce((s, n) => s + n.y, 0) / fixed.length : 0;
    let best = null;
    let bestScore = Infinity;
    for (let seed = 1; ; seed++) {
      let s = seed * 7919;
      const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (const n of free) Object.assign(n, { x: cx + (rand() - 0.5) * spread, y: cy + (rand() - 0.5) * spread, vx: 0, vy: 0 });
      alpha = 1;
      // the first try always settles fully; later ones stop when time is up
      for (let i = 0; i < 400 && alpha > 0.005 && (seed === 1 || performance.now() < until); i++) tick();
      const score = repairScore();
      if (score < bestScore) {
        bestScore = score;
        best = snapshot();
      }
      if (untidiness() === 0) break; // clean (and the pull to the middle keeps it web-like)
      if (performance.now() > until) break;
    }
    restore(best);
    alpha = 0;
  }

  // Opening the graph / Reset layout: a fresh clean layout (animated from `from` if given)
  // Kept short so opening the graph doesn't freeze; the background repair cleans up whatever is left
  function findCleanLayout(budgetMs = 250, from = null) {
    searchLayout(budgetMs);
    const swings = improve(80);
    lineLen = typicalLine();
    for (const [id, a] of polish(new Set(nodes), 90, snapshot())) if (!swings.has(id)) swings.set(id, a); // even out the shapes
    for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
    if (from) animateFrom(from, swings);
    startDeepRepair(); // any crossings left get untangled in the background
  }

  // ---------- repairing a layout ----------
  // When lines cross (or run through notes, or labels overlap), move the notes involved — not held or pinned
  // ones — to another spot around the note they're linked to, e.g. swing a note's children round to its other
  // side. Each move is kept only if it makes things cleaner; repeat until nothing overlaps.
  function troubleNotes(onlyOverlaps = false) {
    const out = new Set();
    // notes on top of each other
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i];
        const q = nodes[j];
        if (hyp(p.x - q.x, p.y - q.y) < radius(p) + radius(q) + 16) { out.add(p); out.add(q); }
      }
    }
    for (const [a, b] of bunchedLines()) { out.add(a); out.add(b); }
    for (const [a, b] of labelsOnNotes()) { out.add(a); out.add(b); }
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [p, q] = edges[i];
        const [r, s] = edges[j];
        if (p !== r && p !== s && q !== r && q !== s && segmentsCross(p, q, r, s)) [p, q, r, s].forEach((n) => out.add(n));
      }
    }
    for (const [p, q] of edges) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      // overly long lines are trouble too (unless we're only fixing overlaps)
      if (!onlyOverlaps && Math.sqrt(len2) > settings.dist * 2.5) [p, q].forEach((n) => out.add(n));
      for (const m of nodes) {
        if (m === p || m === q) continue;
        const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
        if (t > 0 && t < 1 && hyp(m.x - (p.x + t * dx), m.y - (p.y + t * dy)) < radius(m) + 10) [m, p, q].forEach((n) => out.add(n));
      }
    }
    // Small notes first: they're the cheapest to move
    return [...out].filter((n) => !isHeld(n)).sort((a, b) => a.deg - b.deg || a.size - b.size);
  }

  // Messiness plus a cost for lines much longer than usual, so a fix never flings a note far away.
  // 0 means clean.
  function untidiness() {
    let stretch = 0;
    for (const [p, q] of edges) stretch += Math.max(0, hyp(q.x - p.x, q.y - p.y) - settings.dist * 2.5);
    return messiness() + stretch * 2;
  }
  // For choosing between layouts: untidiness, plus a nudge towards the biggest notes being central
  function repairScore() {
    // big notes away from the middle look less like a web
    let mx = 0;
    let my = 0;
    for (const n of nodes) { mx += n.x; my += n.y; }
    mx /= nodes.length || 1;
    my /= nodes.length || 1;
    let offCentre = 0;
    for (const n of nodes) offCentre += (n.size || 0) * hyp(n.x - mx, n.y - my);
    return untidiness() + offCentre * 0.1 + shapeScore();
  }

  // Notes on top of (or touching) each other
  function stackedNotes() {
    let k = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i];
        const q = nodes[j];
        if (hyp(p.x - q.x, p.y - q.y) < radius(p) + radius(q) + 16) k++;
      }
    }
    return k;
  }

  // Two lines leaving the same note almost on top of each other (under ~10° apart): returns the pairs of
  // far ends, e.g. [[Mars, Mercury]] when Inner planets' lines to them nearly coincide
  function bunchedAt(n) {
    const out = [];
    const ns = nbrsOf(n);
    if (ns.length < 2) return out;
    const angs = ns.map((m) => [Math.atan2(m.y - n.y, m.x - n.x), m]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < angs.length; i++) {
      const j = (i + 1) % angs.length;
      const gap = j ? angs[j][0] - angs[i][0] : angs[0][0] + 2 * Math.PI - angs[i][0];
      if (gap < 0.18) out.push([angs[i][1], angs[j][1]]);
    }
    return out;
  }
  // How many of those pairs a note has (same as bunchedAt(n).length, without building the pairs: hot in the repair)
  const angBuf = [];
  function tightGaps(n) {
    const ns = nbrsOf(n);
    const L = ns.length;
    if (L < 2) return 0;
    for (let i = 0; i < L; i++) {
      const a = Math.atan2(ns[i].y - n.y, ns[i].x - n.x);
      let j = i - 1;
      while (j >= 0 && angBuf[j] > a) { angBuf[j + 1] = angBuf[j]; j--; }
      angBuf[j + 1] = a;
    }
    let k = 0;
    for (let i = 0; i < L; i++) {
      const gap = i + 1 < L ? angBuf[i + 1] - angBuf[i] : angBuf[0] + 2 * Math.PI - angBuf[L - 1];
      if (gap < 0.18) k++;
    }
    return k;
  }
  function bunchedLines() {
    return nodes.flatMap(bunchedAt);
  }

  // A note's label (drawn under it) covering another note
  function labelCovers(m, n) {
    const half = m.labelW / 2;
    const rn = radius(n) + 2;
    if (n.x < m.x - half - rn || n.x > m.x + half + rn) return false; // nowhere near (quick check first)
    const y0 = m.y + radius(m) + 2;
    if (n.y < y0 - rn || n.y > y0 + 13 + rn) return false;
    const cx = Math.max(m.x - half, Math.min(n.x, m.x + half));
    const cy = Math.max(y0, Math.min(n.y, y0 + 13));
    return hyp(n.x - cx, n.y - cy) < rn;
  }
  function labelsOnNotes() {
    const out = [];
    for (const m of nodes) for (const n of nodes) if (n !== m && labelCovers(m, n)) out.push([m, n]);
    return out;
  }

  // Overlaps: two lines crossing, a line running through a note, notes on top of (or squeezed against) each
  // other, two lines almost on top of each other, or a label covering a note
  function overlaps() {
    let k = countCrossings() + stackedNotes();
    for (const n of nodes) k += tightGaps(n);
    for (const m of nodes) for (const n of nodes) if (n !== m && labelCovers(m, n)) k++;
    for (const [p, q] of edges) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      for (const m of nodes) {
        if (m === p || m === q) continue;
        const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
        if (t > 0 && t < 1 && hyp(m.x - (p.x + t * dx), m.y - (p.y + t * dy)) < radius(m) + 6) k++;
      }
    }
    return k;
  }

  // The part of overlaps() that involves the notes in S: every crossing, squeeze, near-overlap, covered note or
  // line through a note that has at least one of them in it. When only S moves, the rest of overlaps() can't
  // change, so overlaps() after a move = before − localOverlaps(S) before + localOverlaps(S) after.
  // Much cheaper than re-checking the whole graph for every spot the repair tries.
  const touchedBuf = [];
  let isTBuf = new Uint8Array(64);
  function localOverlaps(S) {
    let k = 0;
    const touched = touchedBuf;
    touched.length = 0;
    if (isTBuf.length < edges.length) isTBuf = new Uint8Array(edges.length * 2);
    const isT = isTBuf;
    for (let i = 0; i < edges.length; i++) {
      isT[i] = S.has(edges[i][0]) || S.has(edges[i][1]) ? 1 : 0;
      if (isT[i]) touched.push(i);
    }
    // lines crossing (each pair once)
    for (const i of touched) {
      const [p, q] = edges[i];
      for (let j = 0; j < edges.length; j++) {
        if (j === i || (isT[j] && j < i)) continue;
        const [r, s] = edges[j];
        if (p !== r && p !== s && q !== r && q !== s && segmentsCross(p, q, r, s)) k++;
      }
    }
    // notes squeezed together (each pair once)
    for (const p of S) {
      for (const q of nodes) {
        if (q === p || (S.has(q) && q.id < p.id)) continue;
        if (hyp(p.x - q.x, p.y - q.y) < radius(p) + radius(q) + 16) k++;
      }
    }
    // a line through a note: lines of S × all notes, other lines × notes of S
    const through = (p, q, m) => {
      if (m === p || m === q) return false;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
      return t > 0 && t < 1 && hyp(m.x - (p.x + t * dx), m.y - (p.y + t * dy)) < radius(m) + 6;
    };
    for (let i = 0; i < edges.length; i++) {
      const [p, q] = edges[i];
      for (const m of isT[i] ? nodes : S) if (through(p, q, m)) k++;
    }
    // lines almost on top of each other, at the notes whose lines moved
    const at = new Set(S);
    for (const n of S) for (const m of nbrsOf(n)) at.add(m);
    for (const n of at) k += tightGaps(n);
    // labels covering notes
    for (const m of nodes) {
      for (const n of S.has(m) ? nodes : S) if (n !== m && labelCovers(m, n)) k++;
    }
    return k;
  }

  // While you drag (a few times a second): if something overlaps, work out where the notes involved should
  // go and let them glide there, so the graph untangles while you're still moving instead of after
  function liveTidy() {
    const now = performance.now();
    if (now - lastLive < (nodes.length > 60 ? 400 : 250)) return; // less often in big vaults so dragging stays fluid
    lastLive = now;
    if (!overlaps()) return; // keep any glides already under way; nothing new to fix
    const snap = snapshot();
    improve(nodes.length > 60 ? 5 : 8, true); // a short look each time, so dragging stays smooth
    for (const n of nodes) {
      const [x, y] = snap.get(n.id);
      if (hyp(n.x - x, n.y - y) > 0.5) guide.set(n.id, [n.x, n.y]);
    }
    restore(snap);
  }

  // A note's linked notes. Kept per note object, since the repair asks thousands of times a second (a rebuild
  // makes new note objects, and the background repair's copies are their own objects too)
  let nbrCache = new WeakMap();
  const nbrsOf = (n) => {
    let ns = nbrCache.get(n);
    if (!ns) nbrCache.set(n, (ns = [...n.nbrs].map((id) => byId.get(id)).filter(Boolean)));
    return ns;
  };

  // The branch hanging off `anchor` through n: n plus everything reachable from it without going through
  // the anchor. null if that's most of the graph or includes a note that must stay put.
  function branchFrom(n, anchor) {
    const seen = new Set([n]);
    const stack = [n];
    while (stack.length) {
      const p = stack.pop();
      for (const m of nbrsOf(p)) {
        if (m === anchor || seen.has(m)) continue;
        if (isHeld(m) || seen.size >= nodes.length / 2) return null;
        seen.add(m);
        stack.push(m);
      }
    }
    return [...seen];
  }

  // Notes up to `hops` links away from n (including n)
  function around(n, hops) {
    const seen = new Set([n]);
    let ring = [n];
    for (let h = 0; h < hops; h++) {
      const next = [];
      for (const p of ring) for (const m of nbrsOf(p)) if (!seen.has(m)) { seen.add(m); next.push(m); }
      ring = next;
    }
    return seen;
  }

  // How far the graph is from looking like star constellations — lower is better:
  //  - lines about the same length (the Spacing slider), so shapes come out even
  //  - the lines at each note spread out instead of bunching up, so the gaps between them close into
  //    simple, open shapes (triangles, quadrilaterals, fans) rather than slivers
  // `only`: score just these notes and their lines
  function shapeScore(only = null) {
    const D = lineLen || settings.dist;
    const seen = new Set();
    let s = 0;
    for (const n of only || nodes) {
      const ns = nbrsOf(n);
      for (const m of ns) {
        const key = n.id < m.id ? n.id + '\n' + m.id : m.id + '\n' + n.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const e = (hyp(m.x - n.x, m.y - n.y) - D) / D;
        s += e * e * 40;
      }
      if (ns.length < 2) continue;
      const angs = ns.map((m) => Math.atan2(m.y - n.y, m.x - n.x)).sort((a, b) => a - b);
      const want = Math.min((2 * Math.PI) / angs.length, Math.PI / 2.2); // the gap two lines should at least have
      for (let i = 0; i < angs.length; i++) {
        const gap = i + 1 < angs.length ? angs[i + 1] - angs[i] : angs[0] + 2 * Math.PI - angs[i];
        const tight = Math.max(0, want - gap);
        s += tight * tight * 60;
      }
    }
    return s;
  }

  // Small, local nudges that make `region` more constellation-like without changing the overall shape:
  // each note may turn a little around a linked note or ease towards the usual line length. A nudge is kept
  // only if it improves the shapes there, adds no overlap, and is worth how far the note moves from `origin`.
  function polish(region, budgetMs, origin) {
    const until = performance.now() + budgetMs;
    const D = lineLen || settings.dist;
    const list = [...region].filter((n) => !isHeld(n) && n.nbrs.size);
    const swings = new Map();
    let base = overlaps();
    for (let pass = 0; pass < 8 && performance.now() < until; pass++) {
      let any = false;
      for (const n of list) {
        if (performance.now() > until) break;
        const ns = nbrsOf(n);
        const tagAlong = ns.filter((m) => m.deg === 1 && !isHeld(m));
        const anchors = ns.filter((m) => !tagAlong.includes(m));
        if (!anchors.length) continue;
        const local = [n, ...ns];
        const [fx, fy] = origin.get(n.id);
        const ox = n.x;
        const oy = n.y;
        const moveTo = (x, y) => {
          const dx = x - n.x;
          const dy = y - n.y;
          n.x = x;
          n.y = y;
          for (const m of tagAlong) { m.x += dx; m.y += dy; }
        };
        const cost = () => shapeScore(local) + hyp(n.x - fx, n.y - fy) * 0.08 * (1 + tagAlong.length);
        let best = cost();
        let bestPos = null;
        let bestAnchor = null;
        for (const a of anchors) {
          const r0 = hyp(ox - a.x, oy - a.y) || D;
          const t0 = Math.atan2(oy - a.y, ox - a.x);
          for (const r of [r0, (r0 + D) / 2, D]) {
            for (const da of [0, 0.12, -0.12, 0.25, -0.25]) {
              if (r === r0 && !da) continue;
              moveTo(a.x + r * Math.cos(t0 + da), a.y + r * Math.sin(t0 + da));
              const c = cost();
              if (c < best - 0.3 && overlaps() <= base) {
                best = c;
                bestPos = [n.x, n.y];
                bestAnchor = a;
              }
            }
          }
        }
        moveTo(ox, oy);
        if (bestPos) {
          moveTo(...bestPos);
          swings.set(n.id, bestAnchor.id);
          for (const m of tagAlong) swings.set(m.id, n.id);
          base = overlaps();
          any = true;
        }
      }
      if (!any) break;
    }
    return swings;
  }

  // After a change: the graph keeps its shape. Only around the note you dropped (two links out) do notes
  // move — first anything overlapping is fixed with the smallest moves, then the shapes there are evened out
  // into constellation-like ones. Animated. `dropped`: the note you let go of (none for a slider change —
  // then the whole graph gets the gentle evening-out).
  // The graph's typical line length (median), so evening out shapes keeps the spacing it has
  function typicalLine() {
    if (!edges.length) return settings.dist;
    const lens = edges.map(([p, q]) => hyp(q.x - p.x, q.y - p.y)).sort((a, b) => a - b);
    return lens[Math.floor(lens.length / 2)];
  }

  // `relax`: first let the physics finish what it's doing (a slider was just moved), so the graph ends up
  // spread out the way the new setting says instead of stopping halfway
  function settleAndTidy(dropped = null, relax = false) {
    for (const n of nodes) {
      if (n.anim) { n.x = n.anim.gx; n.y = n.anim.gy; n.anim = null; }
    }
    const from = snapshot();
    if (relax) {
      alpha = Math.max(alpha, 0.3);
      const until = performance.now() + 200;
      while (alpha > 0.005 && performance.now() < until) tick();
    }
    for (const [id, [x, y]] of guide) {
      const n = byId.get(id);
      if (n && !isHeld(n)) { n.x = x; n.y = y; n.vx = 0; n.vy = 0; }
    }
    const continuing = guide.size > 0;
    guide.clear();
    alpha = 0; // stop exactly as it is
    stopDeepRepair();
    // A quick fix right away (short, so the page never freezes); a big mess (something dragged far) is left
    // to the thorough repair, which runs in the background afterwards
    const swings = overlaps() && countCrossings() < 3 ? improve(nodes.length > 60 ? 30 : 50, true) : new Map();
    const region = dropped ? around(dropped, 2) : new Set(nodes);
    lineLen = typicalLine();
    for (const [id, a] of polish(region, 40, from)) if (!swings.has(id)) swings.set(id, a);
    for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
    // notes already gliding finish with an ease-out, so they don't stop and start again
    animateFrom(from, swings, continuing ? { dur: 1600, ease: 'out' } : {});
    startDeepRepair(); // whatever the quick fix couldn't untangle (does nothing if it's all clean)
  }

  // Move the notes in trouble one by one to cleaner spots; returns which note each moved one swung around
  // `minimal`: only fix overlapping lines, and move as little as possible (keeps the shape you left it in)
  function improve(budgetMs, minimal = false) {
    const until = performance.now() + budgetMs;
    const swingsAround = new Map(); // moved note id -> id of the note it swings around in the animation
    const free = (n) => !isHeld(n); // the note in your hand, pinned notes and the last dropped one stay put
    const evaluate = minimal ? () => overlaps() * 1000 : repairScore;
    const moveCost = minimal ? 2 : 0.01; // per pixel moved
    let score = evaluate();
    let count = minimal ? score / 1000 : 0; // overlaps right now (minimal mode)
    // score with only the notes in S moved, given before = localOverlaps(S) before they moved (fast)
    const scoreMoved = (S, before) => (minimal ? (count - before + localOverlaps(S)) * 1000 : repairScore());
    const clean = minimal ? () => count === 0 : () => untidiness() < 0.5;
    // End notes first; only if that isn't enough, notes with more links
    for (const maxLinks of [1, 2, 3, Infinity]) {
      let improved = true;
      while (performance.now() < until && improved && !clean()) {
        improved = false;
        for (const n of troubleNotes(minimal).filter((t) => t.deg <= maxLinks)) {
          // Its end notes (linked only to it) move along with it, keeping the branch together
          const tagAlong = [...n.nbrs].map((id) => byId.get(id)).filter((m) => m && m.deg === 1 && free(m));
          const anchors = [...n.nbrs].map((id) => byId.get(id)).filter((m) => m && !tagAlong.includes(m));
          if (!anchors.length) continue;
          const ox = n.x;
          const oy = n.y;
          const moveTo = (x, y) => {
            const dx = x - n.x;
            const dy = y - n.y;
            n.x = x;
            n.y = y;
            for (const m of tagAlong) { m.x += dx; m.y += dy; }
          };
          let bestPos = null;
          let bestAnchor = null;
          let best = score;
          const moving = new Set([n, ...tagAlong]);
          const before = minimal ? localOverlaps(moving) : 0;
          // Try spots around each note it links to: small turns from where it is now first (same distance,
          // so the shape holds), then the full circle at normal link length and its current distance
          for (const anchor of anchors) {
            const r0 = Math.max(settings.dist * 0.6, hyp(ox - anchor.x, oy - anchor.y));
            const now = Math.atan2(oy - anchor.y, ox - anchor.x);
            const spots = [];
            for (const d of [10, 20, 30, 45, 60, 80, 100]) for (const sgn of [1, -1]) spots.push([r0, now + (sgn * d * Math.PI) / 180]);
            for (const r of [r0, settings.dist, settings.dist * 1.6, r0 * 1.4]) for (let k = 0; k < 16; k++) spots.push([r, (k / 16) * Math.PI * 2]);
            for (const [r, a] of spots) {
              if (performance.now() > until) break; // big vaults: stop on time, keep the best spot so far
              moveTo(anchor.x + r * Math.cos(a), anchor.y + r * Math.sin(a));
              const s = scoreMoved(moving, before) + hyp(n.x - ox, n.y - oy) * moveCost * (1 + tagAlong.length);
              if (s < best - 0.5) {
                best = s;
                bestPos = [n.x, n.y];
                bestAnchor = anchor;
              }
            }
          }
          // Still nothing that removes an overlap? Then try changing its line's length: pulled in closer, or further
          // out (up to about twice as long) to make room beyond whatever's crowding it. Only taken if it clears every
          // overlap the note has, so lines never change length for a half-fix and the graph doesn't slowly spread out.
          const stuck = () => minimal && best > score - 500;
          const maxLen = (lineLen || settings.dist) * 2.4;
          if (stuck()) {
            for (const anchor of anchors) {
              const r0 = Math.max(settings.dist * 0.6, hyp(ox - anchor.x, oy - anchor.y));
              const now = Math.atan2(oy - anchor.y, ox - anchor.x);
              for (const f of [0.75, 0.55, 1.4, 1.8, 2.2]) {
                if (r0 * f > maxLen) break;
                if (r0 * f < settings.dist * 0.4) continue; // shorter, but never cramped
                for (const d of [0, 20, -20, 45, -45]) {
                  if (performance.now() > until) break;
                  const a = now + (d * Math.PI) / 180;
                  moveTo(anchor.x + r0 * f * Math.cos(a), anchor.y + r0 * f * Math.sin(a));
                  if (localOverlaps(moving) !== 0) continue;
                  const s = scoreMoved(moving, before) + hyp(n.x - ox, n.y - oy) * moveCost * (1 + tagAlong.length);
                  if (s < best - 0.5) {
                    best = s;
                    bestPos = [n.x, n.y];
                    bestAnchor = anchor;
                  }
                }
              }
            }
          }
          moveTo(ox, oy);
          // Moving one note alone can't always fix it (e.g. two linked siblings on either side of a line).
          // So also try moving a whole branch as one rigid piece, which keeps the branch's own shape: the branch
          // hanging off this note, and one level up, the branch its linked notes hang in (e.g. a whole cluster
          // that's in the way of a note dropped into it).
          let bestTurn = null;
          if (!bestPos || best > 0.5) {
            const pairs = anchors.map((a) => [n, a]);
            for (const a of anchors) if (free(a)) for (const b of nbrsOf(a)) if (b !== n) pairs.push([a, b]);
            for (const [root, anchor] of pairs) {
              const branch = branchFrom(root, anchor);
              if (!branch || branch.length < 2) continue;
              const start = branch.map((m) => [m.x, m.y]);
              const rx = root.x;
              const ry = root.y;
              const r0 = hyp(rx - anchor.x, ry - anchor.y);
              const group = new Set(branch);
              const before = minimal ? localOverlaps(group) : 0;
              for (const deg of [20, -20, 40, -40, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
                if (performance.now() > until) break;
                const a = (deg * Math.PI) / 180;
                const cos = Math.cos(a);
                const sin = Math.sin(a);
                branch.forEach((m, i) => {
                  const dx = start[i][0] - anchor.x;
                  const dy = start[i][1] - anchor.y;
                  m.x = anchor.x + dx * cos - dy * sin;
                  m.y = anchor.y + dx * sin + dy * cos;
                });
                // cost of the swing: how far the branch's root travels, a bit more for bigger branches
                const s = scoreMoved(group, before) + r0 * Math.abs(a) * moveCost * (1 + Math.sqrt(branch.length) / 2);
                if (s < best - 0.5) {
                  best = s;
                  bestTurn = { branch, pos: branch.map((m) => [m.x, m.y]), anchor };
                }
              }
              // …or slide the whole branch, unchanged, to another spot round the anchor (e.g. out of the way of
              // a note dropped in the middle of it)
              for (const r of [r0, settings.dist * 1.5, r0 * 1.6]) {
                for (let s16 = 0; s16 < 16; s16++) {
                  if (performance.now() > until) break;
                  const a = (s16 / 16) * Math.PI * 2;
                  const dx = anchor.x + r * Math.cos(a) - rx;
                  const dy = anchor.y + r * Math.sin(a) - ry;
                  branch.forEach((m, i) => { m.x = start[i][0] + dx; m.y = start[i][1] + dy; });
                  const s = scoreMoved(group, before) + hyp(dx, dy) * moveCost * (1 + Math.sqrt(branch.length) / 2);
                  if (s < best - 0.5) {
                    best = s;
                    bestTurn = { branch, pos: branch.map((m) => [m.x, m.y]), anchor };
                  }
                }
              }
              // …or push the whole branch further out along its line (the line to the anchor gets longer),
              // making room for it beyond whatever it's crossing
              const dir = Math.atan2(ry - anchor.y, rx - anchor.x);
              for (const f of stuck() ? [0.75, 0.55, 1.3, 1.6, 2] : []) {
                if (r0 * f > maxLen) break;
                if (r0 * f < settings.dist * 0.4) continue;
                for (const da of [0, 0.25, -0.25]) {
                  if (performance.now() > until) break;
                  const dx = anchor.x + r0 * f * Math.cos(dir + da) - rx;
                  const dy = anchor.y + r0 * f * Math.sin(dir + da) - ry;
                  branch.forEach((m, i) => { m.x = start[i][0] + dx; m.y = start[i][1] + dy; });
                  if (localOverlaps(group) !== 0) continue; // only if it clears the branch completely
                  const s = scoreMoved(group, before) + hyp(dx, dy) * moveCost * (1 + Math.sqrt(branch.length) / 2);
                  if (s < best - 0.5) {
                    best = s;
                    bestTurn = { branch, pos: branch.map((m) => [m.x, m.y]), anchor };
                  }
                }
              }
              branch.forEach((m, i) => { [m.x, m.y] = start[i]; });
            }
          }
          if (bestTurn) {
            bestTurn.branch.forEach((m, i) => {
              [m.x, m.y] = bestTurn.pos[i];
              swingsAround.set(m.id, bestTurn.anchor.id); // the whole branch swings round the anchor together
            });
            score = evaluate();
            if (minimal) count = score / 1000;
            improved = true;
          } else if (bestPos) {
            moveTo(...bestPos);
            swingsAround.set(n.id, bestAnchor.id);
            for (const m of tagAlong) swingsAround.set(m.id, n.id); // its end notes ride along with it
            score = evaluate();
            if (minimal) count = score / 1000;
            improved = true;
          }
          if (clean() || performance.now() > until) break;
        }
      }
      if (clean()) break;
    }
    return swingsAround;
  }

  // The thorough untangling, written as a generator so it runs a few milliseconds at a time between frames
  // instead of freezing the page. Runs on a copy of the graph (see startDeepRepair). Each time it has something
  // cleaner it yields { apply: positions, swings, count } so the graph can glide there right away, and it ends
  // returning the same for the cleanest layout found. `job.over` set: stop soon with the best so far.
  function* deepRepair(job) {
    const snap0 = snapshot();
    const big = countCrossings() >= 3;
    let best = { count: overlaps(), pos: snap0, swings: new Map() };
    let shown = best.count;
    const keep = (swings) => {
      const k = overlaps();
      if (k < best.count) best = { count: k, pos: snapshot(), swings };
    };
    const show = () => {
      if (best.count >= shown) return null;
      shown = best.count;
      return { apply: best.pos, swings: best.swings, count: best.count };
    };
    // 1. the usual small moves and flips (quick, and they keep the shape best): about a tenth of the time
    const a = yield* smallMoves(job, 0.1);
    keep(a.swings);
    yield show();
    // 2. annealing, from the best so far — and for a big mess also from the layout as you left it, since the
    //    small moves can lead into a corner
    const starts = big ? [best.pos, snap0] : [best.pos, best.pos];
    for (let i = 0; i < starts.length && best.count && !job.over; i++) {
      restore(starts[i]);
      yield* anneal(job, i === starts.length - 1 ? 0.95 : 0.52, i + 1);
      keep(new Map()); // no particular note to swing round: each glides round its biggest linked note
      yield show();
    }
    // 3. a last round of small moves on the cleanest one
    restore(best.pos);
    for (let i = 0; i < 3 && best.count && !job.over; i++) {
      const more = improve(nodes.length > 60 ? 15 : 30, true);
      keep(new Map([...best.swings, ...more]));
      restore(best.pos);
      yield;
    }
    restore(best.pos);
    return { apply: best.pos, swings: best.swings, count: best.count };
  }

  // Annealing: many small random moves of single notes (their end notes come along). A move is kept if it makes
  // things cleaner — and, early on, sometimes even if it makes them a bit worse, so the layout can get out of a
  // knot that every cleaner step leaves stuck in. It cools down as it goes and ends on the cleanest layout it
  // passed through. Judged on every line: overlaps first, then lines stretched much longer than usual, then how
  // far notes moved. Runs until `share` of the job's time is used; `seed` picks the random moves.
  function* anneal(job, share, seed) {
    // works with lines a bit shorter than the graph's usual ones: keeping each note close to the notes it links
    // to leaves fewer lines to cross (with the full length it untangled a big knot far less often)
    const D = (lineLen || settings.dist) * 0.65;
    const maxLen = D * 2.6;
    const movable = nodes.filter((n) => !isHeld(n));
    if (!movable.length) return;
    let s = (99991 * seed) % 2147483647;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const start = new Map(nodes.map((n) => [n, [n.x, n.y]]));
    const stretchOf = (S) => {
      let k = 0;
      const seen = new Set();
      for (const n of S) {
        for (const m of nbrsOf(n)) {
          const key = n.id < m.id ? n.id + '\n' + m.id : m.id + '\n' + n.id;
          if (seen.has(key)) continue;
          seen.add(key);
          k += Math.max(0, hyp(m.x - n.x, m.y - n.y) - maxLen);
        }
      }
      return k;
    };
    const travelOf = (S) => {
      let k = 0;
      for (const n of S) {
        const [x, y] = start.get(n);
        k += hyp(n.x - x, n.y - y);
      }
      return k;
    };
    const local = (S) => localOverlaps(S) * 1000 + stretchOf(S) * 3 + travelOf(S) * 0.03;
    let score = overlaps() * 1000 + stretchOf(nodes) * 3 + travelOf(nodes) * 0.03;
    // The chains: for every note P and each of its links, everything hanging off P that way (up to notes that
    // can't move). Moving a whole chain at once — turned round P, mirrored, or slid round to another side of P —
    // keeps its shape, e.g. a note dropped into another cluster gets its chains swung over to its open side.
    const chains = [];
    const seenChain = new Set();
    for (const P of nodes) {
      for (const R of nbrsOf(P)) {
        if (isHeld(R)) continue;
        const G = new Set([R]);
        const stack = [R];
        let tooBig = false;
        while (stack.length && !tooBig) {
          for (const m of nbrsOf(stack.pop())) {
            if (m === P || G.has(m) || isHeld(m)) continue;
            G.add(m);
            stack.push(m);
            if (G.size > movable.length * 0.6) { tooBig = true; break; }
          }
        }
        if (tooBig || G.size < 2) continue;
        const key = P.id + '\n' + [...G].map((n) => n.id).sort().join('\n');
        if (seenChain.has(key)) continue;
        seenChain.add(key);
        chains.push({ P, R, list: [...G], set: G });
      }
    }
    let best = score;
    let bestSnap = snapshot();
    let focus = movable;
    const t0 = job.spent();
    const end = job.limit * share;
    const span = Math.max(1, end - t0);
    for (let it = 0; !job.over && job.spent() < end; it++) {
      if (it % 300 === 0) {
        // mostly move the notes in trouble and the notes they link to
        const f = new Set();
        for (const n of troubleNotes(true)) {
          f.add(n);
          for (const m of nbrsOf(n)) if (!isHeld(m)) f.add(m);
        }
        focus = f.size ? [...f] : movable;
        if (!f.size) break; // nothing in trouble any more
        yield;
      } else if (it % 12 === 0) yield;
      // how much worse a move may be and still be taken: two overlaps' worth at first, cooling to almost nothing
      const T = 2000 * Math.pow(0.01, Math.min(1, (job.spent() - t0) / span));
      if (chains.length && rand() < 0.2) {
        // a whole chain at once: turned round its note, mirrored, or slid round to another side of it
        const { P, R, list, set } = chains[Math.floor(rand() * chains.length)];
        const before = local(set);
        const start = list.map((n) => [n.x, n.y]);
        const kind = rand();
        const a0 = Math.atan2(R.y - P.y, R.x - P.x);
        if (kind < 0.6) {
          // turn by an angle, and maybe pull in or push out
          const turn = kind < 0.4 ? (rand() < 0.5 ? -1 : 1) * (0.3 + rand() * (Math.PI - 0.3)) : rand() * Math.PI * 2 - a0;
          const r0 = hyp(R.x - P.x, R.y - P.y) || D;
          const out = kind < 0.4 ? 0 : D * (0.8 + rand() * 0.6) - r0;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          const ox = Math.cos(a0 + turn) * out;
          const oy = Math.sin(a0 + turn) * out;
          list.forEach((n, i) => {
            const x = start[i][0] - P.x;
            const y = start[i][1] - P.y;
            n.x = P.x + x * cos - y * sin + ox;
            n.y = P.y + x * sin + y * cos + oy;
          });
        } else {
          // mirrored across the line from P through R
          const c2 = Math.cos(2 * a0);
          const s2 = Math.sin(2 * a0);
          list.forEach((n, i) => {
            const x = start[i][0] - P.x;
            const y = start[i][1] - P.y;
            n.x = P.x + x * c2 + y * s2;
            n.y = P.y + x * s2 - y * c2;
          });
        }
        const delta = local(set) - before;
        if (delta <= 0 || rand() < Math.exp(-delta / T)) {
          score += delta;
          if (score < best - 1e-6) {
            best = score;
            bestSnap = snapshot();
          }
        } else {
          list.forEach((n, i) => { [n.x, n.y] = start[i]; });
        }
        continue;
      }
      const pool = rand() < 0.6 ? focus : movable;
      const n = pool[Math.floor(rand() * pool.length)];
      const ns = nbrsOf(n);
      const tag = ns.filter((m) => m.deg === 1 && !isHeld(m));
      const anchors = ns.filter((m) => !tag.includes(m));
      const S = new Set([n, ...tag]);
      const before = local(S);
      let nx;
      let ny;
      if (anchors.length && rand() < 0.6) {
        // somewhere round one of the notes it links to
        const a = anchors[Math.floor(rand() * anchors.length)];
        const ang = rand() * Math.PI * 2;
        const r = D * (0.6 + rand() * 0.9);
        nx = a.x + r * Math.cos(ang);
        ny = a.y + r * Math.sin(ang);
      } else {
        // a nudge, small or bigger
        const sc = D * (rand() < 0.5 ? 0.3 : 1.2);
        nx = n.x + (rand() - 0.5) * 2 * sc;
        ny = n.y + (rand() - 0.5) * 2 * sc;
      }
      const dx = nx - n.x;
      const dy = ny - n.y;
      for (const m of S) { m.x += dx; m.y += dy; }
      const delta = local(S) - before;
      if (delta <= 0 || rand() < Math.exp(-delta / T)) {
        score += delta;
        if (score < best - 1e-6) {
          best = score;
          bestSnap = snapshot();
        }
      } else {
        for (const m of S) { m.x -= dx; m.y -= dy; }
      }
    }
    restore(bestSnap);
  }

  // The usual small moves, then flips (each finished off with small moves), until `share` of the job's time
  function* smallMoves(job, share) {
    const out = () => job.over || job.spent() > job.limit * share;
    const swings = new Map();
    let count = overlaps();
    // pieces of ~30ms: long enough for the small moves to get past the end notes to the bigger ones each time
    const slice = (ms) => improve(nodes.length > 60 ? ms / 2 : ms, true);
    for (let quiet = 0; count && quiet < 3 && !out(); ) {
      const before = count;
      for (const [id, a] of slice(30)) swings.set(id, a);
      count = overlaps();
      quiet = count < before ? 0 : quiet + 1;
      yield;
    }
    for (let round = 0; count && round < 8 && !out(); round++) {
      const snap = snapshot();
      let bestEnd = null;
      for (const cand of flips()) {
        if (bestEnd?.k === 0 || out()) break;
        restore(snap);
        cand.forEach(([n, x, y]) => { n.x = x; n.y = y; });
        const more = new Map();
        for (let i = 0; i < 2; i++) {
          for (const [id, a] of slice(30)) more.set(id, a);
          if (!overlaps()) break;
          yield;
        }
        const k = overlaps();
        if (k < count && (!bestEnd || k < bestEnd.k)) bestEnd = { k, pos: snapshot(), more, moved: cand.map(([n]) => n) };
      }
      restore(bestEnd ? bestEnd.pos : snap);
      if (!bestEnd) break; // nothing helps any more
      for (const n of bestEnd.moved) swings.delete(n.id);
      for (const [id, a] of bestEnd.more) swings.set(id, a);
      count = bestEnd.k;
      yield;
    }
    return { swings, count };
  }

  // Run deepRepair in the background on a copy of the graph; when it's done and found something cleaner,
  // the notes glide there. Anything you do in the graph meanwhile (dragging, sliders, a rebuild) cancels it.
  function stopDeepRepair() {
    if (!deepJob) return;
    deepJob.stop = true;
    clearTimeout(deepJob.timer);
    deepJob = null;
  }
  function startDeepRepair() {
    stopDeepRepair();
    const goal = (n) => (n.anim ? [n.anim.gx, n.anim.gy] : [n.x, n.y]);
    const clones = new Map(nodes.map((n) => { const [x, y] = goal(n); return [n, { ...n, x, y, vx: 0, vy: 0, anim: null }]; }));
    const world = [[...clones.values()], edges.map(([p, q]) => [clones.get(p), clones.get(q)]), new Map([...clones.values()].map((c) => [c.id, c]))];
    const inWorld = (fn) => {
      const saved = [nodes, edges, byId];
      [nodes, edges, byId] = world;
      try { return fn(); } finally { [nodes, edges, byId] = saved; }
    };
    const startCount = inWorld(overlaps);
    if (!startCount) return;
    // ms of work at most; a big mess (something dragged far) gets twice as long
    const big = inWorld(() => countCrossings() >= 3);
    const limit = (nodes.length > 60 ? 800 : 1500) * (big ? 2 : 1);
    const job = { stop: false, over: false, work: 0, timer: 0, limit, t: 0 };
    job.spent = () => job.work + performance.now() - job.t;
    const gen = deepRepair(job);
    let shown = startCount;
    // glide from wherever the notes are right now to a cleaner layout the repair found
    const glideTo = ({ apply, swings, count }) => {
      if (!apply || count >= shown) return;
      shown = count;
      const from = snapshot();
      for (const n of nodes) {
        const p = apply.get(n.id);
        if (!p) continue;
        [n.x, n.y] = p;
        n.anim = null;
        positions.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
      }
      animateFrom(from, new Map(swings), { dur: 1600, ease: 'out' });
    };
    job.run = (all = false) => {
      if (job.stop) return;
      const t = performance.now();
      job.t = t;
      let r;
      inWorld(() => {
        do {
          r = gen.next();
          if (job.work + performance.now() - t > limit) job.over = true; // enough: wrap up with the best so far
          if (r.value?.apply && !all) break; // something cleaner to show now
        } while (!r.done && (all || performance.now() - t < 10));
      });
      job.work += performance.now() - t;
      clearTimeout(job.timer);
      if (r.value?.apply) glideTo(r.value);
      if (!r.done) { job.timer = setTimeout(() => job.run(), 0); return; }
      job.stop = true;
      if (deepJob === job) deepJob = null;
    };
    deepJob = job;
    job.timer = setTimeout(() => job.run(), 30);
  }

  // Flips: a note in the knot jumps to its mirror spot across the line between two of the notes it links to,
  // or across a line it crosses (e.g. a note on the wrong side of a triangle goes over to the other side).
  // Its end notes come along. Returns the starts worth finishing off, best first (fewest crossings, then the
  // shortest jump); positions are left unchanged.
  function flips() {
    const cross = countCrossings();
    const base = overlaps();
    const found = [];
    for (const n of troubleNotes(true)) {
      if (isHeld(n)) continue;
      const ns = nbrsOf(n);
      const tag = ns.filter((m) => m.deg === 1 && !isHeld(m));
      const lines = [];
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) lines.push([ns[i], ns[j]]);
      for (const m of ns) for (const [r, s] of edges) if (r !== n && s !== n && r !== m && s !== m && segmentsCross(n, m, r, s)) lines.push([r, s]);
      const ox = n.x;
      const oy = n.y;
      const moving = [n, ...tag];
      const movingSet = new Set(moving);
      const before = localOverlaps(movingSet);
      const start = moving.map((m) => [m.x, m.y]);
      for (const [a, b] of lines) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1) continue;
        const t = ((ox - a.x) * dx + (oy - a.y) * dy) / len2;
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const mx = 2 * px - ox - ox; // shift that mirrors n across the line
        const my = 2 * py - oy - oy;
        moving.forEach((m, i) => { m.x = start[i][0] + mx; m.y = start[i][1] + my; });
        const c = countCrossings();
        // a flip may leave a few crossings that its neighbours then fix by following it
        if (c <= cross + 3) found.push({ c, k: base - before + localOverlaps(movingSet), jump: hyp(mx, my), pos: moving.map((m) => [m, m.x, m.y]) });
        moving.forEach((m, i) => { [m.x, m.y] = start[i]; });
      }
    }
    found.sort((a, b) => a.c - b.c || a.k - b.k || a.jump - b.jump);
    return found.slice(0, 8).map((f) => f.pos);
  }

  // Kept for the panel's "tidy" use: repair in place and animate
  function repair(budgetMs = 300) {
    const from = snapshot();
    animateFrom(from, improve(budgetMs));
  }

  // Animate: each moved note swings round the note it's attached to (along an arc, not a straight line),
  // a parent's branch rides along with it, and notes further out the tree start a little later
  function animateFrom(start, swingsAround, { dur = 2200, ease = 'inout' } = {}) {
    const now = performance.now();
    const moved = nodes.filter((n) => {
      const [sx, sy] = start.get(n.id);
      return hyp(n.x - sx, n.y - sy) > 0.5;
    });
    // Notes that moved without a recorded anchor swing around their biggest linked note
    for (const n of moved) {
      if (swingsAround.has(n.id)) continue;
      const parent = [...n.nbrs].map((id) => byId.get(id)).filter((m) => m && (m.size > n.size || (m.size === n.size && m.deg > n.deg))).sort((a, b) => b.size - a.size)[0];
      if (parent) swingsAround.set(n.id, parent.id);
    }
    const isMoving = new Set(moved.map((n) => n.id));
    const stepsOut = (n) => {
      // how many moving notes it hangs off (for the stagger); guards against loops
      let k = 0;
      const seen = new Set([n.id]);
      for (let id = swingsAround.get(n.id); id && isMoving.has(id) && !seen.has(id); id = swingsAround.get(id)) {
        seen.add(id);
        k++;
      }
      return k;
    };
    const end = snapshot();
    for (const n of moved) {
      const [sx, sy] = start.get(n.id);
      const [gx, gy] = end.get(n.id);
      const anchor = byId.get(swingsAround.get(n.id)) || null;
      const anim = { sx, sy, gx, gy, t0: now + (ease === 'out' ? 0 : stepsOut(n) * 260), dur, ease, anchor };
      if (anchor) {
        const [asx, asy] = start.get(anchor.id);
        const [agx, agy] = end.get(anchor.id);
        anim.r0 = hyp(sx - asx, sy - asy);
        anim.a0 = Math.atan2(sy - asy, sx - asx);
        anim.r1 = hyp(gx - agx, gy - agy);
        anim.a1 = Math.atan2(gy - agy, gx - agx);
      }
      n.anim = anim;
    }
    for (const n of moved) [n.x, n.y] = start.get(n.id);
  }
  // Gentle ease in and out (no rush in the middle)
  const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

  // Where an animating note is this frame (its anchor may be moving too, so the branch follows it)
  function animAt(n, now, stack = new Set()) {
    const a = n.anim;
    const t = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
    const e = a.ease === 'out' ? 1 - Math.pow(1 - t, 3) : easeInOut(t);
    if (a.anchor && a.r0 !== undefined && !stack.has(a.anchor.id)) {
      stack.add(n.id);
      const [ax, ay] = a.anchor.anim ? animAt(a.anchor, now, stack) : [a.anchor.x, a.anchor.y];
      const turnBy = ((a.a1 - a.a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // shortest way round
      const angle = a.a0 + turnBy * e;
      const r = a.r0 + (a.r1 - a.r0) * e;
      return [ax + r * Math.cos(angle), ay + r * Math.sin(angle)];
    }
    return [a.sx + (a.gx - a.sx) * e, a.sy + (a.gy - a.sy) * e];
  }

  // Advance the repair animation by one frame; returns true while anything is still moving
  function glide() {
    const now = performance.now();
    const next = new Map();
    for (const n of nodes) if (n.anim) next.set(n, now >= n.anim.t0 + n.anim.dur ? [n.anim.gx, n.anim.gy] : animAt(n, now));
    for (const [n, [x, y]] of next) {
      n.x = x;
      n.y = y;
      if (now >= n.anim.t0 + n.anim.dur) n.anim = null;
      positions.set(n.id, { x, y, vx: 0, vy: 0 });
    }
    return next.size > 0;
  }
  // ---------- drawing ----------
  // Every note keeps its usual size (by its own links); notes with more below them grow on top of that,
  // up to 26px times the "Node size" slider (at 0 the graph looks as it did before sizing existed)
  const radius = (n) => 4 + Math.sqrt(n.deg) * 2.2 + (n.size || 0) * 26 * settings.sizeMul;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    return { w: r.width, h: r.height, dpr };
  }

  function draw() {
    readColors();
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * (w / 2 + cam.x), dpr * (h / 2 + cam.y));

    const q = settings.filter.toLowerCase();
    const selNow = selection();
    const inBox = box?.moved ? notesInBox(box) : null; // previewed while drawing the box
    // Searching lights up the best-matching note's whole chain, as if it were hovered (hovering still wins):
    // an exact name first, then a name starting with the search, then the biggest note containing it
    if (searchFor !== q || searchNodes !== nodes) {
      searchFor = q;
      searchNodes = nodes;
      const hits = q ? nodes.filter((n) => !n.unresolved && n.label.toLowerCase().includes(q)) : [];
      const rank = (n) => (n.label.toLowerCase() === q ? 2 : n.label.toLowerCase().startsWith(q) ? 1 : 0);
      searchHit = hits.sort((a, b) => rank(b) - rank(a) || b.size - a.size || b.deg - a.deg)[0] || null;
    }
    const focus = hover || (drag && drag.node) || searchHit || null;
    const match = (n) => (!q || n.label.toLowerCase().includes(q) || !!chain?.has(n.id)) && (!litGroup || n.group?.id === litGroup);

    // Ease every highlight value toward its target so hover changes animate
    const now = performance.now();
    const dt = Math.min(64, now - (lastFrame || now));
    lastFrame = now;
    const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 90);
    fade += ((focus ? 1 : 0) - fade) * ease;

    // Hovering lights up the line above and below the node, one step at a time outward
    if (focus !== chainFor) {
      chainFor = focus;
      const c = focus ? chainFrom(focus) : null;
      chain = c?.all || null;
      chainSince = now;
      for (const e of edges) {
        // A highlighted edge continues one of the two lines, pointing away from the hovered note
        const [p, r] = e;
        e.from = e.to = null;
        if (!c) continue;
        for (const [dir, depth] of [['down', c.below], ['up', c.above]]) {
          const dp = depth.get(p.id);
          const dr = depth.get(r.id);
          if (dp === undefined || dr === undefined) continue;
          if (dir === 'up') {
            // only the steps the chain actually took on its way up
            if (c.upEdges.has(p.id + '\n' + r.id)) [e.from, e.to] = [p, r];
            else if (c.upEdges.has(r.id + '\n' + p.id)) [e.from, e.to] = [r, p];
          } else if (p.down.has(r.id) && dr >= dp && dr > 0) [e.from, e.to] = [p, r];
          else if (r.down.has(p.id) && dp >= dr && dp > 0) [e.from, e.to] = [r, p];
          if (e.to) break;
        }
        // a "Related to" connection of the hovered note lights just that one line
        if (!e.to && p === focus && c.linked.has(r.id)) [e.from, e.to] = [p, r];
        else if (!e.to && r === focus && c.linked.has(p.id)) [e.from, e.to] = [r, p];
      }
    }
    const step = reducedMotion.matches ? 0 : STEP_MS;
    const lit = (depth) => now - chainSince >= (depth - 1) * step; // has this step of the trickle arrived yet?
    const strength = (depth) => Math.max(0.45, 1 - 0.14 * (depth - 1)); // fainter the further away
    for (const n of nodes) {
      const d = chain?.get(n.id);
      n.hot = (n.hot || 0) + ((n === focus ? 1 : 0) - (n.hot || 0)) * ease;
      n.nb = (n.nb || 0) + ((d > 0 && lit(d) ? strength(d) : 0) - (n.nb || 0)) * ease;
    }
    for (const e of edges) {
      const d = e.to ? chain.get(e.to.id) : 0;
      e.hot = (e.hot || 0) + ((e.to && lit(d) ? strength(d) : 0) - (e.hot || 0)) * ease;
    }
    // How visible a node is: dimmed when something else is focused, unless it's in the chain
    const vis = (n) => (1 - fade * 0.82 * (1 - Math.max(n.hot, n.nb))) * (match(n) ? 1 : 0.2);
    const t = reducedMotion.matches ? 0 : now / 1000;

    // Lines run from the edge of one note to the edge of the other, never into the middle
    const shown = (n) => radius(n) * (1 + (n.hot || 0) * 0.45 + (n.nb || 0) * 0.15);
    const segment = (a, b) => {
      const len = hyp(b.x - a.x, b.y - a.y);
      const ra = shown(a) + 2 / cam.k;
      const rb = shown(b) + 2 / cam.k;
      if (len <= ra + rb) return null; // the notes touch: nothing to draw
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      return [a.x + ux * ra, a.y + uy * ra, b.x - ux * rb, b.y - uy * rb];
    };

    // Edges: base line, then an accent overlay with an arrowhead on the edges of the chain
    for (const e of edges) {
      const [p, r] = e;
      const on = e.hot;
      const seg = segment(p, r);
      if (!seg) continue;
      ctx.globalAlpha = Math.min(vis(p), vis(r)) * (1 - on);
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 1 / cam.k;
      ctx.beginPath();
      ctx.moveTo(seg[0], seg[1]);
      ctx.lineTo(seg[2], seg[3]);
      ctx.stroke();
      if (on < 0.01 || !e.to) continue;
      const a = e.from;
      const b = e.to;
      const hs = segment(a, b);
      ctx.globalAlpha = on * 0.9;
      ctx.strokeStyle = ctx.fillStyle = COLORS.edgeHi;
      ctx.lineWidth = (1 + on * 1.2) / cam.k;
      ctx.beginPath();
      ctx.moveTo(hs[0], hs[1]);
      ctx.lineTo(hs[2], hs[3]);
      ctx.stroke();
      // Arrowhead just outside the lower note
      const len = hyp(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const tipBack = radius(b) * (1 + (b.nb || 0) * 0.15) + 3 / cam.k;
      const tx = b.x - ux * tipBack;
      const ty = b.y - uy * tipBack;
      const s = 7 / cam.k;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * s - uy * s * 0.55, ty - uy * s + ux * s * 0.55);
      ctx.lineTo(tx - ux * s + uy * s * 0.55, ty - uy * s - ux * s * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    for (const n of nodes) {
      const r = radius(n) * (1 + n.hot * 0.45 + n.nb * 0.15);
      const v = vis(n);

      // Soft glow behind the focused node and (fainter) its neighbours
      const glow = Math.max(n.hot, n.nb * 0.45);
      if (glow > 0.01) {
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.6, n.x, n.y, r * 3.2);
        g.addColorStop(0, COLORS.accent);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = glow * 0.35;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const accented = q && match(n);
      ctx.globalAlpha = v;
      ctx.fillStyle = accented ? COLORS.accent : n.group ? n.group.color : n.unresolved ? COLORS.unresolved : COLORS.node;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Tint toward the accent colour as the node lights up
      // Grouped notes keep their colour when lit (the glow and size show the highlight)
      const tint = accented || n.group ? 0 : Math.max(n.hot, n.nb * 0.55);
      if (tint > 0.01) {
        ctx.globalAlpha = tint;
        ctx.fillStyle = COLORS.accent;
        ctx.fill();
      }

      // Small dot on notes you've placed by hand
      if (n.pinned) {
        const px = n.x + r * 0.75;
        const py = n.y - r * 0.75;
        ctx.globalAlpha = v;
        ctx.fillStyle = COLORS.label;
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 1.5 / cam.k;
        ctx.beginPath();
        ctx.arc(px, py, 2.6 / cam.k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Selected (box-select or Ctrl/Shift-click in the notes panel), or inside the box being drawn:
      // a soft halo with a crisp ring a little way out from the note
      const picked = selNow.has(n.id) ? 1 : inBox?.has(n.id) ? 0.65 : 0;
      n.sel = (n.sel || 0) + (picked - (n.sel || 0)) * ease;
      if (n.sel > 0.02) {
        const ringR = r + (5 + (1 - n.sel) * 4) / cam.k; // eases in from slightly further out
        ctx.globalAlpha = 0.18 * n.sel;
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 7 / cam.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.95 * n.sel;
        ctx.lineWidth = 1.75 / cam.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Expanding ripple rings around the hovered node
      if (n.hot > 0.01 && !reducedMotion.matches) {
        for (let i = 0; i < 2; i++) {
          const phase = (t * 0.8 + i / 2) % 1;
          ctx.globalAlpha = n.hot * (1 - phase) * 0.7;
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 1.5 / cam.k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + (3 + phase * 16) / cam.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Labels: fade in with zoom; the focused node's label grows and lifts, neighbours' fade in
    const zoomAlpha = Math.min(1, Math.max(0, (cam.k - 0.45) / 0.35));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.label;
    for (const n of nodes) {
      const base = q && match(n) ? 1 : zoomAlpha * 0.85;
      const a = Math.max(base * vis(n), n.hot, n.nb, n.sel || 0); // selected notes always show their name
      if (a <= 0.02) continue;
      const size = 12 + n.hot * 3;
      ctx.font = `${n.hot > 0.5 || n.sel > 0.5 ? 600 : 400} ${size / cam.k}px "Segoe UI", sans-serif`;
      ctx.globalAlpha = a;
      const r = radius(n) * (1 + n.hot * 0.45 + n.nb * 0.15) + (n.sel || 0) * 6 / cam.k; // below the selection ring
      const ly = n.y + r + (3 + n.hot * 4) / cam.k;
      // A thin outline in the background colour hides any line running behind the text
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = 4 / cam.k;
      ctx.lineJoin = 'round';
      ctx.strokeText(n.label, n.x, ly);
      ctx.fillStyle = n.sel > 0.5 ? COLORS.accent : COLORS.label;
      ctx.fillText(n.label, n.x, ly);
    }
    // The selection box while right-dragging (screen coordinates): rounded, a soft fill, a crisp edge,
    // and a small count of the notes inside at its corner
    if (box?.moved) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = Math.min(box.x0, box.x1);
      const y = Math.min(box.y0, box.y1);
      const bw = Math.abs(box.x1 - box.x0);
      const bh = Math.abs(box.y1 - box.y0);
      const rad = Math.min(8, bw / 2, bh / 2);
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, bw, bh, rad);
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = COLORS.accent;
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      const count = (inBox?.size || 0) + (box.add ? [...selNow].filter((id) => !inBox?.has(id)).length : 0);
      if (count) {
        const text = String(count);
        ctx.font = '600 11px "Segoe UI", sans-serif';
        const pw = Math.max(20, ctx.measureText(text).width + 12);
        const px = box.x1 + (box.x1 >= box.x0 ? 8 : -8 - pw);
        const py = box.y1 + (box.y1 >= box.y0 ? 8 : -8 - 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = COLORS.accent;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, 18, 9);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, px + pw / 2, py + 9.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    if (!visible) return;
    if (alpha > 0.003) tick();
    if (drag?.node) liveTidy();
    glide();
    if (fitPending && alpha < 0.3) { fit(); fitPending = false; }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function fit() {
    if (!nodes.length) return;
    const { w, h } = size();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = 80;
    cam.k = Math.min(2, Math.max(0.1, Math.min((w - pad * 2 - 220) / (x1 - x0 || 1), (h - pad * 2) / (y1 - y0 || 1))));
    cam.x = -((x0 + x1) / 2) * cam.k - 110;
    cam.y = -((y0 + y1) / 2) * cam.k;
  }

  // ---------- interaction ----------
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { sx, sy, x: (sx - r.width / 2 - cam.x) / cam.k, y: (sy - r.height / 2 - cam.y) / cam.k };
  }

  function hit(p) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = hyp(n.x - p.x, n.y - p.y);
      if (d < radius(n) + 6 / cam.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  // The selection is shared with the notes panel (the app's set of selected note paths)
  const selection = () => opts.getData().selected || new Set();
  // The notes inside a screen rectangle (a note counts once its circle overlaps the box)
  function notesInBox(b) {
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const { w, h } = size();
    const out = new Set();
    for (const n of nodes) {
      if (n.unresolved) continue;
      const sx = n.x * cam.k + w / 2 + cam.x;
      const sy = n.y * cam.k + h / 2 + cam.y;
      const rr = radius(n) * cam.k;
      const cx = Math.max(x0, Math.min(sx, x1));
      const cy = Math.max(y0, Math.min(sy, y1));
      if (hyp(sx - cx, sy - cy) <= rr) out.add(n.id);
    }
    return out;
  }
  // Selects every note inside the screen rectangle; Ctrl/Shift adds to what's already selected
  function selectInBox(b, add) {
    const sel = selection();
    if (!add) sel.clear();
    for (const id of notesInBox(b)) sel.add(id);
    opts.onSelectionChange?.();
  }

  function bind() {
    canvas.addEventListener('pointerdown', (e) => {
      // Hold right-click and drag: a selection box
      if (e.button === 2) {
        const p = toWorld(e);
        box = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, add: e.ctrlKey || e.shiftKey || e.metaKey, moved: false };
        return;
      }
      if (e.button !== 0) return; // only the main button drags or opens; right-click is handled by contextmenu
      const p = toWorld(e);
      const n = hit(p);
      downAt = { sx: p.sx, sy: p.sy };
      drag = n ? { node: n } : { pan: true, sx: p.sx, sy: p.sy, cx: cam.x, cy: cam.y };
      if (n) {
        alpha = Math.max(alpha, 0.3); // linked notes follow while you drag, like Obsidian
        stopDeepRepair();
        for (const m of nodes) m.anim = null; // a new drag takes over from any repair still animating
        guide.clear();
        dragRegion = around(n, 2); // only notes near the one in your hand follow it
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!visible) return;
      const p = toWorld(e);
      if (box) {
        box.x1 = p.sx;
        box.y1 = p.sy;
        if (hyp(box.x1 - box.x0, box.y1 - box.y0) > 5) box.moved = true;
        return;
      }
      if (drag?.node) {
        drag.node.x = p.x;
        drag.node.y = p.y;
        positions.set(drag.node.id, { x: p.x, y: p.y, vx: 0, vy: 0 });
      } else if (drag?.pan) {
        cam.x = drag.cx + (p.sx - drag.sx);
        cam.y = drag.cy + (p.sy - drag.sy);
      } else if (e.target === canvas) {
        hover = hit(p);
        canvas.style.cursor = hover ? 'pointer' : 'grab';      }
    });
    window.addEventListener('pointerup', (e) => {
      if (box) {
        if (box.moved) {
          selectInBox(box, box.add);
          boxed = true; // the right-click menu that follows shouldn't open
        }
        box = null;
        return;
      }
      if (!drag) return;
      const p = toWorld(e);
      const clicked = downAt && hyp(p.sx - downAt.sx, p.sy - downAt.sy) < 4;
      // a plain click on empty space clears the selection
      if (drag.pan && clicked && selection().size) { selection().clear(); opts.onSelectionChange?.(); }
      if (drag.node && clicked) opts.onOpen(drag.node);
      else if (drag.node?.pinned) setPin(drag.node, true); // moved a pinned note: pin it at its new spot
      else if (drag.node) {
        // Let go: this note stays where you dropped it. Notes dropped earlier become movable again,
        // so the repair has room to untangle things around it (pinned notes never move).
        held.clear();
        held.add(drag.node.id);
      }
      const dropped = drag.node && !clicked ? drag.node : null;
      drag = null;
      downAt = null;
      dragRegion = null;
      if (dropped) settleAndTidy(dropped); // only the notes around it adjust, in one smooth movement
    });
    canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
    // Right-click a note: open it, or let a placed note float again
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // no browser menu on the graph (right-drag draws a selection box)
      if (boxed) { boxed = false; return; } // that right-click was a box selection
      if (box?.moved) return;
      const p = toWorld(e);
      const n = hit(p);
      if (n) showNodeMenu(n, e.clientX, e.clientY);
      else opts.onBlankMenu?.({ x: p.x, y: p.y }, e.clientX, e.clientY); // empty space: e.g. a new note right here
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toWorld(e);
      const r = canvas.getBoundingClientRect();
      const k = Math.min(5, Math.max(0.08, cam.k * Math.exp(-e.deltaY * 0.0015)));
      cam.x = p.sx - r.width / 2 - p.x * k;
      cam.y = p.sy - r.height / 2 - p.y * k;
      cam.k = k;
    }, { passive: false });

    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    on('graph-filter', 'input', (e) => { settings.filter = e.target.value.trim(); });
    // Esc in the Highlight box: clear it and step out of it
    on('graph-filter', 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.target.value = '';
      settings.filter = '';
      e.target.blur();
    });
    on('g-local', 'change', (e) => { settings.local = e.target.checked; rebuild(); fitPending = true; });
    on('g-depth', 'input', (e) => { settings.depth = +e.target.value; if (settings.local) { rebuild(); fitPending = true; } });
    on('g-unresolved', 'change', (e) => { settings.unresolved = e.target.checked; rebuild(); });
    on('g-orphans', 'change', (e) => { settings.orphans = e.target.checked; rebuild(); });
    on('g-repel', 'input', (e) => { stopDeepRepair(); settings.repel = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-dist', 'input', (e) => { stopDeepRepair(); settings.dist = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-size', 'input', (e) => {
      settings.sizeMul = +e.target.value;
      alpha = Math.max(alpha, 0.3); // bigger notes need a bit more room
      saveSettings();
    });
    const sizeSlider = document.getElementById('g-size');
    if (sizeSlider) sizeSlider.value = settings.sizeMul;
    on('g-link', 'input', (e) => {
      stopDeepRepair();
      settings.linkMul = +e.target.value;
      alpha = Math.max(alpha, 0.4);
      saveSettings();
    });
    const linkSlider = document.getElementById('g-link');
    if (linkSlider) linkSlider.value = settings.linkMul;
    on('g-fit', 'click', fit);
    on('g-pull', 'change', (e) => { settings.pull = e.target.checked; settleAndTidy(); });
    // Letting go of a slider tidies up too, so squeezing or spreading the graph never leaves lines crossing
    // let go of a slider: the graph finishes spreading out to the new setting, then tidies (it doesn't snap back)
    for (const id of ['g-repel', 'g-dist', 'g-size', 'g-link']) on(id, 'change', () => settleAndTidy(null, true));
    on('g-unpin', 'click', () => {
      // Reset layout: drop pins and drags, then find a clean layout again
      pins.clear();
      held.clear();
      for (const n of nodes) n.pinned = false;
      savePins();
      const from = snapshot();
      findCleanLayout(250, from);
    });
  }

  // ---------- placing notes by hand ----------
  function savePins() {
    opts.onPinsChange?.(Object.fromEntries(pins));
    updateStats();
  }

  function setPin(n, pinned) {
    n.pinned = pinned;
    if (pinned) pins.set(n.id, { x: Math.round(n.x), y: Math.round(n.y) });
    else pins.delete(n.id);
    alpha = Math.max(alpha, 0.35); // let the other notes settle around it
    savePins();
  }

  let nodeMenu = null;
  function showNodeMenu(n, x, y) {
    nodeMenu?.remove();
    nodeMenu = document.createElement('ul');
    nodeMenu.className = 'menu';
    nodeMenu.innerHTML = `<li data-act="open">Open note</li><li data-act="pin">${n.pinned ? 'Let it float again' : 'Keep it here'}</li>${n.unresolved ? '' : '<li data-act="group">Group…</li>'}`;
    document.body.appendChild(nodeMenu);
    nodeMenu.style.left = Math.min(x, innerWidth - nodeMenu.offsetWidth - 8) + 'px';
    nodeMenu.style.top = Math.min(y, innerHeight - nodeMenu.offsetHeight - 8) + 'px';
    nodeMenu.addEventListener('click', (e) => {
      const act = e.target.closest('li')?.dataset.act;
      nodeMenu.remove();
      nodeMenu = null;
      if (act === 'open') opts.onOpen(n);
      else if (act === 'pin') setPin(n, !n.pinned);
      else if (act === 'group') opts.onGroupMenu?.(n, x, y);
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (nodeMenu && !e.target.closest('.menu')) {
      nodeMenu.remove();
      nodeMenu = null;
    }
  });

  function updateStats() {
    const el = document.getElementById('graph-stats');
    const placed = nodes.filter((n) => n.pinned).length;
    el.textContent = `${nodes.filter((n) => !n.unresolved).length} notes · ${edges.length} links${placed ? ` · ${placed} placed` : ''} · drag to move, right-click → Keep it here to pin, scroll to zoom, click to open`;
  }

  return {
    init(c, o) {
      canvas = c;
      ctx = c.getContext('2d');
      opts = o;
      bind();
    },
    show() {
      const fresh = !positions.size;
      rebuild();
      updateStats();
      if (fresh || settings.local) {
        findCleanLayout(); // try many starts and keep the one with no crossing lines
        fitPending = true;
      }
      if (visible) return;
      visible = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    hide() {
      stopDeepRepair();
      visible = false;
      cancelAnimationFrame(raf);
      hover = null;
      drag = null;
    },
    rebuild() {
      rebuild();
      updateStats();
    },
    // Light up one group (hovering it in the legend); null for none
    highlightGroup(id) {
      litGroup = id;
    },
    // Fix crossing lines and overlaps now (also runs on its own after you drop a note)
    tidy() {
      repair();
    },
    // Current layout, read-only: notes with positions, and lines as pairs of note ids
    // (positions are where notes end up, even if an animation is still carrying them there)
    // What the repair currently counts as overlapping (for checking the layout from the console)
    overlapReport() {
      return {
        total: overlaps(),
        crossings: countCrossings(),
        stacked: stackedNotes(),
        bunched: bunchedLines().map(([a, b]) => `${a.label} / ${b.label}`),
        labelsOnNotes: labelsOnNotes().map(([a, b]) => `${a.label} label on ${b.label}`),
        trouble: troubleNotes(true).map((n) => n.label),
      };
    },
    // For tests: put notes exactly where a layout() said (held = the note last dropped), then tidy as after a drop
    loadLayout(list, heldIds = []) {
      for (const p of list) {
        const n = byId.get(p.id);
        if (!n) continue;
        Object.assign(n, { x: p.x, y: p.y, vx: 0, vy: 0, anim: null });
        positions.set(n.id, { x: p.x, y: p.y, vx: 0, vy: 0 });
      }
      held.clear();
      for (const id of heldIds) held.add(id);
      alpha = 0;
    },
    settle(droppedId = null) {
      settleAndTidy(droppedId ? byId.get(droppedId) : null);
      deepJob?.run(true); // tests: finish the background repair now
      this.finishAnimations();
    },
    // Jump every running animation to its end (for tests: background tabs don't run animations)
    finishAnimations() {
      for (const n of nodes) {
        if (!n.anim) continue;
        n.x = n.anim.gx;
        n.y = n.anim.gy;
        n.anim = null;
        positions.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
      }
    },
    layout() {
      const now = nodes.map((n) => [n, n.x, n.y]);
      for (const n of nodes) if (n.anim) { n.x = n.anim.gx; n.y = n.anim.gy; }
      const result = {
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y, r: radius(n), below: n.below, pinned: !!n.pinned, held: held.has(n.id), animating: !!n.anim, group: n.group?.name || null })),
        edges: edges.map(([p, q]) => [p.id, q.id]),
        crossings: countCrossings(),
      };
      for (const [n, x, y] of now) { n.x = x; n.y = y; }
      return result;
    },
    // Label of the note under a point on screen, if any
    noteAt(clientX, clientY) {
      return hit(toWorld({ clientX, clientY }))?.label || null;
    },
    // Put a (new) note at a spot in the graph and keep it there, like a note you've dropped
    placeAt(id, x, y) {
      positions.set(id, { x, y, vx: 0, vy: 0 });
      held.clear();
      held.add(id);
    },
    // The steps up that light up when hovering `id`, as "lower → higher" labels (for checking chains)
    upSteps(id) {
      const n = byId.get(id);
      if (!n) return [];
      return [...chainFrom(n).upEdges].map((k) => k.split('\n').map((x) => byId.get(x)?.label).join(' → '));
    },
    // Labels of the notes that light up when hovering `id`, in chain order
    chainOf(id) {
      const n = byId.get(id);
      if (!n) return [];
      return [...chainFrom(n).all].filter(([, d]) => d > 0).sort((a, b) => a[1] - b[1]).map(([k]) => byId.get(k).label);
    },
    // Forget the layout when switching vaults; `placed` is the new vault's hand-placed notes
    reset(placed = {}) {
      positions.clear();
      pins.clear();
      held.clear();
      for (const [id, p] of Object.entries(placed)) pins.set(id, p);
      hover = null;
      fitPending = true;
    },
    // Keep a placed note's spot when it's renamed or deleted
    movePin(from, to) {
      const p = pins.get(from);
      if (!p) return;
      pins.delete(from);
      if (to) pins.set(to, p);
      savePins();
    },
  };
})();
