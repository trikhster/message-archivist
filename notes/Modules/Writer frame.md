---
tags: [module]
file: extension/writer.js
lines: 95
updated: 2026-10-26
---
# Writer frame (`writer.html`, `writer.js`)

A hidden extension iframe that the [[Content script]] adds to the Messages page (`FrameSink.open()`). It owns the backup folder: it reads the `backupDir` handle from IndexedDB `gm-exporter`/`kv` and does all reading and writing. Why it exists: [[Architecture]].

## Protocol
1. The content script `postMessage`s `{ type: 'gm-writer-init' }` with a `MessageChannel` port, to the frame's origin.
2. The frame accepts it only from its parent, only from `https://messages.google.com` or its own origin, and only once.
3. Requests `{ id, op, args }` → replies `{ id, ok, result }` or `{ id, ok: false, error, name }`. `id: 0` means ready.

## Ops
| Op | Args | Result |
|---|---|---|
| `status` | | `{ folder, permission }` or `{ folder: null }` |
| `exists` | `path` | boolean |
| `readText` | `path` | text (throws if missing) |
| `write` | `path`, `data` (string or Blob) | creates folders as needed |
| `remove` | `path` | deletes a file or a folder recursively; missing is fine (`false`) |
| `list` | `path` | `[{ name, kind }]`, empty if missing |
| `ask` | | shows the "Allow access" card, resolves `granted` / `denied` |
| `joinCsv` | `out`, `parts` | joins every chat's messages.csv into `out` as Blob slices (each part minus its BOM and header after the first), never as text in the page; returns `{ sha256, size }` (0.5.0.0) |
| `fetch` | `url` | fetches a photo or video the page can't read (CORS), with the extension's site permissions; returns `{ blob }` or `{ blocked }` (0.5.0.0) |

`FrameSink.askPermission()` makes the frame visible in the middle of the page, in the top layer (popover) above the HUD, for the `ask` op.

Paths are relative to the backup folder, `/`-separated. Checksums are kept by `FrameSink`, not here.
