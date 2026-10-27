---
tags: [moc]
updated: 2026-10-26
version: 0.5.0.0
---
# Message Archivist: developer notes

Notes for working on the extension: how it fits together, the formats it writes, how to test and release it, and what has gone wrong before. They describe the code **as of 0.5.0.0**. When the code and a note disagree, the code wins; fix the note.

The user-facing docs live outside this vault: the user guide (`extension/README.md`), the project `README.md`, `CHANGELOG.md`, `PRIVACY.md` and `CONTRIBUTING.md`.

## Start here
- [[Architecture]]: the parts and how they talk
- [[Backup run]]: what happens, step by step, when a chat is backed up
- [[Sources]]: one archive for every app (text messages, WhatsApp, Telegram, Discord, Instagram, Messenger, TikTok…)
- [[Library format]]: every file in the backup folder
- [[Restore package]]: the file the Android app restores from, and writes when it backs a phone up
- [[Photo statuses and runs]]: the master list, speed runs, fetch and upgrade
- [[Gotchas]]: read before changing anything that touches the page
- [[UI map]]: every menu, interaction and edge case, and the 0.5.0.0 redesign

## The code
| Part | File | Note |
|---|---|---|
| Content script (runs on messages.google.com) | `content.js` | [[Content script]] |
| Shared pure functions | `library.js` | [[Library module]] |
| Service worker | `background.js` | [[Background worker]] |
| Folder access frame | `writer.html`, `writer.js` | [[Writer frame]] |
| Toolbar popup | `popup.html`, `popup.js` | [[Popup]] |
| Settings page | `options.html`, `options.js` | [[Settings page]] |
| Other apps' exports | `importers/` | [[Importers]] |
| Offline viewer | `viewer.html`, `viewer.js` | [[Viewer]] |
| Zip writer, theme, scripts | `zip.js`, `theme.*`, `scripts/` | [[Small files]] |
| Android app | `android/` | [[Android app]] |

## Reference
- [[Messages between parts]]: every `gm-*` message
- [[Storage and settings]]: chrome.storage, IndexedDB, localStorage, settings defaults
- [[Google Messages page]]: selectors, and how to check them against the live page
- [[Glossary]]

## Working on it
- [[Testing]]: `npm run check`, the mock page, what to try in Chrome
- [[Releasing]]: version bump, changelog, tag, GitHub release
- [[Known issues]]: open bugs and tech debt from the code review
- [[Decisions]]: why things are the way they are
- [[Android direct connection]]: research behind building our own Android app
- Templates for new notes: `Templates/` (Feature, Bug, Session)

## Ground rules
- Plain JavaScript, no build step, no dependencies. Two-space indent. Comments say *why*.
- All coupling to Google's markup stays in `SEL` at the top of `content.js` (see [[Google Messages page]]).
- Never put real messages, names or phone numbers in code, notes, tests, screenshots or logs.
- Live-page checks read **page structure only**; never print names or message text.
- The GitHub repo (`trikhster/message-archivist`) is **public**, starting at 0.0.1.0. Version numbers from 0.3.5.0 to 0.5.0.1 in these notes are from the private development before that (see [[Decisions]]).
- Commit, push, tag and release only when the owner asks.
