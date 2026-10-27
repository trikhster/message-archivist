---
tags: [workflow, testing]
updated: 2026-10-26
---
# Testing

There are no automated tests beyond `npm run check`. Changes are tested on a mock Google Messages page, then in Chrome with the real extension.

## Always
```bash
npm run check
```
Manifest, versions, referenced files, no inline scripts, `node --check` on every script. CI runs the same on every push and PR (`.github/workflows/ci.yml`).

## The mock page (how 0.4.x was tested)
The harness was built in a session scratchpad and **is not in the repo** (see [[Known issues]]: worth adding as `test/mock/`). To rebuild it:

- **Server**: a tiny Python `http.server` on `127.0.0.1:8765` that sends `Cache-Control: no-store`, plus a `POST /save?path=…` that copies a file out of the page's private storage to disk for inspection.
- **Mock Messages page** (`/web/conversations/123/`): fake custom elements matching [[Google Messages page]] (`mws-message-wrapper msg-id is-outgoing`, `mws-tombstone-message-wrapper`, image parts with canvas-generated JPEGs: a 160×120 thumbnail in the chat, 640×480 in the "viewer"), a spinner and batches of older messages that load as you scroll to the top, a conversation list item and a header link. Query flags: `slow=1` (slow batches), `lazy=1` (lazy images).
- **chrome stub**: `window.chrome` with `runtime.onMessage.addListener` saving the listener as `window.__listener`, `sendMessage` recording into `window.__sent`, and `storage.local` backed by `localStorage`. Runs are started by calling `window.__listener({ type: 'gm-media', … }, {}, reply)` from the console.
- **Backup folder**: the Origin Private File System. Put `navigator.storage.getDirectory()` → `lib` into IndexedDB `gm-exporter`/`kv`/`backupDir`; the real `writer.html`/`writer.js` then work unchanged (same origin).
- **Settings, popup, viewer**: served as-is with a `stub.js` loaded first (fake settings, schedules, runs; `gm-to-tab` returns a canned chat list). The viewer runs with `?library=1` against the same OPFS folder.
- **Cache busting**: add `?v=N` to every script tag and bump N on each change; the browser otherwise keeps old copies.
- **Checks to run** (a `__check()` helper in the console): the chat's `progress.json` status, `media-index.json` counts, files on disk vs files in use (no orphans), journal folder gone, `SHA256SUMS.txt` matching ("Check no files have changed" in Settings, or `shasum -a 256 -c` on a copy saved with `/save`).

Limits: lazy images only load while the browser pane is **visible**; a hidden pane makes photos fail (a harness limit, not a bug). Upgraded file names end in ` (2)`.

## The background worker in Node
`background.js` has no DOM, so its message handlers can be run in Node: define a stub `globalThis.chrome` (in-memory `storage.local`, `runtime.onMessage.addListener` capturing the listener, no-op `alarms`, `action`, `notifications`, `downloads.onDeterminingFilename`), evaluate the file with `new Function(source)()`, then call the listener with a message. Used to check `gm-backup-status` with and without `statusOnly`.

## A multi-year library (0.5.0.0)
`test/perf/genbig.mjs` writes a synthetic library (one chat of 100,000 messages over 4 years with ~2,900 photos, plus 299 smaller chats; 408,000 messages; all names and numbers made up) using `library.js`, with a `files.json` list. Serve it from the mock server, copy it into OPFS (fetch each file, 12 at a time, about 30 s), point IndexedDB `backupDir` at it, and open the viewer (`?library=1`) and Settings. `test/perf/bench.mjs` times the per-pass and per-save costs of a backup on a 100,000-message chat, 0.4.x against 0.5.0.0. Compare against the previous viewer by serving `git show main:extension/viewer.js` as `viewer-old.js`.

## Unit tests
`npm test` runs `test/restore/import-phone.mjs`: a made-up phone backup and library with the awkward cases (numbers written differently, a business and a short code, a photo and its caption split, a minute off, two identical texts, importing twice), checking chat matching and which messages are new. CI runs it.

The whole import (`phoneSource` → `mergeExports` → `importChat`) was checked in a browser by serving `options.html` from a scratch folder with a stand-in for `chrome.*` (storage in memory, `getURL` relative) and the origin-private file system (`navigator.storage.getDirectory()`) as the backup folder: a zip export first, then the emulator's phone backup, then the same again (nothing added), then `viewer.html?library` with that folder put in IndexedDB under `backupDir`.

## The Android app on an emulator
One-time: JDK 17 (`brew install openjdk@17`), Android command-line tools, then `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" "system-images;android-35;google_apis;arm64-v8a" "cmdline-tools;latest"` and `avdmanager create avd -n gmtest -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7`. Use a **google_apis** image (not google_play): it allows `adb root`, which is how the SMS database is read back.

1. `emulator -avd gmtest -no-window -no-audio -no-boot-anim -no-snapshot`, wait for `sys.boot_completed`, `adb root`.
2. Build and `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
3. Make a package with the extension (Settings → Phone restore) from a test library (`test/restore/gensmall.mjs`: a one-to-one chat with same-minute bursts and photos, a group, a short code, one chat without a number), push it to `/data/local/tmp`, and `adb shell run-as io.github.trikhster.messagearchivist cp /data/local/tmp/test.tar files/test.tar` (a file pushed as root elsewhere isn't readable by the app).
4. `adb shell cmd role add-role-holder android.app.role.SMS io.github.trikhster.messagearchivist 0`, then `adb shell am start -S -n io.github.trikhster.messagearchivist/.MainActivity --es restore_path /data/data/io.github.trikhster.messagearchivist/files/test.tar --ez auto true`. The log line `MessageArchivist: restored sms=… mms=… skipped=… failed=…` says how it went.
5. Read back: `adb shell "content query --uri content://sms --projection date:type:address:body --sort 'date ASC'"`, `content://mms`, `content://mms/<id>/addr`, `content://mms/part`. Run it again: everything should be skipped.
6. `cmd role add-role-holder android.app.role.SMS com.google.android.apps.messaging 0`, `pm clear com.google.android.apps.messaging`, open Messages ("Use Messages without an account") and check the chats look right, especially groups.
7. Backup: `adb shell pm grant io.github.trikhster.messagearchivist android.permission.READ_SMS`, then `am start -S -n io.github.trikhster.messagearchivist/.MainActivity --es backup_path /data/data/io.github.trikhster.messagearchivist/files/backup.tar`; the log says `backed up chats=… sms=… mms=… media=…`. Pull it (as root) and `node test/restore/compare.mjs <the package you restored> backup.tar`: every chat should be identical. A made-up contact for names: insert a raw contact and its name and phone rows with `content insert --uri content://com.android.contacts/...`.
8. Updates: back up with `--ez media false`, `run-as … cp` the file, then `--es backup_path <copy> --ez update true` (photos on): 0 messages and every photo added, and `compare.mjs` against a backup made with photos shows them identical. Add texts as root (`content insert --uri content://sms --bind address:s:… --bind body:s:… --bind date:l:… --bind type:i:1 --bind thread_id:l:…`), update again: only those are added, as `threads/<n>.2.ndjson`, version 2. A restore of that file into the same phone skips everything (it read every piece). Daily: turn it on from the done screen, then `adb shell cmd jobscheduler run -f io.github.trikhster.messagearchivist 7`; the log says `daily backup added=…` and the first screen shows it.
9. Contacts and addresses: star a test contact (`content update --uri content://com.android.contacts/contacts --bind starred:i:1 --where _id=1`); a text to two numbers at once (`content insert --uri content://sms --bind address:s:'5550300001;5550300002' …`) makes one canonical address holding both. A backup then has that chat with two addresses, and the starred contact's `people[].starred`.
10. The screens: without `auto`, the file opens on the review screen; tap Restore to go through the permission and role dialogs. `adb shell am startservice -a io.github.trikhster.messagearchivist.STOP -n io.github.trikhster.messagearchivist/.RestoreService` stops a restore. Switching the role back (step 6) ends the app's process: reopen it, it should show the result again. `adb shell cmd uimode night yes` / `no` for dark mode. Screenshots: `adb exec-out screencap -p > shot.png`. For the README's (`docs/screenshots/android/`, made-up data only): demo mode for a clean status bar (`adb shell settings put global sysui_demo_allowed 1`, then `am broadcast -a com.android.systemui.demo -e command enter`, `-e command clock -e hhmm 1200`, `-e command network -e wifi show -e level 4 -e fully true`, `-e command network -e mobile hide`, `-e command battery -e level 100 -e plugged false`, `-e command notifications -e visible false`; `-e command exit` afterwards), then `sips -s format jpeg -s formatOptions 82 -Z 1200 shot.png --out name.jpg`. The viewer's screenshots (`docs/screenshots/viewer-*.jpg`) come from a made-up library: `node test/screenshots/demo-library.mjs extension/library.js <folder>` (one group chat, Alice, Bob, Carol and me, with photos), the viewer copied in, served, in a 1180×746 dark tab. The setup page's (`setup.jpg`) is Settings → Home before a folder is chosen. With a phone plugged in as well, `export ANDROID_SERIAL=emulator-5554` so nothing goes to the phone.

## Scenarios worth repeating
- First backup of a chat; carry on after **Stop…**; a simulated crash mid-run (reload the page), then back up again: journal recovered, no lost messages.
- Speed run → status `messages` → **Fetch photos** goes back only to the oldest target.
- **Retry failed** with a deliberately broken image.
- **Upgrade to full size**: thumbnails replaced, old files removed, checksums still match.
- Settings → **Check every photo** after altering one file and deleting another; **Fetch the missing ones again** brings it back at full size.
- Viewer: flags saved to `labels.json`, Review tab edits, `#labels/<id>`.

## In Chrome
Load `extension/` unpacked, reload the extension **and** the Messages tab after each change. Try it on a short real chat. Check the run log (Settings → Past runs) for DEBUG lines. Never commit or share anything from a real backup.
