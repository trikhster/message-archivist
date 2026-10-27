---
tags: [reference, selectors]
updated: 2026-10-26
---
# Google Messages page

Google Messages for Web is an Angular app built from custom elements (`mws-*`). The extension depends on its markup, and Google can change it at any time. Keep that coupling in one place: `SEL` at the top of `content.js`.

## SEL (0.4.5.0)
| Key | Selector(s) | Used for |
|---|---|---|
| `convLink` | `mws-conversation-list-item a[href*="/conversations/"]`, `a[href*="/web/conversations/"]` | chats in the list (and "paired" detection) |
| `convName` | `[data-e2e-conversation-name]`, `.name`, `h2`, `h3` | a list entry's name |
| `headerTitle` | `mws-header [data-e2e-header-title]` and fallbacks | the open chat's name |
| `header` | `mws-header`, `[data-e2e-conversation-header]` | the open chat's header |
| `message` | `mws-message-wrapper` (attribute `msg-id`, `is-outgoing`) | one message |
| `tombstone` | `mws-tombstone-message-wrapper` | date headings and events ("Alice named the group…") |
| `sender` | `.participant-display-name-text`, `.sender-name`, `[data-e2e-sender-name]` | sender in group chats |
| `textPart` / `textInner` | `mws-text-message-part` / `.text-msg`, `[data-e2e-text-message-content]` | message text |
| `timestamp` | `[data-e2e-message-timestamp]`, `mws-relative-timestamp`, `.timestamp`, `time` | times |
| `skipImg` | avatars, emoji, status, reactions | images that aren't media |

Other markup the code relies on outside `SEL` (worth moving into it, see [[Known issues]]): `mws-image-message-part`, `mws-reactions`, `mws-message-status`, `mws-rich-link-preview-part`, `mws-spinner` (loading older messages), the conversation's menu and Details page (contact card), the full-size photo viewer, `mws-avatar` / canvas avatars.

The accessibility labels are a second source of truth: "Alice sent an image. Received on October 3, 2026 at 4:05 PM." `senderFromLabels()` and `stampFromLabels()` read them when the visible parts are missing.

## Rules
- **Use `chatLinks()`**, not a bare `SEL.convLink` query, to open or list chats. The open chat's header also has a link to the conversation; picking it reloaded the page in a test (see [[Gotchas]]).
- **Read, don't trust order**: messages are matched by `msg-id`, or by timestamp + sender + text when there's no ID.
- Messages only loads older history, and `img` sources, while the tab is **visible**.

## Checking against the live page
- Popup → More options → **Copy page diagnostics**: selector match counts, custom element counts, and sanitised markup of a list item, header, date header and sent/received/media messages, with all text masked.
- With the owner's permission, Claude in Chrome may check selectors against their logged-in messages.google.com tab, **reading page structure only**. Never print names, numbers or message text.
- Testing changes safely: the mock page ([[Testing]]).
