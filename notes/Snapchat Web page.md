---
tags: [reference, selectors]
updated: 2026-10-27
---
# Snapchat for Web page

Snapchat's own download ("My Data") has only saved messages, so the chats the owner opens on **Snapchat for Web** (`https://www.snapchat.com/web`) are read there too, as they're read, by `extension/web/snapchat.js` ([[Importers]] → Web page readers, [[Sources]]). It's a React app with generated class names, which Snapchat can change at any deploy. Keep the coupling in one place: `SEL` at the top of `web/snapchat.js`.

## What it must never do
Snapchat notifies people about screenshots and saves, locks accounts it catches using third-party tools, and its chats change state when they're opened. So the reader **only reads the page's HTML**: no clicks, typing, scrolling or changes to the page (no panel of its own in it, unlike [[Content script|the Messages page]]), no Snaps opened, nothing saved in Snapchat, no screenshots or screen capture, no logs. It reads only chats the owner opens. Snaps aren't chat messages and aren't read at all.

## SEL (read on the live page, 2026-10-27)
| Key | Selector | Used for |
|---|---|---|
| `list` | `ul.MibAa` (fallback: the `ul` whose items hold `li > header time[datetime]`) | the open chat's messages, oldest first; it scrolls |
| `title` | `.k1IaM span.bIpkz` | the open chat's name, in the pane's header |
| `group` | `ul.ujRzj` | one sender's messages in a row (each in an `li.T1yt2` of the list; the list's other items are a day's heading, `li > time` with a `datetime` like "October 27", a loader and an empty end) |
| `message` | `:scope > li` | one message of a group |
| `header` | `:scope > header` (`header.R1ne3`) | on a group's **first message only**: who and when |
| `who` | `.GUB_w` | the sender's name: "ME" for the owner (in red, `rgb(242, 60, 87)`; others blue, `rgb(14, 173, 255)`) |
| `when` | `time[datetime]` | the group's first message's exact time, ISO with milliseconds |
| `bubble` | `div.KB4Aq` | a message (its left edge red for the owner, blue for others) |
| `text` | `span.ogn1z` | its words |
| `reply` / `replyWho` | `div.z_6Hk` / `.SGcAb` | the message a reply quotes (its own words follow it) |
| `media` | `div.j13IG`, `div.ET_CR` | a photo or video: an empty sized box until it's on screen, then `img` or `video` from a `blob:` address |
| `sticker` | `div.p8r1z > img` | a sticker: a picture on its own in a bubble |

After each bubble, `ul.PmTA8` (empty in every message seen). The chat list on the left is a virtualized list (`[role="list"].ReactVirtualized__Grid` in `nav`) whose items are buttons, not links: a chat's ID is in the address once it's open (`/web/<uuid>`), and loading that address afresh goes back to the list, so the reader never opens chats itself.

## How the page behaves
- **The words are hidden**: Snapchat's privacy screen sets message text to `visibility: hidden`, so `innerText` is empty; read `textContent` ([[Gotchas]]).
- **Only a group's first message has a time.** The others were sent between it and the next group's time: the reader places them a millisecond apart after it and gives each the span (`from`, `to`; the last group's ends when it was read), and merging matches them to the download's messages within it (`GMLib.unknownIn`, [[Library module]]).
- **Switching chats:** the address can change before the messages shown do, so a chat is sent only from its second read on (a few seconds later, the same chat ID and title both times); otherwise one chat's messages could be kept under another's ID.
- **No message IDs** in the page: the reader keys each message by its group's time, its sender, its place in the group and its words.
- **Opening a chat sends read receipts** (Snapchat's `UpdateConversation` call) and starts unsaved messages' deletion: that's why only chats the owner opens are read.
- **Screenshot detection** listens for keys and focus (the community "SnapEnhance" script blocks `keydown` and `focus` listeners to defeat it): reading the HTML sends neither.

## Checking it against the live page
In a Chrome where the owner is signed in to Snapchat for Web, and only in chats the owner allows: run read-only JavaScript that returns **structure only** (tags, roles, class names, attribute names, text lengths, counts, true or false), never names, message text or screenshots (a screenshot shows names; the accessibility tree and "find" print them). Don't click to open chats: let the owner open them. Check the open chat is an allowed one with a script that returns only true or false. The 2026-10-27 check: one allowed one-to-one chat, 142 messages loaded, 141 read (72 with words, 73 photos or videos, 4 both, 22 replies), every key unique, times in order; the one left was a sticker, which `sticker` reads since.
