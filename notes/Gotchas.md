---
tags: [lessons]
updated: 2026-10-27
---
# Gotchas

Things that have bitten before, or would. Add to this list whenever something surprises you.

## Google Messages and Chrome
- **History only loads while the page is showing.** Chrome throttles hidden tabs, and Messages fetches older messages from the phone only when visible. Hence the HUD asking people to leave the window alone, `ownWindow()` (a window of its own), and `keepVisible()` / `checkpoint()` un-minimising it.
- **Images load lazily too.** A photo that hasn't been on screen has no usable `src`. `waitForMedia()` / `isReady()` check, and the final media pass scrolls to them.
- **Messages already saved change**: "Delivered" becomes "Read", reactions arrive, edits happen. `mergeChrono()` keeps the latest version.
- **The same picture twice in a message**: a GIF and its still frame, or a thumbnail beside the full-size photo. `dropSamePictures()` keeps one and records the other in `media_left_out`.
- **Not everything served as an image is one.** `sniff()` checks the first bytes; an HTML error page is retried, then logged, never saved.
- **Link-preview pictures** live on other sites. Without the optional permission they're `skipped` ("not saved"), not `failed`.
- **First message evidence**: a "full" batch is about 50 messages. A short batch followed by quiet tries over the patience time, with the spinner gone, is the evidence for "reached the first message". A pass spent saving full-size photos doesn't count as a quiet try.
- **The open chat's header has a link to the conversation.** A generic `SEL.convLink` query picked it once and reloaded the page mid-run. Use `chatLinks()` (list entries first).
- **"Not focused" is fine; "hidden" isn't.** A window behind others, or a small one in a corner, counts as visible as long as part of it shows. A background tab, a minimised window, or a window covered completely (macOS detects this) is hidden, and Messages stops loading. Chrome also slows a hidden page's timers to about once a minute after 5 minutes. Launch flags (`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) help with covered windows but can't be set by the extension.
- **Below 768 px wide the Browser pane emulates a phone**, so test a small window's layout in a sized `<iframe>` instead.
- **`window.open`** has to be blocked in the page's MAIN world (`gm-guard` via the background), not from the content script.

## Extension platform
- **An unpacked extension serves its files from disk, but runs the scripts it loaded.** Change the files without clicking reload in `chrome://extensions` and pages (Settings, the viewer, the popup) open the new files while the background worker and the content script in an open Messages tab are the old ones. A manifest change (a new content script, a web-accessible file) only applies after the reload. One result: an old content script copies the new viewer into the backup folder without the files it now needs (`library.js`). After changing the extension, reload it and then the Google Messages tab.
- **Content scripts can't read the extension's IndexedDB** (they use the page's storage), so they can't get the folder handle. The [[Writer frame]] does the file work.
- **Folder permission can lapse** after Chrome restarts. Interactive runs ask on the page; automatic runs can't prompt and report it.
- **Reloading the extension orphans the content script** on open tabs. The new copy takes over (`__gmExporter.alive`); senders inject the scripts again if the first `sendMessage` fails.
- **Extension pages can't run inline scripts.** `npm run check` fails on them.
- **The service worker can be killed any time.** Keep nothing in its memory that matters.
- **Top layer**: the HUD is a modal `<dialog>` in the top layer. Anything that must appear above it (the folder permission card) has to be a popover too (`HUD.yieldTop()`).
- **Runtime messages carry JSON, not Blobs.** `gm-fetch` returns base64, about 1.33× the file size in memory. See [[Known issues]].

## Files and the library
- **Journal pieces aren't checksummed** (`writeTemp`) and are removed after compaction. A crash leaves them; `loadEntry()` replays them.
- **Removed files must leave the checksum list** (`sink.remove()` records them; `writeIndex` drops them), or "Check no files have changed" reports them missing.
- **A run's per-chat results must reach `finishRun`.** It's the only place that sends `gm-backup-status`, which is what refreshes the popup's status and photo counts. `runScheduled` once built its own summary without them, and the popup kept offering photos that had already been fetched.
- **Upgraded photos get a ` (2)` name**: the thumbnail still holds the base name when the full-size file is written.
- **Photos the background saver finishes after their message was saved** were once left on disk unrecorded. `adoptLate()` and the `ctx.done` / `early.has()` checks in `fetchTarget()` stop that. Check "files on disk == files in use" after changing media code.
- **Folder names** are `safeName(title)` (60 chars max); a clash gets ` (n)`. Never derive a path from a title anywhere else.
- **Old libraries** must keep working: `readLibrary()` migrates, and `data.js` rows may lack newer fields (`media`, `status`). Always have a fallback.

## Android
- **Only the default SMS app can write messages.** Writes from anyone else are silently dropped, so check the role first.
- **`Telephony.Sms.getDefaultSmsPackage()` returns null to a non-system SMS app asking about itself**, even while it holds the role (it also wants a cell-broadcast app-op only system apps get). Use `RoleManager.isRoleHeld(ROLE_SMS)`.
- **Received group MMS need your own number in the "to" list**, or Google Messages files each one as a one-to-one chat with its sender, although the database thread is right.
- **`startForegroundService` must be followed by `startForeground` within seconds, every time**, even for a start the service ignores.
- **Android 15 draws apps edge to edge**: pad for the system bars yourself.
- **`READ_SMS` is hard-restricted.** It can only be granted if the app's installer allowed restricted permissions (`adb install` and the phone's installer for downloaded APKs do; `dumpsys package` shows `RESTRICTION_INSTALLER_EXEMPT`). Play requires a policy exemption.
- **Asking for a permission the manifest doesn't declare is silently refused**: no dialog, just "denied".
- **A canonical address can be several numbers**: `content://mms-sms/canonical-addresses` may hold `5550100001;5550100002` as one address (seen with an SMS sent to two people). Split before normalising.
- **One file descriptor, two channels**: a `FileChannel` from `FileInputStream` can't write and one from `FileOutputStream` can't read; for reading and appending to a picked file, open it `"rw"` and use one of each on the same descriptor, with positional reads and writes. Don't close the input stream early: it closes the descriptor.
- **Google Drive's documents can't be opened `"rw"`** (or give a pipe, `statSize` -1): write such a file whole (`"wt"`, falling back to `"w"`).
- **A file written to Google Drive is 0 bytes online until the Drive app uploads it**, and the upload can wait a long time (seen 2026-10-27 on a Pixel: "Uploading 1 item" for over an hour on a guest Wi-Fi, after the app had said "Backup saved"). `CreateDocument` makes the empty file online at once; the content follows. Meanwhile a run that reads the file back can find it empty: don't take that as "never written" (`BackupFiles.notUploadedYet`), or better, don't read it back at all: keep a copy on the phone and only upload (`PhoneCopy`).
- **On a full phone, Android can't save an app's preferences either** (`SharedPreferencesImpl: write failed: ENOSPC`); it keeps the previous file as `.bak` and reads that next time, so a failed run's recorded error can be lost. The screen still shows it (it's in memory).
- **"Free" differs**: `StorageManager.getAllocatableBytes` leaves out what Android keeps back from apps (0 on a phone near full) while the phone's storage settings show `usableSpace`. Decide with the first, tell people the second.
- **A file deleted or replaced on Google Drive takes the app's permission to it with it**: its uri stays in the app's settings, but any use throws `SecurityException` ("does not have permission… use ACTION_OPEN_DOCUMENT"), even just putting it in an intent with grant flags (`startForegroundService` then throws in the caller). Catch it and ask for the file again.
- **`JobInfo.Builder.setPersisted(true)` needs `RECEIVE_BOOT_COMPLETED`**, or scheduling throws.
- **Losing the SMS role ends the app's process** ("permissions revoked"). Anything the screen should still show after the user switches back has to be saved, not just held in memory.
- **MMS dates are in seconds, SMS dates in milliseconds.**
- **`adb shell` re-splits arguments**: pass a whole command as one quoted string when it has spaces or quotes.

## Performance
- **IntersectionObserver can't see into `content-visibility: auto`.** Pictures inside a skipped month all report "intersecting" (or nothing useful); watch the month section instead.
- **Moving an attribute is a mutation too.** Parking `src` in `data-gmlib` fires the viewer's MutationObserver again; the attribute path must not load parked pictures.
- **IntersectionObserver needs frames.** In a hidden browser pane (tests) its callbacks don't run until a frame is drawn (a screenshot draws one).
- **Anything O(chat size) per pass adds up** at 100,000 messages: rebuilding key sets (28 ms), re-sorting (33 ms), `checkChat` (20 ms), pretty-printed JSON (51 ms). Keep per-pass work proportional to the page.

## GitHub
- **"Latest release" ignores pre-releases.** `/releases/latest` and shields.io's release badge (without `include_prereleases`) skip them; with every release a pre-release, the link 404s. Link to `/releases`.
- **Pull requests keep their original commits** (`refs/pull/N/head`) after a history rewrite, and owners can't delete those refs: rewriting a repo's history doesn't remove what its PRs show (Dependabot's included). Hence a fresh repo for going public ([[Decisions]]).
- **More than three tags in one push** and GitHub runs no tag workflows for them (handy for moving old tags; push a release tag alone).

## Android
- **A job that waits for a network needs `ACCESS_NETWORK_STATE`** on Android 14 and later, or `JobScheduler.schedule` throws a `SecurityException`. Test automatic backup with a file online (or **Only on Wi-Fi** on), not only a file on the phone: the emulator tests missed this, the live test on a phone found it.
- **A TextButton on a coloured card can all but vanish.** Its default colour is the theme's `primary`, and with some phones' wallpaper colours `primary` and `primaryContainer` are close (the status card's **Settings**, the restore's **Choose SMS app in Settings**). Give it the card's content colour (`ButtonDefaults.textButtonColors(contentColor = …)`).

## Obsidian
- **Wikilinks can't hold `#`, `^`, `[`, `]` or `|`**, and file names can't hold `\ / : * ? " < > |`. Note names lose them all (`noteName`); a media file whose name has one is linked with a Markdown link relative to the note instead, percent-encoded.
- **A message's text means things in Obsidian**: `#1` is a tag, `[[x]]` a link, `$5 … $6` maths, `%%…%%` a comment, `==x==` a highlight, a leading `-` or `1.` a list and four leading spaces a code block. `inline` and `lines` escape all of them, but leave web addresses alone (a backslash in a URL breaks the link).
- **In a Markdown table, a wikilink's `|` must be `\|`** (`[[note\|text]]`), or Obsidian reads it as the next column and the row falls apart; GitHub shows the backslash. Every table row goes through `cell` in `obsidian.js`.
- **A link to a day is a link to its heading** (`[[note#Saturday, 1 March 2025|…]]`), so the heading text and the link must come from the same function (`dayHeading`); a heading reworded in one place silently breaks every moment link.
- **File names Windows refuses** (`con`, `nul`, `aux`, `prn`, `com1`, `lpt1`) can be a topic word or a name: `noteName` adds `_`.
- **A Google Messages backup rewrites a chat's contact card** from the page, which shows only names, numbers and photos: `saveContact` keeps what a phone backup added (`favorite`, `card`, a photo the page lacks) by number, or it would be lost at the next backup.
- **Obsidian only shows files inside the vault**, so the vault must be the backup folder itself, not its `Obsidian/` folder; otherwise every photo is a broken link.

## Other apps' exports
- **Snapchat for Web hides its message text** (`visibility: hidden`, its privacy screen, even with the tab in front): `innerText` is empty, so the reader reads `textContent`. Its chat list items are buttons, not links, and loading a chat's address (`/web/<id>`) afresh goes back to the list. Only a group's first message carries a time. Its class names are generated (`ul.MibAa`), so they can change at any deploy ([[Snapchat Web page]]).
- **Reading a live chat page can surprise you**: while checking Snapchat for Web, the open chat changed under the script (someone used the tab), so every check first confirms, with a true or false, that it's in a chat the owner allowed. A "find" or accessibility-tree read prints everyone's names in the list (even another chat's members): use a script that returns only structure.
- **An iPhone's WhatsApp export puts notices under the chat's own name** (a group's name, or the contact's in a one-to-one chat), with an invisible U+200E right after the colon; photos and "image omitted" have the mark too, and those lines also start with one before the `[`. Android's notices have no sender, in one-to-one chats as well as groups, so "a line without a sender" doesn't mean a group.
- **WhatsApp writes the phone's language into the export**: date order and separators, words between date and time (`klo`, `à`), "p. m." with no-break spaces, a narrow no-break space before PM, 오후/下午 before the time, `<adjunto: …>`, "imagen omitida", and U+202A…U+202C around phone numbers in names.
- **Snapchat's field names change case between versions** (`IsSender`, `isSender`), and `Created(microseconds)` holds milliseconds in some downloads.
- **Facebook's "Download your information" is HTML unless you choose JSON**, and Messenger's end-to-end encrypted chats (most chats since 2024) aren't in it at all: they're in Messenger's own download of its secure storage.
- **Big downloads come in parts** (Meta, Snapchat): the messages can be in one zip and their photos in another.
- **A content script fetches extension files only if they're web-accessible**: the backup run copies the viewer's files (`modules/*.js` too) into the backup folder by fetching them from the Messages page, so `manifest.json` lists `modules/*.js` in `web_accessible_resources`. The files copied are what `viewer.html` loads (`GMLib.pageFiles`): a new script in the viewer needs no other list changed.
- **A share's permission lasts only while the receiving screen does**: the Android app copies what's shared into its own storage at once (`Exports.add`), not later in a backup run. WhatsApp on Android has shared an export both ways over the years (one .zip, or the .txt and each photo, `ACTION_SEND_MULTIPLE`), so both are taken, and the share filter leaves out images so sharing photos doesn't offer the app.

## The app
- **The `github-pages` environment allows only the default branch** once Pages is turned on, so a deploy from a release tag fails ("not allowed to deploy to github-pages due to environment protection rules") until a `v*` tag rule is added ([[Releasing]] → The app).
- **Folder access belongs to an origin.** The extension's handle (in its own IndexedDB) isn't the app's: the app asks for the backup folder once, separately, and Chrome's permission prompts are separate too.
- **A `file://` page's `'self'`** doesn't cover the scripts beside it, so a content security policy like the app's would stop the backup folder's `index.html` working from disk. The folder gets `archive/viewer.html`, the extension's viewer unchanged.
- **The offline copy answers from its cache**: test the app from a fresh `npm run app` build, and to see a change, rebuild and reload twice (or use **Restart now**); editing `extension/` alone changes nothing the app serves.
- **`whatsapp.js` contains `app.js`**: look for `src="app.js"`, not the name alone.

## Settings
- **Saving a setting reads all of them and writes them back**, so two switches flipped in the same moment used to lose the first. `saveSettings` now saves one change at a time.

## Testing
- **`am start --esa` keeps the backslash of `\,`**: it splits the list on commas that don't follow a backslash, but leaves `\,` in the value. A chat's key has commas when it's a group, so the debug hook's `only` takes the backslashes out.
- **A change to the codes and spam rules doesn't reach chats already in an archive by itself**: index rows keep the counts (`traits`) from when each chat was last written, and leaving chats out reads them. Raise `GMLib.TRAITS_VERSION` with any change to `CODE_WORD`, `CODE_DIGITS`, `PROMO`, `PROMO_CAPS`, `LINK` or `SCAM` (rows from older rules are then counted again where they're used), and make the same change in `Clutter.kt` with a case in `test/filters/cases.json`. The viewer counts every chat afresh when it loads, so it follows the rules as soon as the archive has the new `library.js`.
- **`adb shell content query` lines end in `\r`**: strip each value before matching ids across queries (a thread id read with its `\r` matches nothing).
- **`content insert --bind body:s:…` can't take a colon in the value** (it splits on `:`): "https://…" or "12:30" fail with "Binding not well formed". Use a link without the scheme (`example.xyz/path`) for test texts.
- **`ANDROID=…/adb -s emulator-5554` in a variable doesn't run in zsh** (no word splitting): use a function, `a() { "$ANDROID_SDK_ROOT/platform-tools/adb" -s emulator-5554 "$@"; }`. And with a phone plugged in as well, always name the emulator: nothing should run on the owner's phone.
- **Writing to a link writes to what it links to.** A test harness that links to the extension's files (`ln -s`) and later copies a page "into" it with `sed … extension/popup.html > harness/popup.html` empties the real `popup.html`: the shell truncates the link's target before `sed` reads it. That happened on 2026-10-27 (the popup was blank until restored from git). Copy pages into a harness, never link them, and `npm run check` now fails on an empty page or one that loads no script.
- **A cached page can hide your change**: a navigation to the same URL (hash only) may reuse the old HTML. Change the query string.
- **Browser cache** kept old scripts in the mock: serve with `no-store` and bump `?v=N`.
- **A hidden browser pane** doesn't render, so lazy images never load there. Photos "fail" for reasons that don't happen in real use.
- **Never use real data** in tests, notes, logs or screenshots.
