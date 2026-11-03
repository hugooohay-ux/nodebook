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
  const cam = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let visible = false;
  let raf = 0;
  let hover = null;
  let drag = null; // { node } | { pan, sx, sy, cx, cy }
  let downAt = null;
  let fitPending = true;

  const settings = { local: false, depth: 1, unresolved: true, orphans: true, repel: 500, dist: 80, filter: '', pull: true, sizeMul: 1 };
  try { settings.sizeMul = JSON.parse(localStorage.getItem('nodebook:graph'))?.sizeMul ?? 1; } catch { /* storage blocked */ }
  let litGroup = null; // group being hovered in the legend

  // ---------- data ----------
  function rebuild() {
    const { notes, links, groups, current } = opts.getData();
    const map = new Map();
    const node = (id, label, unresolved) => ({ id, label, unresolved, deg: 0, nbrs: new Set(), down: new Set(), up: new Set() });
    for (const n of notes.values()) map.set(n.path, node(n.path, n.name, false));

    const es = [];
    const seen = new Set();
    for (const [src, outs] of links) {
      for (const l of outs) {
        let id = l.resolved;
        if (!id) {
          if (!settings.unresolved) continue;
          id = '?' + l.target.toLowerCase();
          if (!map.has(id)) map.set(id, node(id, l.target, true));
        }
        // Remember which way each link was written, so a hover chain can follow links in one direction at a time
        map.get(id).down.add(src);
        map.get(src).up.add(id);
        const key = src < id ? src + '\n' + id : id + '\n' + src;
        if (seen.has(key)) continue;
        seen.add(key);
        es.push([src, id]);
        map.get(src).nbrs.add(id);
        map.get(id).nbrs.add(src);
      }
    }
    if (ctx) ctx.font = '12px "Segoe UI", sans-serif';
    for (const n of map.values()) {
      n.deg = n.nbrs.size;
      n.links = n.up.size + n.down.size; // total links: ones it makes plus ones made to it
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

    // Size = how much sits below a note (every note reachable by following links one way),
    // scaled linearly from the smallest (0) to the biggest (1).
    // "Below" is whichever link direction has the clearest top note, so it works however links are written.
    if (keep.length <= 1500) {
      const reach = (dir) => keep.map((n) => walk(n, dir).size - 1);
      const viaUp = reach('up');
      const viaDown = reach('down');
      const below = Math.max(...viaUp) >= Math.max(...viaDown) ? viaUp : viaDown;
      keep.forEach((n, i) => (n.below = below[i]));
    } else keep.forEach((n) => (n.below = n.links)); // very large vaults: plain link count is much cheaper
    const lo = Math.min(...keep.map((n) => n.below));
    const hi = Math.max(...keep.map((n) => n.below));
    for (const n of keep) n.size = hi > lo ? (n.below - lo) / (hi - lo) : 0;
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

  // Notes reachable from `start` by following links in one direction only ('down' or 'up'), with steps away
  function walk(start, dir) {
    const depth = new Map([[start.id, 0]]);
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const n of frontier) {
        for (const id of n[dir]) {
          const m = byId.get(id);
          if (m && !depth.has(id)) {
            depth.set(id, depth.get(n.id) + 1);
            next.push(m);
          }
        }
      }
      frontier = next;
    }
    return depth;
  }

  // The hover chain: the line of notes above a note plus the line below it — never sideways,
  // so a sibling (reached only by going up and then back down) stays dark
  function chainFrom(start) {
    const below = walk(start, 'down');
    const above = walk(start, 'up');
    const all = new Map(below);
    for (const [id, d] of above) all.set(id, Math.min(d, all.get(id) ?? Infinity));
    return { all, below, above };
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
      const f = ((d - settings.dist) / d) * 0.06 * a;
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
    for (const p of nodes) {
      p.vx -= p.x * 0.004 * a;
      p.vy -= p.y * 0.004 * a;
      if (isHeld(p)) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.6;
      p.vy *= 0.6;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 40) { p.vx *= 40 / v; p.vy *= 40 / v; }
      p.x += p.vx;
      p.y += p.vy;
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
        let d = Math.hypot(dx, dy);
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
    alpha = Math.max(alpha * 0.985, drag?.node ? 0.3 : 0);
  }

  // Held notes don't move: the one being dragged, pinned ones, and ones you've dropped somewhere this session
  const isHeld = (p) => (drag && drag.node === p) || p.pinned || held.has(p.id);

  // ---------- choosing a clean starting layout ----------
  // Lines crossing, lines running through other notes, and labels on top of each other are what make a graph
  // look messy. We try many starting arrangements, let each settle, score it, and keep the cleanest one.
  const turn = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const segmentsCross = (p, q, r, s) => turn(p, q, r) * turn(p, q, s) < 0 && turn(r, s, p) * turn(r, s, q) < 0;
  function countCrossings() {
    let k = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [p, q] = edges[i];
        const [r, s] = edges[j];
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
      for (const m of nodes) {
        if (m === p || m === q) continue;
        const t = ((m.x - p.x) * dx + (m.y - p.y) * dy) / len2;
        if (t <= 0 || t >= 1) continue;
        // the note plus its label (drawn below it)
        if (Math.hypot(m.x - (p.x + t * dx), m.y - (p.y + t * dy)) < radius(m) + 10) lineThroughNote++;
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
    return countCrossings() * 1000 + lineThroughNote * 50 + labelsOverlap * 5;
  }
  function findCleanLayout(budgetMs = 400) {
    const until = performance.now() + budgetMs;
    const free = nodes.filter((n) => !n.pinned && !held.has(n.id));
    if (!free.length) return;
    const spread = Math.sqrt(nodes.length) * 60;
    let best = null;
    let bestScore = Infinity;
    for (let seed = 1; ; seed++) {
      let s = seed * 7919;
      const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (const n of free) Object.assign(n, { x: (rand() - 0.5) * spread, y: (rand() - 0.5) * spread, vx: 0, vy: 0 });
      alpha = 1;
      for (let i = 0; i < 400 && alpha > 0.005; i++) tick();
      const score = messiness();
      if (score < bestScore) {
        bestScore = score;
        best = free.map((n) => [n, n.x, n.y]);
      }
      if (bestScore === 0 || performance.now() > until) break;
    }
    for (const [n, x, y] of best) Object.assign(n, { x, y, vx: 0, vy: 0 });
    for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
    alpha = 0; // settled and clean: stay still
  }
  // ---------- drawing ----------
  // Smallest notes are 6px; the one with the most below it grows by up to 26px times the "Node size" slider
  const radius = (n) => 6 + (n.size || 0) * 26 * settings.sizeMul;

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
    const { current } = opts.getData();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * (w / 2 + cam.x), dpr * (h / 2 + cam.y));

    const focus = hover || (drag && drag.node) || null;
    const q = settings.filter.toLowerCase();
    const match = (n) => (!q || n.label.toLowerCase().includes(q)) && (!litGroup || n.group?.id === litGroup);

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
          if (p[dir].has(r.id) && dr >= dp && dr > 0) [e.from, e.to] = [p, r];
          else if (r[dir].has(p.id) && dp >= dr && dp > 0) [e.from, e.to] = [r, p];
          if (e.to) break;
        }
      }
    }
    const step = reducedMotion.matches ? 0 : STEP_MS;
    const lit = (depth) => now - chainSince >= (depth - 1) * step; // has this step of the trickle arrived yet?
    const strength = (depth) => Math.max(0.45, 1 - 0.14 * (depth - 1)); // fainter the further down
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
      const len = Math.hypot(b.x - a.x, b.y - a.y);
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
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
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

      const accented = n.id === current || (q && match(n));
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

      if (n.id === current) {
        ctx.globalAlpha = v;
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 2 / cam.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4 / cam.k, 0, Math.PI * 2);
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
      const base = n.id === current || (q && match(n)) ? 1 : zoomAlpha * 0.85;
      const a = Math.max(base * vis(n), n.hot, n.nb);
      if (a <= 0.02) continue;
      const size = 12 + n.hot * 3;
      ctx.font = `${n.hot > 0.5 ? 600 : 400} ${size / cam.k}px "Segoe UI", sans-serif`;
      ctx.globalAlpha = a;
      const r = radius(n) * (1 + n.hot * 0.45 + n.nb * 0.15);
      const ly = n.y + r + (3 + n.hot * 4) / cam.k;
      // A thin outline in the background colour hides any line running behind the text
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = 4 / cam.k;
      ctx.lineJoin = 'round';
      ctx.strokeText(n.label, n.x, ly);
      ctx.fillStyle = COLORS.label;
      ctx.fillText(n.label, n.x, ly);
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    if (!visible) return;
    if (alpha > 0.003) tick();
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
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < radius(n) + 6 / cam.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function bind() {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // only the main button drags or opens; right-click is handled by contextmenu
      const p = toWorld(e);
      const n = hit(p);
      downAt = { sx: p.sx, sy: p.sy };
      drag = n ? { node: n } : { pan: true, sx: p.sx, sy: p.sy, cx: cam.x, cy: cam.y };
      if (n) alpha = Math.max(alpha, 0.3);
    });
    window.addEventListener('pointermove', (e) => {
      if (!visible) return;
      const p = toWorld(e);
      if (drag?.node) {
        drag.node.x = p.x;
        drag.node.y = p.y;
        positions.set(drag.node.id, { x: p.x, y: p.y, vx: 0, vy: 0 });
        alpha = Math.max(alpha, 0.3); // its neighbours adjust gently while you drag
      } else if (drag?.pan) {
        cam.x = drag.cx + (p.sx - drag.sx);
        cam.y = drag.cy + (p.sy - drag.sy);
      } else if (e.target === canvas) {
        hover = hit(p);
        canvas.style.cursor = hover ? 'pointer' : 'grab';
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const p = toWorld(e);
      const clicked = downAt && Math.hypot(p.sx - downAt.sx, p.sy - downAt.sy) < 4;
      if (drag.node && clicked) opts.onOpen(drag.node);
      else if (drag.node?.pinned) setPin(drag.node, true); // moved a pinned note: pin it at its new spot
      else if (drag.node) held.add(drag.node.id); // let go: it stays where you dropped it (this session, no pin)
      drag = null;
      downAt = null;
    });
    canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
    // Right-click a note: open it, or let a placed note float again
    canvas.addEventListener('contextmenu', (e) => {
      const n = hit(toWorld(e));
      if (!n) return;
      e.preventDefault();
      showNodeMenu(n, e.clientX, e.clientY);
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
    on('g-local', 'change', (e) => { settings.local = e.target.checked; rebuild(); fitPending = true; });
    on('g-depth', 'input', (e) => { settings.depth = +e.target.value; if (settings.local) { rebuild(); fitPending = true; } });
    on('g-unresolved', 'change', (e) => { settings.unresolved = e.target.checked; rebuild(); });
    on('g-orphans', 'change', (e) => { settings.orphans = e.target.checked; rebuild(); });
    on('g-repel', 'input', (e) => { settings.repel = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-dist', 'input', (e) => { settings.dist = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-size', 'input', (e) => {
      settings.sizeMul = +e.target.value;
      alpha = Math.max(alpha, 0.3); // bigger notes need a bit more room
      try { localStorage.setItem('nodebook:graph', JSON.stringify({ sizeMul: settings.sizeMul })); } catch { /* storage blocked */ }
    });
    const sizeSlider = document.getElementById('g-size');
    if (sizeSlider) sizeSlider.value = settings.sizeMul;
    on('g-fit', 'click', fit);
    on('g-pull', 'change', (e) => { settings.pull = e.target.checked; alpha = Math.max(alpha, 0.4); });
    on('g-unpin', 'click', () => {
      // Reset layout: drop pins and drags, then find a clean layout again
      pins.clear();
      held.clear();
      for (const n of nodes) n.pinned = false;
      savePins();
      findCleanLayout();
      fit();
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
    // Current layout, read-only: notes with positions, and lines as pairs of note ids
    layout() {
      return {
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y, r: radius(n), below: n.below, pinned: !!n.pinned, group: n.group?.name || null })),
        edges: edges.map(([p, q]) => [p.id, q.id]),
        crossings: countCrossings(),
      };
    },
    // Label of the note under a point on screen, if any
    noteAt(clientX, clientY) {
      return hit(toWorld({ clientX, clientY }))?.label || null;
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
