---
tags: [reference, format]
updated: 2026-10-27
index_version: 5
---
# Library format (index version 5)

The backup folder the user picks is "the library": every conversation from every app ([[Sources]]). One folder per chat, one index for all of them, one viewer. `GMLib.INDEX_VERSION` is `5` (4 before apps; a version 4 index reads as all text messages) and is stored in `data.js`. A change that breaks reading existing libraries is a **major** version (see [[Releasing]]).

```
<backup folder>/
  index.html, viewer.js, library.js,           the offline viewer (rewritten at the end of every run, and by Settings
  theme.js, theme.css, modules/<app>.js        when a file it loads is missing): every file viewer.html loads (GMLib.pageFiles);
                                               library.js gives it GMLib's helpers, modules/ how each app shows
  README.txt                                   GMLib.README
  data.js                                      window.GM_EXPORT = { ...summary of every chat }
  messages.csv                                 every chat's messages.csv joined
  verification.json                            GMLib.verificationOf(...).full
  export-info.json                             tool, version, timezone, case note, runs[]
  backup-state.json                            "Back up everything": the conversation list, progress, excluded chats
  labels.json, labels.js                       labels, flags and notes (NOT in the checksums)
  people.json, people.js                       who's who: the owner's joins, splits and names ([[Sources]] → People; NOT in the checksums)
  contacts.json, contacts.js                   the phone's address book, from a phone backup with "Save all my contacts" on
  Obsidian/                                    notes for Obsidian, when turned on ([[Obsidian notes]]; NOT in the checksums)
  SHA256SUMS.txt                               `shasum -a 256 -c` format, sorted, excludes itself
  logs/<YYYY-MM-DD HH.MM.SS> - <kind>.txt      one per run
  removed-chats/<date>/...                     chats deleted from the backup (Settings)
  removed-duplicates/<date>/...                extra photo copies moved aside (Settings)
  restore-to-phone/restore-<date>.tar          restore package for the Android app ([[Restore package]]); not in the checksums
  accounts.json                                which ID is each source's main account ([[Sources]] → Accounts)
  restore-to-phone/sms-<date>.xml              the same for SMS Backup & Restore (Phone restore → "Using SMS Backup & Restore instead?")
  conversations/<safeName(title)>[ (n)]/       a text-message chat (service "sms")
  conversations/<App>/<safeName(title)>[ (n)]/ another app's chat (GMLib.chatFolder): WhatsApp, Telegram, Discord, Instagram, Messenger, TikTok, Snapchat…
  conversations/<App> - <account>/<chat>/      a second account's chat (another number or ID in that app; "Google Messages - (555) 019-9999")
  (each chat folder:)
    messages.json        the chat: convData() with every record(); compact JSON since 0.5.0.0
    progress.json        how far it got, evidence for the first message, checks
    chat.js              window.GM_CHATS[folder] = compactMessages(...)
    messages.csv         chatCsv()
    media-index.json     the photo master list (0.4.5.0)
    media-index.csv      the same, for spreadsheets
    contact.json         contact card (people: name, number, photo, favorite, card: the phone's contact from a phone backup); contact/<name>.png photos
    media/<YYYY-MM-DD HH.MM> - <sender>[ (n)].<ext>
    journal/000001.json  pieces saved during a run; removed after compaction
```

Folder names come from `safeName()` (forbidden characters → `_`, max 60 chars). A second chat with the same name gets ` (2)`. `adoptOrCreate()` reuses a folder whose `messages.json` has the same `conversation_id` (a run that stopped before the index was written).

## messages.json
`convData(conv, messages, previous, range)`:
`service?` (absent = `sms`, Google Messages), `account?` and `account_label?` (absent = the source's main account), `conversation`, `conversation_id` (Google's ID; `<service>:<the app's ID or the chat's name>` for another app), `url`, `exported_at`, `updated_at`, `range?`, `participants`, `message_count`, `media_count`, `media_failed`, `media_skipped`, `group?`, `partial?` (what an import's export leaves out), `messages[]`.

Each message is `record(m, index)` in `content.js`:

| Field | Meaning |
|---|---|
| `index` | 1-based position in the chat |
| `id` | Google's message ID (`msg-id` attribute), when there is one |
| `direction` | `sent` / `received` |
| `sender`, `text`, `section` | |
| `timestamp` | normalised local time `YYYY-MM-DD HH:MM` |
| `timestamp_precision` | `message`, `section` (from the date heading), `day`, or unknown |
| `timestamp_raw` | exactly what the page showed |
| `text_is_fallback` | text taken from the accessibility label |
| `reply_to` | `{ sender, text }` |
| `web_window` | for a message read on an app's web page: `[from, to]` ms, when it was sent between (only a group's first message shows its time there); merging matches it to the app's export by side and words within it. The chat has `web_id`, the page's own chat ID |
| `media[]` | `{ kind, file, width, height, bytes, source, sha256, error?, skipped?, upgraded_from?, want_full? }`; `file` is relative to the chat folder |
| `media_left_out[]` | `{ kind, reason: 'gif-preview' \| 'duplicate', width, height }` |
| `gif_previews_skipped` | older form of left-out GIF stills (count) |
| `accessibility_label` | the on-screen label, word for word |
| (chat) `conversation_details.pinned` | pinned in Google Messages' list when last backed up (`SEL.pinned`); the index row gets `pinned` |
| `sender_number`, `phone_id`, `subject` | from a phone backup ([[Restore package]]): the sender's number, the phone's own row (`sms:<id>` / `mms:<id>`), an MMS subject. Such messages have no `id` until a backup from the web claims them (it then sets `id`, and `also_ids` for the second half of a photo and caption the web shows apart; see [[Backup run]]); `timestamp_raw` is the exact time (ISO) and media have `source: 'phone backup'`, `content_type`, `original_name`, `phone_part`, and `kind: 'file'` for anything that isn't a photo, video or audio. A photo from a phone backup made without photos has `file: null` (status *not fetched yet*) |
| plus `messageDetails()` | `status` (Read, Delivered, Not sent…), `edited`, `reactions`, link and map previews, when present; `raw_html` with the "keep page markup" setting |

Messages from another app's export (`GMLib.importedRecord`) have the same fields, plus `sender_id` (the app's ID for the sender), `sender_name` (what the export called you; your own messages are always `sender: 'Me'`), and `kind` (`system` for notices, `call`); `timestamp_raw` is the exact time (ISO). Media the export didn't include have `file: null`, `skipped: '<why>'` and, when it only linked to them, `url`.

Merging is by `keyOf(m)`: the message ID, or `sigOf(m)` (timestamp, sender, text, media count) when there's no ID. See [[Library module]].

## progress.json
Built by `buildProgress()` in `backupConversation`: `complete` (history complete **and** no media waiting, unless photos weren't wanted), `history_complete`, `message_count`, `oldest`, `newest`, `updated_at`, `start` (method, detail and evidence for reaching the first message), `stopped_reason?`, `newest_check { on_screen, all_saved, at }`, `second_read?`, `speed_run?`, `imported_from?`, and `checks` = `GMLib.checkChat(...)`.

`checks.status`: `verified` (every check ok), `complete` (ok with warnings), `imported` (another app's export), `phone` ("From phone": `from_phone` set and not yet read to its first message from Messages; every message the phone had), `messages` (speed run, or a phone backup without photos: messages done, photos waiting), `incomplete`, `problem`.

`imported: { service, importer, file, at, partial? }` is set for a chat from another app's export: status `imported` ("Imported", counted as backed up); `partial` makes the start check a warning (Discord's package has only your messages).

`from_phone: { file, at }` is set by a phone import ([[Settings page]]) when the chat's history isn't known to be complete; a backup from Messages keeps it until it reaches the first message. A chat imported from an older export takes `history_complete`, `start` and `newest_check` from that export's own `progress.json` when it has one, instead of starting as unfinished.

## chat.js (compact form for the viewer)
`compactMessages(folder, messages)`, short keys to keep it small:
`i` index, `d` 1 = sent, `s` sender, `t` timestamp, `x` text, `p` precision (if not `message`), `tr` raw time, `id`, `r` `{ s, x }` reply, `rc` reactions (the labels Google Messages for Web showed), `m[]` media `{ k kind, f path from library root, w, h, src, sha, err, skip, st status }`, `lo[]` left out `{ k, why, w, h }`.

## data.js
`GMLib.indexScript({ exported_at, updated_at, info, conversations: rows, skipped, verification, version })`. Each row is `GMLib.summarize(entry)`: `id`, `title`, `service` (only when not `sms`), `account` and `account_label` (only for a second account), `folder`, `file` (the `chat.js` path), `participants`, `updated_at`, `range`, `traits` (`{ v, sent, received, codes, promos, links, scams }`, `v` the rules' version, `GMLib.TRAITS_VERSION`: older rows have none, and are counted again where their traits are used; `GMLib.chatTraits`: what tells codes, promotions and automated texts apart, [[Sources]]), `contact` (summary: `people[]` of `{ n, num?, h? (an app handle), photo?, fav? }`), `group` (only `true`, for a group from an import), `count`, `first`, `last`, `media_saved/failed/pending/skipped`, and from 0.4.5.0 `media: { full, same, thumbnail, original, waiting, skipped, failed, left }`, then `status`, `problems`, `checked_at` from the checks, and `imported_at` (`progress.imported.at`: when another app's export last brought it in, for Settings' Apps tab). Read back with `GMLib.parseIndex()`; `GMLib.readLibrary()` migrates older libraries.

## media-index.json (0.4.5.0)
`{ conversation, updated_at, statuses: MEDIA_STATUS, counts, items[] }`. Each item: `message_index`, `message_id`, `timestamp`, `sender`, `item` (1-based, `null` for left-out rows), `kind`, `status`, `file` (path from the library root), `width`, `height`, `bytes`, `sha256`, `source`, `note`. Statuses in [[Photo statuses and runs]].

## labels.json / labels.js
Written only by the viewer opened with "Open my backup":
`{ version: 1, labels: [{ id, name, icon }], chats: { <chatKey>: [labelId] }, messages: { <chatKey>|<msgId or index>: [labelId] }, flags: { <chatId or ci>|<msgId or index>: { note, at } }, updated_at }`.
`keep: { <chatKey>: true }` is a chat the owner said isn't codes, promotions or automated texts ("It's not" in the viewer): it's never kept apart or left out ([[Sources]] → Kept apart). `labels.js` is `window.GM_LABELS = …` so `index.html` from disk sees them. Not in `SHA256SUMS.txt`: they're the user's notes, not the record. Note the two key schemes (see [[Known issues]]).

## contacts.json / contacts.js
The phone's address book, written by an import of a phone backup whose manifest has `address_book` (the app's *Save all my contacts*), when it's newer than the one here (`newestBook` in `options.js`): `{ format: "gm-address-book", version: 1, captured_at, contacts: [{ key, name?, starred?, numbers?, emails?, nickname?, organization?, job_title?, birthday?, labels?, relations? }] }`, as the phone had it ([[Restore package]]). Replaced whole, never merged; a phone that stopped saving every contact brings an empty `contacts`, which takes them out. `contacts.js` is `window.GM_CONTACTS = …` for `index.html` from disk. `GMLib.people(rows, saved, book)` uses it to tie chats to contacts ([[Sources]] → People). In the checksums: it's what the phone said, not the owner's edits.

## people.json / people.js
Written only by the viewer opened with "Open my backup" (its People tab): what the owner decided about who's who, by chat key (`GMLib.chatKey`: the conversation ID, else the folder):
`{ version: 1, joined: [[chatKey, chatKey]], apart: [[chatKey, chatKey]], alone: [chatKey], names: { <chatKey>: name }, updated_at }`.
People themselves aren't stored: `GMLib.people(rows, saved)` works them out each time from the index and this file ([[Sources]] → People). `people.js` is `window.GM_PEOPLE = …` for `index.html` from disk. Not in `SHA256SUMS.txt`, like the labels.

## Obsidian/
Notes for Obsidian, written by `obsidian.js` when the owner turns them on ([[Obsidian notes]]): a note per person (with their timeline, photos and links below it) and chat, a calendar (a note a year and a month), events, every photo by day, a note per shared topic (words and phrases), the messages a year (or a month) at a time, and `.message-archivist.json`, the manifest of what was written and what each chat says (`a`: its days, words and phrases, events, photos…). Derived from the archive and open to the owner's own writing, so not in `SHA256SUMS.txt`.

## SHA256SUMS.txt
Every file a run writes is hashed as it's written (`sink.hashes`); `writeIndex` merges them into the existing list, drops paths in `sink.removed`, and writes the list sorted. Journal pieces use `writeTemp` and are never listed. Settings' `libraryIO` does the same for its own writes.

## backup-state.json
`{ excluded?: [{ id, title, … }], scanned_at, conversations: [{ id, title }], run: { started_at, total, limited, done: [ids], finished_at? } }`. Written by `runTotal()` in `content.js`: a full scan replaces `conversations`, "most recent N" adds to it. A run with no `finished_at` (and not `limited`) is carried on next time, skipping the ids in `done`. `excluded` holds chats deleted with "don't back it up again", and chats left out as codes, promotions or automated texts (`reason`: `codes`, `promos` or `automated`; skipped only while Settings still leaves that kind out); backing one up by hand takes it off. Coverage (`verificationOf`) compares `conversations` with the library.
