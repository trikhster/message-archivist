---
tags: [module]
file: extension/modules/, extension/import.js
updated: 2026-10-27
---
# App modules and importing (`extension/modules/`, `extension/import.js`)

Every app the archive holds is a **module** beside Google Messages, the core ([[Sources]]): one file in `extension/modules/` with the app's name, colour, folder, how to get its export, and the reader of that export. `import.js` (`GMImport`) reads exports with those readers. Plain scripts like the rest of the extension; they use `GMLib` ([[Library module]]) and `GMZip` and nothing else, so `test/importers/run.mjs` runs them in Node.

## A module (`GMLib.addModule`)
```js
GMLib.addModule({
  id: 'whatsapp', label: 'WhatsApp', short: 'WA', folder: 'WhatsApp', color: '#25d366', ids: 'phone', book: true,
  partial: null,                 // what its export always leaves out (Discord, Snapchat)
  steps: ['Open the chat…', …],  // how to get its export: Settings' Apps tab, "Where each file comes from"
  phone: 'share',                // the Android app takes it: 'share' (shared from the app) or 'download'
  later: null,                   // why it can't come in yet (iMessage, Signal): no reader then
  reader: { detect(set), open(set, ctx), explain?(set) },
});
```
- **Google Messages** (`sms`, `core: true`) is added by `library.js` itself: it's what the extension and the Android app back up. Every other app is a file: `whatsapp`, `meta` (Instagram and Messenger: one download format, one reader, two modules), `snapchat`, `telegram`, `discord`, `tiktok`, and `imessage`, `signal` (`later`).
- `addModule` fills `GMLib.SERVICES` (label, short, folder, colour, ids, `book`), which everything reads: folders (`chatFolder`, and a text chat named like an app's folder gets " (chat)"), labels (Settings, the viewer, [[Obsidian notes]]), colours (badges, dots), and People (`book`: an app whose names are the phone's contacts, so a chat may be tied to a contact by name). `GMLib.modules()` lists them, Google Messages first; `GMLib.module(id)` finds one.
- **Where they're loaded:** everywhere the archive is read or written: Settings (`options.html`), the viewer (`viewer.html`, so the backup folder's `index.html` and [[App]] too), and the Messages page's content script (`manifest.json`, and the injections in `background.js` and `popup.js`, which take the manifest's list). `npm run check` fails if a file in `modules/` isn't in all three. The reader code is only run by Settings; in the viewer and on the Messages page a module just says how its app shows.
- **Into the backup folder:** the viewer's files are copied beside `index.html` by what `viewer.html` loads (`GMLib.pageFiles`), so `modules/` goes along: `content.js` (`viewerFiles`), `options.js` (`finishLibraryRun`, again if a file is missing) and `scripts/build-app.mjs` (the app's `archive/` copy).

## The framework (`import.js`, `GMImport`)
| Function | What |
|---|---|
| `list()` | the readers, each once, in module order: `{ id, service, label, partial, detect, open, explain }` (a reader may say its own `id` and `label`: Meta's is `meta`, "Instagram or Messenger") |
| `fileSet(picked)` | a picked File (zip read in place with `GMZip`; any other file is a set of one) or folder handle (walked, dot files skipped) as `{ name, names, blob(path), text(path) }` |
| `detect(set)` / `open(picked, ctx)` | the first reader whose `detect` says yes; `open` returns `{ importer, source }` or throws a plain-words error: a module's `explain` (HTML instead of JSON, one part of several), else one naming the apps |
| `openSet(set, ctx)` / `openAll(picked, ctx)` | every export in it: the whole of it if a reader reads it, else each `.zip` in it that one does (a folder of WhatsApp chats); `[{ importer, source }]` with `skipped` (zips that looked like exports but couldn't be read) |
| `packageExports(pkg, name, ctx)` | the exports a phone backup carries (shared to the Android app; [[Restore package]] → Exports), each read as if its files had been picked: one file as itself, several (a chat's text and its photos) as one set; sources named `<backup> › <file>` |
| `locate(set, path, base)` | the file an export's path points at: exact, or the one ending with it (exports name files from their own root, often a folder or two down) |
| `attach(files, setPath, label, extra)` | a media item for a file in the set, as `media/<name>` (unique within the chat: ` (2)`…), recorded in the chat's `files` map |
| `mediaMissing(kind, why, extra)` | a media item the export left out (`file: null`, `skipped: why`) |
| `stableId(prefix, …parts)` / `counter()` | IDs for messages an export gives none, the same in every export of the chat; `counter` numbers identical repeats |
| `fixMeta(s)` | Meta's UTF-8-as-Latin-1 strings put back |
| `chatData({ service, id, title, people, messages, group, owner })` | the chat in `messages.json` shape, messages in time order and numbered |
| `sourceOf(set, importer, chats)` | the import source Settings merges: `{ name, service, importer, chats, chat(key), read(path) }`, the same shape as an earlier export's (`<key>/messages.json`, `<key>/media/<name>`) |

A reader's `open(set, ctx)` returns chats `{ key, data, files }`. `ctx` = `{ whoAmI(service, names, hint) → name|null, locale }`.

## The apps
| File | Service | Reads | Notes |
|---|---|---|---|
| `whatsapp.js` | whatsapp | "Export chat" `.zip` (`_chat.txt` or `WhatsApp Chat with X.txt` + media) or `.txt`; a folder of several | one chat per export, each text file in a set a chat (media looked for beside it first); date order from the dates (a day over 12) or the browser's language; iPhone `[d/m/y, h:m:s] Name: text` and Android `d/m/y, h:m - Name: text`, with the phone language's ways (`31.01.24`, `2024. 1. 31. 오후 2:05`, `klo`, `p. m.`, a leading U+200E/U+200F); attachments `<attached: …>` (the word in any language) / `… (file attached)` (when the words say so, the name is WhatsApp's own, or the file is there); `<Media omitted>` / `image omitted` and their translations; `<This message was edited>`; notices: Android's lines with no sender, an iPhone's marked lines (U+200E after the colon) under a group's own name or saying what only WhatsApp says (`NOTICE`, English and a few other languages); an iPhone's marked "Missed voice call" is a call. A group: more than two people, a group's notice, or two people in a chat named for neither (Android's encryption notice has no sender in one-to-one chats too). No chat ID: the name stands in |
| `telegram.js` | telegram | Telegram Desktop "Machine-readable JSON": `result.json` (one chat or the whole account) and its folder or zip | `personal_information.user_id` is you; `date_unixtime`; text pieces joined; `photo`/`file` paths relative to result.json; "(File not included…)" → left out; service messages → notices or calls; replies and reactions kept |
| `discord.js` | discord | the data package (`package.zip`): `messages/index.json`, `messages/c<id>/channel.json`, `messages.json` or `messages.csv` | **only your own messages** (`partial`); times UTC; attachments are links (kept as `url`); DMs named for the other person |
| `meta.js` | instagram, messenger | "Download your information", JSON: `…/messages/inbox/<thread>/message_N.json`; Messenger's own download of end-to-end encrypted chats (secure storage): a zip of camelCase JSON files, one per chat, and their media; both together too | Instagram if the paths say so; text through `fixMeta`; newest-first lists sorted; photos, videos, audio, files, GIFs, stickers by `uri`; reactions; calls; you from the profile files or the name in every chat. Messenger's own download has no chat IDs: `threadName` stands in (with the file's name for a second chat of that name). `explain`: an HTML download (`message_1.html`), or a part with only photos |
| `tiktok.js` | tiktok | "Download your data", JSON (`user_data_tiktok.json`) | keys matched loosely (they vary by version); "Chat History with X:" names each chat; times UTC; you from the profile's `userName`; no media |
| `snapchat.js` | snapchat | "My Data": `json/chat_history.json` (+ `account.json`, `friends.json`), `chat_media/<date>_<media ID>.<ext>`; an older download's "Received/Sent Saved Chat History" | `partial` (only what Snapchat still keeps); keys matched without case or spaces (`IsSender`/`isSender`); a chat per key (the friend's username, or a group's ID with its `Conversation Title`); times UTC, exact from `Created(microseconds)` (microseconds or milliseconds); you from `IsSender` and `account.json`; display names from `friends.json`, usernames as handles; media by `Media IDs` (` \| `-separated) on the same UTC day; `NOTE` is audio; `STATUS…` types are notices; empty texts left out; `snap_history.json` not read. `explain`: HTML only, or a part with only `chat_media` |
| `imessage.js`, `signal.js` | imessage, signal | nothing yet (`later`) | how they show, for when they come; the Apps tab says why not yet |

## In Settings
- **Apps tab** (`renderApps`): a card per module, Google Messages first (its counts, with **Backups** and **Phone restore**), then each app with a reader: what the archive has from it (chats, messages, and when its chats were last brought in: the index row's `imported_at`), what its export leaves out, its `steps`, what the Android app does with it (`phone`), and **Bring in … files…** / **A folder…**; then **Not yet** (the `later` ones). Bringing in from there writes its progress under the Apps tab (`importMsg`).
- **Bring in conversations** (Tools): **Bring in files…** (one or more) or **Bring in a folder…**, for every kind of import (`importAnything` → `sourcesFrom`: a `.tar` is a phone backup, with `packageExports` for the other apps' exports in it; a zip or folder holding `conversations/*/messages.json` an earlier export; anything else goes to `GMImport.openAll`, whose `skipped` are listed under "Left out"). Phone backups are merged big file first, then updates files. Each source is summarised in a confirm (chats, messages, and what a partial export lacks), and merged by `mergeExports` → `importChat` ([[Settings page]]), which keeps `service`, puts new chats under `conversations/<App>/`, and sets `progress.imported`. "Where each file comes from" lists each module's `steps`.

## Web page readers (`web/`)
An app whose export can't have every chat (Snapchat's has only saved messages) may also have a **web page reader**: the module's `web` says where (`{ label, url, matches, origins, script }`), and `web/<app>.js` reads the chats the owner opens there, as they're read. Only `web/snapchat.js` so far ([[Snapchat Web page]]).
- **Turned on in Settings → Apps** (`setWebReader`): Chrome is asked, on the click, to let the extension read the site (`origins`, an optional permission; `https://*/*` is already optional in the manifest), then the script is registered for the site's pages (`chrome.scripting.registerContentScripts`, id `web-<app>`, kept across restarts). Off: unregistered, and the permission given back. Not in the app (it can't register scripts).
- **Read-only:** a reader never clicks, types, scrolls, changes the page, opens a Snap, saves anything in the app or captures the screen; it reads only what the owner opens, and logs nothing.
- **Kept until brought in:** it sends what's new in the open chat (`gm-web-capture`: `{ service, chat: { id, title, people, group }, items }`, each item `{ key, at, from, to, me, sender, text, media[], reply? }`) to the background, which keeps it per chat in `chrome.storage.local` (`webcap:<app>:<chat id>`) and skips keys already brought in (`webdone:…`).
- **Into the archive** (Settings → Apps → **Put them in my archive**, `bringInWeb`): `GMImport.webSource` makes the kept chats a source like an export's ("Snapchat for Web", importer `snapchat-web`, partial): messages with IDs from their keys and their span (`web_window`), chats with no ID (the page's isn't the export's, so a chat joins the app's chat of the same name; the page's is kept as `web_id`), photos and videos noted, not saved. It's merged like any import; what went in leaves the queue and its keys go to `webdone`.

## Adding an app
Write `extension/modules/<app>.js` (`GMLib.addModule`, with its reader), add `<script src="modules/<app>.js">` to `options.html` and `viewer.html` and the file to the manifest's content script (`npm run check` says where if one is missing), and a made-up export to `test/importers/run.mjs`. If a phone can export it, add it to the Android app's `Apps.kt` (`AppsTest` checks its name and colour against the module) with a how-to string. Nothing else changes: merging, the index, checksums, the viewer and the Apps tab are source-neutral.
