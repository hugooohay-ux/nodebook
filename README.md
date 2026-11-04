# Nodebook

A Markdown note web app with vaults, `[[wiki links]]`, backlinks and a graph view.
Everything is stored in your browser (IndexedDB) — no server, no account. It's an installable app (PWA)
that works offline: in Chrome/Edge use the install icon in the address bar, on a phone "Add to Home screen". Export a vault as a `.zip` to back it up or move it to another device.

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
- `[[Note]]`, `[[Note#heading]]` links, with autocomplete after typing `[[`. To show other text than the note's
  name: `[[Note, "shown text"]]` or `[[Note|shown text]]` (renaming the note keeps the shown text)
- Clicking a link to a note that doesn't exist creates it
- Backlinks (with context) and outgoing links for every note
- Links in the text are the main way notes connect. Hovering a note in the graph follows them:
  everything below it lights up, and above it every route to the top where each step gets closer to the top
  (several equally short routes all light up; detours don't). Notes directly above that aren't closer light up
  one step only. Never sideways: a sibling stays dark. Which way is "down" is worked out from the vault
  (a topic linking to its subtopics, or the other way round, both work).
- "Related to": a lighter side connection, set from the bar above each note and stored as `related:`
  properties (older `up:` entries are read too). When hovering it lights up one step only, so
  Handelsbolag → [[Juridisk person]] doesn't carry on to what Juridisk person is related to.
- "★ Critical" (in the same bar): any note (linked or not) a note's chain must go to first, then on up from there, even when another
  route is shorter (e.g. a shortcut link from a top note). Coming from any other note, the chain reaches the
  note but doesn't carry on below it. No line is added for it: the highlight travels along the shortest chain of existing links to get there,
  drawn thicker. Stored as `critical:`.
- Note size = how much sits below a note along its links
- Renaming a note updates every link to it across the vault (all link forms, and "Related to")
- Deleting a note turns links to it into plain text, so nothing is left pointing at a note that's gone
- Notes panel: Ctrl-click to pick several notes, Shift-click to pick everything in between. Drag or right-click
  them to move them into a folder together, or press Delete to delete them; Esc clears the selection
- Drag a note in the graph to place it: it stays there (saved with the vault) and the rest settles around it.
  Right-click to let it float again, or "Unpin all". Notes are kept off lines that aren't theirs, and lines
  stop at the edge of each note.
- Folders in the notes panel: make one with the folder button, drag notes into it (or right-click a note),
  collapse it, add a note to it with ＋, rename/recolour/delete it with ⋯. A folder is a coloured group:
  its notes share its colour in the graph and can be pulled together. Groups can also be set from the graph
  (right-click a note) or the chip on a note, and managed in the graph panel.
- "Example: Solar System" template on the home screen: 26 notes in 3 folders: topics link to their subtopics, plus a few "Related to" connections
- Note size follows how linked a note is, with a "Node size" slider
- Force-directed graph: drag, zoom, click to open, hover to highlight neighbours,
  local graph with depth, unresolved/orphan toggles. Typing in Highlight lights up the best-matching note's whole path,
  as if you hovered it
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
- `public/sw.js`, `public/pwa.js`, `public/manifest.webmanifest`, `public/icons/` – installable app + offline cache.
  The service worker isn't registered on localhost, so local changes always show up.
- `public/home.js` – vault home screen
- `public/renderer.js` – editor, links, backlinks, search, routing
- `public/graph.js` – graph view (canvas + force simulation)
- `src/editor.js` – the editor (CodeMirror 6): live-rendered links, hidden Markdown marks, formatting commands.
  Rebuild with `npm install && npm run build`; the output `public/vendor/editor.js` is committed so the site needs no build step.
- `public/vendor/` – the built editor, marked (Markdown) and JSZip
