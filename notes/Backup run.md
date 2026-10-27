---
tags: [flow, backup]
updated: 2026-10-26
---
# Backup run

What happens when someone clicks **Back up this chat**. Other starts ("Back up everything", the backup list, schedules, fetch/upgrade photos) share the same core: `folderRun()` → `backupConversation()`. Function names are in `content.js` unless marked.

## 1. Start
- Popup `start('gm-export', opts)` → content `run(opts)`. A date range goes to `zipExport()` instead (the only thing not saved into the folder).
- `startRun()` resets state, shows the HUD, turns on the link guard (`gm-guard`) and key/scroll blocking.
- `backupSink(true, true)` probes the folder first (opens the [[Writer frame]], asks for permission on the page if needed), so nothing is read that can't be saved.
- `chooseTargets()` works out the chat; `confirmStart()` reads the chat's `progress.json` for current counts and asks with `askChoice()`: **Start backup** or **Speed run** (see [[Photo statuses and runs]]). Then `ownWindow()` moves Messages into its own window (and, with `compactWindow`, shrinks it into a corner; `finishRun()` asks for the size back with `gm-restore-window`). `runScheduled()` does the same for interactive runs ("Run now", Fetch photos, Upgrade).

## 2. folderRun(sink, pickTargets, opts, kind)
- `openLibrary()` reads `data.js` (via `GMLib.readLibrary`, which migrates old formats) and `backup-state.json`.
- For each target: open the chat (`openConversation()` using `chatLinks()`), find or create its entry (`findEntry` / `adoptOrCreate`), run `backupConversation()`, then `writeIndex(sink, lib, run, false)` between chats so a stopped run leaves a usable library.
- At the end: `writeIndex(..., true)` writes the viewer, the library's messages.csv (only if a chat changed, joined by the writer frame), `verification.json`, the run log and `SHA256SUMS.txt`, and returns a summary with `perChat` results.

## 3. backupConversation(conv, opts, ctx, entry)
1. **Load** the saved chat: `loadEntry()` reads `messages.json` and `progress.json` and replays any `journal/` pieces left by a run that stopped hard ("recovered N messages…").
2. **Contact card** (not for media-only runs): `captureContact()` opens the chat's Details through its menu, reads names, numbers, photos and encryption, then `backToChat()`.
3. **Targets and stop point**: photos to fetch or upgrade (`findTargets()`), and `stopAt`: stop at messages already saved, or at the oldest photo target. A chat whose history isn't complete has no stop point: it reads back to the first message.
4. **Load the history**: `collectConversation()` scrolls to the top repeatedly. Messages loads older messages from the phone in batches. Each pass calls `onPass`, which:
   - reads what's on the page: `scrapeSnapshot()` with `cachedRead()` (results kept per element until a MutationObserver sees it change)
   - merges with `GMLib.mergeChrono()`
   - **flushes** every 15 s, or after 100 new messages, or when saved messages changed: pieces go to `journal/NNNNNN.json` (`writeTemp`, not checksummed); `compact()` folds them into `messages.json` at the first save of a new chat, every `max(3 min, 20 ms × messages)`, past `max(3000, messages/4)` journaled records and at the end (0.5.0.0; 0.4.x: every 3 min / 3000)
   - hands loaded photos that need no viewer to the background saver (`mediaSaver`, 4 at a time)
   - offers photo targets now on the page to `fetchTarget()`

   While Messages fetches the next batch, `fullSizeBetween()` opens photos that just arrived in the full-size viewer (setting "Save full-size photos while older messages load", on by default). **Reaching the first message** is decided by evidence: a short batch, then more tries over the patience time (`settings.patience`, default 25 s) find nothing older, with Messages' spinner gone. The evidence goes into `progress.start`.
5. **Remaining photos** (not in a speed run): `saveMedia()` walks the chat for anything not saved yet, using the viewer where full size is wanted.
6. **Newest check**: the newest messages on screen must all be saved; late arrivals are added.
7. **Second read** (setting "double-check", not for media-only runs): reopen, read everything again, add anything missed.
8. **Finish**: `save(true)`: final compaction, journal removed, `progress.json` with `checks = GMLib.checkChat()`. Returns `{ id, title, added, complete, count, oldest, status, media, fetched }`.

## 4. finishRun(kind, target, result)
- `report('gm-backup-status', …)` when there are `perChat` results (updates the popup's `chatStatus`, and the backup list unless `statusOnly`), `report('gm-done', …)` for the badge and notification (not for scheduled runs).
- The HUD docks bottom-right with the summary and **Carry on now** / **Open my backup**.
- `recordRun()` keeps the run (with the last 1500 log lines) in `chrome.storage.local.runs` (last 30).

## Pause, stop, carry on
- **Pause** holds at the next `checkpoint()`. **Stop…** asks (`confirmStop`) then sets `cancelled`. Whatever was read is saved (`save(true)` when stopped).
- `lastStart` remembers how the run began, for **Carry on now**. Backing up the same chat later carries on from `progress.json`.
- `checkpoint()` also brings the window back if it was minimised (`gm-keep-visible`): Messages only loads history while its page is showing.

## Scheduled and "Run now"
`background.js` `runDue()` → `gm-scheduled` → `runScheduled(jobs, interactive, retryFailed, extra)` → `folderRun`. Timed runs never prompt; if the folder needs permission again they report it instead. `gm-media` uses the same function with `extra.media`. `runScheduled` hands `folderRun`'s `perChat` to `finishRun` with `statusOnly: !extra.media`: a scheduled run's list entries are written by `runDue` from the reply, while fetch and upgrade runs update them through `gm-backup-status`.

## "Back up everything"
`runTotal()`: `listConversations()` scrolls the whole conversation list, writes `backup-state.json`, skips `excluded` and (when carrying on) `done` chats, and records each finished chat in `afterChat`. Speed run is offered here too. Coverage is computed from the list in `GMLib.verificationOf()`.

## Messages that came from a phone backup
A chat brought in from a phone backup (the Android app) has messages with no Google ID. `unknown(scraped)` matches a page message to one of them loosely (`GMLib.phoneClaims` / `claimPhone`: same side, within a minute either way, same text, or a photo for a photo-only message) after the usual ID and signature checks; the phone message **claims** that ID (`r.id`), so later runs match it by ID and its photos (if it was backed up without them) become targets like any saved message's. A phone message with a photo and a caption that the page shows as two messages is claimed by both halves: the second only if it brings the missing half, its ID kept in `also_ids` (and in `savedIds`). Page messages that match nothing (sent RCS messages the phone didn't store) are added as new. The run's debug log says how many were matched. `findEntry` also finds a chat with no Google ID by its number when both are named by one, however it's written.
