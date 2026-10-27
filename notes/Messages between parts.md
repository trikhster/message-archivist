---
tags: [reference, messaging]
updated: 2026-10-26
---
# Messages between parts

Every message has a `type` starting with `gm-`. Handlers are `switch (msg?.type)` blocks at the bottom of `content.js` and in `background.js`. Adding one: handle it in both places it passes through, and add a row here. See [[Architecture]].

## To the content script (Messages tab)
Sent with `chrome.tabs.sendMessage`. The popup's `send()` and the background's `sendToTab()` inject `zip.js`, `library.js` and `content.js` first if the tab was open before the extension was (re)loaded.

| Type | From | Payload | Reply | Notes |
|---|---|---|---|---|
| `gm-ping` | popup, options (via `gm-to-tab`), background | | `{ ok, running, id, title, paired, screen }` | `paired`: the conversation list or a message is on the page. `screen`: `{ left, top, width, height }` of the display's free area, for the compact window |
| `gm-avatar` | popup | | `{ ok, avatar }` | the chat's own picture, from the conversation list or header |
| `gm-export` | popup | `{ opts }` | `{ ok }` at once | `run(opts)`: back up this chat (or a date-range zip) |
| `gm-media` | popup, options (via `gm-to-tab`) | `{ mode: 'fetch' \| 'fullsize', retryFailed, jobs? }` | `{ ok, results }` when done | fetch or upgrade photos; `jobs` default to the open chat. See [[Photo statuses and runs]] |
| `gm-total` | popup, options (via `gm-to-tab`) | `{ opts }` | `{ ok }` at once | `runTotal`: back up everything |
| `gm-analyze` | popup | `{ opts }` | `{ ok }` at once | analyze without saving |
| `gm-scheduled` | background (`runDue`) | `{ jobs, interactive, retryFailed }` | `{ ok, results }` when done | scheduled runs and "Run now" / "Back up all now" |
| `gm-list-chats` | options (via `gm-to-tab`) | `{ limit }` | `{ ok, chats }` | "Add chats…": the conversation list, quickly |
| `gm-diagnose` | popup | | `{ ok, text }` | page structure with message text masked |

A second run while one is going gets `{ ok: false, error: 'An export is already running on this page.' }`.

## To the background worker
Sent with `chrome.runtime.sendMessage`.

| Type | From | Payload | Does |
|---|---|---|---|
| `gm-fetch` | content | `{ url }` | fetches media the page can't (CORS); replies `{ ok, type, b64 }`, or `{ blocked }` when the site isn't allowed |
| `gm-expect-download` | content | `{ name, subfolder }` | the next download with that name goes into Downloads/`subfolder` |
| `gm-run-now` | options | `{ ids, retryFailed }` | `runDue(ids, interactive=true)` |
| `gm-to-tab` | options | `{ message, focus? }` | brings the Messages tab forward and forwards `message` |
| `gm-guard` | content | `{ on }` | replaces `window.open` in the page's MAIN world while a run is going |
| `gm-badge` | content | `{ text }` | badge text while running |
| `gm-done` | content | `{ ok, title, message }` | ✓ or ! badge, and a notification if allowed |
| `gm-backup-status` | content (`finishRun`) | `{ results: [{ id, title, added, complete, count, oldest, status, media }], statusOnly? }` | updates `chatStatus` (the popup's status and photo counts) and, unless `statusOnly`, the backup list entries. Sent by every run that has per-chat results; scheduled runs set `statusOnly` because `runDue` updates the list itself |
| `gm-own-window` | content | | moves the tab into its own window, and with `compactWindow` shrinks it into a corner; replies `{ moved, windowId, compact }` |
| `gm-restore-window` | content (`finishRun`) | | gives a window that was shrunk for the backup its size back (only one that existed before the backup) |
| `gm-keep-visible` | content | | un-minimises that window |
| `gm-open-backup` | content, popup, options | `{ hash? }` | opens `viewer.html?library=1#hash` (hash checked against `^[\w/%.-]*$`) |
| `gm-open-messages` | popup, options | | focuses or opens Google Messages |
| `gm-open-settings` | content, viewer | `{ hash? }` | opens `options.html#hash` (`folder`, `welcome`, `delete:<folder>`) |
| `gm-clear-badge` | popup | | |

## Inside the page
- `gm-writer-init`: `postMessage` from the content script to the writer frame, carrying a `MessageChannel` port. After that the port carries `{ id, op, args }` → `{ id, ok, result | error, name }`. Ops: `status`, `exists`, `readText`, `write`, `remove`, `list`, `ask`, and from 0.5.0.0 `joinCsv` and `fetch`. See [[Writer frame]].
- `gm-data`: `postMessage` from the content script to the embedded viewer (`viewer.html?embed=1`) for "Analyze without saving".
