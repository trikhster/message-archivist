---
tags: [feature, media]
updated: 2026-10-26
since: 0.4.5.0
---
# Photo statuses and runs

Every photo, GIF, video and voice note has a status, worked out from what was recorded about it. Because the backup knows exactly which items still need work, a later run only goes back as far as the oldest of them instead of re-reading the whole chat. Formats are in [[Library format]].

## Statuses
`GMLib.mediaStatus(md)` in `library.js` (accepts both the `messages.json` and the compact `chat.js` keys):

| Status | Rule | Label (`MEDIA_STATUS`) |
|---|---|---|
| `full` | has a file, `source === 'full-size viewer'` | Full size |
| `same` | has a file, source says "same size as the full-size viewer" | Full size (the chat picture was already full size) |
| `thumbnail` | has a file, `kind === 'image'`, source mentions "chat thumbnail" | Thumbnail |
| `original` | has a file, anything else (GIFs, videos, audio, files) | Saved as sent |
| `skipped` | no file, `skipped` set (link-preview pictures from sites not allowed) | Not saved (by choice) |
| `failed` | no file, `error` set | Couldn't be saved |
| `waiting` | no file, no error, not skipped | Not fetched yet |
| `left` | not a media item: a row from `media_left_out` | Left out (another copy kept) |

`left` comes from `dropSamePictures()`: a GIF's still frame (`gif-preview`) or a smaller copy of the same picture (`duplicate`), matched by `imageFingerprint()` / `sameImage()` / `betterCopy()`.

The viewer has its own copy of these rules (`mediaSt()` in `viewer.js`) because `index.html` runs from disk without `library.js`. Change both together.

## Run modes (`opts.media`)
| Mode | Started by | What it does |
|---|---|---|
| `all` (default) | "Start backup" | messages and every photo; full size when `opts.fullSize` |
| `speed` | "Speed run" on the start card or in "Back up everything" | messages first; photos that haven't loaded are left `waiting`. `saveMedia` returns after the fast pass. Chat status becomes `messages` |
| `fetch` | popup "Fetch N photos", Settings "Fetch … not fetched yet", "Retry failed photos", "Fetch the missing ones again" | only items without a file (`waiting`, plus `failed`/`skipped` when `retryFailed`) |
| `fullsize` | popup "Upgrade N to full size", Settings "Upgrade … thumbnails" | items with status `thumbnail`; sets `fullSize: true` |

`mediaOnly(opts)` is true for `fetch` and `fullsize`: no contact card capture, no second read.

## How a fetch or upgrade run works
In `backupConversation()` (`content.js`):
1. `wants(md)` decides per item: no file and no error → wanted unless speed; no file with error/skipped → only with `retryFailed`; has a file → only in `fullsize` mode and only thumbnails.
2. `findTargets()` builds `targets`: message key → item indexes. `tried` stops the same item being attempted twice in a run.
3. `stopAt.lastT` is set to the oldest target's timestamp, so scrolling back stops there ("reached messages already saved").
4. As messages appear, `fetchTarget(m, { viewer, scroll })` matches the page's media to the saved items with `alignMedia()` (left-out copies shift the indexes), downloads, and writes with `saveMediaFile()`.
5. Upgrades: the new file gets a unique name (often ending ` (2)`), the old thumbnail is removed with `sink.remove()` (and dropped from the checksums), and `upgraded_from: { width, height, sha256, at }` is kept.
6. `refreshTargets()` runs on every flush, so messages saved during this run whose photos hadn't loaded are picked up too.
7. Items the background saver (`early`) or the run's own `ctx.done` already has are skipped; `adoptLate()` folds late results into the saved record.

`want_full` on an item (set by Settings' "Fetch the missing ones again" when the lost file was full size) makes `fetchTarget` use the full-size viewer for that item even in `fetch` mode.

## Where the counts show
- Popup: `renderPhotos(job.media)` from `chatStatus[id].media`, refreshed by `gm-backup-status` after every run (manual, scheduled, fetch, upgrade).
- Settings → Check for problems: `mediaCell()` per chat from `data.js` rows; bulk buttons from the same counts.
- Settings → Check every photo: reads every `media-index.json`, checks file present, SHA-256, and decoded size (`createImageBitmap`, HEIC skipped).
- Viewer → Media tab: the status filter, with counts.
- Run result: `backupConversation` returns `media` counts (including `left`).
