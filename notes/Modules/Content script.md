---
tags: [module]
file: extension/content.js
lines: 3064
updated: 2026-10-26
---
# Content script (`content.js`)

Runs on `https://messages.google.com/*` after `zip.js` and `library.js` (manifest order). One IIFE. It reads chats out of the page, drives scrolling and the photo viewer, shows the progress panel, and writes through the [[Writer frame]]. The biggest file by far: find your way with the section markers (`// ---------- name ----------`).

## Sections (in file order)
| Section | What's there |
|---|---|
| top | `SEL` selectors ([[Google Messages page]]), `running` / `cancelled` / `lastStart`, small helpers (`clean`, `pad`, `safeName`, `currentId`) |
| progress HUD | `HUD`: the panel (top-layer modal `<dialog>` while working, popover docked bottom-right otherwise), two progress bars, log, Pause/Stop. `guard()` blocks clicks, keys and scrolling on the page; `askChoice()` / `askOnPage()` / `confirmStop()`; `ownWindow()`, `keepVisible()`, `checkpoint()` (pause point + bring the window back) |
| timestamps | `parseTime`, `parseDay`, `formatDate`: Messages shows relative times and date headings; this normalises them to local `YYYY-MM-DD HH:MM` with a precision |
| reading messages from the DOM | `readMessage()`, `messageDetails()` (status, edited, reactions, previews), `cachedRead()` (WeakMap + MutationObserver), `scrapeSnapshot()` |
| media | `sniff()` (checks the first bytes really are media), `fetchBlob()` (page fetch, falls back to `gm-fetch`), `liveElement()`, `waitForMedia()`, `fullSizeFromViewer()`, `downloadMedia()`, `uniqueName()` |
| where files go | `ZipSink` (date-range zips), `FrameSink` (the backup folder: `write`, `writeTemp`, `remove`, `list`, `readText`, `exists`, `askPermission`) |
| one conversation | `collectConversation()` (scroll back, decide the first message is reached), `dropSamePictures()`, `writeMessageMedia()`, `saveMediaFile()`, `mediaSaver()` (background saver), `saveMedia()` (final pass), `record()`, `convData()`, `exportOne()` |
| resumable backup of one conversation | `loadEntry()` (+ journal replay), `alignMedia()`, `conversationDetails()`, `mediaOnly()`, **`backupConversation()`** (~400 lines; see [[Backup run]]) |
| contact card | `backToChat()`, `captureContact()`, `saveContact()` |
| navigating between conversations | `listConversations()`, `chatLinks()`, `chatListInfo()`, `listChatsQuick()`, `openConversation()`, `reopenConversation()`, `chatAvatar()`, `currentTitle()` |
| settings | `getSettings()` (read only: the page never changes settings), `backupSink()` |
| pinned chats | `SEL.pinned` and `isPinned()` (an icon named `push_pin`/`keep`, a "Pinned" label, or the item's aria-label): `chatListInfo().pinned` (the Add chats list) and `conversationDetails().pinned` (saved with the chat). **Not yet checked against the live page** |
| index, checksums, logs | `openLibrary()`, `findEntry()` (by Google ID; for a chat without one, by name or by number),  `writeChatFiles()` (chat.js, CSV, media-index), `writeIndex()`, `recordRun()` |
| choosing chats / date range | `chooseTargets()`, `zipExport()` |
| backing up into the library | `folderRun()`, `adoptOrCreate()` |
| back up everything | `runTotal()` |
| entry points | `report()`, `finishRun()`, `failRun()`, `run()`, `runScheduled()` |
| analyze without saving | `runAnalyze()`, `openAnalyzer()` (embeds `viewer.html?embed=1`, sends `gm-data`) |
| diagnostics | `diagnose()`: selector match counts and sanitised markup, text masked |
| bottom | `chrome.runtime.onMessage` listener ([[Messages between parts]]) |

## Long chats (0.5.0.0)
`backupConversation` keeps `savedIds` / `savedSigs` sets beside `savedBy`, so `unknown(page)` costs the page, not the chat. `mergeIn` puts a batch older (or newer) than everything saved in front (or at the end) and renumbers in place, updating the sets incrementally; anything else goes through `mergeChrono` and a full `reindex()`. `buildProgress({ checks: false })` reuses the last `checkChat` result between compactions. Compaction runs every `max(3 min, 20 ms × messages)` or past `max(3000, messages/4)` journaled records, and is skipped at the start when the chat is already on disk with no leftover journal. Mid-chat `onCompact` calls `writeIndex(…, false, { chatFiles: false })`. `mediaSink` (the open `FrameSink`) lets `fetchBlob` fetch through the writer frame before falling back to `gm-fetch`. Benchmarks: [[Testing]].

## Things to know
- **Re-injection**: after the extension reloads, the old copy on an open tab is cut off. `window.__gmExporter.alive()` lets the new copy take over.
- **One run at a time** per tab (`running`). Handlers answer "already running".
- **Closures everywhere**: `backupConversation` keeps its state (`saved`, `savedBy`, `targets`, `touched`, `journalSeq`…) in local variables and inner functions. Read it top to bottom before changing it.
- **The page must be visible** for Messages to load history and images. `checkpoint()` and the background's `keepVisible` deal with minimised windows. See [[Gotchas]].
- **Logs**: `HUD.log(text, level)`; `HUD.debug()` lines are only in the saved log (marked DEBUG). Never log message text.
- `background` (module-level flag) marks unattended runs; `runOptions()` records the options in the log and export-info.

## Related
[[Backup run]] · [[Photo statuses and runs]] · [[Library format]] · [[Google Messages page]] · [[Gotchas]]
