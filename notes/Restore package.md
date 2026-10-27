---
tags: [reference, format, android]
updated: 2026-10-26
format: gm-restore
format_version: 2
---
# Restore package (`gm-restore` v1 and v2)

What the extension hands to [[Android app|the Android app]]: one `.tar` file, written by Settings → Phone restore → **Make the restore file** (`$('exportPackage')` in `options.js`) into `restore-to-phone/restore-<date> <time>.tar`. The Android app writes the same format when it backs a phone up (`PhoneBackup.kt`, saved where the user picks, `messages-backup-<date>.tar`); the differences are under "From a phone". The extension reads such a file back into its library: Settings → Tools → **Bring in a phone backup…** ([[Settings page]]; matching in [[Library module]]).

## Why tar
Each entry is a 512-byte header (`GMLib.tarHeader`) followed by the bytes, padded to 512, and the file ends with two empty blocks (`GMLib.tarEnd`). That can be written a piece at a time with no limit that matters (zip needs Zip64 past 4 GB or 65,535 entries) and no compression work, photos are stored as they are (no base64, unlike the SMS Backup & Restore XML), and the app indexes it by reading only headers. Entry names are ASCII and under 100 characters. The system `tar` reads it, which is handy for checking.

## Entries
| Entry | What |
|---|---|
| `media/<n>.<ext>` | a photo, video or voice note, as saved in the backup. `n` counts up across the whole package |
| `threads/<nnnn>.ndjson` | one chat: one JSON object per line, oldest first |
| `manifest.json` | written last: format, totals and every thread |

### manifest.json
```json
{ "format": "gm-restore", "version": 1, "created_at": "…", "tool": "Message Archivist", "tool_version": "0.0.1.0",
  "timezone": "Europe/London",
  "counts": { "threads": 3, "messages": 472, "sms": 402, "mms": 70, "media": 14, "media_bytes": 26180 },
  "threads": [ { "file": "threads/0001.ndjson", "title": "…", "addresses": ["+15550100001"], "group": false, "messages": 400, "first": 1704121200000, "last": 1704438000000 } ] }
```

### A message line
```json
{ "date": 1704121201000, "box": 1, "kind": "mms", "addrs": ["+15550100001"], "from": "+15550100001",
  "text": "…", "parts": [ { "file": "media/1.png", "ct": "image/png", "name": "2024-01-01 10.00 - … .png" } ], "src_id": "…" }
```
- `date`: milliseconds. Backups have minute times, so messages in the same minute get a second each, in order (`restoreItems()` in `options.js`, shared with the XML file).
- `box`: 1 received, 2 sent. `kind`: `sms` for one-to-one text, `mms` for groups and anything with parts.
- `addrs`: everyone in the chat but you (digits and `+`). `from`: who sent a received message (looked up by name on the contact card in groups).
- `parts`: files in `media/`, with their content type and original name.
- `src_id`: Google's message ID, for reference.

## Version 2: a chat in pieces
The Android app's updates add a day's messages as one more piece of a chat rather than writing the chat again: the thread entry then has `"files": ["threads/0001.ndjson", "threads/0001.2.ndjson", …]` (oldest first; `file` stays the first, as the chat's identity) and the manifest says `"version": 2`. Readers take every piece in order (`RestorePackage.threadFiles`, `GMLib.readPackage().threadLines`). A file with no chat in pieces is written as version 1.

An update writes its new entries after the old ones, so a name can appear more than once (a chat written again, the manifest): **the last copy wins**, as with `tar -x`. The earlier copies stay in the file unused; a chat written again in full (photos added to a backup made without them) leaves its old copy behind, once. Nothing compacts a file yet.

## From a phone
A backup made by the Android app has `"tool": "Message Archivist"`, `"source": "phone"`, `tool_version` the app's version, and `"stopped": true` if the user stopped it (it then holds only the chats finished). Each thread also has `names`: `{ "<address>": "<name on the phone's contacts>" }`, and its `title` is those names (or the numbers) joined. Messages have exact times (no same-minute spacing), `src_id` `sms:<id>` or `mms:<id>` (the phone's row), and MMS may have `subject`. Texts are `kind: "sms"`; everything from the MMS table is `mms`, with or without parts. A part has `id` (the phone's part row); in a backup made without photos it has no `file` (`{ "ct": "image/jpeg", "name": "…", "id": 123 }`): the photo is known to be there, and a later update with photos adds it. Readers skip parts without a file when restoring.

Thread entries from the app also have `people`: `[{ "address", "name"?, "starred"?, "photo"? }]`, from the phone's contacts (`starred`: in Android's Favorites; `photo`: an entry `contacts/<n>.jpg`). Thread entries from the app also carry their counts, so an update needn't read them: `messages`, `sms`, `mms`, `first`, `last`, `media` (parts with a file), `media_waiting` (without), `media_bytes`. The manifest's `counts` add `media_waiting`; it also has `updated_at` (after an update) and `history`: one `{ at, added, media_added, stopped? }` per run.

## Which chats go in (from the extension)
Those with numbers on their contact card, or named by a number or short code (`restoreAddrs()`); the Phone restore tab lists the others.

## Compatibility
The app refuses a file whose `format` isn't `gm-restore` or whose `version` is newer than it knows (`RestorePackage.VERSION`, now 2); the extension reads up to `GMLib`'s `RESTORE_READS` (2) and writes `RESTORE_VERSION` (1). Add fields freely; bump the version only when old readers would restore something wrong (as pieces did: an old reader would see only a chat's first piece).
