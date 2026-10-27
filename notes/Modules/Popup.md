---
tags: [module, ui]
file: extension/popup.js
lines: 258
updated: 2026-10-26
---
# Popup (`popup.html`, `popup.js`)

The toolbar popup. It always says what to do next (`guide()`): no folder yet → choose one; not on Messages → open it; phone not paired → how to pair; no chat open → pick one or back up everything.

## What it shows for an open chat
- Status from `chatStatus[id]` merged with the backup-list entry (`renderChatStatus()`): "Backed up and verified", "Backed up", "Messages backed up, photos to fetch", "Partly backed up", count and how far back. The main button reads **Carry on backing up** for unfinished chats.
- The chat's own picture (`gm-avatar`).
- **Photos and videos in the backup** (`renderPhotos(job.media)`) with **Fetch N photos** (`runPhotos('fetch', hasFailed)`) and **Upgrade N to full size** (`runPhotos('fullsize')`). `runPhotos` pings first and stops if a run is going, sends `gm-media`, waits 600 ms for an early refusal, then closes the popup. A run that starts only answers when it's done.
- **🏷 Labels and flags…** → `gm-open-backup` with `labels/<chat id>`, opening the [[Viewer]] with the chat's labels menu.
- Backup list select ("Keep this chat backed up automatically"): adds the chat to `settings.schedules` and sets `everyHours`.

## More options
Media and full-size checkboxes (the same `includeMedia` / `fullSize` settings as Settings → Basic, since 0.5.0.0), a date range (a separate zip), **Back up everything** behind three deliberate steps (open the panel, tick the box, confirm the count on the page), page diagnostics.

## How it talks to the page
`send(msg)`: `chrome.tabs.sendMessage` to the active tab; if that fails (tab open before the extension loaded), injects `zip.js`, `library.js`, `content.js` and retries. Starting a run uses `start(type, opts)`, which closes the popup once the page has accepted.
