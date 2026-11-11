/* global JSZip */
// Vaults and notes live in the browser's IndexedDB. Exposes the `api` object the UI uses.
(() => {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('nodebook') : null;
  let current = null; // id of the open vault

  const TEMPLATES = {
    blank: {},
    starter: {
      'Welcome.md': `# Welcome to Nodebook

Nodebook keeps your notes as Markdown in this browser. Each vault is its own collection of linked notes.
Use **Export** in the sidebar to download a vault as a .zip backup.

- Link notes by typing \`[[\` and picking a note, e.g. [[Linking notes]].
- Or press **Ctrl+Enter** with the cursor in (or just after) a word to turn it into a new note.
- Open the [[Graph view]] with **Ctrl+G** to see how everything connects.
- Every note shows its **backlinks** in the right panel.

Shortcuts: Alt+N new note · Ctrl+P search · Ctrl+E edit/read · Alt+←/→ back/forward
`,
      'Linking notes.md': `# Linking notes

Write \`[[Note name]]\` to link to another note. If the note doesn't exist yet,
clicking the link creates it — like this one: [[Ideas]].

Use an alias with a pipe: [[Welcome|back to the start]].
`,
      'Graph view.md': `# Graph view

Each note is a node, each link is an edge. Drag nodes, scroll to zoom,
click a node to open it. Toggle **Local** to only see neighbours of the current note.

See also: [[Welcome]], [[Linking notes]].
`,
    },
  };

  // ---------- IndexedDB plumbing ----------
  let dbPromise = null;
  function db() {
    dbPromise ??= new Promise((resolve, reject) => {
      const r = indexedDB.open('nodebook', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('vaults', { keyPath: 'id' });
        r.result.createObjectStore('notes', { keyPath: ['vault', 'path'] }).createIndex('byVault', 'vault');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbPromise;
  }

  // Runs fn({ vaults, notes }) in one transaction; rejects (and rolls back) if fn throws
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(['vaults', 'notes'], mode);
      let result;
      let failure = null;
      const fail = (e) => {
        failure = e;
        try { t.abort(); } catch { /* already finished */ }
      };
      try {
        Promise.resolve(fn({ vaults: t.objectStore('vaults'), notes: t.objectStore('notes') })).then((r) => (result = r), fail);
      } catch (e) {
        fail(e);
      }
      t.oncomplete = () => resolve(result);
      t.onabort = () => reject(failure || t.error || new Error('Transaction aborted'));
    });
  }

  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const changed = (vault) => channel?.postMessage({ vault });
  const cleanPath = (p) => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/[:*?"<>|]/g, '');
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const vaultNotes = (s, vault) => req(s.notes.index('byVault').getAll(vault));

  function need() {
    if (!current) throw new Error('No vault open');
    return current;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Besides the notes, an exported zip carries the vault's graph setup in this file: groups (folders), notes
  // placed by hand, and where every note was in the graph. Other apps just see a hidden folder.
  const META = '.nodebook/vault.json';

  async function readZip(file) {
    const zip = await JSZip.loadAsync(file);
    const out = [];
    let metaEntry = null;
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir && (entry.name === META || entry.name.endsWith('/' + META))) metaEntry = entry;
      if (entry.dir || !/\.md$/i.test(entry.name) || entry.name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) continue;
      out.push({ path: cleanPath(entry.name), content: await entry.async('string') });
    }
    // Drop a single shared top folder ("My vault/Note.md" -> "Note.md")
    const tops = new Set(out.map((n) => (n.path.includes('/') ? n.path.split('/')[0] : '')));
    const [top] = tops;
    if (tops.size === 1 && top) for (const n of out) n.path = n.path.slice(top.length + 1);
    let meta = null;
    try {
      if (metaEntry) meta = cleanMeta(JSON.parse(await metaEntry.async('string')), new Set(out.map((n) => n.path)));
    } catch { /* not readable: import just the notes */ }
    return { notes: out, meta };
  }

  // Only keep well-formed parts of an imported vault.json, for notes that are in the zip (it could come from anywhere)
  function cleanMeta(m, paths) {
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const str = (v) => typeof v === 'string' && v.length < 500;
    const known = (p) => paths.has(p) || (str(p) && p.startsWith('?')); // "?name": a link to a note not written yet
    const out = {};
    if (m?.groups && Array.isArray(m.groups.list)) {
      const list = m.groups.list.filter((g) => g && str(g.id) && str(g.name) && (!g.color || /^#[0-9a-f]{3,8}$/i.test(g.color))).map((g) => ({ id: g.id, name: g.name, ...(g.color ? { color: g.color } : {}) }));
      const ids = new Set(list.map((g) => g.id));
      const members = {};
      for (const [p, g] of Object.entries(m.groups.members || {})) if (paths.has(p) && ids.has(g)) members[p] = g;
      out.groups = { list, members };
    }
    if (m?.pins && typeof m.pins === 'object') {
      out.pins = {};
      for (const [p, v] of Object.entries(m.pins)) if (known(p) && num(v?.x) && num(v?.y)) out.pins[p] = { x: v.x, y: v.y };
    }
    if (m?.layout?.positions && typeof m.layout.positions === 'object') {
      const positions = {};
      for (const [p, v] of Object.entries(m.layout.positions)) if (known(p) && Array.isArray(v) && num(v[0]) && num(v[1])) positions[p] = [v[0], v[1]];
      const c = m.layout.cam;
      out.layout = { positions, ...(c && num(c.x) && num(c.y) && num(c.k) && c.k > 0 ? { cam: { x: c.x, y: c.y, k: c.k } } : {}) };
    }
    return out;
  }

  // `extra`: { groups, pins, layout } to start the vault with (e.g. from an imported zip)
  async function createVault(name, template = 'blank', notes = null, groups = null, extra = null) {
    const id = newId();
    const now = Date.now();
    const files = notes || Object.entries(TEMPLATES[template] || {}).map(([path, content]) => ({ path, content }));
    await tx('readwrite', (s) => {
      s.vaults.put({ id, name: name || 'Untitled vault', created: now, opened: now, ...(groups ? { groups } : {}), ...(extra || {}) });
      for (const n of files) s.notes.put({ vault: id, path: n.path, content: n.content, mtime: now });
    });
    changed(id);
    return id;
  }

  window.api = {
    // ---------- vaults ----------
    async listVaults() {
      if (!localStorage.getItem('nodebook:seeded')) {
        const count = await tx('readonly', (s) => req(s.vaults.count()));
        if (!count) await createVault('My notes', 'starter');
        try { localStorage.setItem('nodebook:seeded', '1'); } catch { /* private mode */ }
        navigator.storage?.persist?.(); // ask the browser not to evict our data
      }
      return tx('readonly', async (s) => {
        const [vaults, notes] = await Promise.all([req(s.vaults.getAll()), req(s.notes.getAll())]);
        for (const v of vaults) v.notes = notes.filter((n) => n.vault === v.id);
        return vaults.sort((a, b) => b.opened - a.opened);
      });
    },

    createVault,

    async openVault(id) {
      const v = await tx('readwrite', async (s) => {
        const vault = await req(s.vaults.get(id));
        if (vault) s.vaults.put({ ...vault, opened: Date.now() });
        return vault;
      });
      current = v ? v.id : null;
      return v ? { id: v.id, name: v.name } : null;
    },

    closeVault: () => { current = null; },

    // Notes placed by hand in the graph: { notePath: { x, y } }, kept with the vault
    async getPins(id = current) {
      return tx('readonly', async (s) => (await req(s.vaults.get(id)))?.pins || {});
    },
    async savePins(pins, id = current) {
      await tx('readwrite', async (s) => {
        const v = await req(s.vaults.get(id));
        if (v) s.vaults.put({ ...v, pins });
      });
    },

    // Where every note was in the graph, and the view: { positions: { notePath: [x, y] }, cam: { x, y, k } },
    // so reopening the vault shows the graph as you left it
    async getLayout(id = current) {
      return tx('readonly', async (s) => (await req(s.vaults.get(id)))?.layout || null);
    },
    async saveLayout(layout, id = current) {
      await tx('readwrite', async (s) => {
        const v = await req(s.vaults.get(id));
        if (v) s.vaults.put({ ...v, layout });
      });
    },

    // Coloured groups: { list: [{ id, name, color }], members: { notePath: groupId } }, kept with the vault
    async getGroups(id = current) {
      const g = await tx('readonly', async (s) => (await req(s.vaults.get(id)))?.groups);
      return { list: g?.list || [], members: g?.members || {} };
    },
    async saveGroups(groups, id = current) {
      await tx('readwrite', async (s) => {
        const v = await req(s.vaults.get(id));
        if (v) s.vaults.put({ ...v, groups });
      });
      changed(id);
    },

    async renameVault(id, name) {
      await tx('readwrite', async (s) => {
        const v = await req(s.vaults.get(id));
        if (v) s.vaults.put({ ...v, name });
      });
      changed(id);
    },

    async deleteVault(id) {
      await tx('readwrite', async (s) => {
        s.vaults.delete(id);
        for (const key of await req(s.notes.index('byVault').getAllKeys(id))) s.notes.delete(key);
      });
      changed(id);
    },

    async exportVault(id = current) {
      const [vault, notes] = await tx('readonly', (s) => Promise.all([req(s.vaults.get(id)), vaultNotes(s, id)]));
      const zip = new JSZip();
      for (const n of notes) zip.file(n.path, n.content);
      const meta = { version: 1, groups: vault.groups || { list: [], members: {} }, pins: vault.pins || {}, layout: vault.layout || null };
      zip.file(META, JSON.stringify(meta, null, 1));
      download(await zip.generateAsync({ type: 'blob' }), `${vault.name.replace(/[\\/:*?"<>|]/g, '')}.zip`);
    },

    // A zip exported from here comes back with its groups, placed notes and graph layout
    async importZipAsVault(file) {
      const { notes, meta } = await readZip(file);
      const extra = {};
      if (meta?.pins && Object.keys(meta.pins).length) extra.pins = meta.pins;
      if (meta?.layout && Object.keys(meta.layout.positions).length) extra.layout = meta.layout;
      return createVault(file.name.replace(/\.zip$/i, ''), 'blank', notes, meta?.groups?.list.length ? meta.groups : null, extra);
    },

    // ---------- notes in the open vault ----------
    listNotes: () => tx('readonly', (s) => vaultNotes(s, need())),

    async writeNote(path, content) {
      const vault = need();
      await tx('readwrite', (s) => s.notes.put({ vault, path, content, mtime: Date.now() }));
      changed(vault);
    },

    async createNote(path, content) {
      const vault = need();
      await tx('readwrite', async (s) => {
        if (await req(s.notes.get([vault, path]))) throw new Error('A note with that name already exists');
        s.notes.put({ vault, path, content, mtime: Date.now() });
      });
      changed(vault);
    },

    async renameNote(from, to) {
      const vault = need();
      await tx('readwrite', async (s) => {
        const note = await req(s.notes.get([vault, from]));
        if (!note) throw new Error('Note not found');
        if (from.toLowerCase() !== to.toLowerCase() && (await req(s.notes.get([vault, to])))) throw new Error('A note with that name already exists');
        s.notes.delete([vault, from]);
        s.notes.put({ ...note, path: to, mtime: Date.now() });
      });
      changed(vault);
    },

    async trashNote(path) {
      const vault = need();
      await tx('readwrite', (s) => s.notes.delete([vault, path]));
      changed(vault);
    },

    // Accepts .md files and .zip archives into the open vault. Returns the number imported.
    async importFiles(files) {
      const vault = need();
      const incoming = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) incoming.push(...(await readZip(f)).notes);
        else if (/\.md$/i.test(f.name)) incoming.push({ path: cleanPath(f.webkitRelativePath || f.name), content: await f.text() });
      }
      if (!incoming.length) return 0;
      const existing = new Set((await this.listNotes()).map((n) => n.path));
      const clashes = incoming.filter((n) => existing.has(n.path)).length;
      if (clashes && !(await Dialog.confirm(`${clashes} of ${incoming.length} notes already exist in this vault.`, { title: 'Overwrite existing notes?', okLabel: 'Overwrite', danger: true }))) return 0;
      await tx('readwrite', (s) => {
        for (const n of incoming) s.notes.put({ vault, ...n, mtime: Date.now() });
      });
      changed(vault);
      return incoming.length;
    },

    openExternal: (url) => {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    },

    // Fires with the changed vault id when another tab edits data
    onVaultChanged: (fn) => channel?.addEventListener('message', (e) => fn(e.data?.vault)),
  };
})();
