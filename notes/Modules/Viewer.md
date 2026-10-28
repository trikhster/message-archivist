---
tags: [module, ui]
file: extension/viewer.js
lines: 1623
updated: 2026-10-27
---
# Viewer (`viewer.html`, `viewer.js`)

The offline archive viewer, in three modes:

| Mode | URL | Data from | Can save |
|---|---|---|---|
| Library | `viewer.html?library=1` ("Open my backup") | the folder, through the IndexedDB handle (`openLibrary` → `loadLibrary`); photos read as blob URLs on demand (`gmlib:` placeholders filled by a MutationObserver) | labels, flags and notes into `labels.json` / `labels.js`; who's who into `people.json` / `people.js` |
| From disk | `index.html` in the backup folder | `data.js`, each chat's `chat.js`, `labels.js`, `people.js` via `<script>` tags | flags in that browser's localStorage only |
| Analyzer | `viewer.html?embed=1` inside the Messages tab | `gm-data` postMessage from the content script | nothing |

`index.html` is a copy of `viewer.html` written by every run (`writeIndex`), so viewer changes reach a library at its next backup. It loads `library.js` (copied beside it, with `viewer.js` and `theme.*`) for `GMLib`'s people and number helpers (`fmtNumber`, `isNumberName` are `GMLib`'s).

## Structure
`boot(D)` does everything after loading. Section markers inside it: prepare data (`ALL` messages, people, colours, `PHOTOS`), labels and folders (`LABELS`, `saveLabels`), flags (`FLAGS`, `flagKey`, migration from localStorage), search helpers, tooltip, scrubber (Google Photos-style month rail), conversation list, **people**, chat view (`msgHtml`, `mediaHtml`, `labelMenu`, `toggleFlag`), global search, **review**, print/PDF (`printReport`), media gallery (status filter, `MEDIA_ALL`, `mediaSt`), lightbox, charts (hand-made SVG), analysis, about, routing, keyboard.

## Routes
`#chat/<ci>/<i>`, `#people/<a chat key of theirs>` (`#people/~matches`: the same-name suggestions), `#contacts`, `#search`, `#media`, `#review`, `#stats/<ci|all>`, `#about`, `#labels/<conversation id or folder>` (that chat and its labels menu) and `#chat-id/<conversation id>` (Settings → Backups → ⋯ → Open in my backup). Keys `1`–`8` switch tabs in nav order (Chats, People, Contacts, Search, Media, Review, Analysis, About).

## Contacts
`renderContacts()`: every person of [[#People (unreleased)|People]] (`PPL.list`) as a 72px circle (`avatar`: their contact photo or coloured initial) in a grid (`.contacts-grid`, `auto-fill` 112px columns), their name (or number) below in two lines at most and one more line: a number or handle that isn't the name, else how many apps or messages. Filter as People's (names, numbers, handles), sort A–Z (default), Most messages, Recent, In the most apps (`#ctSort`, also started by `chatSort`). A circle is a link to `#people/<key>`.

## Big chats and big galleries (0.5.0.0)
- **Chats are drawn a month at a time** (`renderChat`, `fillMonth`, `trimMonths`): each month starts as an empty `<section>` of estimated height (`estimate()`), an IntersectionObserver on `#chatScroll` (1,600 px margin) fills months near the screen, and months far away are emptied again, keeping their measured height, once more than 8 are drawn. Chrome's scroll anchoring keeps the view still when a month above fills in. Find-in-chat searches the data (`state.hits` are messages, not `<mark>`s), so undrawn months are searched too; `goHit` and "jump to month" fill the month first.
- **Numbers shown one way**: at load, chat titles, senders, reply senders and contact names that are numbers go through `fmtNumber` (the original title stays in `rawTitle`, which `chatKey` uses, so labels saved before still match).
- **Lists in one order**: every chat dropdown and the chat list's "Favorites, then A–Z" use `chatOrder` (favourites, from `favourite(c)`: pinned in Messages, a starred contact, or labelled Favorites; then names A–Z; then numbers); favourites get ⭐ in dropdowns, pinned chats 📌 in the list. People dropdowns use `personOrder` (you, starred contacts, names, numbers). "From phone" is a status like the others (no pill in the list).
- **Reactions** show as a pill under the bubble (`reactHtml`): those Google Messages for Web showed (`rc` in `chat.js`), and reactions a phone saved as texts (`❤️ to “…”`, `Reacted 😂 to “…”`, iPhone's `Loved “…”`, `Laughed at an image`, `Removed a heart from “…”`). `foldReactions` (at load) finds the message a reaction quotes (the nearest earlier one with that text, or one starting with a quote cut short by "…"; the nearest with a photo for "an image"), puts it in the target's `rx` and marks the text `rxOf`: it isn't drawn, isn't a chat-list preview, and counts as its emoji in Analysis' words. The files keep the text.
- **One time per run**: in a chat, a message followed by another from the same person in the same minute shows no time (`.time.more`, its flag buttons still there on hover); the last of the run shows it.
- **Search terms in quotes are whole words** (`WHOLE` marker, `termIn`, `termPattern`): `"now"` doesn't find "know"; unquoted terms are still substrings. Analysis' word chips search in quotes.
- **Other files** (`kind: 'file'`, from a phone backup: a contact card or a document sent in a picture message) show as a download link in the chat, a 📎 tile in Media, and a link in the lightbox.
- **Photos load near the screen** (library mode): a `gmlib:` `src` is parked in `data-gmlib` and the photo's month section (or the photo) is watched; when it comes within 600 px it's looked up in the folder. The month is watched rather than the picture because gallery months use `content-visibility: auto`, which hides their pictures from IntersectionObserver.
- Measured on 100,000 messages: 4.7 s to open (4.6: 12.1 s), 25,000 elements (509,000), 121 photos read (2,942); Media tab: 60 of 3,173 photos read.

## Every app (unreleased)
Each chat shows its source and account (`appOf`, `appName`, `appColor` from `GMLib.SERVICES`, which the app modules fill: the viewer loads `modules/` after `library.js`; `srcKey`, `srcName`, `appBadge`): "WhatsApp", "Google Messages · (555) 019-9999", and plain Google Messages chats unbadged until Google Messages has a second account (`MULTI_SMS`); the sidebar's **All sources** select filters the list once there's more than one. See [[Sources]].

`c.group` is what the index says (`true` for a group from an import); `c.multi` (a group, or more than one person wrote) is what the chat list and bubbles use to show names. `GMLib.people` reads `c.group`, so a one-to-one chat whose contact was renamed (two sender names) is still one person.

## People (unreleased)
One person across apps, accounts and numbers ([[Sources]] → People): `PPL = GMLib.people(D.conversations, SAVED)`, rebuilt after every change.
- **The People tab** (`#view-people`, laid out like Chats): everyone (`renderPeopleList`: filter by name, number or handle; sort by most messages, recent, A–Z, or in the most apps; coloured dots for their apps), and a person's page (`renderPerson`): their numbers and handles, "The same person?" (same-name suggestions with *Same person* / *Not the same*), their chats (*Open*, *Not them* to split one off), the groups they're in, and **one timeline of every message with them**, newest first, 100 at a time (`showPersonMessages`; their messages under one name). *Rename…* and *Same person as…* (a box listing everyone, by name, number or handle) are in the header.
- **Suggestions:** the button above the list ("3 pairs of people have the same name…") opens `#people/~matches`: every pair, and *join all* (a confirm).
- **A chat's header** says who it's with: "👤 Sam Rivers · also in [WhatsApp] · maybe [Instagram?]" (`personOf`, `elsewhere`, `maybeElsewhere`); the name opens their page; dashed chips are same-name suggestions.
- **Saving** (`savePeople`) is like labels: library mode only (`canLabel`), `people.json` (`GMLib.peopleSaved` shape) and `people.js` (`window.GM_PEOPLE`). From disk it's read-only, with a note saying where to change it.
- About lists how many people, how many are in more than one app, and a link to the suggestions.

## Codes, promotions and automated texts (unreleased)
At load (before the messages are prepared) each chat gets `c.kind` (`GMLib.chatKind` on `chatTraits(c.messages)`, or none if `labels.json` has it in `keep` or gives it a label other than Spam; [[Sources]] → Kept apart). Unless **Show them everywhere** is on (`SHOW_ALL`, localStorage `ma-show-filtered`), such chats are `tucked`: their messages aren't in `ALL` (so Search, Media, Analysis and Review leave them out), `GMLib.people` gets `PEOPLE_ROWS` without them, the chat pickers skip them, and All chats doesn't list them. The folder bar adds **🔑 Codes**, **📣 Promotions** and **🤖 Automated** with counts (`kind:<k>` folders), and **Show them everywhere** / **Keep them apart**, which flips the setting and reloads. A chat of one says so under its name (`headerExtras`), with **It's not** in library mode: it's added to `LABELS.keep`, saved, and the page reloads. About lists how many of each.

`headerExtras(c)` is everything under a chat's name (labels, the kind line, who it's with): the label menu redraws it the same way.

## Narrow screens
At 640 px and less the chats view is one pane at a time: the list, or (`#view-chats.picked`, set by `route()` when a chat is named in the hash) one chat with a back arrow (`#chatBack` → `#chat`). The month picker, print and "Media only" are hidden there. People works the same way (`#view-people.picked`, `#personBack`), and a person's chat rows put their buttons on a line of their own.

## Without library.js
An `index.html` copied by a backup run from before `library.js` went beside it (an extension changed on disk but not reloaded: [[Gotchas]]) has no `GMLib`. The viewer then stops at once with a panel saying the file is missing and how it comes back (a reload and any backup, or anything brought in from Settings, whose `finishLibraryRun` rewrites the viewer files when `library.js` is missing). "Open my backup" in the extension is unaffected.

## In the app
`const APP = !!window.MA_APP` ([[App]]): library mode always (`LIBRARY`); opened by itself with no folder chosen it goes to Settings' setup steps (`./#welcome`).

## In Settings (embedded)
`viewer.html?library=1&embedded=1` in a frame is Settings' **Archive** tab, in the extension and the app (`EMBEDDED`, only when it really is in a frame). `html.embedded` hides the whole header (its tabs, the counts, ⚙, ?, theme): Settings' menu has the views, the logo and the theme switch (`theme.js` follows a change made in the other page through the `storage` event); keys still work. `route()` posts `{ type: 'ma-view', view }` to the page around it, so its menu shows the view. Whatever would open Settings (`toSettings`: Delete, no folder yet) posts `{ type: 'ma-settings', hash }` to the page around it instead of `gm-open-settings`, which would open a second Settings.

Opened by itself in library mode (the old link, `viewer.html?library=1`), the header has a ⚙ **Settings** button (`gm-open-settings`, `#home`); the copy in the backup folder has no Settings to go to, so it stays hidden. Before `boot`, `loadLibrary` reads `settings.chatSort` (Settings → Order of chats and people) and starts `#convSort`, `#pplSort` and `#ctSort` there; `auto` leaves each at its own (Recent, Most messages). The menus change the order only while you look.

## Keys to know
- `ci` is the chat's index in `D.conversations` (not stable between libraries); `i` is the message's `index`.
- Labels use `chatKey(c) = c.id || c.folder || c.title`; flags use `flagKey(m) = (c.id || ci)|(m.id || m.i)`; people use `GMLib.chatKey(c) = c.id || c.folder`. See [[Known issues]].
- `canLabel` is true only in library mode.
- The status rules in `mediaSt()` copy `GMLib.mediaStatus()` (library.js isn't loaded here).
- No external libraries; charts and the scrubber are hand-built. Colours come from `theme.css` variables; people get `--c1`–`--c8`.
