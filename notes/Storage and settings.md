---
tags: [reference, storage]
updated: 2026-10-26
---
# Storage and settings

## chrome.storage.local
| Key | Written by | Holds |
|---|---|---|
| `settings` | popup, options, content, background | the settings object below |
| `runs` | content `recordRun()`, options (imports, clean-ups) | last 30 runs: `{ at, kind, target, ok, summary, added, log[] }` |
| `chatStatus` | background on `gm-backup-status` | per chat ID: `{ title, complete, count, oldest, status, media, at }`, read by the popup |
| `restore` (`chrome.storage.session`) | background `compactWindow()` | per tab ID: the bounds and state of a window shrunk for a backup, given back by `gm-restore-window`. Session storage survives the worker being stopped, not a browser restart |
| `myNames` | options `whoAmI()` | per service: the names that are you in that app's exports ("Which one is you?"), e.g. `{ whatsapp: ['Alex Doe'] }` ([[Sources]]) |
| `theme` | `theme.js` (`GMTheme.set`) | `light`, `dark` or `system`; mirrors the extension pages' choice so the progress panel on the Messages tab matches |

Every part reads settings through `GMLib.normalizeSettings()` (`library.js`, loaded by the content script, background worker, popup and Settings), so defaults live in one place: `GMLib.SETTINGS_DEFAULTS`. `saveSettings(patch)` merges into the normalised object, which also saves the migration.

### Settings fields (0.5.0.0, `settingsVersion: 5`)
| Field | Default | Used for |
|---|---|---|
| `folderName` | `''` | name of the chosen backup folder (the handle itself is in IndexedDB) |
| `includeMedia` | `true` | save photos, GIFs, videos and audio (Basic). Fetch/upgrade runs save photos regardless |
| `fullSize` | `true` | full-size photos in **every** kind of backup (Basic "Photo quality"). Replaces 0.4.x's popup choice, `totalFullSize` and `scheduleFullSize` |
| `fullSizeEarly` | `true` | open full-size photos between history batches (Advanced) |
| `backupWindow` | `corner` | `corner` (small window in a corner), `window` (own window), `tab` (left where it is). Replaces `ownWindow` + `compactWindow` |
| `compactCorner` | `bottom-right` | `bottom-right`, `bottom-left`, `top-right`, `top-left` (Advanced) |
| `notify` | `true` | notification when a backup finishes |
| `patience` | `25` | seconds to wait for older messages before deciding a chat is complete (10 / 25 / 60) |
| `verifyRead` | `false` | read each chat twice in "Back up everything" |
| `rawMarkup` | `false` | keep each message's outerHTML (`raw_html`) |
| `phoneMedia` | `true` | include photos in the phone restore file |
| `downloadsSubfolder` | `Google Messages Exports` | date-range zips go to Downloads/this |
| `caseNote` | `''` | case reference written into export-info.json, logs and printouts |
| `schedules` | `[]` | the automatic backup list (below) |
| `settingsVersion` | `5` | set by the migration |

Migration from 0.4.x (`normalizeSettings`): popup `fullSize: false` → `fullSize: false`; popup `includeMedia: false` → `includeMedia: false`; `ownWindow: false` → `backupWindow: 'tab'`; everything else takes the new defaults; old keys (`popup`, `ownWindow`, `compactWindow`, `totalFullSize`, `scheduleFullSize`, `saveMode`, schedule `action`) are removed. The background worker saves the migrated form on install and startup.

Link-preview pictures ("previewPics") aren't a stored setting: the checkbox reflects whether the optional `https://*/*` host permission is granted.

### schedules[] (the backup list)
`{ id, title, everyHours (0 = only when asked), enabled, addedAt, lastRun, lastTried, lastOk, lastResult, lastAdded, complete, count, oldest, status }`. `runDue()` runs those due every 15-minute alarm (`gm-schedule`), within 5 minutes of due.

## IndexedDB
Database `gm-exporter`, store `kv`, key `backupDir`: the `FileSystemDirectoryHandle` for the backup folder. Written by Settings (`showDirectoryPicker`), read by the [[Writer frame]], Settings and the [[Viewer]]. All three are extension pages, so they share it.

Permission: `queryPermission({ mode: 'readwrite' })`; Chrome may drop it after a restart. Interactive runs ask on the page (the writer frame's card); automatic runs can't and report it.

## localStorage
- `gm-settings-mode` (Settings page): `basic` or `advanced`, the list last shown.

## localStorage (viewer)
- `gm-flags:<exported_at>:<chat ids…>`: flags for a viewer **not** opened from the extension (`index.html` from disk). With "Open my backup" flags live in `labels.json` and any here are moved over once.
- `gm-theme`: the theme choice for each extension page and the viewer (`theme.js`). The source of truth for those pages; `chrome.storage.local.theme` is a copy for the content script.
