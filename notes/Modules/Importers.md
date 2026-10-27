---
tags: [module]
file: extension/importers/
updated: 2026-10-27
---
# Importers (`extension/importers/`)

Other apps' own exports, read into library chats ([[Sources]]). Loaded by Settings only (`options.html`), plain scripts like the rest of the extension; they use `GMLib` ([[Library module]]) and `GMZip` and nothing else, so `test/importers/run.mjs` runs them in Node.

## The framework (`importers.js`, `GMImport`)
| Function | What |
|---|---|
| `register(importer)` | each app file calls it with `{ id, service, label, how, partial?, detect(set), open(set, ctx) }` |
| `fileSet(picked)` | a picked File (zip read in place with `GMZip`; any other file is a set of one) or folder handle (walked, dot files skipped) as `{ name, names, blob(path), text(path) }` |
| `detect(set)` / `open(picked, ctx)` | the first importer whose `detect` says yes; `open` returns `{ importer, source }` or throws a plain-words error naming the supported apps |
| `locate(set, path, base)` | the file an export's path points at: exact, or the one ending with it (exports name files from their own root, often a folder or two down) |
| `attach(files, setPath, label, extra)` | a media item for a file in the set, as `media/<name>` (unique within the chat: ` (2)`…), recorded in the chat's `files` map |
| `mediaMissing(kind, why, extra)` | a media item the export left out (`file: null`, `skipped: why`) |
| `stableId(prefix, …parts)` / `counter()` | IDs for messages an export gives none, the same in every export of the chat; `counter` numbers identical repeats |
| `fixMeta(s)` | Meta's UTF-8-as-Latin-1 strings put back |
| `chatData({ service, id, title, people, messages, group })` | the chat in `messages.json` shape, messages in time order and numbered |
| `sourceOf(set, importer, chats)` | the import source Settings merges: `{ name, service, importer, chats, chat(key), read(path) }`, the same shape as an earlier export's (`<key>/messages.json`, `<key>/media/<name>`) |

`open(set, ctx)` returns chats `{ key, data, files }`. `ctx` = `{ whoAmI(service, names, hint) → name|null, locale }`.

## The apps
| File | Service | Reads | Notes |
|---|---|---|---|
| `whatsapp.js` | whatsapp | "Export chat" `.zip` (`_chat.txt` or `WhatsApp Chat with X.txt` + media) or `.txt` | one chat per export; date order from the dates (a day over 12) or the browser's language; iPhone `[d/m/y, h:m:s] Name: text` and Android `d/m/y, h:m - Name: text`; attachments `<attached: …>` / `… (file attached)`; `<Media omitted>` / `image omitted`; `<This message was edited>`; lines with no sender are notices. No chat ID: the name stands in |
| `telegram.js` | telegram | Telegram Desktop "Machine-readable JSON": `result.json` (one chat or the whole account) and its folder or zip | `personal_information.user_id` is you; `date_unixtime`; text pieces joined; `photo`/`file` paths relative to result.json; "(File not included…)" → left out; service messages → notices or calls; replies and reactions kept |
| `discord.js` | discord | the data package (`package.zip`): `messages/index.json`, `messages/c<id>/channel.json`, `messages.json` or `messages.csv` | **only your own messages** (`partial`); times UTC; attachments are links (kept as `url`); DMs named for the other person |
| `meta.js` | instagram or messenger | "Download your information", JSON: `…/messages/inbox/<thread>/message_N.json`; Messenger's own camelCase download | Instagram if the paths say so; text through `fixMeta`; newest-first lists sorted; photos, videos, audio, files, GIFs, stickers by `uri`; reactions; calls; you from the profile files or the name in every chat |
| `tiktok.js` | tiktok | "Download your data", JSON (`user_data_tiktok.json`) | keys matched loosely (they vary by version); "Chat History with X:" names each chat; times UTC; you from the profile's `userName`; no media |

## In Settings
"Bring in conversations from other apps" (Tools tab): **Bring in an export file…** (one or more files) or **…folder**. Each is opened with `GMImport.open`, summarised in a confirm (chats, messages, and what a partial export lacks), and merged by `mergeExports` → `importChat` ([[Settings page]]), which keeps `service`, puts new chats under `conversations/<App>/`, and sets `progress.imported`. "How to export from each app" lists each importer's `how`.
