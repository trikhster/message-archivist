---
tags: [lessons]
updated: 2026-10-26
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
- **A TextButton on a coloured card can all but vanish.** Its default colour is the theme's `primary`, and with some phones' wallpaper colours `primary` and `primaryContainer` are close (the status card's **Settings**, the restore's **Choose SMS app in Settings**). Give it the card's content colour (`ButtonDefaults.textButtonColors(contentColor = …)`).

## Testing
- **A cached page can hide your change**: a navigation to the same URL (hash only) may reuse the old HTML. Change the query string.
- **Browser cache** kept old scripts in the mock: serve with `no-store` and bump `?v=N`.
- **A hidden browser pane** doesn't render, so lazy images never load there. Photos "fail" for reasons that don't happen in real use.
- **Never use real data** in tests, notes, logs or screenshots.
