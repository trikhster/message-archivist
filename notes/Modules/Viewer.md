---
tags: [module, ui]
file: extension/viewer.js
lines: 1623
updated: 2026-10-26
---
# Viewer (`viewer.html`, `viewer.js`)

The offline archive viewer, in three modes:

| Mode | URL | Data from | Can save |
|---|---|---|---|
| Library | `viewer.html?library=1` ("Open my backup") | the folder, through the IndexedDB handle (`openLibrary` → `loadLibrary`); photos read as blob URLs on demand (`gmlib:` placeholders filled by a MutationObserver) | labels, flags and notes into `labels.json` / `labels.js` |
| From disk | `index.html` in the backup folder | `data.js`, each chat's `chat.js`, `labels.js` via `<script>` tags | flags in that browser's localStorage only |
| Analyzer | `viewer.html?embed=1` inside the Messages tab | `gm-data` postMessage from the content script | nothing |

`index.html` is a copy of `viewer.html` written by every run (`writeIndex`), so viewer changes reach a library at its next backup.

## Structure
`boot(D)` does everything after loading. Section markers inside it: prepare data (`ALL` messages, people, colours, `PHOTOS`), labels and folders (`LABELS`, `saveLabels`), flags (`FLAGS`, `flagKey`, migration from localStorage), search helpers, tooltip, scrubber (Google Photos-style month rail), conversation list, chat view (`msgHtml`, `mediaHtml`, `labelMenu`, `toggleFlag`), global search, **review**, print/PDF (`printReport`), media gallery (status filter, `MEDIA_ALL`, `mediaSt`), lightbox, charts (hand-made SVG), analysis, about, routing, keyboard.

## Routes
`#chat/<ci>/<i>`, `#search`, `#media`, `#review`, `#stats/<ci|all>`, `#about`, `#labels/<conversation id or folder>` (that chat and its labels menu) and `#chat-id/<conversation id>` (Settings → Backups → ⋯ → Open in my backup). Keys `1`–`6` switch tabs in nav order.

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
Each chat shows its app (`APPS`, `appOf`, `appBadge`, copies of `GMLib.SERVICES`); the sidebar's **All apps** select filters the list once there's more than one app; and a one-to-one chat's header says "Also in WhatsApp · Telegram…" with links to the same person's chats in other apps (`personKeys`: the last ten digits of a contact number, else the name). See [[Sources]].

## Keys to know
- `ci` is the chat's index in `D.conversations` (not stable between libraries); `i` is the message's `index`.
- Labels use `chatKey(c) = c.id || c.folder || c.title`; flags use `flagKey(m) = (c.id || ci)|(m.id || m.i)`. See [[Known issues]].
- `canLabel` is true only in library mode.
- The status rules in `mediaSt()` copy `GMLib.mediaStatus()` (library.js isn't loaded here).
- No external libraries; charts and the scrubber are hand-built. Colours come from `theme.css` variables; people get `--c1`–`--c8`.
