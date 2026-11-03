# Nodebook

A Markdown note web app with vaults, `[[wiki links]]`, backlinks and a graph view.
Everything is stored in your browser (IndexedDB) — no server, no account. Export a vault as a `.zip` to back it up or move it to another device.

## Run locally

```
npm start
```

Then open http://localhost:5173. No dependencies to install.

## Deploy to Render

The repo includes a `render.yaml` blueprint that publishes `public/` as a free static site.
In Render: **New → Blueprint**, pick this repository, and click **Apply**.

## Features

- Home screen with every vault as a card (live graph thumbnail, note count, last opened); rename, export, delete; templates; import a `.zip` as a new vault
- Markdown editor with Edit / Read modes and autosave
- `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]` links, with autocomplete after typing `[[`
- Clicking a link to a note that doesn't exist creates it
- Backlinks (with context) and outgoing links for every note
- "Part of" parents, set from a bar above each note. Stored as `up:` properties (the format Obsidian's
  Breadcrumbs plugin reads), hidden in the editor. The parent lists the note under Sub-notes.
- Hovering a note in the graph lights up its line in both directions — the notes it leads to and the notes
  that lead to it, step by step — but never sideways (a sibling under the same parent stays dark).
  It doesn't matter which of two notes writes the link.
- Renaming a note updates links to it across the vault
- Force-directed graph: drag, zoom, click to open, hover to highlight neighbours,
  local graph with depth, unresolved/orphan toggles, highlight filter
- Full-text search, back/forward history, live sync between open tabs
- Works on phones (sidebar becomes a slide-out menu)

## Shortcuts

| Key | Action |
| --- | --- |
| Alt+N | New note |
| Ctrl+Enter | Turn the word at the cursor (or the selection) into a linked note |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline |
| Ctrl+Shift+X | Strikethrough |
| Ctrl+Alt+0–3 | Normal text / Heading 1–3 |
| Ctrl+Shift+7 / 8 / 9 | Numbered list / bulleted list / checklist |
| Ctrl+P / Ctrl+O | Search notes |
| Ctrl+G | Toggle graph view |
| Ctrl+E | Toggle edit / read |
| Ctrl+S | Save now |
| Alt+← / Alt+→ | Back / forward |

## Files

- `public/storage.js` – vaults and notes in IndexedDB, import/export
- `public/home.js` – vault home screen
- `public/renderer.js` – editor, links, backlinks, search, routing
- `public/graph.js` – graph view (canvas + force simulation)
- `src/editor.js` – the editor (CodeMirror 6): live-rendered links, hidden Markdown marks, formatting commands.
  Rebuild with `npm install && npm run build`; the output `public/vendor/editor.js` is committed so the site needs no build step.
- `public/vendor/` – the built editor, marked (Markdown) and JSZip
