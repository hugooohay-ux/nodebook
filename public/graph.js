// Force-directed graph of notes, drawn on a canvas. No dependencies.
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

  let canvas, ctx, opts;
  let nodes = [];
  let edges = [];
  let byId = new Map();
  const positions = new Map(); // survives rebuilds so the layout doesn't jump
  const cam = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let visible = false;
  let raf = 0;
  let hover = null;
  let drag = null; // { node } | { pan, sx, sy, cx, cy }
  let downAt = null;
  let fitPending = true;

  const settings = { local: false, depth: 1, unresolved: true, orphans: true, repel: 500, dist: 80, filter: '' };

  // ---------- data ----------
  function rebuild() {
    const { notes, links, current } = opts.getData();
    const map = new Map();
    for (const n of notes.values()) map.set(n.path, { id: n.path, label: n.name, unresolved: false, deg: 0, nbrs: new Set() });

    const es = [];
    const seen = new Set();
    for (const [src, outs] of links) {
      for (const l of outs) {
        let id = l.resolved;
        if (!id) {
          if (!settings.unresolved) continue;
          id = '?' + l.target.toLowerCase();
          if (!map.has(id)) map.set(id, { id, label: l.target, unresolved: true, deg: 0, nbrs: new Set() });
        }
        const key = src < id ? src + '\n' + id : id + '\n' + src;
        if (seen.has(key)) continue;
        seen.add(key);
        es.push([src, id]);
        map.get(src).nbrs.add(id);
        map.get(id).nbrs.add(src);
      }
    }
    for (const n of map.values()) n.deg = n.nbrs.size;

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

    byId = new Map(keep.map((n) => [n.id, n]));
    edges = es.filter(([a, b]) => byId.has(a) && byId.has(b)).map(([a, b]) => [byId.get(a), byId.get(b)]);
    nodes = keep;

    for (const n of nodes) {
      const p = positions.get(n.id);
      if (p) Object.assign(n, p);
      else {
        // Spawn next to an already placed neighbour when possible
        const nb = [...n.nbrs].map((id) => positions.get(id)).find(Boolean);
        const a = Math.random() * Math.PI * 2;
        const r = nb ? 30 : Math.sqrt(nodes.length) * 40 * Math.random();
        n.x = (nb ? nb.x : 0) + Math.cos(a) * r;
        n.y = (nb ? nb.y : 0) + Math.sin(a) * r;
        n.vx = 0;
        n.vy = 0;
      }
    }
    if (hover && !byId.has(hover.id)) hover = null;
    alpha = Math.max(alpha, 0.5);
  }

  // ---------- simulation ----------
  function tick() {
    const n = nodes.length;
    const a = alpha;
    const repel = settings.repel;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const f = (repel * a) / d2;
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
    for (const p of nodes) {
      p.vx -= p.x * 0.004 * a;
      p.vy -= p.y * 0.004 * a;
      if (drag && drag.node === p) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.6;
      p.vy *= 0.6;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 40) { p.vx *= 40 / v; p.vy *= 40 / v; }
      p.x += p.vx;
      p.y += p.vy;
      positions.set(p.id, { x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    }
    alpha = Math.max(alpha * 0.985, drag?.node ? 0.3 : 0);
  }

  // ---------- drawing ----------
  const radius = (n) => 4 + Math.sqrt(n.deg) * 2.2;

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
    const match = (n) => !q || n.label.toLowerCase().includes(q);

    // Ease every highlight value toward its target so hover changes animate
    const now = performance.now();
    const dt = Math.min(64, now - (lastFrame || now));
    lastFrame = now;
    const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 90);
    fade += ((focus ? 1 : 0) - fade) * ease;
    for (const n of nodes) {
      n.hot = (n.hot || 0) + ((n === focus ? 1 : 0) - (n.hot || 0)) * ease;
      n.nb = (n.nb || 0) + ((focus && focus.nbrs.has(n.id) ? 1 : 0) - (n.nb || 0)) * ease;
    }
    // How visible a node is: dimmed when something else is focused, unless it's a neighbour
    const vis = (n) => (1 - fade * 0.82 * (1 - Math.max(n.hot, n.nb))) * (match(n) ? 1 : 0.2);
    const t = reducedMotion.matches ? 0 : now / 1000;

    // Edges: base line, then an accent overlay that fades in on edges touching the focused node
    for (const [p, r] of edges) {
      const on = Math.max(p.hot, r.hot);
      ctx.globalAlpha = Math.min(vis(p), vis(r)) * (1 - on);
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 1 / cam.k;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      if (on < 0.01) continue;
      // Draw from the focused node outward so the flowing dashes travel away from it
      const [a, b] = p.hot >= r.hot ? [p, r] : [r, p];
      ctx.globalAlpha = on * 0.9;
      ctx.strokeStyle = COLORS.edgeHi;
      ctx.lineWidth = (1 + on * 1.2) / cam.k;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (!reducedMotion.matches) {
        ctx.globalAlpha = on;
        ctx.lineWidth = (2.2 + on) / cam.k;
        ctx.setLineDash([2 / cam.k, 14 / cam.k]);
        ctx.lineDashOffset = -t * 28 / cam.k;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';
      }
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
      ctx.fillStyle = accented ? COLORS.accent : n.unresolved ? COLORS.unresolved : COLORS.node;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Tint toward the accent colour as the node lights up
      const tint = accented ? 0 : Math.max(n.hot, n.nb * 0.55);
      if (tint > 0.01) {
        ctx.globalAlpha = tint;
        ctx.fillStyle = COLORS.accent;
        ctx.fill();
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
      ctx.fillText(n.label, n.x, n.y + r + (3 + n.hot * 4) / cam.k);
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
      drag = null;
      downAt = null;
    });
    canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toWorld(e);
      const r = canvas.getBoundingClientRect();
      const k = Math.min(5, Math.max(0.08, cam.k * Math.exp(-e.deltaY * 0.0015)));
      cam.x = p.sx - r.width / 2 - p.x * k;
      cam.y = p.sy - r.height / 2 - p.y * k;
      cam.k = k;
    }, { passive: false });

    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    on('graph-filter', 'input', (e) => { settings.filter = e.target.value.trim(); });
    on('g-local', 'change', (e) => { settings.local = e.target.checked; rebuild(); fitPending = true; });
    on('g-depth', 'input', (e) => { settings.depth = +e.target.value; if (settings.local) { rebuild(); fitPending = true; } });
    on('g-unresolved', 'change', (e) => { settings.unresolved = e.target.checked; rebuild(); });
    on('g-orphans', 'change', (e) => { settings.orphans = e.target.checked; rebuild(); });
    on('g-repel', 'input', (e) => { settings.repel = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-dist', 'input', (e) => { settings.dist = +e.target.value; alpha = Math.max(alpha, 0.4); });
    on('g-fit', 'click', fit);
  }

  function updateStats() {
    const el = document.getElementById('graph-stats');
    el.textContent = `${nodes.filter((n) => !n.unresolved).length} notes · ${edges.length} links · drag to move, scroll to zoom, click to open`;
  }

  return {
    init(c, o) {
      canvas = c;
      ctx = c.getContext('2d');
      opts = o;
      bind();
    },
    show() {
      rebuild();
      updateStats();
      if (!positions.size || settings.local) fitPending = true;
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
    // Forget the layout when switching vaults
    reset() {
      positions.clear();
      hover = null;
      fitPending = true;
    },
  };
})();
