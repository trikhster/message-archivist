---
tags: [module, ui]
file: extension/options.js
lines: 1400
updated: 2026-10-26
---
# Settings page (`options.html`, `options.js`)

The extension's options page. Unlike the content script, it can read and write the backup folder directly (it's an extension page), using `folderForReading()` and `libraryIO(dir)` (which also hashes what it writes). Loads `zip.js` and `library.js` too.

## Tabs and routes (0.5.0.0)
`#home` (with the setup steps until there's a folder: folder, **start with your phone** (`welcomePhone` opens Tools and the phone import), Google Messages, back up everything; `#welcome` on first install keeps them showing), `#backups` (the index of every chat), `#restore` (phone restore file), `#tools` (checks, import, past runs), `#settings` (Basic / Advanced, remembered in localStorage). `#folder` opens Settings at the folder, `#delete:<folder>` opens Backups with the delete dialog. `showTab()` swaps the panel and `refreshTab()` draws only what that tab shows.

## Reading the backup once
`getLib(force)` reads `data.js`, `backup-state.json` and which chat folders exist, once, and Home, Backups and Phone restore share it. It's dropped (`libCache = null`) when something on disk changed: a run finished (`runs` changed), a delete, an import, a clean-up, a new folder, access allowed. `chrome.storage.onChanged` only reacts to `settings` and `runs`, in batches of 300 ms: settings redraw from memory; `runs` re-reads the backup. (0.4.x redrew everything, including 30 full logs, on every storage change.) Past runs put a log on the page only when it's opened.

## Sections (top to bottom of the file)
| Area | What it does |
|---|---|
| top (no marker) | `getSettings` (normalised), tabs, `renderForm` (Basic/Advanced), `renderRuns`, the change handler, the link-preview permission, choosing the folder, `getLib`, `renderHome` |
| reading the library | `fileAt`, `textAt`, `jsonAt`, `libraryRows` (data.js rows plus older formats) |
| back up everything | starts `gm-total` via `gm-to-tab`; `renderTotal()` shows the last run's coverage |
| every chat (the backup index) | `renderIndex` merges library rows and `settings.schedules` into `indexItems`; `drawIndex` filters, searches and draws 150 rows at a time; row actions (Back up / Continue via `runChats`, ⋯ Fetch / Upgrade via `runPhotos`, Open in my backup via `#chat-id/<id>`, Delete), the "By itself" select (writes `schedules`), the checks row from `progress.json`, and the fix-it bar (`health.*`) |
| tools | **Check every photo** (`checkPhotos`, `refetchMissing`), **Check no files have changed** (`verifySums`) |
| a copy for restoring to a phone | `renderRestore` (readiness from the rows: `restoreAddrs` = contact numbers, or a numeric/short-code title), `restoreItems()` (shared: addresses, sender numbers, same-minute seconds), `exportPackage` (the [[Restore package]] tar for the Android app) and the SMS Backup & Restore XML writer: one chat's messages.json at a time, a 2 MB write buffer, photos base64-encoded 3 MB at a time straight into the file (`writeBase64`), the count written over a placeholder at the end, same-minute messages a second apart |
| deleting a chat from the backup | moves the chat folder to `removed-chats/<date>/`, rewrites the index, checksums and log (`finishLibraryRun`), optionally adds it to `backup-state.json` `excluded` |
| duplicate photos | finds pictures saved twice and leftover identical files, moves extras to `removed-duplicates/<date>/` |
| chat names and order | numbers through `GMLib.formatNumber` and every list in `GMLib.chatOrder` order (the Backups index, the "Add chats" picker with pinned chats first); ⭐ for a starred contact and 📌 for pinned in the index |
| import earlier exports and phone backups | brings zips or folders from older versions, or a phone backup from the Android app, into the library (`importChat`). A phone backup is a source like a zip (`phoneSource`: chats read with `GMLib.readPackage` / `GMLib.phoneChat`, photos read straight from the tar); its chats are matched by phone number (`GMLib.phoneRowFor`), received senders renamed to the library's (`GMLib.useLibraryNames`), and new messages found with `GMLib.unknownPhone` instead of `unknownIn`. Each chat's history: `from_phone` from a phone backup ("From phone"), or an export's own `progress.json`; the phone's starred contacts and contact photos are added to a card the library already has (by number) |
| add chats from Messages | `gm-list-chats`, a searchable list with **Select all**, adds to the backup list |

## Patterns
- Anything that writes the library goes through `libraryIO` and ends with `finishLibraryRun()`, which rewrites `data.js`, `export-info.json`, `verification.json`, `messages.csv`, a log and `SHA256SUMS.txt`, and records the run in Past runs. `refetchMissing` is lighter: it rewrites the affected `messages.json` and the checksum list, then starts a fetch run.
- Actions that need the Messages page go through the [[Background worker]]: `gm-run-now` (backup-list jobs) or `gm-to-tab` (`gm-media`, `gm-total`, `gm-list-chats`).
- `toast(text)` for short confirmations; `esc()` for anything put into HTML.
