---
tags: [module, ui]
file: extension/graph.js
updated: 2026-11-03
---
# Graph model (`extension/graph.js`)

`GMGraph`: the model behind the viewer's **Graph** view ([[Viewer]] → Graph), the view the archive opens on. The archive as nodes and links, as Obsidian's graph shows the vault the notes make ([[Obsidian notes]]), but as data, and never all of it at once: an **ego graph** round one focus, a step or two out, laid out the same way every time, with the focus's **profile**. Pure functions over the viewer's chat rows, who's who (`GMLib.people`) and what each chat says (`GMLib.analyse`, [[Library module]] → What a chat says, the analysis the notes keep): no DOM, no clock, no randomness, and every sort has a tie-break on ids, so the same archive always gives the same graph and the same picture. Loaded by `viewer.html` after the app modules, so it reaches the backup folder's `index.html` and the app with the other viewer files (`GMLib.pageFiles`; `manifest.json` lists it as web-accessible for that). The plan it comes from: [[Investigations and graph]], Phase 4.1.

## Ids
`you` · `person:<key>` (the person's `key` from `GMLib.people`: their first chat's key) · `topic:<word or phrase>` · `group:<chat key>` (`GMLib.chatKey`) · `year:<YYYY>` · `label:<label>` (a label in the phone's contacts). `TYPES` is that order: `you, person, topic, group, year, label`.

## `build({ rows, P, cache, book }) → G`
`rows` are the viewer's chat rows (each with its compact messages; in Node, index rows with `messages`), `P = GMLib.people(rows, saved, book)` (made here when not given), `cache` a Map of row → `GMLib.analyse(messages)` (a row without one is analysed here, without folded reactions), `book` the address book (`contacts.json`). It works out what `GMObsidian.update` does before writing notes, as data:
- **People** added up (`GMLib.mergeAnalyses` of their chats' analyses); **one-way** senders (never written to, in an app you've written in somewhere, no chat unreadable) are nodes but stay out of topics, mentions, the years' totals, events and the lists of who matters (`G.oneWay`: their ids); they keep their `chat` and `active` links, shown when one-way senders are turned on.
- **Topics**: each two-way person's and each analysed group's (20 messages or more) words and phrases that stand out (`GMLib.standout`); one two or more share is a node, weighed by its uses in all, with `people` (how many share it) and `phrase`. Each year's standout words (`GMLib.byYear`) feed the year profiles.
- **Mentions** (`GMLib.mentionsOf`), **groups in common** (`P.groupsOf`), **relations** from the contact cards resolved by name (a person with that name, or an address-book contact whose numbers are a person's), **labels** from the cards.
- **Events** as the notes find them (`{ d, row, person, kind, me, hint, n?, for? }`, `person` a node; a group's "Happy birthday Cleo!" is Cleo's when only one person has that first name), photo days (`PHOTO_DAY` photos or videos in a chat in a day), each person's events (`byPerson`), **birthdays** (from the contacts, else *probably* when the same day was wished in two years or more, *maybe* when once) and **yours** (`mine`: the day most people wished you happy birthday, 3 up).

Nodes are `{ id, type, key, label, w, … }`: `w` is messages (you, a person, a group, a year) or uses (a topic) or people (a label); a person also has `sub` (their number, email or handle), `services`, `oneWay` and `ref` (the person); a group `service` and `ref` (the row); a topic `people` and `phrase`. Edges are `{ a, b, kind, w, dir?, type? }`, one per pair per kind:

| Kind | Between | Weight |
|---|---|---|
| `chat` | you – person | messages with them |
| `talks` | person or group – topic; you – topic | uses (you: the total) |
| `named` | person → person (`dir: true`: a names b in your chats with them) | times |
| `member` | person – group; you – group | what they said in it (by number or name; 1 if nothing); you: the group's messages |
| `together` | person – person | groups in common |
| `active` | person or group – year; you – year | messages that year |
| `label` | person – label; you – label | 1; you: people with it |
| `relation` | person – person (`type`: sister, friend…) | 1 |

`G` is `{ nodes (Map), edges, adj (each node's edges), byType (ids of each type, heaviest first), oneWay, events, byPerson, birthdays, mine, ctx }`; `ctx` keeps what the profiles need (the analyses, `standout`'s result, mentions, groups in common, the calendar's days…).

## `ego(G, id, { depth, types, oneWay, services }) → { focus, depth, nodes, edges, hidden }`
Ring 1 is what links to the focus, ring 2 (`depth: 2`) what links to those: in each ring the heaviest of each type up to `CAPS` (`{ person: 14, topic: 10, group: 6, year: 12, label: 6 }`), the rest counted in `hidden` by type so the viewer can say "23 more people". `types` (a Set; the focus always shows), `oneWay` (false: senders you've never written to stay out, unless they're the focus) and `services` (a Set of apps: only people and groups in them) filter. You are the hub of everything, so you are never a neighbour in anyone else's graph. Nodes come back as copies with `ring` (0, 1, 2), `link` (the weight of the link that brought them in; the heaviest when several) and, on ring 2, `via` (the ring-1 node's id); `edges` are every edge between the nodes shown. An unknown id throws (the viewer falls back to you).

## `layout(ego, { width, height }) → { width, height, cx, cy, nodes, edges }`
Deterministic, no physics: the focus at the centre (radius 26), ring 1 on a circle round it (a third of the box when there's room, so a few nodes aren't huddled round the focus; further out when they need it), ring 2 a step outside that (further when its nodes need the room), never past the box, everything shrunk together in a small box. On a ring the nodes go in `TYPES` order (people, then topics, groups, years, labels: sectors), the heaviest first in each, from the top clockwise, each taking the arc it needs (a topic the width of its pill), a gap between sectors and the slack shared out; ring 2's nodes sit beside the ring-1 node they came through. Node radius follows the weight of its link to the focus (ring 1: 10–22, ring 2: 7–13); a ring too small for its nodes squeezes them, and when they still don't fit (topic pills don't shrink) their spacing closes up so the ring ends where it began, never past it; on a ring that had room, twelve passes nudge neighbours that still touch apart. A ring with topics stays far enough in that a pill on its left or right stays inside the box. Nodes are `{ id, x, y, r, ring }`, edges `{ a, b, kind, w, dir, sw (stroke 1–3.5), x1, y1, x2, y2 }`, coordinates to a tenth. The viewer trims each line to the nodes' edges and draws the shapes by type.

## `profile(G, id) → object | null`
Everything the archive knows about a node, as the Obsidian notes say it, as data:
- **person**: `node`, `p`, `oneWay`, `ids`, `labels`, `contact` (`card` merged as the notes' `contactOf`, `photo`, `starred`, `birthday`), `totals` (`total`, `sent`, `recv`, `share` %, `replyMine` / `replyTheirs` (`GMLib.usually`), `talks`, `theyStart` %, `kinds`, `media`, `calls`, `links`), `years` (`{ y, sent, recv, topics }`; a year's pair in an analysis is `[received, sent]`), `hours`, `week`, `topics` (`{ w, n, shared }`), `mentions` (`out`, `into`: `{ q: node, n }`), `together`, `relations` (`{ type, name, q }`), `moments` (`first`, `busiest`, `longest`, `streak`, `silence`, `recent`, `birthdays`, each with `d` and the `row` to open that day: the chat with the most messages that day), `events` (`birthday` when guessed, `met`, `milestones`, `trips`, `photoDays`, `holidays`), `emoji` (`yours`, `theirs`), `groups` (`{ node, row }`).
- **topic**: `word`, `phrase`, `total`, `first`, `last`, `peak`, `users` (`{ node, n, first, last, peakDay, peakN }`), `years`, `related` (`{ node, shared }`: topics the same people share, as the notes' related topics).
- **group**: `row`, `totals`, `members` (nodes), `senders` (`{ name, n, node }`, you among them), `topics`, `years`, `events`.
- **year**: `y`, `total`, `media`, `months`, `people`, `groups`, `topics` (that year's standout words, shared ones with their node), `events`, `busiest` (`{ d, n, row }`).
- **label**: `name`, `people`.
- **you**: `totals` (`chats`, `messages`, `first`, `last`, `twoWay`, `oneWay`, `media`), `years`, `people` (the 25 busiest), `topics` (the 20 most shared), `groups`, `mine`.

## `search(G, text, limit) → nodes`
By name without case, accents or punctuation (a person's other names and handle too), or by the digits of a number; an exact name first, then the heaviest.

## Tests
`test/graph/run.mjs` ([[Testing]]): an invented archive (three people, a shop never written to, a group, an address book) checks every part above, that `build` and `layout` are deterministic, the caps, filters and hidden counts, that ring-1 neighbours never overlap and sectors come in order, and every profile field.

The viewer's side of it (the Graph view) is described in [[Viewer]].
