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

### Added
- **One archive for every app.** Bring in your chats from **WhatsApp, Telegram, Discord, Instagram, Messenger and TikTok** from the export each app makes (Settings → Tools → Bring in conversations from other apps). They sit beside your text messages, each marked with its app, in the same viewer, search and analysis. Bring in a newer export later and only what's new is added.
- **Which one is you?** When an export doesn't say whose it is, Settings asks once per app and remembers.
- **Back up as often as you like (Android app).** Automatic backup can run every hour, 6 hours, 12 hours, day or week, or at a custom interval of any number of hours or days (1 hour to 30 days). The switch after a backup is now **Back up automatically**.
- The viewer shows each chat's app, filters the list by app (**All apps**), and links a chat to the same person's chats in other apps (**Also in WhatsApp · Telegram**).

### Changed
- Other apps' chats are kept in `conversations/<App>/` in the backup folder, with the new status **Imported**; text chats stay where they are. The library's index is version 5 (older libraries read as they are).
- Phone restore, "Back up everything", photo fetching and the backup list apply to text chats only.

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
