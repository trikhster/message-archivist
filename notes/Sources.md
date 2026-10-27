---
tags: [architecture, format]
updated: 2026-10-27
---
# Sources: one archive for every app

The library is meant to hold **every conversation the owner has, whichever app it was in**: text messages, WhatsApp, Telegram, Discord, Instagram, Messenger, TikTok, and later iMessage and Signal. This note is the model that makes that work; [[Importers]] is the code.

## The model
- **Every chat belongs to one service.** `messages.json` and its index row carry `service` (`GMLib.SERVICES`: `sms`, `whatsapp`, `telegram`, `discord`, `instagram`, `messenger`, `tiktok`, `imessage`, `signal`). No `service` means `sms`: text messages (SMS, MMS, RCS), from Google Messages for Web or a phone backup. Every library from before services reads unchanged (`GMLib.serviceOf`).
- **One record shape for every app.** A message is the same record a Google Messages backup writes ([[Library format]]): `id`, `direction`, `sender`, `text`, `timestamp` (local minute) with the exact time in `timestamp_raw`, `media[]`, `reply_to`, `reactions`, `edited`. Importers build them with `GMLib.importedRecord`, which adds `sender_id` (the app's own ID for the sender), `sender_name` (what the export called *you*), and `kind` (`system` for notices, `call` for calls). **Your own messages are always `sender: 'Me'`** with `direction: 'sent'`, as in text chats, so the viewer's sides, "You:" and every statistic about you work across apps.
- **Folders by app.** Text chats stay in `conversations/<chat>/` (as always); other apps' go in `conversations/<App>/<chat>/` (`GMLib.chatFolder`), so a WhatsApp chat and the text chat with the same person never share a folder. A text chat named like an app folder gets ` (chat)`.
- **A chat joins only a chat of the same app.** Importing matches by `conversation_id` (`<service>:<the app's chat ID>`, or the chat's name where the export has no ID, as WhatsApp's) or name, among rows of the same service. The live backup (`findEntry` in `content.js`) looks only at text chats.
- **Status "Imported".** A chat from another app's export has `progress.imported = { service, importer, file, at, partial? }` and status `imported` ("Imported", counted as backed up). `partial` says what the export leaves out (Discord: only your messages); the start check is then a warning. A newer export of the same chat adds only what's new: importers give every message a stable `id` (the app's ID, or `GMImport.stableId` of its time, sender, text and repeat number), so nothing is added twice.
- **Media an export doesn't have** is listed with `file: null` and `skipped: '<why>'` (status "Not saved (by choice)"), with `url` when the export only links to it (Discord, some Meta shares).

## What stays text-only
Backing up from Google Messages, "Back up everything" and its coverage check (`verificationOf` compares Google's list with **text chats only**), photo fetching and upgrading, the backup list, and the Phone restore files (a phone can't hold a WhatsApp chat as texts). Settings hides those actions on other apps' rows (`isText`).

## One person, many apps
The viewer links a one-to-one chat to the same person's chats in other apps ("Also in WhatsApp · Telegram"), by the last ten digits of a number in the chat's contact card or, failing that, the name (`personKeys` in `viewer.js`). Names are a guess (two different "Sam"s would link); numbers are reliable. A later step could let the owner join or split people by hand and keep that in `labels.json`.

## Who "me" is
An export doesn't always say whose it is. In order: the export's own account (Telegram's `personal_information`, Discord's `account/user.json`, TikTok's profile, Meta's profile files); a one-to-one chat named for the other person (WhatsApp); the one name in every chat (Meta); else Settings asks "Which one is you?" and remembers the answer per app (`chrome.storage.local` `myNames`, see [[Storage and settings]]).

## Adding an app
Write `extension/importers/<app>.js` (see [[Importers]]), add the service to `GMLib.SERVICES` and the viewer's `APPS`, load the script in `options.html`, and add a made-up export to `test/importers/run.mjs`. Nothing else changes: merging, the index, checksums and the viewer are already source-neutral.

## Not yet
- **iMessage**: the Messages database on a Mac (`~/Library/Messages/chat.db`, readable only with Full Disk Access) is SQLite, with newer messages' text inside an `attributedBody` blob and recent ones still in `chat.db-wal`. Reading it needs a small SQLite reader in plain JS (no dependencies) and the attachments folder; see [[Known issues]].
- **Signal**: no plain export exists (its backups are encrypted with a passphrase).
- **iPhone texts** (SMS/iMessage from an iPhone backup) would be the same chat.db, inside an iTunes/Finder backup.
- Linking people by hand; one timeline of a person across apps.
