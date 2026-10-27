# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a problem

Use [New issue → Bug report](https://github.com/trikhster/message-archivist/issues/new/choose). The most useful things to include are:

- the extension version (Settings shows it under the title)
- what you did and what happened
- the run's log: click **Copy log** on the progress panel, or open Settings → More settings → Past runs → **Copy log**

**Before you post a log or screenshot, remove anything private.** Logs contain chat names, contact names and phone numbers, times and file names (never message text). Replace names and numbers with placeholders such as "Contact A" and "(555) 555-0100". Never post your backup folder, its files, or screenshots with real messages.

If Google Messages changed its layout and backups come out empty or wrong, use **Copy page diagnostics** in the popup (More options). It copies the page structure with all message text masked, which shows what changed.

Security problems: please report them privately, as described in [SECURITY.md](SECURITY.md).

## Making changes

1. Fork the repository and create a branch.
2. Load `extension/` with **Load unpacked** in `chrome://extensions`, and reload the extension and your Messages tab after each change.
3. Run the checks (Node.js 18 or later):

   ```bash
   npm run check
   npm test
   ```

4. Add a line to **Unreleased** in [CHANGELOG.md](CHANGELOG.md), and update the [user guide](extension/README.md) if what people see changes.
5. Open a pull request describing what changed, why, and how you tested it.

Code style: plain JavaScript with no build step or dependencies, two-space indentation, and comments that explain why. Selectors for Google Messages' page live in `SEL` at the top of `content.js`; keep coupling to their markup there.

The Android app (`android/`) is a separate Gradle project. With JDK 17 and the Android SDK (platform 35):

```bash
cd android
./gradlew assembleDebug
```

The APK is in `android/app/build/outputs/apk/debug/`. How it's tested on an emulator is in `notes/Testing.md`.

Developer notes (architecture, file formats, message types, testing, releasing, known issues) are in [`notes/`](notes/Home.md), an [Obsidian](https://obsidian.md) vault that also reads fine as plain Markdown. Update the matching note when you change a format, message, setting or flow.

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
