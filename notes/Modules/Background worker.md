---
tags: [module]
file: extension/background.js
lines: 294
updated: 2026-10-26
---
# Background worker (`background.js`)

The MV3 service worker. It can be stopped at any time by Chrome, so it keeps nothing important in memory (the `expected` downloads map is the one short-lived exception).

## Jobs
- **Schedules**: alarm `gm-schedule` every 15 minutes (`ensureAlarm()` on install and startup). `runDue(onlyIds, interactive, retryFailed)` picks due jobs from `settings.schedules`, finds or opens a Messages tab (`openMessagesWindow()`; skips with a "!" badge if the phone isn't paired), sends `gm-scheduled`, then records results on each job and sets the badge and notification.
- **Fetching for the page** (`gm-fetch`): media on googleusercontent.com etc. that the page can't read because of CORS. Other sites only with the optional `https://*/*` permission. Returns base64 (see [[Known issues]] for large videos).
- **Downloads into a subfolder**: `onDeterminingFilename` puts the expected zip into Downloads/`downloadsSubfolder`.
- **Windows**: `ownWindow()` moves the Messages tab into a window of its own; `keepVisible()` un-minimises it. With the compact setting, `compactWindow()` shrinks it to `COMPACT` (560×600, the width Messages is known to work at) in a corner of the screen the tab reports in `gm-ping` (a service worker has no `screen`), un-maximising first. A window that existed before is remembered in `chrome.storage.session` and put back by `restoreWindow()`. `openMessagesWindow()` (scheduled runs) compacts too.
- **Relays**: `gm-to-tab` from Settings to the Messages tab; opening Settings, the viewer or Messages.
- **Status**: `gm-backup-status` writes `chatStatus` (for the popup) and, unless the message says `statusOnly`, updates the backup list entries. The two writers of `settings.schedules` after a scheduled run would otherwise race (`runDue`'s `mark()` and this handler).
- **Link guard**: `gm-guard` swaps `window.open` in the page's MAIN world (content scripts can't).
- Loads `library.js` (`importScripts`) for `GMLib.normalizeSettings`. `migrateSettings()` saves settings in the current form on install and startup (4.0 removed the zip-per-run options; 5.0 merges the photo and window settings).

All message types: [[Messages between parts]].
