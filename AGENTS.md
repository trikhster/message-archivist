# Message Archivist

A Chrome MV3 extension (plain JavaScript, no build step, no dependencies) that backs up Google Messages for Web into a folder on the user's computer, and an Android app that restores those backups to a phone and backs a phone up. The extension is `extension/`; the app (Kotlin with Jetpack Compose) is `android/` (`cd android && ./gradlew assembleDebug`; see `notes/Modules/Android app.md`).

## Developer notes
`notes/` is an Obsidian vault with the project's developer notes. Start at `notes/Home.md`, then read the notes for the area you're changing:
- how it fits together: `notes/Architecture.md`, `notes/Backup run.md`, `notes/Messages between parts.md`
- what's on disk: `notes/Library format.md`, `notes/Photo statuses and runs.md`, `notes/Storage and settings.md`
- each file: `notes/Modules/`
- before touching page reading: `notes/Google Messages page.md`, `notes/Gotchas.md`
- open bugs and tech debt: `notes/Known issues.md`; why things are as they are: `notes/Decisions.md`

Keep the notes true: when a change alters a format, message, setting or flow, update the matching note in the same change, and record fixed items in `Known issues.md` and surprises in `Gotchas.md`. Links between notes use `[[Note name]]`.

## Rules
- Run `npm run check` and `npm test` after every change.
- All coupling to Google's markup goes in `SEL` at the top of `content.js`.
- Never put real messages, names or phone numbers in code, notes, tests, screenshots or logs. Logs never contain message text.
- Checks against the owner's live messages.google.com tab read page structure only; never print names or message text.
- Commit, push, tag and release only when the owner asks. The GitHub repo (`trikhster/message-archivist`) is public: nothing personal in commits, files or release notes. Commit as `trikhster <1780213+trikhster@users.noreply.github.com>`. The APK signing key never enters the repo or a log (`notes/Releasing.md`).
- Releases: `notes/Releasing.md`. User-facing docs: `extension/README.md`, `README.md`, `CHANGELOG.md`, `PRIVACY.md`.
