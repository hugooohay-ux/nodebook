/* global marked, Graph, Home, api */
// `api` is exposed by storage.js
const $ = (s) => document.querySelector(s);

const state = {
  vault: null,
  notes: new Map(), // path -> { path, name, content }
  links: new Map(), // path -> [{ target, resolved }]
  byName: new Map(), // lowercase name / path (no .md) -> path
  current: null,
  mode: 'edit',
  view: 'note',
  history: [],
  hIndex: -1,
};

let saveTimer = null;
let pendingSave = null;

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
    for (const m of stripCode(n.content).matchAll(LINK_RE)) {
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
}

// ---------- loading ----------
async function loadNotes() {
  const list = await api.listNotes();
  const fresh = new Map(list.map((n) => [n.path, { path: n.path, name: nameOf(n.path), content: n.content }]));
  // Keep unsaved edits for the open note
  if (pendingSave && fresh.has(pendingSave.path)) fresh.get(pendingSave.path).content = pendingSave.content;
  state.notes = fresh;
  rebuildIndex();
}

const EMPTY_MSG = 'This vault is empty. Create your first note with Alt+N.';

async function openVault(info) {
  Home.hide();
  Graph.reset();
  $('#app').hidden = false;
  state.vault = info;
  document.title = `${info.name} – Nodebook`;
  $('#vault-name').textContent = info.name;
  $('#search').value = '';
  state.current = null;
  state.history = [];
  state.hIndex = -1;
  await loadNotes();
  renderFileList();
  const first = state.notes.has('Welcome.md') ? 'Welcome.md' : [...state.notes.keys()].sort()[0];
  if (first) openNote(first);
  else showEmpty(EMPTY_MSG);
}

function showEmpty(msg) {
  state.view = 'empty';
  Graph.hide();
  $('#empty-msg').textContent = msg;
  $('#empty').hidden = false;
  $('#note-view').hidden = true;
  $('#graph-view').hidden = true;
  renderSidePanel();
}

// ---------- saving ----------
function scheduleSave() {
  const note = state.notes.get(state.current);
  if (!note) return;
  note.content = $('#editor').value;
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
  renderSidePanel();
  if (state.view === 'graph') Graph.rebuild();
}

// ---------- opening notes ----------
async function openNote(path, { push = true } = {}) {
  await flushSave();
  if (!state.notes.has(path)) return;
  state.current = path;
  if (push) {
    state.history = state.history.slice(0, state.hIndex + 1);
    if (state.history[state.hIndex] !== path) state.history.push(path);
    state.hIndex = state.history.length - 1;
  }
  setView('note');
  const note = state.notes.get(path);
  $('#title').value = note.name;
  $('#editor').value = note.content;
  $('#editor').scrollTop = 0;
  setMode(state.mode);
  renderSidePanel();
  highlightActive();
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

// Ctrl+Enter: turn the word at/just before the cursor (or the selection) into [[link]] and create that note
const WORD_CH = /[\p{L}\p{N}_'-]/u;
async function linkWordAtCursor() {
  const ta = $('#editor');
  const text = ta.value;
  let start = ta.selectionStart;
  let end = ta.selectionEnd;
  const caret = end;
  if (start === end) {
    // Cursor inside a word, or after a word plus trailing spaces
    if (!WORD_CH.test(text[end] || '') && !WORD_CH.test(text[end - 1] || '')) {
      while (end > 0 && /[ \t]/.test(text[end - 1])) end--;
    }
    start = end;
    while (start > 0 && WORD_CH.test(text[start - 1])) start--;
    while (end < text.length && WORD_CH.test(text[end])) end++;
  } else {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
  }
  const word = text.slice(start, end).replace(/^['-]+|['-]+$/g, '');
  start += text.slice(start, end).indexOf(word);
  end = start + word.length;
  if (!word || /[[\]\n|#]/.test(word)) return toast('Put the cursor in or right after a word');
  if (text.slice(start - 2, start) === '[[' && text.slice(end, end + 2) === ']]') return toast(`“${word}” is already a link`);

  // execCommand keeps the edit on the native undo stack (Ctrl+Z works)
  ta.focus();
  ta.setSelectionRange(start, end);
  document.execCommand('insertText', false, `[[${word}]]`);
  const pos = caret > end ? caret + 4 : end + 4;
  ta.setSelectionRange(pos, pos);
  scheduleSave();

  if (resolve(word)) return toast(`Linked to “${word}”`);
  await createNoteNamed(word);
  await flushSave();
  toast(`Created note “${word}”`);
}

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

async function newNote() {
  if (!state.vault) return;
  let name = 'Untitled';
  for (let i = 1; resolve(name); i++) name = `Untitled ${i}`;
  const path = (state.current ? dirOf(state.current) : '') + name + '.md';
  await api.createNote(path, '');
  state.notes.set(path, { path, name, content: '' });
  rebuildIndex();
  renderFileList();
  await openNote(path);
  setMode('edit');
  $('#title').focus();
  $('#title').select();
}

function go(delta) {
  const i = state.hIndex + delta;
  if (i < 0 || i >= state.history.length) return;
  const path = state.history[i];
  if (!state.notes.has(path)) return;
  state.hIndex = i;
  openNote(path, { push: false });
}

// ---------- rename & delete ----------
async function renameCurrent() {
  const note = state.notes.get(state.current);
  if (!note) return;
  const newName = $('#title').value.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!newName || newName === note.name) {
    $('#title').value = note.name;
    return;
  }
  await flushSave();
  const oldName = note.name;
  const newPath = dirOf(note.path) + newName + '.md';
  try {
    await api.renameNote(note.path, newPath);
  } catch (e) {
    alert(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    $('#title').value = oldName;
    return;
  }
  state.notes.delete(note.path);
  state.notes.set(newPath, { path: newPath, name: newName, content: note.content });
  state.history = state.history.map((p) => (p === note.path ? newPath : p));
  state.current = newPath;

  // Update [[Old]], [[Old|alias]] and [[Old#heading]] across the vault
  const re = new RegExp(`\\[\\[\\s*${escapeRe(oldName)}\\s*(?=[\\]|#])`, 'gi');
  for (const n of state.notes.values()) {
    const updated = n.content.replace(re, `[[${newName}`);
    if (updated !== n.content) {
      n.content = updated;
      await api.writeNote(n.path, updated);
    }
  }
  $('#editor').value = state.notes.get(newPath).content;
  rebuildIndex();
  renderFileList();
  renderSidePanel();
  if (state.mode === 'preview') renderPreview();
}

async function deleteCurrent() {
  const note = state.notes.get(state.current);
  if (!note) return;
  if (!confirm(`Delete "${note.name}"? This can't be undone.`)) return;
  clearTimeout(saveTimer);
  pendingSave = null;
  await api.trashNote(note.path);
  state.notes.delete(note.path);
  state.history = state.history.filter((p) => p !== note.path);
  state.hIndex = state.history.length - 1;
  rebuildIndex();
  renderFileList();
  const next = state.history[state.hIndex] || [...state.notes.keys()].sort()[0];
  if (next) openNote(next, { push: false });
  else {
    state.current = null;
    showEmpty(EMPTY_MSG);
  }
}

// ---------- rendering ----------
function setView(view) {
  state.view = view;
  $('#empty').hidden = true;
  $('#note-view').hidden = view !== 'note';
  $('#graph-view').hidden = view !== 'graph';
  $('#btn-graph').classList.toggle('active', view === 'graph');
  if (view === 'graph') Graph.show();
  else Graph.hide();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#editor').hidden = mode !== 'edit';
  $('#preview').hidden = mode !== 'preview';
  if (mode === 'preview') renderPreview();
  else $('#editor').focus();
}

function renderPreview() {
  const note = state.notes.get(state.current);
  if (!note) return;
  const md = outsideCode(note.content, (part) =>
    part.replace(LINK_RE, (_m, inner) => {
      const { target, alias, raw } = parseLink(inner);
      const cls = resolve(target) ? 'wikilink' : 'wikilink unresolved';
      return `<a href="#" class="${cls}" data-target="${escapeHtml(target)}">${escapeHtml(alias || raw)}</a>`;
    })
  );
  $('#preview').innerHTML = marked.parse(md);
}

function renderFileList() {
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#file-list');
  ul.innerHTML = '';
  const notes = [...state.notes.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  let lastDir = '';
  for (const n of notes) {
    let snippet = '';
    if (q) {
      const inName = n.name.toLowerCase().includes(q);
      const idx = n.content.toLowerCase().indexOf(q);
      if (!inName && idx < 0) continue;
      if (!inName) snippet = n.content.slice(Math.max(0, idx - 20), idx + 60).replace(/\s+/g, ' ');
    }
    const dir = dirOf(n.path);
    if (dir !== lastDir && dir) {
      const f = document.createElement('li');
      f.className = 'folder';
      f.textContent = dir.slice(0, -1);
      ul.appendChild(f);
    }
    lastDir = dir;
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.path = n.path;
    li.title = n.path;
    li.textContent = n.name;
    if (dir) li.style.paddingLeft = '18px';
    if (snippet) {
      const s = document.createElement('span');
      s.className = 'snippet';
      s.textContent = '…' + snippet;
      li.appendChild(s);
    }
    ul.appendChild(li);
  }
  highlightActive();
}

function highlightActive() {
  document.querySelectorAll('#file-list li.note').forEach((li) => li.classList.toggle('active', li.dataset.path === state.current));
}

function linkContext(content, targetPath) {
  for (const line of stripCode(content).split('\n')) {
    for (const m of line.matchAll(LINK_RE)) {
      if (resolve(parseLink(m[1]).target) === targetPath) return line.replace(LINK_RE, (_x, i) => parseLink(i).alias || parseLink(i).raw).trim();
    }
  }
  return '';
}

function renderSidePanel() {
  const bl = $('#backlinks');
  const ol = $('#outlinks');
  bl.innerHTML = '';
  ol.innerHTML = '';
  const cur = state.current;
  const none = (ul, text) => {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = text;
    ul.appendChild(li);
  };

  const backs = [];
  if (cur) for (const [p, links] of state.links) if (links.some((l) => l.resolved === cur)) backs.push(p);
  $('#bl-count').textContent = backs.length ? `(${backs.length})` : '';
  if (!backs.length) none(bl, cur ? 'No backlinks' : '—');
  for (const p of backs.sort()) {
    const li = document.createElement('li');
    li.dataset.open = p;
    li.textContent = nameOf(p);
    const ctx = linkContext(state.notes.get(p).content, cur);
    if (ctx) {
      const s = document.createElement('span');
      s.className = 'ctx';
      s.textContent = ctx;
      li.appendChild(s);
    }
    bl.appendChild(li);
  }

  const outs = cur ? state.links.get(cur) || [] : [];
  if (!outs.length) none(ol, cur ? 'No outgoing links' : '—');
  for (const l of outs) {
    const li = document.createElement('li');
    li.textContent = l.resolved ? nameOf(l.resolved) : l.target;
    li.dataset.target = l.target;
    if (!l.resolved) {
      li.className = 'unresolved';
      li.title = 'Not created yet — click to create';
    }
    ol.appendChild(li);
  }

  const words = cur ? (state.notes.get(cur)?.content.match(/\S+/g) || []).length : 0;
  $('#stats').textContent = state.vault ? `${state.notes.size} notes${cur ? ` · ${words} words` : ''}` : '';
}

// ---------- [[ autocomplete ----------
const ac = { el: $('#ac'), items: [], sel: 0, start: 0, open: false };

function caretCoords(ta, pos) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', boxSizing: 'border-box', width: ta.clientWidth + 'px', top: '0', left: '0' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = '​';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const out = { x: r.left + span.offsetLeft - ta.scrollLeft, y: r.top + span.offsetTop - ta.scrollTop + (parseFloat(cs.lineHeight) || 24) };
  div.remove();
  return out;
}

function updateAutocomplete() {
  const ta = $('#editor');
  const pos = ta.selectionStart;
  const m = ta.value.slice(0, pos).match(/\[\[([^[\]\n|#]*)$/);
  if (!m) return closeAutocomplete();
  const q = m[1].toLowerCase();
  const names = [...state.notes.values()].map((n) => n.name).filter((n) => n !== nameOf(state.current));
  const items = names
    .filter((n) => n.toLowerCase().includes(q))
    .sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) || a.localeCompare(b))
    .slice(0, 8)
    .map((n) => ({ name: n }));
  if (q && !names.some((n) => n.toLowerCase() === q)) items.push({ name: m[1].trim(), create: true });
  if (!items.length) return closeAutocomplete();
  ac.items = items;
  ac.sel = Math.min(ac.sel, items.length - 1);
  ac.start = pos - m[1].length;
  ac.open = true;
  ac.el.innerHTML = items
    .map((it, i) => `<li data-i="${i}" class="${i === ac.sel ? 'sel' : ''}${it.create ? ' create' : ''}">${it.create ? 'Link new note: ' : ''}${escapeHtml(it.name)}</li>`)
    .join('');
  const c = caretCoords(ta, ac.start);
  ac.el.hidden = false;
  ac.el.style.left = Math.min(c.x, window.innerWidth - 380) + 'px';
  ac.el.style.top = Math.min(c.y, window.innerHeight - ac.el.offsetHeight - 8) + 'px';
}

function closeAutocomplete() {
  ac.open = false;
  ac.sel = 0;
  ac.el.hidden = true;
}

function acceptAutocomplete(i = ac.sel) {
  const it = ac.items[i];
  if (!it) return;
  const ta = $('#editor');
  const after = ta.value.slice(ta.selectionStart);
  const closing = after.startsWith(']]') ? '' : ']]';
  ta.setRangeText(it.name + closing, ac.start, ta.selectionStart, 'end');
  if (!closing) ta.selectionStart = ta.selectionEnd = ta.selectionStart + 2;
  closeAutocomplete();
  scheduleSave();
}

// ---------- events ----------
$('#editor').addEventListener('input', () => {
  scheduleSave();
  updateAutocomplete();
});
$('#editor').addEventListener('click', closeAutocomplete);
$('#editor').addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
$('#editor').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    closeAutocomplete();
    linkWordAtCursor();
    return;
  }
  if (ac.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      ac.sel = (ac.sel + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length;
      updateAutocomplete();
      return e.preventDefault();
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      acceptAutocomplete();
      return e.preventDefault();
    }
    if (e.key === 'Escape') {
      closeAutocomplete();
      return e.preventDefault();
    }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    e.target.setRangeText('    ', e.target.selectionStart, e.target.selectionEnd, 'end');
    scheduleSave();
  }
  // Auto-close [[ ]]
  if (e.key === '[' && e.target.value[e.target.selectionStart - 1] === '[' && e.target.selectionStart === e.target.selectionEnd) {
    e.preventDefault();
    const s = e.target.selectionStart;
    e.target.setRangeText('[]]', s, s, 'start');
    e.target.selectionStart = e.target.selectionEnd = s + 1;
    scheduleSave();
    updateAutocomplete();
  }
});
ac.el.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) {
    e.preventDefault();
    acceptAutocomplete(+li.dataset.i);
  }
});

$('#preview').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.classList.contains('wikilink')) openOrCreate(a.dataset.target);
  else if (/^https?:/i.test(a.getAttribute('href'))) api.openExternal(a.href);
});

$('#file-list').addEventListener('click', (e) => {
  const li = e.target.closest('li.note');
  if (li) openNote(li.dataset.path);
});
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
    $('#editor').focus();
  }
});

$('#title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#editor').focus();
  } else if (e.key === 'Escape') {
    e.target.value = nameOf(state.current);
    $('#editor').focus();
  }
});
$('#title').addEventListener('change', renameCurrent);

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#btn-new').addEventListener('click', newNote);
$('#btn-graph').addEventListener('click', () => (state.view === 'graph' && state.current ? openNote(state.current, { push: false }) : setView('graph')));
$('#btn-delete').addEventListener('click', deleteCurrent);
$('#btn-back').addEventListener('click', () => go(-1));
$('#btn-fwd').addEventListener('click', () => go(1));
$('#btn-first-note').addEventListener('click', newNote);
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
    if (!state.current) openNote([...state.notes.keys()].sort()[0]);
    else renderSidePanel();
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
});
$('#vault-name').addEventListener('click', async () => {
  const name = prompt('Rename vault', state.vault.name)?.trim();
  if (!name || name === state.vault.name) return;
  await api.renameVault(state.vault.id, name);
  state.vault.name = name;
  $('#vault-name').textContent = name;
  document.title = `${name} – Nodebook`;
});
$('#btn-menu').addEventListener('click', () => document.body.classList.toggle('show-sidebar'));
$('#file-list').addEventListener('click', () => document.body.classList.remove('show-sidebar'));

document.addEventListener('keydown', (e) => {
  if (!state.vault) return;
  const k = e.key.toLowerCase();
  // Ctrl+N can't be intercepted in browsers, so new note is Alt+N
  if (e.altKey && k === 'n') { e.preventDefault(); newNote(); }
  else if (e.ctrlKey && k === 'g') { e.preventDefault(); $('#btn-graph').click(); }
  else if (e.ctrlKey && (k === 'p' || k === 'o')) { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  else if (e.ctrlKey && k === 'e' && state.current) { e.preventDefault(); if (state.view !== 'note') openNote(state.current, { push: false }); setMode(state.mode === 'edit' ? 'preview' : 'edit'); }
  else if (e.ctrlKey && k === 's') { e.preventDefault(); flushSave(); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
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
  renderFileList();
  if (state.current && !state.notes.has(state.current)) {
    const next = [...state.notes.keys()].sort()[0];
    state.current = null;
    if (next) openNote(next, { push: false });
    else showEmpty(EMPTY_MSG);
    return;
  }
  const after = state.notes.get(state.current)?.content;
  if (after !== undefined && after !== before && !pendingSave) {
    const ta = $('#editor');
    const sel = ta.selectionStart;
    ta.value = after;
    ta.selectionStart = ta.selectionEnd = Math.min(sel, after.length);
    if (state.mode === 'preview') renderPreview();
  }
  renderSidePanel();
  if (state.view === 'graph') Graph.rebuild();
});

// ---------- boot ----------
Graph.init($('#graph'), {
  getData: () => ({ notes: state.notes, links: state.links, current: state.current }),
  onOpen: (node) => (node.unresolved ? openOrCreate(node.label) : openNote(node.id)),
});

// Routes: #/ (home) and #/v/<vault id>
async function route() {
  await flushSave();
  const m = location.hash.match(/^#\/v\/([\w-]+)/);
  if (m) {
    const info = await api.openVault(m[1]);
    if (info) return openVault(info);
    return location.replace('#/');
  }
  api.closeVault();
  state.vault = null;
  state.current = null;
  Graph.hide();
  closeAutocomplete();
  $('#app').hidden = true;
  Home.show();
}
window.addEventListener('hashchange', route);
route();
