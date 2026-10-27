# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions have four
parts, production.major.minor.patch: the first is 0 until the first production
release, and those releases are published as GitHub pre-releases. The other
three follow [Semantic Versioning](https://semver.org/):

- **Major**: changes that break existing backups or need you to redo setup.
- **Minor**: new features, with existing backups still working.
- **Patch**: bug fixes only.

## [Unreleased]

## [0.0.1.0] - 2026-10-27

The first public release of Message Archivist: a Chrome extension and an Android app that keep your text messages on your own devices.

### Chrome extension
- **Backs up Google Messages for Web** into one folder on your computer: one chat or every chat, every message with who sent it and when, photos at full size, GIFs, videos, voice notes, contact names, numbers and pictures. Messages are saved as they're read, so a backup that stops carries on where it left off; after that only new messages are added, by hand or on a schedule.
- **Checks every chat is complete**: that its first message was reached (and on what evidence), that the newest are saved, that nothing is duplicated and every photo is in. "Back up everything" also checks every conversation in Google Messages against the backup.
- **A master list of photos and videos** per chat, with each one's status (full size, thumbnail, not fetched, failed), so a quick run can save the messages and the photos can follow later.
- **Labels, flags and folders** for chats and single messages, and a Review tab of everything flagged.
- **Starts from a phone backup**: brings in a backup from the Android app, matching chats by phone number, then adds what the phone doesn't keep without saving anything twice. Also brings in older exports.
- **Reads anywhere**: a Google Messages-style viewer with search (quoted words match whole words), a media gallery, a timeline, and analysis (activity, a year in review, reply times, most-used words), favorite chats first and numbers formatted one way.
- **Makes a restore file** for putting a backup back on an Android phone (and an SMS Backup & Restore file).
- **Evidence-grade records**: a SHA-256 for every file, a log of every run, Google's message IDs and the on-screen timestamps.

### Android app
- **Backs up a phone's texts in minutes**: every text and picture message in every chat, group chats included, with exact times, photos and videos (or without them, to add later), contact names, favorites and contact photos, into one file on the phone or Google Drive.
- **Keeps that file up to date by itself**: every 12 hours, day or week, only while charging or on Wi-Fi if you like, adding only what's new. A status card says when the last backup ran.
- **Puts a backup back on a phone**: every chat or the ones you pick, in order, without duplicates, with photos and videos; restoring again carries on where it stopped. It becomes the SMS app only while it restores, and walks you through switching back.
- **No internet permission**: messages go only where you save the file.
- Signed with the project's key, so later versions install over this one.

[Unreleased]: https://github.com/trikhster/message-archivist/compare/v0.0.1.0...HEAD
[0.0.1.0]: https://github.com/trikhster/message-archivist/releases/tag/v0.0.1.0
