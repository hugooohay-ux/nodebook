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
- `public/vendor/` – marked (Markdown) and JSZip
