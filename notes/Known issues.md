---
tags: [issues, review]
updated: 2026-10-26
reviewed_version: 0.5.0.0
---
# Known issues

From a code review of 0.4.5.0 (2026-10-26). Bugs first, then tech debt, then ideas. Strike through or delete an item when it's fixed, and say in which version.

## Bugs
All four found in the 0.4.5.0 review were fixed before 0.4.5.0 was released (kept here for the record).

1. ~~**Popup photo counts go stale after Fetch photos, Upgrade to full size, and scheduled runs.** `runScheduled()` (`content.js`) calls `finishRun()` with `{ ok, summary, added }` and no `perChat`, so `gm-backup-status` is never sent and `chatStatus[id].media` keeps the counts from the last manual backup. The popup then offers "Fetch N photos" again for photos already fetched. *Fix*: pass `perChat` (built from `results`) to `finishRun`, or report `gm-backup-status` from `runScheduled`.~~ **Fixed in 0.4.5.0**: `runScheduled` passes `perChat` to `finishRun`; scheduled runs send it with `statusOnly`, so only `chatStatus` changes and `runDue` keeps updating the backup list.
2. ~~**End-of-run text points to an option that's gone.** `folderRun()`'s summary says "“Retry failed photos” (popup → More options) tries again", but 0.4.5.0 removed that checkbox (the popup's **Fetch photos** retries failed ones). *Fix*: "“Fetch photos” in the popup, or “Retry failed photos” in Settings, tries again."~~ **Fixed in 0.4.5.0** with that wording.
3. ~~**The popup says "Fetching…" even when the page is busy.** `runPhotos()` in `popup.js` ignores the reply. A busy page answers at once with "An export is already running", but the popup shows "Fetching…" anyway and closes. (A successful run only answers when it ends, so the reply can't simply be awaited.) *Fix*: `gm-ping` first and check `running`, or wait a moment for an early error.~~ **Fixed in 0.4.5.0**: both. The popup pings first, then waits 600 ms for an early refusal.
4. ~~**Speed-run chats show as "Partly backed up" on the backup list.** `gm-backup-status` in `background.js` writes `lastResult` from `complete` only, without knowing the `messages` status.~~ **Fixed in 0.4.5.0**: `lastResult` and `runScheduled`'s summary say "Messages backed up, photos to fetch" (no "Run again to carry on").
5. **The app's restore estimate of time left starts too high on a slower run.** On the emulator it said "About 14 minutes left" at 18%; the whole restore took 7 min 38 s. Probably because the estimate weighs each picture/group message as a fixed 16.7 texts (`SMS_PER_SEC / MMS_PER_SEC`, measured on the emulator), so a run whose texts go slower than the emulator's, or whose picture messages go faster, is over-estimated. *Fix*: time the two kinds apart as the restore goes, as the backup does (`PhoneBackup.secondsLeft`), and estimate each kind's remainder at its own measured speed. The README says the estimate is a guide.

## Tech debt
- ~~**`gm-fetch` sends media as base64 over runtime messaging**~~ **Mostly fixed in 0.5.0.0**: during backups the [[Writer frame]] fetches and returns a Blob. `gm-fetch` remains the fallback (date-range zips, contact cards before a backup starts), with its 48 MB limit.
- **Two key schemes in the viewer**: labels use `chatKey(c) = id || folder || title`; flags use `flagKey(m) = (id || ci)|(msgId || index)`. `ci` is a position in `data.js` and changes when chats are added or removed, so a flag on a chat without an ID can move to another chat. Unify on `chatKey` with a one-time migration in `labels.json`.
- **Photo status rules exist twice**: `GMLib.mediaStatus()` and the viewer's `mediaSt()`. The viewer could load `library.js` (copy it into the folder with the viewer files) instead.
- ~~**Five copies of `getSettings()` with different defaults**~~ **Fixed in 0.5.0.0**: `GMLib.normalizeSettings()` everywhere.
- **Selectors outside `SEL`**: image parts, reactions, status, link previews, spinner, the Details page and the photo viewer are queried inline. Move them into `SEL` so a layout change is a one-place fix. See [[Google Messages page]].
- **`backupConversation()` is ~400 lines of closures** sharing state. Splitting it into stages (load, targets, journal/saving, fetching, finish) with an explicit state object would make it safer to change.
- **`content.js` is 3,000+ lines.** It could be several content scripts listed in the manifest (HUD, page reading, media, library writing), still with no build step.
- **"Fetch the missing ones again" ignores journal pieces.** If a crash left `journal/` pieces for that chat, `loadEntry()` replays them over the edited `messages.json` and could bring back the missing file's record. Rare; check for `journal/` first.
- **Upgraded file names end in ` (2)`.** Remove the thumbnail before writing the full-size file (or rename after) to keep the base name.

- **With full-size photos, a duplicate picture in a message can be saved twice.** `dropSamePictures()` only compares pictures saved together in `writeMessageMedia`; photos saved one at a time (full size between batches, `fetchTarget`) aren't compared with what's already saved for that message. On the mock chat: 2 extra thumbnails, the same in 4.6 with full size on. 0.5.0.0 makes full size the default, so it's more visible. Tools → Find duplicate photos cleans them up. *Fix*: before writing a single picture, fingerprint it against the message's saved pictures.
- **The viewer reads every chat when it opens** (all `chat.js` files, then indexes every message for search). 4.7 s for 408,000 messages; loading a chat's messages only when opened (and search on demand) would make it near-instant.

- **The Android app can't download a picture message that arrives during a restore** (it would need a full MMS stack). It notifies; Google Messages usually fetches it once it's the default again, but not always. Restoring when no messages are expected avoids it.
- **A phone backup can lack outgoing RCS messages**: since mid-2026 Google Messages doesn't always store them in the phone's database ([[Android direct connection]]). The extension's backups have them.
- **A chat that came only from a phone backup can get a second folder** when it's later backed up from Google Messages for Web, if the phone named it from its contacts and the web shows a different name (a number-named chat is found by its number). Renaming the folder's chat to the web's name avoids it.
- **A phone message whose photo and caption the web shows apart, backed up from the phone without photos:** its photo isn't fetched from the web (the photo half's ID is only in `also_ids`); updating the phone backup with photos and bringing it in again fills it.
- **Phone backup files aren't compacted.** An update that writes a chat again in full (photos added to a backup made without them) leaves the old copy in the file, unused; so does each run's old manifest. A "compact" step would rewrite the file without them.
- **A daily backup to Google Drive re-uploads the whole file** each day (Drive can't add to a file in place). Fine for a backup without photos; with photos, keep the daily file on the phone and copy it to Drive now and then.
- ~~**Pinned chats: the selector isn't checked against the live page yet** (`SEL.pinned`).~~ **Checked 2026-10-27**: on the live chat list a pinned item carries `data-e2e-is-pinned="true"` and a "Pinned" aria-label (both matched every pinned chat, and only those); the pin-icon and title forms matched nothing and stay as fallbacks.
- **A phone backup made before 0.5.0.0's address fix** can have a chat whose "number" is several numbers stuck together (17+ digits). Make a new phone backup; updating the old file keeps that chat beside the corrected one.
- **Contact photos from the phone** weren't tested on the emulator (its test contact had none); starred contacts were.
- ~~**The app is debug-signed.** Updating from a copy built on another computer fails ("App not installed") until releases are signed with one key.~~ **Fixed in 0.0.1.0**: releases carry an APK signed with the project's key; see [[Releasing]].

## Missing
- **iMessage isn't importable yet.** Its database (`~/Library/Messages/chat.db`) is SQLite; reading it needs a small SQLite reader (plain JS, no dependencies), the `attributedBody` text of newer messages, `chat.db-wal` for the newest, and the Attachments folder. Signal has no plain export. See [[Sources]].
- **People are matched across apps by number or name only.** Two different people with the same name link; one person under two names doesn't. Joining and splitting by hand is an idea in [[Sources]].
- **WhatsApp exports are capped** by WhatsApp (tens of thousands of messages, fewer with media); a longer chat comes in partly. Bringing in a later export adds what's new, not what WhatsApp left out.
- **Few unit tests.** `npm test` covers only the phone backup import (`test/restore/import-phone.mjs`). The rest of `library.js` is pure and easy to cover the same way (merging, `mediaStatus`, `checkChat`, `summarize`, `parseSums`/`formatSums`, `readLibrary` migrations).
- **The mock test page isn't in the repo.** Recreate it under `test/mock/` from [[Testing]] so anyone can rerun the scenarios. (The big-library generator and the benchmark are: `test/perf/`.)
- **No end-to-end check in CI** beyond syntax and manifest checks.

## Ideas
- Re-check a single chat's photos from the viewer (the master list is already loaded there).
- Show `upgraded_from` and the status in the viewer's lightbox details.
- Let **Check every photo** also offer "Fetch again" for photos whose file changed (today only missing ones).
