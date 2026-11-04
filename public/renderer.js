/* global marked, Graph, Home, NoteEditor, api */
// `api` is exposed by storage.js, `NoteEditor` by vendor/editor.js (built from src/editor.js)
const $ = (s) => document.querySelector(s);

const state = {
  vault: null,
  notes: new Map(), // path -> { path, name, content, mtime }
  links: new Map(), // path -> [{ target, resolved }]
  ups: new Map(), // path -> Set of paths it's "Related to"
  groups: { list: [], members: {} }, // coloured groups for this vault
  byName: new Map(), // lowercase name / path (no .md) -> path
  current: null,
  mode: 'edit',
  view: 'home', // 'home' | 'docs' | 'graph' | 'note'
};

let saveTimer = null;
let pendingSave = null;

const editor = NoteEditor.create($('#editor'), {
  placeholder: 'Start writing…  Type [[ to link a note, or press Ctrl+Enter on a word to turn it into one',
  resolve: (target) => !!resolve(target),
  noteNames: () => [...state.notes.values()].map((n) => n.name).filter((n) => n !== nameOf(state.current)),
  onChange: () => scheduleSave(),
  onOpenLink: (target) => openOrCreate(target),
  onLinkWord: (r) => linkedWord(r),
  onFormat: (f) => updateToolbar(f),
});

// ---------- helpers ----------
const nameOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;
const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

// Apply `fn` only to the parts of `text` that aren't code blocks/spans
function outsideCode(text, fn) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE_RE)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}
const stripCode = (text) => text.replace(CODE_RE, (m) => m.replace(/[^\n]/g, ' '));

function parseLink(inner) {
  const bar = inner.indexOf('|');
  const raw = bar < 0 ? inner : inner.slice(0, bar);
  return { target: raw.split('#')[0].trim(), alias: bar < 0 ? null : inner.slice(bar + 1).trim(), raw: raw.trim() };
}

// ---------- "Related to" ----------
// Links in the text are the main way notes connect: they build the chains you see when hovering in the graph.
// "Related to" is a lighter connection on the side: it only reaches one step. Stored at the top of the note:
// ---
// related:
//   - "[[Handelsbolag]]"
// ---
// (older notes used `up:` for this; it's still read, and rewritten as `related:` when the list is edited)
const FRONT_RE = /^---\n([\s\S]*?)\n---(?=\n|$)/;
const stripFront = (content) => content.replace(FRONT_RE, '').replace(/^\n/, '');

function parseUps(content) {
  const out = [];
  const m = FRONT_RE.exec(content);
  if (m) {
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const key = /^(?:related|up):\s*(.*)$/.exec(lines[i]);
      if (!key) continue;
      const values = key[1] ? [key[1]] : [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) values.push(lines[++i]);
      for (const v of values) for (const l of v.matchAll(LINK_RE)) out.push(parseLink(l[1]).target);
    }
  }
  // Also accept Dataview-style `related:: [[Note]]` (or `up::`) lines
  for (const line of content.matchAll(/^(?:related|up)::\s*(.+)$/gm)) for (const l of line[1].matchAll(LINK_RE)) out.push(parseLink(l[1]).target);
  return [...new Set(out.filter(Boolean))];
}

// The edit that sets a note's "Related to" list to `names` (other properties are kept)
function upsEdit(content, names) {
  const m = FRONT_RE.exec(content);
  const rest = [];
  if (m) {
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^(?:related|up):/.test(lines[i])) {
        while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) i++;
        continue;
      }
      if (lines[i].trim()) rest.push(lines[i]);
    }
  }
  const body = [...(names.length ? ['related:', ...names.map((n) => `  - "[[${n}]]"`)] : []), ...rest];
  const to = m ? m[0].length + (content[m[0].length] === '\n' ? 1 : 0) : 0;
  return { from: 0, to, insert: body.length ? `---\n${body.join('\n')}\n---\n` : '' };
}

function resolve(target) {
  if (!target) return null;
  return state.byName.get(target.toLowerCase().replace(/\.md$/i, '')) || null;
}

function rebuildIndex() {
  state.byName.clear();
  // Full paths win over bare names when both match
  for (const n of state.notes.values()) {
    const key = n.name.toLowerCase();
    if (!state.byName.has(key)) state.byName.set(key, n.path);
  }
  for (const n of state.notes.values()) state.byName.set(n.path.toLowerCase().replace(/\.md$/i, ''), n.path);

  state.links.clear();
  for (const n of state.notes.values()) {
    const seen = new Set();
    const out = [];
    // only links written in the text; "Related to" entries in the properties are kept separately (state.ups)
    for (const m of stripCode(stripFront(n.content)).matchAll(LINK_RE)) {
      const { target } = parseLink(m[1]);
      if (!target) continue;
      const resolved = resolve(target);
      const key = resolved || '?' + target.toLowerCase();
      if (seen.has(key) || resolved === n.path) continue;
      seen.add(key);
      out.push({ target, resolved });
    }
    state.links.set(n.path, out);
  }

  // What each note is "Related to", as resolved paths
  state.ups.clear();
  for (const n of state.notes.values()) {
    const parents = new Set();
    for (const t of parseUps(n.content)) {
      const p = resolve(t);
      if (p && p !== n.path) parents.add(p);
    }
    state.ups.set(n.path, parents);
  }
}

// ---------- loading ----------
async function loadNotes() {
  const list = await api.listNotes();
  const fresh = new Map(list.map((n) => [n.path, { path: n.path, name: nameOf(n.path), content: n.content, mtime: n.mtime }]));
  // Keep unsaved edits for the open note
  if (pendingSave && fresh.has(pendingSave.path)) fresh.get(pendingSave.path).content = pendingSave.content;
  state.notes = fresh;
  rebuildIndex();
}

// ---------- addresses: #/v/<vault> (documents), #/v/<vault>/graph, #/v/<vault>/n/<note path> ----------
const vaultHash = () => `#/v/${state.vault.id}`;
const noteHash = (path) => `${vaultHash()}/n/${encodeURIComponent(path)}`;

async function enterVault(info) {
  Home.hide();
  Graph.reset(await api.getPins(info.id));
  state.vault = info;
  state.groups = await api.getGroups(info.id);
  state.current = null;
  setVaultName(info.name);
  $('#btn-home').href = $('#vault-name').href = vaultHash();
  $('#search').value = '';
  $('#note-search').value = '';
  await loadNotes();
  renderFileList();
}

function setVaultName(name) {
  state.vault.name = name;
  document.title = `${name} – Nodebook`;
  for (const el of ['#vault-name span', '#vh-name > span', '#panel-vault > span', '#vh-title']) $(el).textContent = name;
}

// The vault page: every note as a document card, or the vault's graph with every note as a node
async function showVaultPage(mode) {
  await flushSave();
  state.view = mode;
  $('#app').hidden = true;
  $('#vault-home').hidden = false;
  $('#vault-home').classList.toggle('graph-mode', mode === 'graph');
  document.querySelectorAll('.view-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  $('#graph-view').hidden = mode !== 'graph';
  if (mode === 'graph') {
    renderGroupLegend();
    Graph.show();
  }
  else {
    Graph.hide();
    renderNoteGrid();
  }
}

// ---------- saving ----------
function scheduleSave() {
  const note = state.notes.get(state.current);
  if (!note) return;
  note.content = editor.value;
  pendingSave = { path: note.path, content: note.content };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingSave) return;
  const { path, content } = pendingSave;
  pendingSave = null;
  await api.writeNote(path, content);
  rebuildIndex();
  editor.refresh();
  renderSidePanel();
  if (state.view === 'graph') Graph.rebuild();
}

// ---------- opening notes ----------
async function showNote(path) {
  await flushSave();
  if (!state.notes.has(path)) return;
  state.current = path;
  state.view = 'note';
  Graph.hide();
  $('#vault-home').hidden = true;
  $('#app').hidden = false;
  const note = state.notes.get(path);
  $('#title').value = note.name;
  editor.load(note.content);
  setMode(state.mode);
  renderPartOf();
  renderGroupChip();
  renderSidePanel();
  highlightActive();
}

// ---------- groups: named colours for notes ----------
// Ordered so each new group gets a colour clearly different from the ones before it
const GROUP_COLORS = ['#0090ff', '#f76b15', '#46a758', '#d6409f', '#12a594', '#e5484d', '#8e4ec6', '#e2a336'];

const groupById = (id) => state.groups.list.find((g) => g.id === id) || null;
const groupOf = (path) => groupById(state.groups.members[path]);

async function saveGroups() {
  // Drop memberships pointing at deleted groups or notes
  for (const [path, id] of Object.entries(state.groups.members)) {
    if (!groupById(id) || !state.notes.has(path)) delete state.groups.members[path];
  }
  await api.saveGroups(state.groups);
  renderGroups();
}

// Everything that shows group colours
function renderGroups() {
  renderFileList(); // folders in the notes panel
  renderGroupChip();
  renderGroupLegend();
  if (state.view === 'docs') renderNoteGrid();
  if (state.view === 'graph') Graph.rebuild();
}

function createGroup(name) {
  const used = new Set(state.groups.list.map((g) => g.color));
  const color = GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[state.groups.list.length % GROUP_COLORS.length];
  const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color };
  state.groups.list.push(g);
  return g;
}

async function setGroup(path, groupId) {
  if (groupId) state.groups.members[path] = groupId;
  else delete state.groups.members[path];
  await saveGroups();
}

// Small menu for choosing a note's group: existing groups, "No group", and a box to type a new one
let groupMenu = null;
function closeGroupMenu() {
  groupMenu?.remove();
  groupMenu = null;
}
function openGroupMenu(path, x, y) {
  closeGroupMenu();
  const current = state.groups.members[path];
  groupMenu = document.createElement('ul');
  groupMenu.className = 'menu group-menu';
  groupMenu.innerHTML =
    state.groups.list
      .map((g) => `<li data-id="${g.id}"><span class="swatch" style="--sw:${g.color}"></span>${escapeHtml(g.name)}${g.id === current ? '<span class="check">✓</span>' : ''}</li>`)
      .join('') +
    `<li data-id="">No group${!current ? '<span class="check">✓</span>' : ''}</li>
     <li class="sep"></li>
     <li class="new"><input placeholder="New group…" spellcheck="false"></li>`;
  document.body.appendChild(groupMenu);
  groupMenu.style.left = Math.min(x, innerWidth - groupMenu.offsetWidth - 8) + 'px';
  groupMenu.style.top = Math.min(y, innerHeight - groupMenu.offsetHeight - 8) + 'px';
  const input = groupMenu.querySelector('input');
  groupMenu.addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    closeGroupMenu();
    await setGroup(path, li.dataset.id || null);
  });
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return closeGroupMenu();
    if (e.key !== 'Enter') return;
    const name = input.value.trim();
    if (!name) return;
    const g = state.groups.list.find((x) => x.name.toLowerCase() === name.toLowerCase()) || createGroup(name);
    closeGroupMenu();
    await setGroup(path, g.id);
    toast(`“${nameOf(path)}” is in ${g.name}`);
  });
  if (!state.groups.list.length) input.focus();
}
document.addEventListener('pointerdown', (e) => {
  if (groupMenu && !e.target.closest('.group-menu')) closeGroupMenu();
});

function renderGroupChip() {
  const chip = $('#group-chip');
  const g = state.current ? groupOf(state.current) : null;
  chip.classList.toggle('set', !!g);
  chip.style.setProperty('--sw', g ? g.color : '');
  chip.innerHTML = g ? `<span class="swatch"></span>${escapeHtml(g.name)}` : '+ Group';
}
$('#group-chip').addEventListener('click', (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  openGroupMenu(state.current, r.left, r.bottom + 4);
});

// Groups section in the graph panel: change colour, rename, delete; hover highlights the group
function renderGroupLegend() {
  const ul = $('#g-groups');
  const counts = {};
  for (const [path, id] of Object.entries(state.groups.members)) if (state.notes.has(path)) counts[id] = (counts[id] || 0) + 1;
  ul.innerHTML = state.groups.list.length
    ? state.groups.list
        .map((g) => `<li data-id="${g.id}">
          <button class="swatch" style="--sw:${g.color}" title="Change colour"></button>
          <span class="g-name" title="Click to rename">${escapeHtml(g.name)}</span>
          <span class="g-count">${counts[g.id] || 0}</span>
          <button class="g-del" title="Delete group">×</button>
        </li>`)
        .join('')
    : '<li class="none">Right-click a note → Group… to make one</li>';
}
$('#g-groups').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const g = groupById(li.dataset.id);
  if (e.target.closest('.swatch')) {
    g.color = GROUP_COLORS[(GROUP_COLORS.indexOf(g.color) + 1) % GROUP_COLORS.length];
    await saveGroups();
  } else if (e.target.closest('.g-del')) {
    const ok = await Dialog.confirm(`The notes in “${g.name}” stay; they just lose the colour.`, { title: 'Delete group?', okLabel: 'Delete', danger: true });
    if (!ok) return;
    state.groups.list = state.groups.list.filter((x) => x !== g);
    await saveGroups();
  } else if (e.target.closest('.g-name') && !e.target.isContentEditable) {
    inlineEdit(e.target.closest('.g-name'), { value: g.name, onSave: async (name) => { g.name = name; await saveGroups(); } });
  }
});
$('#g-groups').addEventListener('mouseover', (e) => Graph.highlightGroup(e.target.closest('li[data-id]')?.dataset.id || null));
$('#g-groups').addEventListener('mouseleave', () => Graph.highlightGroup(null));

// ---------- "Related to" bar ----------
function renderPartOf() {
  const note = state.notes.get(state.current);
  if (!note) return;
  const ups = parseUps(note.content);
  $('#po-chips').innerHTML = ups
    .map((n) => `<span class="po-chip${resolve(n) ? '' : ' unresolved'}"><a href="#" data-open="${escapeHtml(n)}" title="Open “${escapeHtml(n)}”">${escapeHtml(n)}</a><button data-remove="${escapeHtml(n)}" title="Remove from Related to">×</button></span>`)
    .join('');
  $('#partof').classList.toggle('empty', !ups.length);
}

async function setParents(names) {
  const note = state.notes.get(state.current);
  if (!note) return;
  const { from, to, insert } = upsEdit(note.content, names);
  editor.replaceRange(from, to, insert); // saved and undoable like typing
  await flushSave();
  renderPartOf();
  if (state.mode === 'preview') renderPreview();
}

async function addParent(raw) {
  const name = raw.replace(/[[\]|#\\:*?"<>]/g, '').trim();
  const note = state.notes.get(state.current);
  if (!name || !note) return;
  const existing = resolve(name);
  if (existing === note.path) return toast('A note can’t be related to itself');
  const canonical = existing ? nameOf(existing) : name;
  const ups = parseUps(note.content);
  if (ups.some((u) => u.toLowerCase() === canonical.toLowerCase())) return;
  if (!existing) await createNoteNamed(canonical);
  await setParents([...ups, canonical]);
  toast(existing ? `Now related to “${canonical}”` : `Created “${canonical}” and related this note to it`);
}

function closeParentInput() {
  $('#po-input').hidden = true;
  $('#po-input').value = '';
  $('#po-add').hidden = false;
}

$('#po-add').addEventListener('click', () => {
  const note = state.notes.get(state.current);
  const taken = new Set(parseUps(note.content).map((n) => n.toLowerCase()));
  $('#po-list').innerHTML = [...state.notes.values()]
    .filter((n) => n.path !== note.path && !taken.has(n.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => `<option value="${escapeHtml(n.name)}"></option>`)
    .join('');
  $('#po-add').hidden = true;
  $('#po-input').hidden = false;
  $('#po-input').focus();
});
$('#po-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const value = e.target.value;
    closeParentInput();
    await addParent(value);
  } else if (e.key === 'Escape') closeParentInput();
});
// Picking from the list fires `input` with the exact name
$('#po-input').addEventListener('input', async (e) => {
  if (e.inputType !== 'insertReplacementText' && e.inputType !== undefined) return;
  const value = e.target.value;
  if (!resolve(value)) return;
  closeParentInput();
  await addParent(value);
});
$('#po-input').addEventListener('blur', () => setTimeout(closeParentInput, 150));
$('#po-chips').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  const remove = e.target.closest('[data-remove]');
  if (open) {
    e.preventDefault();
    openOrCreate(open.dataset.open);
  } else if (remove) {
    const note = state.notes.get(state.current);
    setParents(parseUps(note.content).filter((n) => n !== remove.dataset.remove));
  }
});

// Show the note now and give it its own address, so the browser's Back button works
async function openNote(path) {
  await showNote(path);
  if (state.current === path && location.hash !== noteHash(path)) location.hash = noteHash(path);
}

async function createNoteNamed(name) {
  const path = (name.replace(/[\\:*?"<>|]/g, '').trim() || 'Untitled') + '.md';
  await api.createNote(path, '');
  state.notes.set(path, { path, name: nameOf(path), content: '' });
  rebuildIndex();
  renderFileList();
  return path;
}

async function openOrCreate(target) {
  const existing = resolve(target);
  if (existing) return openNote(existing);
  openNote(await createNoteNamed(target));
  setMode('edit');
}

// Ctrl+Enter / toolbar link button: the editor wrapped a word in [[ ]]; create the note if it's new
async function linkedWord({ word, error }) {
  if (error) return toast(error);
  if (resolve(word)) return toast(`Linked to “${word}”`);
  await createNoteNamed(word);
  await flushSave();
  toast(`Created note “${word}”`);
}

// ---------- formatting toolbar ----------
const FONTS = { sans: 'var(--font)', serif: 'Georgia, "Times New Roman", serif', mono: 'var(--mono)' };
const display = { font: 'sans', size: 16 };
try { Object.assign(display, JSON.parse(localStorage.getItem('nodebook:display')) || {}); } catch { /* storage blocked */ }

function applyDisplay() {
  display.size = Math.min(28, Math.max(11, display.size));
  document.documentElement.style.setProperty('--editor-font', FONTS[display.font] || FONTS.sans);
  document.documentElement.style.setProperty('--editor-size', display.size + 'px');
  $('#tb-font').value = display.font;
  $('#tb-size').textContent = display.size;
  try { localStorage.setItem('nodebook:display', JSON.stringify(display)); } catch { /* storage blocked */ }
}

function updateToolbar(f) {
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => b.classList.toggle('on', !!f[b.dataset.cmd]));
  $('#tb-style').value = String(Math.min(f.heading, 3));
}

$('#toolbar').addEventListener('mousedown', (e) => {
  // Keep focus (and the selection) in the editor while clicking toolbar buttons
  if (e.target.closest('button')) e.preventDefault();
});
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cmd) editor.exec(b.dataset.cmd);
  else if (b.dataset.size) {
    display.size += +b.dataset.size;
    applyDisplay();
  }
});
$('#tb-style').addEventListener('change', (e) => editor.exec('heading', +e.target.value));
$('#tb-font').addEventListener('change', (e) => {
  display.font = e.target.value;
  applyDisplay();
  editor.focus();
});
applyDisplay();

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('out');
    toastTimer = setTimeout(() => (el.hidden = true), 250);
  }, 1800);
}

// `folder`: id of the folder (group) to put it in
async function newNote(folder = null) {
  if (!state.vault) return;
  let name = 'Untitled';
  for (let i = 1; resolve(name); i++) name = `Untitled ${i}`;
  const path = (state.view === 'note' && state.current ? dirOf(state.current) : '') + name + '.md';
  await api.createNote(path, '');
  state.notes.set(path, { path, name, content: '', mtime: Date.now() });
  rebuildIndex();
  if (typeof folder === 'string' && groupById(folder)) {
    state.groups.members[path] = folder;
    setFolderClosed(folder, false);
    await api.saveGroups(state.groups);
  }
  renderFileList();
  await openNote(path);
  setMode('edit');
  $('#title').focus();
  $('#title').select();
}

// ---------- rename & delete ----------
// Renames a note and updates [[Old]], [[Old|alias]] and [[Old#heading]] across the vault. Returns the new path.
async function renameNote(path, newName) {
  const note = state.notes.get(path);
  newName = newName.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!note || !newName || newName === note.name) return null;
  await flushSave();
  const oldName = note.name;
  const newPath = dirOf(path) + newName + '.md';
  try {
    await api.renameNote(path, newPath);
  } catch (e) {
    Dialog.alert(e.message, 'Could not rename the note');
    return null;
  }
  state.notes.delete(path);
  state.notes.set(newPath, { ...note, path: newPath, name: newName });
  if (state.current === path) state.current = newPath;
  Graph.movePin(path, newPath);
  if (state.groups.members[path]) {
    state.groups.members[newPath] = state.groups.members[path];
    delete state.groups.members[path];
    api.saveGroups(state.groups);
  }

  const re = new RegExp(`\\[\\[\\s*${escapeRe(oldName)}\\s*(?=[\\]|#])`, 'gi');
  for (const n of state.notes.values()) {
    const updated = n.content.replace(re, `[[${newName}`);
    if (updated !== n.content) {
      n.content = updated;
      await api.writeNote(n.path, updated);
    }
  }
  rebuildIndex();
  renderFileList();
  return newPath;
}

async function renameCurrent() {
  const newPath = await renameNote(state.current, $('#title').value);
  $('#title').value = nameOf(state.current);
  if (!newPath) return;
  editor.replace(state.notes.get(newPath).content);
  editor.refresh();
  renderPartOf();
  renderSidePanel();
  if (state.mode === 'preview') renderPreview();
  history.replaceState(null, '', noteHash(newPath));
}

async function deleteNote(path) {
  const note = state.notes.get(path);
  if (!note) return false;
  const ok = await Dialog.confirm(`“${note.name}” will be deleted. This can't be undone.`, { title: 'Delete note?', okLabel: 'Delete', danger: true });
  if (!ok) return false;
  if (state.current === path) {
    clearTimeout(saveTimer);
    pendingSave = null;
    state.current = null;
  }
  await api.trashNote(path);
  state.notes.delete(path);
  Graph.movePin(path, null);
  if (state.groups.members[path]) {
    delete state.groups.members[path];
    api.saveGroups(state.groups);
  }
  rebuildIndex();
  renderFileList();
  return true;
}

async function deleteCurrent() {
  if (await deleteNote(state.current)) location.replace(vaultHash());
}

// ---------- rendering ----------
// Formatting toolbar only works while editing a note
function syncEditable() {
  document.body.classList.toggle('no-edit', state.view !== 'note' || state.mode !== 'edit');
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#topbar .seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#editor').hidden = mode !== 'edit';
  $('#preview').hidden = mode !== 'preview';
  syncEditable();
  if (mode === 'preview') renderPreview();
  else editor.focus();
}

function renderPreview() {
  const note = state.notes.get(state.current);
  if (!note) return;
  const md = outsideCode(stripFront(note.content), (part) =>
    part.replace(LINK_RE, (_m, inner) => {
      const { target, alias, raw } = parseLink(inner);
      const cls = resolve(target) ? 'wikilink' : 'wikilink unresolved';
      return `<a href="#" class="${cls}" data-target="${escapeHtml(target)}">${escapeHtml(alias || raw)}</a>`;
    })
  );
  $('#preview .page').innerHTML = marked.parse(md);
}

// Folders in the notes panel are the vault's groups: a note in a folder gets that group's colour in the graph
const collapsedKey = () => `nodebook:folders-closed:${state.vault?.id}`;
function closedFolders() {
  try { return new Set(JSON.parse(localStorage.getItem(collapsedKey()) || '[]')); } catch { return new Set(); }
}
function setFolderClosed(id, closed) {
  const s = closedFolders();
  if (closed) s.add(id); else s.delete(id);
  try { localStorage.setItem(collapsedKey(), JSON.stringify([...s])); } catch { /* private mode */ }
}

function noteItem(n, snippet, inFolder) {
  const li = document.createElement('li');
  li.className = 'note' + (inFolder ? ' in-folder' : '');
  li.dataset.path = n.path;
  li.title = n.path;
  li.draggable = true;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = n.name;
  li.appendChild(name);
  if (snippet) {
    const s = document.createElement('span');
    s.className = 'snippet';
    s.textContent = '…' + snippet;
    li.classList.add('has-snippet');
    li.appendChild(s);
  }
  return li;
}

function renderFileList() {
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#file-list');
  ul.innerHTML = '';
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const matches = [];
  for (const n of state.notes.values()) {
    let snippet = '';
    if (q) {
      const inName = n.name.toLowerCase().includes(q);
      const idx = n.content.toLowerCase().indexOf(q);
      if (!inName && idx < 0) continue;
      if (!inName) snippet = n.content.slice(Math.max(0, idx - 20), idx + 60).replace(/\s+/g, ' ');
    }
    matches.push({ n, snippet });
  }
  matches.sort((a, b) => byName(a.n, b.n));
  const closed = closedFolders();
  const folders = [...state.groups.list].sort(byName);
  for (const g of folders) {
    const inside = matches.filter((m) => state.groups.members[m.n.path] === g.id);
    if (q && !inside.length) continue; // while searching, only folders with hits
    const open = q || !closed.has(g.id) || inside.some((m) => m.n.path === state.current);
    const f = document.createElement('li');
    f.className = 'folder' + (open ? ' open' : '');
    f.dataset.group = g.id;
    f.style.setProperty('--sw', g.color);
    f.innerHTML = `<span class="chev" aria-hidden="true"></span><span class="ficon" aria-hidden="true"></span>
      <span class="name">${escapeHtml(g.name)}</span><span class="count">${inside.length}</span>
      <button class="f-add icon" title="New note in this folder">＋</button>
      <button class="f-more icon" title="Folder options">⋯</button>`;
    ul.appendChild(f);
    if (open) for (const m of inside) ul.appendChild(noteItem(m.n, m.snippet, true));
  }
  const loose = matches.filter((m) => !groupById(state.groups.members[m.n.path]));
  if (folders.length && loose.length) {
    const h = document.createElement('li');
    h.className = 'loose-head';
    h.textContent = 'Not in a folder';
    ul.appendChild(h);
  }
  for (const m of loose) ul.appendChild(noteItem(m.n, m.snippet, false));
  highlightActive();
}

async function newFolder() {
  const name = await Dialog.prompt('New folder', '', { message: 'Notes in a folder share its colour in the graph.', okLabel: 'Create' });
  if (typeof name !== 'string' || !name.trim()) return;
  const g = state.groups.list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) || createGroup(name.trim());
  setFolderClosed(g.id, false);
  await saveGroups();
  return g;
}

// Folder options: rename, change colour, delete
let folderMenu = null;
function closeFolderMenu() { folderMenu?.remove(); folderMenu = null; }
function openFolderMenu(g, x, y) {
  closeFolderMenu();
  folderMenu = document.createElement('ul');
  folderMenu.className = 'menu folder-menu';
  folderMenu.innerHTML = `<li data-act="new">New note here</li><li data-act="rename">Rename</li>
    <li data-act="color"><span class="swatch" style="--sw:${g.color}"></span>Change colour</li>
    <li class="sep"></li><li data-act="delete" class="danger">Delete folder</li>`;
  document.body.appendChild(folderMenu);
  folderMenu.style.left = Math.min(x, innerWidth - folderMenu.offsetWidth - 8) + 'px';
  folderMenu.style.top = Math.min(y, innerHeight - folderMenu.offsetHeight - 8) + 'px';
  folderMenu.addEventListener('click', async (e) => {
    const act = e.target.closest('li[data-act]')?.dataset.act;
    if (!act) return;
    closeFolderMenu();
    if (act === 'new') return newNote(g.id);
    if (act === 'color') {
      g.color = GROUP_COLORS[(GROUP_COLORS.indexOf(g.color) + 1) % GROUP_COLORS.length];
      await saveGroups();
      return renderFileList();
    }
    if (act === 'rename') {
      const el = $(`#file-list li.folder[data-group="${g.id}"] .name`);
      if (el) inlineEdit(el, { value: g.name, onSave: async (name) => { g.name = name; await saveGroups(); renderFileList(); } });
      return;
    }
    const ok = await Dialog.confirm(`The notes in “${g.name}” are kept; they just move out of the folder.`, { title: 'Delete folder?', okLabel: 'Delete', danger: true });
    if (!ok) return;
    state.groups.list = state.groups.list.filter((x) => x !== g);
    await saveGroups();
    renderFileList();
  });
}
document.addEventListener('pointerdown', (e) => {
  if (folderMenu && !e.target.closest('.folder-menu')) closeFolderMenu();
});

function highlightActive() {
  document.querySelectorAll('#file-list li.note').forEach((li) => li.classList.toggle('active', li.dataset.path === state.current));
}

// ---------- vault page: notes as document cards ----------
function edited(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// Small rendered preview of the start of a note, shown as a shrunken page
function thumbHtml(content) {
  const md = outsideCode(stripFront(content).slice(0, 1500), (part) =>
    part.replace(LINK_RE, (_m, inner) => `<span class="wikilink">${escapeHtml(parseLink(inner).alias || parseLink(inner).raw)}</span>`)
  );
  return marked.parse(md);
}

function renderNoteGrid() {
  const q = $('#note-search').value.trim().toLowerCase();
  const backlinks = new Map();
  for (const links of state.links.values()) for (const l of links) if (l.resolved) backlinks.set(l.resolved, (backlinks.get(l.resolved) || 0) + 1);
  const notes = [...state.notes.values()]
    .filter((n) => !q || n.name.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name));
  $('#note-grid').innerHTML = notes
    .map((n) => {
      const links = (state.links.get(n.path)?.length || 0) + (backlinks.get(n.path) || 0);
      return `<div class="vault-card note-card" data-path="${escapeHtml(n.path)}" tabindex="0">
        <div class="doc-thumb"><div class="doc-mini markdown${stripFront(n.content).trim() ? '' : ' empty'}">${stripFront(n.content).trim() ? thumbHtml(n.content) : ''}</div></div>
        <div class="card-info">
          <div class="card-text">
            <div class="card-name" title="${escapeHtml(n.path)}">${escapeHtml(n.name)}</div>
            <div class="card-meta">${groupOf(n.path) ? `<span class="swatch" style="--sw:${groupOf(n.path).color}" title="${escapeHtml(groupOf(n.path).name)}"></span>` : '<span class="card-icon doc"></span>'} ${n.mtime ? 'Edited ' + edited(n.mtime) : ''}${links ? ` · ${links} link${links === 1 ? '' : 's'}` : ''}</div>
          </div>
          <button class="card-more icon" title="More actions">⋮</button>
        </div>
      </div>`;
    })
    .join('');
  // Banner stats for the whole vault
  const all = [...state.notes.values()];
  const linkCount = [...state.links.values()].reduce((sum, l) => sum + l.filter((x) => x.resolved).length, 0);
  const lastEdit = Math.max(0, ...all.map((n) => n.mtime || 0));
  $('#vh-stats').textContent = [
    `${all.length} note${all.length === 1 ? '' : 's'}`,
    `${linkCount} link${linkCount === 1 ? '' : 's'}`,
    lastEdit ? `last edited ${edited(lastEdit)}` : '',
  ].filter(Boolean).join(' · ');

  const empty = $('#note-empty');
  empty.hidden = notes.length > 0;
  empty.textContent = q ? 'No notes match your search.' : 'No notes yet — start one with “Blank note” above.';
}

let noteMenuFor = null;
function closeNoteMenu() {
  $('#note-menu').hidden = true;
  noteMenuFor = null;
}

$('#note-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.note-card');
  if (!card || e.target.isContentEditable) return;
  if (e.target.closest('.card-more')) {
    e.stopPropagation();
    const r = e.target.getBoundingClientRect();
    const menu = $('#note-menu');
    noteMenuFor = card.dataset.path;
    menu.hidden = false;
    menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px';
    return;
  }
  openNote(card.dataset.path);
});
$('#note-grid').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('note-card')) openNote(e.target.dataset.path);
});
$('#note-menu').addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  const path = noteMenuFor;
  closeNoteMenu();
  if (!li || !path) return;
  if (li.dataset.act === 'open') openNote(path);
  else if (li.dataset.act === 'rename') {
    // Edit the name right on the card, like vault names
    const el = [...document.querySelectorAll('.note-card')].find((c) => c.dataset.path === path)?.querySelector('.card-name');
    if (el) inlineEdit(el, { value: nameOf(path), onSave: async (name) => { await renameNote(path, name); renderNoteGrid(); } });
  } else if (li.dataset.act === 'delete') {
    if (await deleteNote(path)) renderNoteGrid();
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#note-menu')) closeNoteMenu(); });

$('#note-search').addEventListener('input', renderNoteGrid);
$('#vh-new').addEventListener('click', newNote);
document.querySelectorAll('.view-toggle button').forEach((b) =>
  b.addEventListener('click', () => { location.hash = b.dataset.view === 'graph' ? `${vaultHash()}/graph` : vaultHash(); })
);
// Rename the vault by editing its name in place (`el` is the name text that becomes editable)
function renameVault(el = state.view === 'graph' ? $('#vh-name > span') : $('#vh-title')) {
  inlineEdit(el, {
    value: state.vault.name,
    onSave: async (name) => {
      await api.renameVault(state.vault.id, name);
      setVaultName(name);
    },
  });
}
$('#vh-name').addEventListener('click', () => renameVault($('#vh-name > span')));
$('#vh-title').addEventListener('click', () => renameVault($('#vh-title')));

// ⋮ next to the vault name: rename / export / delete this vault
$('#vh-more').addEventListener('click', (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  const menu = $('#vault-menu');
  menu.hidden = false;
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = r.bottom + 4 + 'px';
});
$('#vault-menu').addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  $('#vault-menu').hidden = true;
  if (!li) return;
  if (li.dataset.act === 'rename') renameVault();
  else if (li.dataset.act === 'export') api.exportVault();
  else if (li.dataset.act === 'delete') {
    const ok = await Dialog.confirm(`“${state.vault.name}” and its ${state.notes.size} notes will be deleted. This can't be undone — export it first if you want a backup.`, { title: 'Delete vault?', okLabel: 'Delete', danger: true });
    if (!ok) return;
    const id = state.vault.id;
    location.hash = '#/';
    await api.deleteVault(id);
    Home.refresh();
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#vault-menu')) $('#vault-menu').hidden = true; });

// Right-click a note card for its menu
$('#note-grid').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  e.preventDefault();
  const menu = $('#note-menu');
  noteMenuFor = card.dataset.path;
  menu.hidden = false;
  menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + 'px';
});
$('#vh-export').addEventListener('click', () => api.exportVault());
$('#vh-import').addEventListener('click', () => $('#file-input').click());

function linkContext(content, targetPath) {
  for (const line of stripCode(content).split('\n')) {
    for (const m of line.matchAll(LINK_RE)) {
      if (resolve(parseLink(m[1]).target) === targetPath) return line.replace(LINK_RE, (_x, i) => parseLink(i).alias || parseLink(i).raw).trim();
    }
  }
  return '';
}

function renderSidePanel() {
  const ol = $('#outlinks');
  ol.innerHTML = '';
  const cur = state.current;
  const none = (ul, text) => {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = text;
    ul.appendChild(li);
  };

  // Links here: notes whose text links to this one, and notes related to it
  const subs = [];
  if (cur) for (const [p, links] of state.links) if (p !== cur && (links.some((l) => l.resolved === cur) || state.ups.get(p)?.has(cur))) subs.push(p);
  const sl = $('#subnotes');
  sl.innerHTML = '';
  $('#sub-count').textContent = subs.length ? `(${subs.length})` : '';
  if (!subs.length) none(sl, cur ? 'No notes link here yet' : '—');
  for (const p of subs.sort()) {
    const li = document.createElement('li');
    li.dataset.open = p;
    li.textContent = nameOf(p);
    // Show the sentence the link is in, or "Related" when it's only a Related-to connection
    const ctx = linkContext(stripFront(state.notes.get(p).content), cur) || (state.ups.get(p)?.has(cur) ? 'Related' : '');
    if (ctx) {
      const s = document.createElement('span');
      s.className = 'ctx';
      s.textContent = ctx;
      li.appendChild(s);
    }
    sl.appendChild(li);
  }

  // Links to: what this note links to
  const outs = cur
    ? [...(state.links.get(cur) || []), ...[...(state.ups.get(cur) || [])].map((p) => ({ target: nameOf(p), resolved: p, part: true }))]
    : [];
  if (!outs.length) none(ol, cur ? 'No links yet' : '—');
  for (const l of outs) {
    const li = document.createElement('li');
    li.textContent = l.resolved ? nameOf(l.resolved) : l.target;
    if (l.part) {
      const s = document.createElement('span');
      s.className = 'ctx';
      s.textContent = 'Related';
      li.appendChild(s);
    }
    li.dataset.target = l.target;
    if (!l.resolved) {
      li.className = 'unresolved';
      li.title = 'Not created yet — click to create';
    }
    ol.appendChild(li);
  }

  const words = cur ? (stripFront(state.notes.get(cur)?.content || '').match(/\S+/g) || []).length : 0;
  $('#stats').textContent = state.vault ? `${state.notes.size} notes${cur ? ` · ${words} words` : ''}` : '';
}

// ---------- events ----------
$('#preview').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.classList.contains('wikilink')) openOrCreate(a.dataset.target);
  else if (/^https?:/i.test(a.getAttribute('href'))) api.openExternal(a.href);
});

$('#file-list').addEventListener('click', (e) => {
  const folder = e.target.closest('li.folder');
  if (folder) {
    e.stopImmediatePropagation(); // keep the slide-out panel open on phones
    const g = groupById(folder.dataset.group);
    if (!g || e.target.isContentEditable) return;
    if (e.target.closest('.f-add')) return newNote(g.id);
    if (e.target.closest('.f-more')) {
      const r = e.target.getBoundingClientRect();
      return openFolderMenu(g, r.left, r.bottom + 4);
    }
    setFolderClosed(g.id, folder.classList.contains('open'));
    return renderFileList();
  }
  const li = e.target.closest('li.note');
  if (li) openNote(li.dataset.path);
});
// Right-click: a note → choose its folder; a folder → its options
$('#file-list').addEventListener('contextmenu', (e) => {
  const folder = e.target.closest('li.folder');
  const note = e.target.closest('li.note');
  if (!folder && !note) return;
  e.preventDefault();
  if (folder) openFolderMenu(groupById(folder.dataset.group), e.clientX, e.clientY);
  else openGroupMenu(note.dataset.path, e.clientX, e.clientY);
});
// Drag a note onto a folder (or a note in it) to put it there; anywhere else in the list takes it out.
let draggedNote = null;
function dropTarget(e) {
  const li = e.target.closest('#file-list li');
  if (li?.matches('li.folder')) return li;
  if (li?.matches('li.note.in-folder')) return findFolderRow(li);
  return $('#file-list');
}
$('#file-list').addEventListener('dragstart', (e) => {
  const li = e.target.closest('li.note');
  if (!li) return;
  draggedNote = li.dataset.path;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', nameOf(draggedNote));
});
$('#file-list').addEventListener('dragover', (e) => {
  if (!draggedNote) return;
  const t = dropTarget(e);
  document.querySelectorAll('#file-list .drop-here, #file-list.drop-here').forEach((x) => x.classList.remove('drop-here'));
  e.preventDefault();
  t.classList.add('drop-here');
});
function findFolderRow(li) {
  let x = li;
  while (x && !x.matches('li.folder')) x = x.previousElementSibling;
  return x;
}
$('#file-list').addEventListener('drop', async (e) => {
  if (!draggedNote) return;
  e.preventDefault();
  const t = dropTarget(e);
  const path = draggedNote;
  draggedNote = null;
  const id = t.matches('li.folder') ? t.dataset.group : null;
  if ((state.groups.members[path] || null) === id) return renderFileList();
  if (id) setFolderClosed(id, false);
  await setGroup(path, id);
  const g = groupById(id);
  toast(g ? `“${nameOf(path)}” moved to ${g.name}` : `“${nameOf(path)}” is no longer in a folder`);
});
$('#file-list').addEventListener('dragend', () => {
  draggedNote = null;
  document.querySelectorAll('#file-list .drop-here, #file-list.drop-here').forEach((x) => x.classList.remove('drop-here'));
});
$('#btn-new-folder').addEventListener('click', newFolder);
$('#rightbar').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  if (li.dataset.open) openNote(li.dataset.open);
  else if (li.dataset.target) openOrCreate(li.dataset.target);
});

$('#search').addEventListener('input', renderFileList);
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = $('#file-list li.note');
    if (first) openNote(first.dataset.path);
  } else if (e.key === 'Escape') {
    e.target.value = '';
    renderFileList();
    editor.focus();
  }
});

$('#title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.focus();
  } else if (e.key === 'Escape') {
    e.target.value = nameOf(state.current);
    editor.focus();
  }
});
$('#title').addEventListener('change', renameCurrent);

document.querySelectorAll('#topbar .seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#btn-new').addEventListener('click', newNote);
$('#btn-delete').addEventListener('click', deleteCurrent);
$('#btn-back').addEventListener('click', () => history.back());
$('#btn-fwd').addEventListener('click', () => history.forward());
$('#btn-export').addEventListener('click', async () => {
  await flushSave();
  api.exportVault();
});
$('#btn-import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  await flushSave();
  try {
    const count = await api.importFiles(files);
    if (!count) return;
    await loadNotes();
    renderFileList();
    if (state.view === 'docs') renderNoteGrid();
    else if (state.view === 'graph') Graph.rebuild();
    else renderSidePanel();
    toast(`Imported ${count} note${count === 1 ? '' : 's'}`);
  } catch (err) {
    Dialog.alert(err.message, 'Could not import');
  }
});
$('#btn-menu').addEventListener('click', () => document.body.classList.toggle('show-sidebar'));

// Notes panel can be collapsed (remembered per browser)
function setNotesCollapsed(collapsed) {
  document.body.classList.toggle('notes-collapsed', collapsed);
  try { localStorage.setItem('nodebook:notesCollapsed', collapsed ? '1' : ''); } catch { /* storage blocked */ }
}
$('#btn-collapse').addEventListener('click', () => setNotesCollapsed(true));
$('#btn-expand').addEventListener('click', () => setNotesCollapsed(false));
try { setNotesCollapsed(!!localStorage.getItem('nodebook:notesCollapsed')); } catch { /* storage blocked */ }
$('#file-list').addEventListener('click', () => document.body.classList.remove('show-sidebar'));

document.addEventListener('keydown', (e) => {
  if (!state.vault) return;
  const k = e.key.toLowerCase();
  // Ctrl+N can't be intercepted in browsers, so new note is Alt+N
  if (e.altKey && k === 'n') { e.preventDefault(); newNote(); }
  // Ctrl+G: the vault's graph (or back to its documents when already there)
  else if (e.ctrlKey && k === 'g') { e.preventDefault(); location.hash = state.view === 'graph' ? vaultHash() : `${vaultHash()}/graph`; }
  else if (e.ctrlKey && (k === 'p' || k === 'o')) {
    e.preventDefault();
    const box = state.view === 'note' ? $('#search') : $('#note-search');
    if (state.view === 'graph') location.hash = vaultHash();
    box.focus();
    box.select();
  }
  else if (e.ctrlKey && k === 'e' && state.view === 'note') { e.preventDefault(); setMode(state.mode === 'edit' ? 'preview' : 'edit'); }
  else if (e.ctrlKey && k === 's') { e.preventDefault(); flushSave(); }
});

window.addEventListener('beforeunload', () => {
  if (pendingSave) api.writeNote(pendingSave.path, pendingSave.content);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});

// Edits made in another tab
api.onVaultChanged(async (vaultId) => {
  if (Home.visible) return Home.refresh();
  if (!state.vault || vaultId !== state.vault.id) return;
  const before = state.notes.get(state.current)?.content;
  await loadNotes();
  state.groups = await api.getGroups(state.vault.id);
  renderGroupChip();
  renderGroupLegend();
  renderFileList();
  if (state.view === 'docs') return renderNoteGrid();
  if (state.view === 'note' && !state.notes.has(state.current)) {
    state.current = null;
    return location.replace(vaultHash());
  }
  const after = state.notes.get(state.current)?.content;
  if (after !== undefined && after !== before && !pendingSave) {
    editor.replace(after);
    renderPartOf();
    if (state.mode === 'preview') renderPreview();
  }
  renderSidePanel();
  if (state.view === 'graph') Graph.rebuild();
});

// ---------- boot ----------
Graph.init($('#graph'), {
  getData: () => ({ notes: state.notes, links: state.links, related: state.ups, groups: state.groups, current: state.current }),
  onOpen: (node) => (node.unresolved ? openOrCreate(node.label) : openNote(node.id)),
  onPinsChange: (pins) => api.savePins(pins),
  onGroupMenu: (node, x, y) => openGroupMenu(node.id, x, y),
});

// Routes: #/ (all vaults), #/v/<vault> (its documents), #/v/<vault>/graph, #/v/<vault>/n/<note path>
async function route() {
  await flushSave();
  const m = location.hash.match(/^#\/v\/([\w-]+)(?:\/(graph|n\/(.*)))?$/);
  if (!m) {
    api.closeVault();
    state.vault = null;
    state.current = null;
    state.view = 'home';
    Graph.hide();
    $('#app').hidden = true;
    $('#vault-home').hidden = true;
    return Home.show();
  }
  if (!state.vault || state.vault.id !== m[1]) {
    const info = await api.openVault(m[1]);
    if (!info) return location.replace('#/');
    await enterVault(info);
  }
  if (m[3] !== undefined) {
    const path = decodeURIComponent(m[3]);
    if (!state.notes.has(path)) return location.replace(vaultHash());
    if (state.view === 'note' && state.current === path) return; // already showing it
    return showNote(path);
  }
  showVaultPage(m[2] === 'graph' ? 'graph' : 'docs');
}
window.addEventListener('hashchange', route);
route();
