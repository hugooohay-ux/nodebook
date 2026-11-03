// Markdown editor with live-rendered [[wiki links]], built on CodeMirror 6.
// Bundled to public/vendor/editor.js by `npm run build`; exposes window.NoteEditor.
import { Annotation, EditorSelection, EditorState, Prec, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';

const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;
const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const WORD_CH = /[\p{L}\p{N}_'-]/u;

const refreshLinks = StateEffect.define(); // re-check which links resolve
const external = Annotation.define(); // changes that didn't come from typing

function parseLink(inner) {
  const bar = inner.indexOf('|');
  const raw = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  return { target: raw.split('#')[0].trim(), label: bar < 0 ? raw : inner.slice(bar + 1).trim() };
}

// ---------- link widget shown in place of [[...]] ----------
class LinkWidget extends WidgetType {
  constructor(label, target, resolved, open) {
    super();
    this.label = label;
    this.target = target;
    this.resolved = resolved;
    this.open = open;
  }
  eq(o) {
    return o.label === this.label && o.target === this.target && o.resolved === this.resolved;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = this.resolved ? 'cm-wikilink' : 'cm-wikilink cm-unresolved';
    el.textContent = this.label;
    el.title = this.resolved ? `Open “${this.target}”` : `Create “${this.target}”`;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.open(this.target);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function linkDecorations(view, opts) {
  const text = view.state.doc.toString();
  const code = [...text.matchAll(CODE_RE)].map((m) => [m.index, m.index + m[0].length]);
  const ranges = view.state.selection.ranges;
  const builder = new RangeSetBuilder();
  for (const m of text.matchAll(LINK_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    if (code.some(([a, b]) => from >= a && from < b)) continue;
    const { target, label } = parseLink(m[1]);
    if (!target) continue;
    // Show the raw [[...]] only while the cursor is in or touching it
    const editing = view.hasFocus && ranges.some((r) => r.from <= to && r.to >= from);
    builder.add(
      from,
      to,
      editing
        ? Decoration.mark({ class: 'cm-wikilink-raw' })
        : Decoration.replace({ widget: new LinkWidget(label, target, opts.resolve(target), opts.onOpenLink) })
    );
  }
  return builder.finish();
}

const livePreview = (opts) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = linkDecorations(view, opts);
      }
      update(u) {
        if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))) {
          this.decorations = linkDecorations(u.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

// ---------- hide Markdown syntax (#, **, _, ~~, `, <u>) except on lines being edited ----------
const HIDDEN_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const UNDERLINE_RE = /<u>(.+?)<\/u>/g;

function activeLines(view) {
  const lines = new Set();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    for (let l = view.state.doc.lineAt(r.from).number; l <= view.state.doc.lineAt(r.to).number; l++) lines.add(l);
  }
  return lines;
}

function markDecorations(view) {
  const { state } = view;
  const active = activeLines(view);
  const decos = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (!HIDDEN_MARKS.has(node.name)) return;
        if (node.name === 'CodeMark' && node.node.parent?.name !== 'InlineCode') return; // keep ``` fences
        if (active.has(state.doc.lineAt(node.from).number)) return;
        let end = node.to;
        if (node.name === 'HeaderMark' && state.sliceDoc(end, end + 1) === ' ') end++;
        if (end > node.from) decos.push(Decoration.replace({}).range(node.from, end));
      },
    });
    // Underline isn't Markdown, so it's stored as <u>…</u>
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(UNDERLINE_RE)) {
      const start = from + m.index;
      const end = start + m[0].length;
      decos.push(Decoration.mark({ class: 'cm-underline' }).range(start + 3, end - 4));
      if (!active.has(state.doc.lineAt(start).number)) {
        decos.push(Decoration.replace({}).range(start, start + 3));
        decos.push(Decoration.replace({}).range(end - 4, end));
      }
    }
  }
  return Decoration.set(decos, true);
}

const hideMarks = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = markDecorations(view);
    }
    update(u) {
      if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged) this.decorations = markDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

// ---------- formatting commands ----------
function wordAround(state, pos) {
  const line = state.doc.lineAt(pos);
  let a = pos - line.from;
  let b = a;
  while (a > 0 && WORD_CH.test(line.text[a - 1])) a--;
  while (b < line.text.length && WORD_CH.test(line.text[b])) b++;
  return { from: line.from + a, to: line.from + b };
}

// Wrap the selection (or the word at the cursor) in open/close marks, or remove them if already there
function toggleWrap(view, open, close = open) {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      let { from, to } = range.empty ? wordAround(state, range.head) : range;
      const inner = state.sliceDoc(from, to);
      if (state.sliceDoc(from - open.length, from) === open && state.sliceDoc(to, to + close.length) === close) {
        return {
          changes: [{ from: from - open.length, to: from }, { from: to, to: to + close.length }],
          range: range.empty ? EditorSelection.cursor(range.head - open.length) : EditorSelection.range(from - open.length, to - open.length),
        };
      }
      if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
        return {
          changes: [{ from, to: from + open.length }, { from: to - close.length, to }],
          range: EditorSelection.range(from, to - open.length - close.length),
        };
      }
      return {
        changes: [{ from, insert: open }, { from: to, insert: close }],
        range: range.empty ? EditorSelection.cursor(range.head + open.length) : EditorSelection.range(from + open.length, to + open.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input.format' }
  );
  return true;
}

function selectedLines(state) {
  const lines = [];
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) if (!lines.includes(l)) lines.push(l);
  }
  return lines.map((n) => state.doc.line(n));
}

function setHeading(view, level) {
  const changes = selectedLines(view.state).map((line) => {
    const m = /^#{1,6}\s+/.exec(line.text);
    return { from: line.from, to: line.from + (m ? m[0].length : 0), insert: level ? '#'.repeat(level) + ' ' : '' };
  });
  view.dispatch({ changes, userEvent: 'input.format' });
  return true;
}

const LIST_RE = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
const BLOCKS = {
  bullet: { test: /^\s*[-*+] (?!\[[ xX]\] )/, make: () => '- ' },
  number: { test: /^\s*\d+[.)] /, make: (i) => `${i + 1}. ` },
  task: { test: /^\s*[-*+] \[[ xX]\] /, make: () => '- [ ] ' },
  quote: { test: /^\s*> /, make: () => '> ' },
};

// Toggle a list/quote prefix on every selected line
function toggleBlock(view, kind) {
  const lines = selectedLines(view.state);
  const all = lines.every((l) => BLOCKS[kind].test.test(l.text));
  const changes = lines.map((line, i) => {
    const m = LIST_RE.exec(line.text);
    const indent = m ? m[1] : '';
    const cut = m ? m[0].length : 0;
    return { from: line.from, to: line.from + cut, insert: all ? indent : indent + BLOCKS[kind].make(i) };
  });
  view.dispatch({ changes, userEvent: 'input.format' });
  return true;
}

// What formatting is at the cursor, for the toolbar's active states
function formatState(state) {
  const pos = state.selection.main.head;
  const names = new Set();
  const tree = syntaxTree(state);
  for (const side of [-1, 1]) for (let n = tree.resolveInner(pos, side); n; n = n.parent) names.add(n.name);
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const underline = [...line.text.matchAll(UNDERLINE_RE)].some((m) => col >= m.index && col <= m.index + m[0].length);
  return {
    bold: names.has('StrongEmphasis'),
    italic: names.has('Emphasis'),
    strike: names.has('Strikethrough'),
    code: names.has('InlineCode'),
    underline,
    heading: (/^(#{1,6})\s/.exec(line.text)?.[1].length) || 0,
    bullet: BLOCKS.bullet.test.test(line.text),
    number: BLOCKS.number.test.test(line.text),
    task: BLOCKS.task.test.test(line.text),
    quote: BLOCKS.quote.test.test(line.text),
  };
}

const COMMANDS = {
  undo: (v) => undo(v),
  redo: (v) => redo(v),
  bold: (v) => toggleWrap(v, '**'),
  italic: (v) => toggleWrap(v, '_'),
  underline: (v) => toggleWrap(v, '<u>', '</u>'),
  strike: (v) => toggleWrap(v, '~~'),
  code: (v) => toggleWrap(v, '`'),
  heading: (v, level) => setHeading(v, level),
  bullet: (v) => toggleBlock(v, 'bullet'),
  number: (v) => toggleBlock(v, 'number'),
  task: (v) => toggleBlock(v, 'task'),
  quote: (v) => toggleBlock(v, 'quote'),
};

// ---------- [[ autocomplete ----------
const linkCompletions = (opts) => (ctx) => {
  const m = ctx.matchBefore(/\[\[[^[\]\n|#]*/);
  if (!m) return null;
  const query = m.text.slice(2).trim();
  const names = opts.noteNames();
  const apply = (name) => (view, _c, from, to) => {
    const closed = view.state.sliceDoc(to, to + 2) === ']]';
    view.dispatch({ changes: { from, to, insert: closed ? name : name + ']]' }, selection: { anchor: from + name.length + 2 } });
  };
  const options = names.map((n) => ({ label: n, apply: apply(n) }));
  if (query && !names.some((n) => n.toLowerCase() === query.toLowerCase())) {
    options.push({ label: query, detail: 'new note', apply: apply(query), boost: -50 });
  }
  return { from: m.from + 2, options, validFor: /^[^[\]\n|#]*$/ };
};

// ---------- Ctrl+Enter: word at cursor (or selection) -> [[link]] ----------
const linkWordCommand = (opts) => (view) => {
  const text = view.state.doc.toString();
  let { from: start, to: end } = view.state.selection.main;
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
  if (!word || /[[\]\n|#]/.test(word)) return opts.onLinkWord({ error: 'Put the cursor in or right after a word' }), true;
  if (text.slice(start - 2, start) === '[[' && text.slice(end, end + 2) === ']]') return opts.onLinkWord({ error: `“${word}” is already a link` }), true;
  view.dispatch({
    changes: { from: start, to: end, insert: `[[${word}]]` },
    selection: { anchor: caret > end ? caret + 4 : end + 4 },
    userEvent: 'input.link',
  });
  opts.onLinkWord({ word });
  return true;
};

// ---------- look ----------
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '650', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '.9em' },
  { tag: t.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--text-dim)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font, var(--font))', fontSize: 'var(--editor-size, 16px)', lineHeight: '1.7', overflow: 'auto', padding: '20px 16px 40vh' },
  // The note sits on a "page", like a document
  '.cm-content': {
    width: '100%',
    maxWidth: '816px',
    minHeight: 'min(1056px, calc(100vh - 170px))',
    margin: '0 auto',
    padding: '64px 72px',
    boxSizing: 'border-box',
    background: 'var(--page)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    boxShadow: 'var(--page-shadow)',
    caretColor: 'var(--accent)',
  },
  '@media (max-width: 700px)': { '.cm-scroller': { padding: '0' }, '.cm-content': { padding: '20px 16px', border: 'none', boxShadow: 'none', borderRadius: '0' } },
  '.cm-underline': { textDecoration: 'underline' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--text-dim)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font)', maxHeight: '16em', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', borderRadius: '5px', lineHeight: '1.5' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' },
  '.cm-completionDetail': { marginLeft: '8px', color: 'var(--text-dim)', fontStyle: 'italic' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '650' },
});

// ---------- public API ----------
window.NoteEditor = {
  create(parent, opts) {
    const extensions = [
      history(),
      drawSelection(),
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{'] } }]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      placeholder(opts.placeholder || ''),
      autocompletion({ override: [linkCompletions(opts)], icons: false }),
      livePreview(opts),
      hideMarks,
      theme,
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: linkWordCommand(opts) },
          { key: 'Mod-b', run: COMMANDS.bold },
          { key: 'Mod-i', run: COMMANDS.italic },
          { key: 'Mod-u', run: COMMANDS.underline },
          { key: 'Mod-Shift-x', run: COMMANDS.strike },
          { key: 'Mod-Shift-7', run: COMMANDS.number },
          { key: 'Mod-Shift-8', run: COMMANDS.bullet },
          { key: 'Mod-Shift-9', run: COMMANDS.task },
          { key: 'Mod-Alt-0', run: (v) => setHeading(v, 0) },
          { key: 'Mod-Alt-1', run: (v) => setHeading(v, 1) },
          { key: 'Mod-Alt-2', run: (v) => setHeading(v, 2) },
          { key: 'Mod-Alt-3', run: (v) => setHeading(v, 3) },
        ])
      ),
      keymap.of([
        { key: 'Tab', run: (v) => acceptCompletion(v) || (v.dispatch(v.state.replaceSelection('    ')), true) },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) opts.onChange();
        if (u.docChanged || u.selectionSet) opts.onFormat?.(formatState(u.state));
      }),
    ];
    const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });

    return {
      view,
      get value() {
        return view.state.doc.toString();
      },
      // Show a different note: fresh undo history, cursor at the top
      load(doc) {
        view.setState(EditorState.create({ doc, extensions }));
        view.scrollDOM.scrollTop = 0;
        opts.onFormat?.(formatState(view.state));
      },
      // Run a toolbar command: bold, italic, heading (with level), bullet, link, undo, …
      exec(cmd, arg) {
        if (cmd === 'link') linkWordCommand(opts)(view);
        else COMMANDS[cmd]?.(view, arg);
        view.focus();
      },
      // Replace the text of the same note (rename, other tab), keeping the cursor where it was
      replace(doc) {
        if (doc === view.state.doc.toString()) return;
        const head = Math.min(view.state.selection.main.head, doc.length);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor: head }, annotations: external.of(true) });
      },
      refresh() {
        view.dispatch({ effects: refreshLinks.of(null) });
      },
      focus() {
        view.focus();
      },
    };
  },
};
