---
tags: [module]
file: extension/library.js
lines: 439
updated: 2026-10-27
---
# Library module (`library.js`, `GMLib`)

Pure functions shared by the [[Content script]], the [[Settings page]] and the [[Viewer]] (loaded before each; copied into the archive beside `index.html`). No page or extension APIs, so it's the easiest part to unit-test (`npm test` covers the phone backup functions, the importers' records and people). Exposed as `globalThis.GMLib`.

## Exports by section
| Section | Exports | Notes |
|---|---|---|
| apps and accounts | `SERVICES`, `serviceOf`, `serviceLabel`, `appFolder`, `chatFolder(service, title, account?)`, `importedRecord`, `accountKey`, `accountOf`, `sameAccount`, `accountLabel` | every app a chat can come from, where its folder goes, and one message from an importer in the library's shape ([[Sources]]) |
| people | `PEOPLE_VERSION`, `chatKey`, `isGroupChat`, `isPersonChat`, `personIds`, `personName`, `nameKey`, `people`, `peopleSaved`, `joinPeople`, `keepApart`, `splitChat`, `renamePerson` | one person across apps, accounts and numbers ([[Sources]] → People). `people(rows, saved)` → `{ list, byChat, suggestions, groupsOf }`: chats sharing a number, email or app handle are joined (union–find), then the owner's `joined` pairs; `alone` chats keep out of the automatic joins; same-name people are `suggestions` unless `apart`. The four edits return a new `people.json` object. Tested by `test/people/run.mjs` |
| codes, promotions and automated texts | `CHAT_KINDS`, `TRAITS_VERSION`, `chatTraits`, `traitsCurrent`, `senderOf`, `chatKind`, `chatKindFor`, `skipKinds` | told apart per chat ([[Sources]] → Kept apart): `chatTraits(messages)` counts what came in (codes, promotions, links, scam-like links) and what you sent, in either record shape; `senderOf(row)` says who it's with; `chatKind(row, traits)` gives `codes`, `promos`, `automated` or null; `chatKindFor(row, labels, traits)` adds the owner's say; `skipKinds(settings)` is what Settings leaves out. `summarize` keeps `traits` in each row. Tested by `test/filters/run.mjs` |
| settings | `SETTINGS_VERSION`, `SETTINGS_DEFAULTS`, `normalizeSettings` | the one definition every part uses, and the 0.4.x migration ([[Storage and settings]]) |
| merging | `sigOf`, `keyOf`, `unknownIn`, `mergeChrono` | key = message ID, else timestamp + sender + text + media count. `mergeChrono(saved, added, scraped)` keeps order and takes the latest version of messages already saved (read receipts, reactions, edits) |
| the same picture twice | `imageFingerprint`, `sameImage`, `betterCopy` | a tiny size-independent fingerprint; keep the GIF over its still, else the larger |
| every picture's status | `MEDIA_STATUS`, `mediaStatus`, `mediaIndex`, `mediaCounts`, `mediaIndexCsv` | see [[Photo statuses and runs]] |
| per-chat files | `compactMessages`, `chatScript`, `contactSummary`, `chatCsv`, `joinCsv` | `chat.js` short keys in [[Library format]] (reactions as `rc`); CSVs start with a BOM for Excel |
| completeness checks | `checkChat`, `STATUS_LABEL`, `verificationOf` | items (by id): `start` (first message reached, with evidence), `newest`, `ids` (duplicate message IDs), `order` (in time order), `second` (second read), `media`, `contact`. Status `verified` / `complete` / `messages` / `incomplete` / `problem` |
| the index | `summarize`, `indexScript`, `parseIndex`, `readLibrary`, `INDEX_VERSION` | `readLibrary(io, log)` reads `data.js` and migrates older libraries, writing as needed. A row keeps `group: true` for a group from an import, and each contact's `h` (handle) |
| checksums | `parseSums`, `formatSums`, `sha256` | `shasum -a 256 -c` format |
| restore package | `RESTORE_FORMAT`, `RESTORE_VERSION`, `tarHeader`, `tarPadding`, `tarEnd` | writing the [[Restore package]] |
| phone numbers | `phoneDigits`, `restoreAddrs`, `formatNumber`, `isNumberName`, `chatOrder`, `isFavourite`, `phoneKey` | `formatNumber`: "(555) 020-0001" for North American numbers, "+44 770 090 0123" otherwise, a list number by number, anything else as it is (the viewer uses it as `fmtNumber`). `chatOrder(fav)`: favourites, then names A–Z, then chats known only by numbers; `isFavourite(row)`: pinned, or a starred contact (`contact.people[].fav`, from `contactSummary`). `restoreAddrs(people, title)`: the numbers a chat goes to on a phone. `phoneKey`: the last ten digits (or a short code, or a business name in lower case), so differently written numbers compare equal |
| phone backups | `readPackage`, `phoneChat`, `phoneRowFor`, `useLibraryNames`, `phoneSlots`, `claimPhone`, `phoneClaims`, `unknownPhone` | `readPackage(blob)` indexes a package from its headers (a 1 MB window at a time), reads entries as slices, and reads a chat across its pieces (`threadLines`, version 2; reads up to `RESTORE_READS`). `phoneClaims(saved)`: a backup from the web claiming the phone messages it matches (sets `id`, or `also_ids` for the other half of a split photo; [[Backup run]]). `claimPhone` is the one matching rule both ways. `phoneChat(thread, lines, sizeOf, at)` → `{ data, files }`: library records ("Me", minute times, `sender_number`, `phone_id`) and photo name → package entry. `unknownPhone(saved, incoming)`: looser than `unknownIn`, as phone messages have no Google ID (same side, ±1 minute, same text or photo for photo; each saved message vouches once). Tested by `npm test` (`test/restore/import-phone.mjs`) |
| misc | `safeName`, `README` | `README` is the text of README.txt in each backup folder |

## Rules for changing it
- Keep it pure: anything that needs `chrome.*`, the DOM or a file handle belongs in the caller. `io` objects (`readText`, `write`) are passed in.
- `norm(m)` accepts both `messages.json` records and compact `chat.js` messages; keep both shapes working when adding fields.
- `summarize()` output is what `data.js` rows look like; Settings and the viewer read those rows, so a new field needs handling in both, with a fallback for libraries written before it existed.
- Changing `checkChat` changes every chat's status the next time it's saved; mention it in the changelog.
