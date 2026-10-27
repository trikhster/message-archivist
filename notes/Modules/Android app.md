---
tags: [module, android]
folder: android/
package: io.github.trikhster.messagearchivist
version: 0.5.0.0
updated: 2026-10-26
---
# Android app (`android/`)

Backs a phone's texts up into a [[Restore package]] file and keeps that file up to date (by hand or by itself, every hour to every 30 days), and puts such a file back on a phone. Its launcher name is Message Archivist, like the extension's, and its package is `io.github.trikhster.messagearchivist` (since 0.0.1.0; test builds from before used another package, so they don't update to it). The launcher icon is the extension's speech bubble, white with blue dots on Google blue, with a backup-and-restore badge (Material "history"); themed icons and notifications use the bubble alone. Kotlin, minSdk 26 (Android 8), target 35. The screens are Jetpack Compose with Material 3, so it looks like Google's own apps: the phone's own (wallpaper) colours on Android 12+, Google blue before, light and dark (see [[Decisions]]). Nothing else beyond the platform: JSON is `org.json`, the tar reader is ~60 lines. No internet permission: it never sends anything anywhere.

## The one rule that shapes it
Android only lets the **default SMS app** write to the SMS/MMS database. So the app becomes the default SMS app for the restore (the system asks the user), then the user makes Google Messages the default again. To be allowed the role an app must have the parts of an SMS app; `DefaultSmsParts.kt` has the minimum:
- `SmsReceiver`: a text arriving during the restore is saved to the inbox and a notification says so.
- `MmsReceiver`: a picture message arriving during the restore can't be downloaded here; a notification explains Google Messages fetches it afterwards.
- `ComposeActivity`: "send a text" requests from other apps get a short "use Google Messages" screen.
- `HeadlessSmsSendService`: quick replies to calls are ignored.

Check the role with `RoleManager.isRoleHeld(ROLE_SMS)` (`RestoreService.isDefaultSmsApp`), **not** `Telephony.Sms.getDefaultSmsPackage()`: that returns null to a non-system SMS app asking about itself (it also requires a cell-broadcast app-op only system apps can get). Found the hard way; see [[Gotchas]].

## Files
| File | What |
|---|---|
| `MainActivity.kt` | the activity and its actions (`Actions`): choose a file (`ACTION_OPEN_DOCUMENT`, or opened from Files/Drive), read its manifest, Restore (notification permission once, then the SMS role, then the service), Stop, switch back. `UiState` holds what the screens show and copies `RestoreState` in four times a second |
| `Screens.kt` | the Compose screens (below) and their pieces: hero icon, avatars, stat columns, info cards, the "still your SMS app" banner, time and size text, the restore-speed figures used for estimates |
| `Theme.kt` | `RestoreTheme` (dynamic colour, or Google's blue light/dark schemes) and the avatar colours |
| `RestoreService.kt` | foreground service (`dataSync`) with a wake lock that runs the restore, or a backup (`ACTION_BACKUP`); `RestoreState` (polled by the screen, and the last result saved to preferences), notifications with a Stop action, `ownNumber()`, `open()` |
| `Restorer.kt` | the database writes (below) |
| `PhoneBackup.kt` | backing this phone up, new or as an update (below); `TarWriter` (the same tar headers as `GMLib.tarHeader`) and `ChannelOut` (writing from a position) |
| `BackupFiles.kt` | where a backup goes (`BackupFiles.run`: a new file, or an update in place or through a copy) and the daily backup (`Daily`, `DailyBackupService`) |
| `RestorePackage.kt` | tar index (headers only, the last copy of a name wins, a cut-short entry ends it), manifest, line-by-line threads across their pieces (`threadFiles`), entries read by position (so a thread and its photos can be read at once), `end` (where an update appends) |
| `DefaultSmsParts.kt` | the SMS-app parts above |

## Screens (`Screens.kt`)
One activity; `RestoreApp` picks the screen from the state and cross-fades between them. Back from a review or a result goes to Welcome.
- **Welcome** (the home): a settings gear in the top bar. First a **status card**: backed up (when, and to which file), automatic backup on but not run yet, the last run failed (why), or not backed up yet; this phone's messages, chats and photos (`PhoneBackup.summary`, counted on resume when it may read texts); **Back up now** (or **Back up by itself**, which opens Settings) and **Settings**. Then **Back up this phone** (the filled button) and **Restore a backup** (the three steps; **Choose restore file**, tonal). If the SMS permission was refused, a card with **App settings**.
- **Settings** (gear; back arrow or Back returns): *Automatic backup*: **Back up by itself** (turning it on asks for a **New file…**, backed up now, or **A backup I already have…**, brought up to date now); the file (on this phone or online) with **Change**; **How often** (filter chips: hour, 6 hours, 12 hours, day, week, and **Custom…**, a dialog for any number of hours or days within `Daily.HOURS` = 1–720; a note that Android may wait longer, and a warning when the file is online and it's under 12 hours); **Include photos and videos**; **Only while charging**; **Only on Wi-Fi** (on by default for a file online); **Tell me after each backup**; the last backup and **Back up now**. *About*: version, "no internet access", and **App permissions** (Android's page for the app). Each change reschedules the job (`Daily.enable`).
- **Review**: the backup's date, an estimate for the ticked chats, messages / chats / photos (with their size); why the app becomes the SMS app; every chat with a tick (all ticked; **Select all** shows a dash when only some are), newest first, with avatar, message count, years and "Group". The bottom bar has **Choose another file** and **Restore N messages**. Only some chats ticked: their files go to the service as `EXTRA_THREADS`. Groups and no known own number: a number field appears.
- **Running**: a ring with the percentage and "n of total", the chat being restored, time left, texts / picture & group / already here, **Stop**. The screen stays on. The notification shows the same with a Stop action.
- **Done**: finished, "already on this phone" (same file again), stopped, or failed. While this is still the SMS app: a **One more step** card with **Switch back to Google Messages** (opens it; it asks to be the SMS app again) and **Choose SMS app in Settings**. Afterwards: **You're all set**. Then **Restore another file** (to Welcome), or after a stop or failure **Restore again** / **Try again** (back to the same file's review).
- **Backup review**: this phone's messages, chats and photos (`PhoneBackup.summary`), **Include photos and videos** (on), what's in a backup (and the RCS caveat below), **Update a backup instead…** (`OpenDocument`: a backup made before); **Back** / **Save backup**, which opens Android's save screen (`CreateDocument`, `messages-backup-<date>.tar`). Either way the file's permission is kept (read and write, `takePersistableUriPermission`) for the daily backup.
- **Running** shows a backup the same way: messages, chats, photos so far, and the time left the backup works out itself.
- **Backup saved / updated / stopped / didn't finish**: counts (for an update, what it added and what the file now has), file name and size, photos still to add if it was made without them, **Back up automatically** (a switch: the automatic backup of this file, at the interval already set, else every day), "Next: your computer backup" (Settings → Tools → Bring in a phone backup), **Share** (any app: Drive, email, Nearby Share) and **Done**.
- A banner on Welcome and Review says when this app is still the SMS app, with **Switch back**.

Estimates use speeds measured on the emulator (38,281 messages in 7½ minutes): 250 texts a second, 15 picture/group messages a second (each is several writes). Time left counts work the same way, since a chat's texts go quickly and its pictures slowly.

**The result is saved** (`RestoreState.save`, preferences `last_restore`): when Google Messages takes the SMS role back, Android revokes this app's SMS permissions and ends its process, so without it the app would reopen on Welcome instead of "You're all set". After a stop or failure the file is reopened too, quietly, so **Restore again** works.

## Backing up this phone (`PhoneBackup`)
Reading needs only `READ_SMS`, asked for at the time (with `READ_CONTACTS` for chat names, optional, and notifications), **not** the SMS role: the phone's SMS app is never changed. `READ_SMS` is a hard-restricted permission: Android grants it only to apps whose installer allowed it, which `adb install` and the phone's own installer for downloaded APKs do; Play would need a policy exemption.
- Chats come from `content://mms-sms/conversations?simple=true` (newest first), their people from `canonical-addresses`. **One canonical address can hold several numbers** (`5550100001;5550100002`, from a group text): `PhoneBackup.addrs` splits on `;` and `,` (and on spaces when every piece is a whole number), so they don't become one 20-digit "number". `addr` keeps digits and `+` for a number, lower case for an email address, and a business name as it is. Names, starred (Android's Favorites) and photo from `PhoneLookup`, else the number; each thread's `people` records them, and a contact's photo goes into the package once (`contacts/<n>.jpg`), kept by later updates. Contacts are looked up again on every update, so a renamed or newly starred contact shows.
- Each chat: texts (`content://sms`, types 1 and 2: drafts and unsent ones are left out), then picture/group messages (`content://mms`, boxes 1 and 2) with their parts (`content://mms/<id>/part`: text, or a photo or video listed with its type, name and part ID, the SMIL layout part skipped) and sender (`/addr` type 137). Photos are then copied in (`copyParts`, through a temporary file so the tar header can have its size), or, without photos, left listed with no `file`. Sorted by time and written as one `threads/<nnnn>.ndjson`; the manifest goes last, so a stopped backup is a whole file of the chats finished so far. A new backup that fails deletes its file.
- **Updating a backup** (`previous` set): new entries are written from `RestorePackage.end` (over the end blocks) and the file is cut to its new length. Chats are matched by their sorted addresses. For a chat the file has, the phone's messages up to its `last` are counted; if there are no more than the file has and no photos are wanted that it lacks, only messages after `last` are read and written as one more piece (`threads/<nnnn>.<k>.ndjson`, listed in `files`); otherwise the whole chat is read and merged with the file's (same message: same date, box and text; the file's photos are reused by position, its first `src_id` kept, a message deleted from the phone kept) and written again under its first name. Each thread entry keeps `messages`, `sms`, `mms`, `first`, `last`, `media`, `media_waiting`, `media_bytes`, so the next update needn't read it; a file from before these were kept is read once to work them out. The manifest gets `updated_at` and a `history` entry per run.
- **Where it's written** (`BackupFiles.run`): in place when the file can be opened `"rw"` and isn't a pipe (`statSize` ≥ 0): reads through a `FileInputStream` channel and writes through a `FileOutputStream` channel on the same descriptor. Otherwise (Google Drive) the file is copied to the cache, updated there and written back with `"wt"` (or `"w"`).
- **By itself** (`Daily`): a `JobScheduler` periodic job (every `everyHours`, 1 to 720, with a quarter of that as flex and at least 15 minutes; App Standby may run it less often for an app not opened in a while, battery not low, optionally charging, optionally unmetered network, on by default for a file not on the phone's own storage; kept across restarts) runs `DailyBackupService`, an update of the chosen file with its photos setting. A file that's still empty (just chosen) gets a whole backup. With **Tell me after each backup**, a quiet notification says what was added. A run Android stops (about 10 minutes) writes what it has and carries on next time. The last run (time, added, error) is in preferences `daily_backup`; a failure notifies. A manual update of the same file counts as the day's run.
- The format is the extension's (see [[Restore package]]), with `tool: "Message Archivist"`, `source: "phone"`, each chat's `names`, exact times, and `src_id` `sms:<id>` / `mms:<id>`. So it restores with this app on any phone.
- Numbers are shown as the extension shows them (`RestoreService.shown`, the same rule as `GMLib.formatNumber`): a North American number as "(555) 010-0001", another with a country code as "+44 7700 900 123"-style groups, a name or anything else as it is; a chat title of several numbers is formatted number by number. Used for the chat on the progress screen and in notifications, and the restore review's chat list.
- Time left: texts and picture messages are timed apart as they're read (picture messages take several reads each), then each kind's remainder at its own speed.
- **RCS**: Google Messages keeps RCS chats in the same database as MMS, so they're backed up, except that since mid-2026 a Google bug stops some **outgoing** RCS messages being stored there (see [[Android direct connection]]). Those are only in a backup made with the extension. The extension imports these files into its library (Settings → Tools → **Bring in a phone backup…**).

Measured on the emulator: 38,281 messages, 4,741 of them picture/group, 262 photos, in about 2½ minutes (50 s without photos); restoring that backup elsewhere gives back every message and photo exactly (`test/restore/compare.mjs` checks two packages chat by chat). Updating the photo-less backup with photos: 57 s, 0 messages and 262 photos added, the result identical to a backup made with photos. A daily update with two new texts: 2 s, the file 9 KB bigger.

## How messages go in (`Restorer`)
- Thread id from `Telephony.Threads.getOrCreateThreadId(addresses)`.
- SMS: `bulkInsert` into `content://sms`, 400 at a time: address, body, date, date_sent, type (1/2), read, seen.
- MMS: insert into `content://mms` (date in **seconds**, msg_box, m_type 128 sent / 132 received, `ct_t` multipart/related), then parts into `content://mms/<id>/part` (text part with `text`; file parts by streaming into `openOutputStream(partUri)`), then addresses into `content://mms/<id>/addr`: 137 = from (`insert-address-token` for sent), 151 = to.
- **Received group messages also list this phone's own number as a 151.** Without it, Google Messages files each received group message as a one-to-one chat with its sender (seen on the emulator). The number comes from `SubscriptionManager.getPhoneNumber` or `TelephonyManager.line1Number` (allowed for the default SMS app), or the user types it.
- Duplicates: before starting, every `thread|date|type` (SMS) and `thread|seconds|box` (MMS) on the phone is loaded; matching messages are skipped. Restoring twice adds nothing; a stopped restore carries on.

## Building and testing
```bash
cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo /opt/homebrew/opt/openjdk@17) ./gradlew assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`. CI builds it on every push (`.github/workflows/ci.yml`, job `android`). Emulator testing: [[Testing]].

Debug builds accept `--es restore_path <file the app can read> --ez auto true` to start a restore without the file picker, and `--es backup_path <file the app can write>` (optionally `--ez media false`, `--ez update true`) to back up, or update that file, at once (tests only); release builds ignore both. `adb shell cmd jobscheduler run -f io.github.trikhster.messagearchivist 7` runs the daily backup now.

## Known limits
- Times in a file from the extension are to the minute (from Google Messages for Web); a phone backup's are exact. RCS goes back as SMS/MMS; picture messages arriving mid-restore aren't downloaded (see `MmsReceiver`).
- The launcher label is cut to "Message Ar…" on most launchers.
- Not on Google Play: people sideload the release APK from GitHub Releases, signed with the project's key (see [[Releasing]]). CI's debug APKs have a different signature, so one can't update the other.
