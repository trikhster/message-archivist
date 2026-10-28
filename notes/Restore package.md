---
tags: [reference, format, android]
updated: 2026-10-27
format: gm-restore
format_version: 3
---
# Restore package (`gm-restore` v1 and v2)

What the extension hands to [[Android app|the Android app]]: one `.tar` file, written by Settings → Phone restore → **Make the restore file** (`$('exportPackage')` in `options.js`) into `restore-to-phone/restore-<date> <time>.tar`. The Android app writes the same format when it backs a phone up (`PhoneBackup.kt`, saved where the user picks, `messages-backup-<date>.tar`); the differences are under "From a phone". The extension reads such a file back into its library: Settings → Tools → **Bring in files…** (with its updates file, if any: the big one first) ([[Settings page]]; matching in [[Library module]]).

## Why tar
Each entry is a 512-byte header (`GMLib.tarHeader`) followed by the bytes, padded to 512, and the file ends with two empty blocks (`GMLib.tarEnd`). That can be written a piece at a time with no limit that matters (zip needs Zip64 past 4 GB or 65,535 entries) and no compression work, photos are stored as they are (no base64, unlike the SMS Backup & Restore XML), and the app indexes it by reading only headers. Entry names are ASCII and under 100 characters. The system `tar` reads it, which is handy for checking.

## Entries
| Entry | What |
|---|---|
| `media/<n>.<ext>` | a photo, video or voice note, as saved in the backup. `n` counts up across the whole package |
| `threads/<nnnn>.ndjson` | one chat: one JSON object per line, oldest first |
| `exports/<n>/<k>.<ext>` | from a phone only: another app's export shared to the Android app, as it was (see Exports below) |
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

An update writes its new entries after the old ones, so a name can appear more than once (a chat written again, the manifest): **the last copy wins**, as with `tar -x`. The earlier copies stay in the file unused: every run's old manifest, and a chat written again in full (photos added to a backup made without them). The Android app **compacts** a file it owns (its copy on the phone of a backup online, or the download it updates) once those make up a quarter of it and at least 1 MB (`RestorePackage.deadBytes`, `BackupFiles.compact`): the entries still in use are copied, in order, to a new file beside it, which is then renamed over it. A file picked on the phone itself is never compacted (it can't be replaced in one step); there, the manifest is written without indentation and its `history` keeps the last 100 runs, so each run's leftover is small.

## Version 3: gzipped chats
The Android app writes each chat's file gzipped: `threads/<nnnn>.ndjson.gz`, pieces `threads/<nnnn>.<k>.ndjson.gz` (text shrinks 10–14×; on the emulator a 6.3 MB backup became 0.45 MB). A file is gzipped exactly when its name ends `.gz`, so a backup made before keeps its plain pieces and gets gzipped ones after them; a chat written again in full is written gzipped under its own number. The manifest says `"version": 3` once any chat file is gzipped. Readers: `RestorePackage.messages`/`bytes` (`GZIPInputStream`), `GMLib.readPackage().lines` (`DecompressionStream`), `test/restore/compare.mjs` (`gunzipSync`). The manifest and photos stay as they are (photos are already compressed; they're kept byte for byte).

**One photo, many messages.** A photo or video already in the file byte for byte (the same picture sent again, forwarded, or received in two chats) isn't stored again: the new message's part points at the same `media/<n>.<ext>`. The app looks only at files of the same size, then compares SHA-256 (reading an older file's entry once). Readers need nothing new: each part is read from its file, and two parts may name the same one.

## From a phone
A backup made by the Android app has `"tool": "Message Archivist"`, `"owner": { "number": "…" }` when the phone knows its own number (so a second phone's texts are kept apart: [[Sources]] → Accounts), `"source": "phone"`, `tool_version` the app's version, and `"stopped": true` if the user stopped it (it then holds only the chats finished). Each thread also has `names`: `{ "<address>": "<name on the phone's contacts>" }`, and its `title` is those names (or the numbers) joined. Messages have exact times (no same-minute spacing), `src_id` `sms:<id>` or `mms:<id>` (the phone's row), and MMS may have `subject`. Texts are `kind: "sms"`; everything from the MMS table is `mms`, with or without parts. A part has `id` (the phone's part row); in a backup made without photos it has no `file` (`{ "ct": "image/jpeg", "name": "…", "id": 123 }`): the photo is known to be there, and a later update with photos adds it. Readers skip parts without a file when restoring.

A backup made with Settings' *Save all my contacts* on has `"address_book": { "file": "address-book.json.gz", "contacts": <n>, "captured_at" }` and that entry (gzipped JSON, `{ "format": "gm-address-book", "version": 1, "captured_at", "contacts": [...] }`: every contact with a number or email address, each like a person's `contact` below plus `name` and `starred`, with all its `numbers`). It's written again only when the contacts changed since the file's copy (the entry of the same name replaces the old one, which compacting drops); turned off, a file that had one gets an empty book in its place. Read by the extension ([[Library format]] → contacts.json), not by restores.

A backup made with Settings' *Leave out of phone backups* on has `"left_out": { "codes": 1, "promos": 2 }`: how many chats this run left out, by kind ([[Sources]] → Kept apart). Readers ignore it; those chats simply aren't in `threads`.

Thread entries from the app also have `people`: `[{ "address", "name"?, "starred"?, "photo"?, "contact"? }]`, from the phone's contacts (`starred`: in Android's Favorites; `photo`: an entry `contacts/<n>.jpg`; `contact`: the rest of the phone's contact, `{ "key", "numbers"? (when more than one), "emails"?, "nickname"?, "organization"?, "job_title"?, "birthday"? ("1990-05-04" or "--05-04"), "labels"? (the owner's contact labels, not the system's), "relations"? ([{ "name", "type" }]) }`, written on every run so it follows the phone's contacts; older files and readers without it carry on as before). Thread entries from the app also carry their counts, so an update needn't read them: `messages`, `sms`, `mms`, `first`, `last`, `media` (parts with a file), `media_waiting` (without), `media_bytes`. The manifest's `counts` add `media_waiting`; it also has `updated_at` (after an update) and `history`: one `{ at, added, media_added, stopped?, chosen? }` per run (`chosen`: the run backed up only that many chats, chosen on the phone; after an update like that, the file's other chats are as earlier runs left them).

## Exports: other apps' chats shared to the phone
A backup from the Android app may also carry **other apps' exports** shared to it or added there (WhatsApp's "Export chat", a Snapchat, Facebook, Instagram, TikTok or Discord download: [[Android app]] → Other apps), byte for byte, for the archive to read with the same modules as a file brought in on the computer ([[Importers]]):
- Entries `exports/<n>/<k>.<ext>`: export `n` (counting up across the file), its `k`th file (one `.zip` or `.txt`, or a chat's `.txt` and each of its photos), with only the extension of its name.
- The manifest's `exports`: `[{ "id", "app", "title", "added_at", "files": [{ "entry", "name", "bytes" }] }]`. `id` is the first 16 hex digits of the SHA-256 of its files (the same files shared twice are one export); `app` is what the phone took it for (`whatsapp`, `messenger`, `instagram`, `snapchat`, `tiktok`, `discord`; the archive works it out again); `title` a WhatsApp chat's name; `name` each file's name as it was shared, which the readers go by (WhatsApp's chat name, Snapchat's `chat_media/` names live inside the zips).
- **Each export once per file.** An update keeps the file's own (those whose entries are still in it) and adds the ones waiting on the phone that the file doesn't have; once a run to a backup file has worked, the phone's copies go. An **updates file** carries the ones waiting each time it's written, until the big file catches up and has them. A stopped run leaves them waiting.
- **Readers:** the extension (`GMImport.packageExports`, from Settings' phone backup source) reads each as if its files had been picked, named `<backup> › <file>`; one it can't read is listed under "Left out". The Android app's restore ignores them (they aren't texts), and so do older readers: no version change.

## Updates files
An updates file (the Android app's "Upload less" for a backup online) is an ordinary package of only the messages after a time: its manifest adds `updates_since` (ISO time) and `updates_for` (the big file's name). Readers need nothing special: restore or import the big file, then the updates file, and the messages already there are skipped.

## Which chats go in (from the extension)
Those with numbers on their contact card, or named by a number or short code (`restoreAddrs()`); the Phone restore tab lists the others.

## Compatibility
The app refuses a file whose `format` isn't `gm-restore` or whose `version` is newer than it knows (`RestorePackage.VERSION`, now 3); the extension reads up to `GMLib`'s `RESTORE_READS` (3) and writes `RESTORE_VERSION` (1). Add fields freely; bump the version only when old readers would restore something wrong (as pieces did: an old reader would see only a chat's first piece).
