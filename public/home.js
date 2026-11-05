/* global api */
// Home screen: every vault shown as a card with a small graph thumbnail.
const Home = (() => {
  const $ = (s) => document.querySelector(s);
  const LINK_RE = /\[\[([^[\]\n|#]+)/g;
  let vaults = [];
  let menuFor = null;

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function opened(ts) {
    const d = new Date(ts);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  // Small, deterministic force layout for the card thumbnail
  function layout(notes) {
    const names = new Map(notes.map((n, i) => [n.path.split('/').pop().replace(/\.md$/i, '').toLowerCase(), i]));
    const nodes = notes.slice(0, 150).map((_, i) => ({ x: Math.cos(i * 2.4) * (10 + i * 3), y: Math.sin(i * 2.4) * (10 + i * 3), vx: 0, vy: 0, deg: 0 }));
    const edges = [];
    notes.slice(0, 150).forEach((n, i) => {
      for (const m of n.content.matchAll(LINK_RE)) {
        const j = names.get(m[1].replace(/\s*,?\s*["“”„].*$/, '').trim().toLowerCase()); // [[Note, "shown text"]]
        if (j !== undefined && j !== i && j < nodes.length) { edges.push([i, j]); nodes[i].deg++; nodes[j].deg++; }
      }
    });
    for (let it = 0; it < 220; it++) {
      const a = 1 - it / 220;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const p = nodes[i], q = nodes[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d2 = dx * dx + dy * dy || 0.1;
          const f = (400 * a) / d2;
          p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f;
        }
      }
      for (const [i, j] of edges) {
        const p = nodes[i], q = nodes[j];
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = ((d - 40) / d) * 0.08 * a;
        p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f;
      }
      for (const p of nodes) {
        p.vx -= p.x * 0.01 * a; p.vy -= p.y * 0.01 * a;
        p.vx *= 0.6; p.vy *= 0.6;
        p.x += p.vx; p.y += p.vy;
      }
    }
    return { nodes, edges };
  }

  function drawThumb(canvas, notes) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement);
    const color = (name) => cs.getPropertyValue(name).trim();
    if (!notes.length) {
      ctx.fillStyle = color('--text-dim');
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Empty vault', w / 2, h / 2 + 4);
      return;
    }
    const { nodes, edges } = layout(notes);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = 22;
    const k = Math.min(2.2, (w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (y1 - y0 || 1));
    const tx = (x) => w / 2 + (x - (x0 + x1) / 2) * k;
    const ty = (y) => h / 2 + (y - (y0 + y1) / 2) * k;
    ctx.strokeStyle = color('--edge');
    ctx.lineWidth = 1;
    for (const [i, j] of edges) {
      ctx.beginPath();
      ctx.moveTo(tx(nodes[i].x), ty(nodes[i].y));
      ctx.lineTo(tx(nodes[j].x), ty(nodes[j].y));
      ctx.stroke();
    }
    for (const n of nodes) {
      ctx.fillStyle = n.deg > 2 ? color('--accent') : color('--node');
      ctx.beginPath();
      ctx.arc(tx(n.x), ty(n.y), Math.min(7, 2.5 + Math.sqrt(n.deg) * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    const q = $('#vault-search').value.trim().toLowerCase();
    const grid = $('#vault-grid');
    const shown = vaults.filter((v) => !q || v.name.toLowerCase().includes(q));
    grid.innerHTML = shown
      .map(
        (v) => `<div class="vault-card" data-id="${v.id}" tabindex="0">
          <canvas class="thumb"></canvas>
          <div class="card-info">
            <div class="card-text">
              <div class="card-name" title="Click to rename">${escapeHtml(v.name)}</div>
              <div class="card-meta"><span class="card-icon"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><g class="edges"><line x1="8" y1="9" x2="23" y2="13"/><line x1="8" y1="9" x2="12" y2="24"/><line x1="23" y1="13" x2="12" y2="24"/></g><circle cx="8" cy="9" r="4"/><circle cx="23" cy="13" r="5"/><circle cx="12" cy="24" r="4"/></svg></span>${v.notes.length} note${v.notes.length === 1 ? '' : 's'} · Opened ${opened(v.opened)}</div>
            </div>
            <button class="card-more icon" title="Rename, export or delete">⋮</button>
          </div>
        </div>`
      )
      .join('');
    $('#vault-empty').hidden = shown.length > 0 || !q;
    grid.querySelectorAll('.vault-card').forEach((card) => drawThumb(card.querySelector('canvas'), vaults.find((v) => v.id === card.dataset.id).notes));
  }

  async function refresh() {
    vaults = await api.listVaults();
    render();
  }

  const open = (id) => { location.hash = '#/v/' + id; };

  async function create(template) {
    const ex = window.EXAMPLE_VAULT;
    const id = template === 'example' && ex
      ? await api.createVault(ex.name, 'blank', ex.notes, ex.groups)
      : await api.createVault(template === 'starter' ? 'Getting started' : 'Untitled vault', template);
    open(id);
  }

  function closeMenu() {
    $('#card-menu').hidden = true;
    menuFor = null;
  }

  // Edit a vault card's name right on the card
  function renameInPlace(id) {
    const v = vaults.find((x) => x.id === id);
    const el = document.querySelector(`.vault-card[data-id="${id}"] .card-name`);
    if (!v || !el) return;
    inlineEdit(el, {
      value: v.name,
      onSave: async (name) => {
        await api.renameVault(id, name);
        v.name = name;
      },
    });
  }

  async function menuAction(act, id) {
    const v = vaults.find((x) => x.id === id);
    if (!v) return;
    if (act === 'open') open(id);
    else if (act === 'rename') renameInPlace(id);
    else if (act === 'export') api.exportVault(id);
    else if (act === 'delete') {
      const ok = await Dialog.confirm(`“${v.name}” and its ${v.notes.length} notes will be deleted. This can't be undone — export it first if you want a backup.`, { title: 'Delete vault?', okLabel: 'Delete', danger: true });
      if (ok) {
        await api.deleteVault(id);
        refresh();
      }
    }
  }

  // ---------- events ----------
  $('#vault-search').addEventListener('input', render);
  document.querySelectorAll('#home .template').forEach((b) => b.addEventListener('click', () => create(b.dataset.template)));

  function openMenu(id, x, y) {
    const menu = $('#card-menu');
    menuFor = id;
    menu.hidden = false;
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }

  $('#vault-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.vault-card');
    if (!card) return;
    if (e.target.closest('.card-more')) {
      e.stopPropagation();
      const r = e.target.getBoundingClientRect();
      return openMenu(card.dataset.id, r.left, r.bottom + 4);
    }
    // Clicking the name renames the vault; clicking anywhere else on the card opens it
    if (e.target.closest('.card-name')) {
      if (!e.target.isContentEditable) renameInPlace(card.dataset.id);
      return;
    }
    open(card.dataset.id);
  });
  // Right-click a vault for the same menu
  $('#vault-grid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.vault-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(card.dataset.id, e.clientX, e.clientY);
  });
  $('#vault-grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('vault-card')) open(e.target.dataset.id);
  });
  $('#card-menu').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    const id = menuFor;
    closeMenu();
    if (li) menuAction(li.dataset.act, id);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#card-menu')) closeMenu(); });
  window.addEventListener('resize', () => { if (!$('#home').hidden) render(); });
  Theme.onChange(() => { if (!$('#home').hidden) render(); });

  $('#btn-import-vault').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        open(await api.importZipAsVault(input.files[0]));
      } catch (err) {
        Dialog.alert(err.message, 'Could not import that file');
      }
    };
    input.click();
  });

  return {
    async show() {
      $('#home').hidden = false;
      document.title = 'Nodebook';
      await refresh();
    },
    hide() {
      $('#home').hidden = true;
      closeMenu();
    },
    refresh,
    get visible() { return !$('#home').hidden; },
  };
})();
