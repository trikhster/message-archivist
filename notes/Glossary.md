---
tags: [reference]
updated: 2026-10-26
---
# Glossary

| Term | Meaning |
|---|---|
| **library** | the backup folder the user chose; one index for every chat ([[Library format]]) |
| **entry** | a chat in an open library: `{ id, title, folder, row, data?, progress?, dirty }` |
| **row** | a chat's summary in `data.js` (`GMLib.summarize`) |
| **sink** | where files are written: `FrameSink` (the folder) or `ZipSink` (a date-range zip) |
| **HUD** | the progress panel on the Messages tab |
| **run** | one start-to-finish operation (backup, scheduled backup, total backup, fetch photos, upgrade photos, export, import); logged in `logs/` and Past runs |
| **target** (chats) | a chat chosen for a run: `{ id, name, href, entry? }` |
| **target** (photos) | a saved message with items to fetch or upgrade: key → item indexes |
| **speed run** | messages first, photos listed as `waiting` ([[Photo statuses and runs]]) |
| **fetch / upgrade** | `gm-media` runs: save waiting (and failed) photos / replace thumbnails with full size |
| **stopAt** | where reading back stops: messages already saved, or the oldest photo target |
| **patience** | seconds of quiet loading before the first message counts as reached |
| **journal** | `journal/NNNNNN.json` pieces written during a run; **compaction** folds them into `messages.json` |
| **early saver** | `mediaSaver()`: saves loaded photos in the background while history loads |
| **full size between batches** | `fullSizeBetween()`: viewer photos opened while Messages fetches the next batch |
| **left out** | a duplicate picture (GIF still, smaller copy) not saved because another copy was |
| **tombstone** | Messages' date headings and group events (`mws-tombstone-message-wrapper`) |
| **precision** | how exact a timestamp is: `message`, `section` (date heading), `day` |
| **coverage** | how many conversations in Messages' list are completely backed up (`backup-state.json` vs the library) |
| **excluded** | chats deleted with "don't back it up again"; "Back up everything" skips them |
| **ci / i** | in the viewer: a chat's position in `data.js` / a message's `index` |
| **restore package** | the `.tar` the Android app reads ([[Restore package]]) |
| **SMS role** | being the phone's default SMS app; only its holder may write messages ([[Android app]]) |
| **paired** | Google Messages for Web is connected to the phone (the conversation list shows) |
- **Phone backup**: a [[Restore package]] made by the Android app from a phone's own messages; updated in place, and by itself (every hour to every 30 days) if asked.
- **Claim**: a backup from the web taking a phone-imported message as the same message (it gets Google's ID). See [[Backup run]].
- **Piece**: one of the files a chat is in, in a version 2 package (`files`).
