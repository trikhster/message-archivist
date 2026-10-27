---
tags: [decisions]
updated: 2026-10-26
---
# Decisions

Why things are the way they are. Newest last. Add an entry when you make a choice someone might later want to undo, with what was rejected and why.

### No build step, no dependencies
Plain JavaScript files loaded as they are. Anyone can read what runs, `Load unpacked` works straight from the repo, and there's no supply chain to audit. Cost: no modules or types; big files (see [[Known issues]]).

### One library folder (0.4.0.0)
Every backup (one chat, a list, schedules, everything) goes into one folder with one index and one viewer, instead of a zip per run. Chats saved at different times stay together and only changed chats are rewritten. Only date-range copies are still zips. This was a major version: older exports are brought in with Settings → Import.

### The writer frame owns the folder
Content scripts can't use the extension's stored folder handle (see [[Gotchas]]). An extension iframe on the page can, and blobs pass to it without copying. Rejected: sending every file through the background worker (JSON-only messages, base64 overhead).

### Completeness is shown with evidence
"Reached the first message" is only claimed with evidence (a short batch, then quiet tries with no spinner), and every chat gets checks in `progress.json`. A backup that's merely probably complete says so. People use this for records, sometimes legal ones.

### Never log message text
Logs carry names, numbers, times and file names, so people can share them for help, but never message text. Diagnostics mask text too.

### Deleting moves, never deletes
Deleting a chat or duplicate photos moves them into `removed-chats/` or `removed-duplicates/`. Nothing in the backup is destroyed by the extension.

### Labels and flags are notes, not record (0.4.2.0, 0.4.5.0)
They live in `labels.json` / `labels.js` and are left out of `SHA256SUMS.txt`: the checksums vouch for what was read from Messages, not for later annotations. From 0.4.5.0 flags are saved there too (before, only in the viewer's browser).

### Save as it goes: journal plus compaction (0.4.5.0)
Rewriting a big `messages.json` every few seconds is slow, and saving only at the end lost work and held whole chats in memory. Small journal pieces every 15 s / 100 messages, folded in every 3 minutes, make a crash lose almost nothing. Pieces aren't checksummed because they're temporary.

### A photo master list, derived from the record (0.4.5.0)
`messages.json` stays the source of truth; `media-index.json` / `.csv` and the counts in `data.js` are rebuilt from it on every save. The status is computed (`mediaStatus`), not stored, so it can't disagree with the files recorded. This is what lets speed runs, fetch-later and upgrade-later go straight to the photos that need work.

### Full-size photos between batches by default (0.4.5.0)
Opening photos in Messages' viewer while it fetches the next batch uses time that was otherwise idle. It was an opt-in experiment from 0.4.1.0 to 0.4.4.2 and behaved well, so it's on by default.

### Developer notes in an Obsidian vault (`notes/`)
Kept at the repository root, outside `extension/`, because everything in that folder is loaded by Chrome and zipped into releases.

### One settings definition, basic and advanced (0.5.0.0)
Settings had grown three "full size" switches, two window switches and popup-only choices, each with its own defaults in five files. 0.5.0.0 has one shared definition (`GMLib.normalizeSettings`) and one setting per decision, split into a Basic list (what most people ever change) and an Advanced list. Old choices are migrated only where they were clearly made on purpose; otherwise the new defaults apply.

### Defaults aim at "put it back on a phone" (0.5.0.0)
The end goal for most people is a backup they can restore to an Android phone with SMS Backup & Restore. So photos are on and full size, contact cards (numbers) are always captured, and the restore file includes photos. Full size costs little extra because most viewer work happens while Google Messages fetches the next batch.

### One list of chats in Settings (0.5.0.0)
"Chats kept up to date" and "Check for problems" showed the same chats twice with different information and buttons. Now every chat is one row with its status, photos and automatic schedule; filters replace the separate tables.

### Draw a month at a time, not virtualised rows (0.5.0.0)
Months are the viewer's natural unit (the scrubber, jump to month, the headings), they're small enough to draw at once and big enough to keep IntersectionObserver traffic low. Full row virtualisation would have meant fixed row heights, which messages with photos and quotes don't have.

### Don't connect to the phone directly (0.5.0.0 research)
ADB can't read the SMS database without `READ_SMS`; an app that can already exists (SMS Backup & Restore). Importing its XML is the faster path. See [[Android direct connection]].

### Our own Android app for restores (0.5.0.0)
Instead of handing users to SMS Backup & Restore, the project has its own Android app (`android/`), and its own [[Restore package]] format: a tar of JSON lines and plain photo files, written a piece at a time, so years of photos never pass through base64 or memory. Kotlin, with no libraries for the restore itself. The XML for SMS Backup & Restore stays available as a fallback. Restore first; reading the phone's own messages comes next.

### Compose and Material 3 for the app's screens (0.5.0.0)
The first version of the Android app was built from plain Android views to keep it library-free. Its screens are now Jetpack Compose with Material 3 (the Compose BOM, `activity-compose`): it's what Google's own apps are built with, so the app looks and behaves like them (the phone's own colours on Android 12+, dark mode, animations) for little code. The restore itself still uses only the platform. Cost: a bigger app (about 10 MB as a debug build); a release build shrunk with R8 would be much smaller.

### Phone backups in the same format, with READ_SMS only (0.5.0.0)
The Android app backs a phone up into the [[Restore package]] format rather than a format of its own: one reader, so a phone backup restores on any phone, and the extension can learn to import it once. It reads with the `READ_SMS` permission instead of becoming the SMS app: nothing about the phone changes, and there's no switching back. The extension brings a phone backup into its library as one more import source, matched by phone number (below).

### Phone backups join the library by number, with looser message matching (0.5.0.0)
A phone has no Google conversation or message IDs, and names chats from its own contacts, so a phone chat is matched to a library chat by its set of phone numbers (`phoneKey`: last ten digits), falling back to the name only for a library chat with no numbers. Messages can't use `keyOf` either: Google Messages for Web sometimes shows a photo and its caption as two messages, and its minute can differ from the phone's by one. So a phone message is "already there" if the library has one from the same side within a minute either way with the same text (or a photo, for a photo-only message), each library message vouching for one phone message. The risk is the other way round (two genuinely different messages taken as one) only for identical texts from the same side within two minutes, which the one-to-one vouching mostly covers.

### Phone first, then the extension (0.5.0.0)
A phone backup takes minutes where Google Messages for Web takes hours for years of texts, so new users start there: the app's first screen leads with **Back up this phone**, its done screen points to the extension, and the extension's first-run steps put "Start with your phone" right after choosing a folder. The extension then fills in what the phone lacks and keeps the backup up to date. For that to be safe, a backup from the web **claims** messages that came from the phone (`GMLib.phoneClaims`) instead of saving them again: the same loose rule as importing, used the other way round, and once claimed a message has a Google ID and is matched normally.

### Phone backups are updated, not made again (0.5.0.0)
An update appends to the backup file (tar entries after the old ones; the last copy of a name wins), and a chat that only gained newer messages gets one more small piece (format version 2, `files`) instead of being written again, so a daily backup of years of texts reads and writes only the day's messages. Writing a chat again in full is kept for when its older part changed (a restore added messages, or photos are wanted now), at the cost of an unused old copy in the file. Alternatives: a new file per day (simple, but restoring or importing needs all of them, and online storage can't create files in a folder from the background), or rewriting the file every day (gigabytes a day with photos). A file on Google Drive can't be written in place, so it's still updated through a copy; that's the cost of keeping the app without internet access or a Google sign-in.

### The daily backup is a JobScheduler job (0.5.0.0)
No WorkManager (another library) for one periodic job: `JobScheduler` does it with the platform. An update takes seconds, well within a job's time; a job Android stops leaves a whole file and carries on next time.

### Reactions sent as texts are shown, not rewritten (0.5.0.0)
A phone stores a reaction that couldn't travel as one as a text (`❤️ to “…”`). The viewer shows it on the message it quotes; the backup keeps the text as it came, so the record isn't changed by a guess about which message it meant.

### One order and one number format for every list (0.5.0.0)
Favourites first (pinned in Google Messages, a starred contact on the phone, or the Favorites label), then chats with names A–Z, then those known only by a number, shown as "(555) 020-0001" (North America) or "+44 …": in the viewer's dropdowns and chat list, and Settings' lists. Stored titles aren't changed; only what's shown.

### "From phone" instead of "Unfinished" (0.5.0.0)
A chat from a phone backup has every message the phone had, which is usually the whole chat; calling it Unfinished sent people to fix something that wasn't broken. It gets its own status, counted as backed up; a backup from Google Messages later checks it to the first message as for any chat. Imports of older exports take the export's own record of how far it got.

### A new application, Message Archivist, from one first commit (0.0.1.0)
Going public, the project took one name, **Message Archivist**, for the extension and the app alike, and a new repo, `trikhster/message-archivist`: the earlier name tied it to one service and to "scraping", while it now backs up and restores phones and may read more than Google Messages later. It starts as a new application: version 0.0.1.0, a new Android package (`io.github.trikhster.messagearchivist`) and a repository whose history begins with one commit of the code as it stood. The development before that stays private; its commits carried a personal email, and GitHub keeps every pull request's original commits even after a history rewrite, so a fresh repository was the only way to leave none of it public. Formats didn't change: libraries and backup files made before still open (the viewer still reads flag files made under the old name).

### Releases are pre-releases while the version starts with 0 (0.0.1.0)
The first part of the version is the production level (see [[Releasing]]); until it's 1, GitHub marks every release as a pre-release. GitHub's "latest release" link and shields.io's default badge skip pre-releases, so the README links to the Releases page and the badge includes pre-releases.

### The APK is signed in GitHub Actions from repository secrets (0.0.1.0)
A release's APK must always be signed with the same key, or updates won't install. The key was made on the owner's Mac (password in the Keychain) and given to the Release workflow as two secrets; it's on the runner's disk only for the build step. Tag-push workflows only run for people who can push tags, and pull requests from forks never see secrets. The actions in that workflow are pinned to commits so a moved tag can't change what runs next to the key.

