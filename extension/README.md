# Message Archivist for Chrome

Make verifiable copies of your [Google Messages for Web](https://messages.google.com/web) conversations, keep them up to date automatically, and search and analyze them, either offline from the copy or live without saving anything.

Everything runs in your browser. Nothing is sent anywhere. The interface is styled after Google Messages for Web, in light or dark. It follows your system setting, and the sun/moon button on each page switches it (Settings → Appearance can switch it back to the system default).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `extension` folder.
3. **After every update or reload of the extension, reload your messages.google.com tab too.**

## Getting started

The quickest start is from your Android phone: Message Archivist's Android app reads the phone's own copy of your texts, so years of them take minutes (Google Messages for Web has to scroll through every chat, which can take hours). Then this extension keeps the backup up to date. Right after installing, Settings opens with these steps, each with a button:

1. **Choose a folder for your backups.** For example, make a new folder called "Messages Backup" in Documents. Chrome asks to let the extension save there: choose **Allow** (or **Allow on every visit**).
2. **Start with your phone.** In the Message Archivist app on your phone, tap **Back up this phone** and save the file (see [Back up a phone with the Android app](#back-up-a-phone-with-the-android-app)). Copy it to this computer, then **Bring in a phone backup…**. No Android phone to hand? Skip this step.
3. **Open Google Messages and connect your phone.** On your phone, open Messages, tap your profile picture → **Device pairing** → **QR code scanner**, and scan the code shown in Chrome.
4. **Back up everything once, then keep it up to date.** Click **Back up everything…** (or open one chat, click the 💬 icon at the top right of Chrome and choose **Back up this chat**). After a phone backup, this fills in what the phone doesn't keep (some chat messages you sent, during a Google Messages bug), contact cards and pictures, and recognises the messages already there instead of saving them twice. From then on only new messages are added, by hand or on a schedule.

Then click **Open my backup** (in the popup, in Settings, or at the end of a backup) to read everything. You don't need to find any files.

**Have older exports from this extension, or a newer phone backup?** Settings → *Tools* → **Bring in files…** adds them to the same backup.

## The popup

The popup always says what to do next:
- **No backup folder yet:** a button to choose one.
- **Not on Google Messages:** a button that opens it (or switches to it).
- **Phone not connected:** step-by-step pairing instructions.
- **No chat open:** "pick a chat on the left", or back up everything at once.
- **A chat is open:** its status ("Backed up and verified", "Backed up", "Messages backed up, photos to fetch", "Partly backed up", how many messages and how far back), **Back up this chat**, and **Search & stats**, which opens search and statistics for this chat without saving anything.
  - **Keep this chat backed up automatically:** No, every hour, 6 hours, day or week, or only when you click "Back up all now".
  - **Photos and videos in the backup:** how many are full size, thumbnails, not fetched yet or failed, with **Fetch N photos** and **Upgrade N to full size** when there's something to do (see [Photos: the master list](#photos-the-master-list)).
  - **🏷 Labels and flags…** opens this chat in your backup with its labels ready to change.
- **Open my backup** and **Back up everything…**
- **More options:**
  - what to save: media, and full-size photos vs. thumbnails
  - a date range, downloaded as a separate zip (the only thing that isn't saved into your backup)
  - **Back up everything** (or the most recent N), guarded by three deliberate steps
  - page diagnostics

## While a backup runs

- **It asks first.** "Back up this chat" opens a short summary in the middle of the page: whether the chat has been backed up before, what will be saved and where. Nothing starts until you click **Start backup**, or **Speed run** to save every message now and the photos later (see [Photos: the master list](#photos-the-master-list)).
- **It runs in a small window in a corner.** When it starts, Google Messages moves into a small window of its own in the corner of your screen, so you can keep using your computer. It doesn't need to be the window you're working in, but leave some of it showing: Google Messages only loads older messages while its page is showing. If the window gets minimised, the backup brings it back by itself. If it was already a window of its own, it gets its size back when the backup ends. Settings → *While a backup runs* can make it a normal-sized window instead, or leave Google Messages where it is; Advanced → *Corner* picks the corner.

- **A large progress panel sits in the middle of the Messages tab**, over a dimmed page. It says in plain words what it's doing ("Step 2 of 3: loading older messages from your phone…"), with two progress bars, running totals, a scrolling log, and Pause and Cancel. The exporter is scrolling and opening photos in that tab, and clicks, scrolling or keys there could make it miss messages, so the dimmed page takes them all until it's done. When it finishes, stops or is paused, the panel moves to the bottom-right corner and the page is yours again.
- **Pause or stop.** **Pause** holds the backup where it is, on the page, until you click **Resume**. **Stop…** ends it, after asking you to confirm: everything read so far is saved, and the panel offers **Carry on now**. Backing up the same chat again later (the popup's button then says **Carry on backing up**), or "Back up everything", also picks up from there. Google Messages has to show the older messages again first, which goes quickly, and nothing already saved is fetched twice.
- **Links can't open.** Links in the chat, and the page's own attempts to open new tabs or windows (for example a map link), are blocked until it's done.
- **Keep the tab showing.** Chrome slows down background tabs, so the backup pauses if you switch away. To use Chrome meanwhile, drag the Messages tab out into its own window.
- **When it's done** the panel says plainly how it went: "All done", "your messages are backed up, but 2 photos couldn't be saved", "a chat isn't finished yet: back up again to carry on", or, if something went wrong, what usually fixes it. **Open my backup** shows the result; **Copy log** copies the full log for whoever is helping you.
- The 💬 icon shows "…" while it runs and ✓ when it's done, and a notification says when it's finished.

## Backups

- **One library.** Every backup, whether one chat, the backup list, a schedule or everything, goes into the backup folder you chose, with one viewer (`index.html`) for all of it. Chats saved at different times stay together, and each chat only ever has one folder.
- **Saved as it goes.** While a chat is read, new messages are written to disk every 15 seconds or 100 messages, as small pieces in the chat's `journal/` folder, and folded into `messages.json` every few minutes and at the end. Photos, GIFs and videos are saved as soon as they've loaded, several at a time, and full-size photos are opened in Messages' viewer while older messages load (Settings → Advanced, on by default). Very long chats are rewritten in full less often (about every half hour at 100,000 messages); the journal keeps everything safe in between. Nothing waits for the end, so a long chat doesn't fill up memory, and if Chrome closes or the computer sleeps half-way, the next backup recovers everything already written and carries on from there.
- **Picks up where it stopped.** Each chat's `progress.json` records how far back it got. If Chrome closes, you press Cancel, or a chat spans years, the next backup carries on from there and fetches any media a stopped run didn't reach.
- **Then only adds what's new.**
- **Automatic backups** run by themselves every 15 minutes or so when one is due. If Google Messages isn't open, they open it in a window of their own and close it afterwards; if it's open in a background tab, it's moved into its own window first. Chrome has to be running and your phone connected. Chrome may ask for access to the backup folder again after it restarts. Choose **Allow on every visit** when it offers, or use **Allow access** in Settings. Older history doesn't always load in a background tab, so a chat whose history was read that way stays "Unfinished" until a run with the tab in front finishes it.
- **Date ranges** (popup → More options) are the one exception: a separate copy, downloaded as a zip.

### Reaching the first message

Messages loads old history from your phone in batches of about 50 messages, with a spinner at the top of the chat while it works. It only asks your phone for the next batch when the chat is scrolled up to the top *from further down*, and after each batch it keeps your place by jumping the list down. So for every batch the exporter scrolls a little way down, waits for the page to notice, and goes back to the top, then waits up to 12 seconds for the batch (up to a minute while the spinner shows).

A chat is only treated as complete on evidence:
- a batch smaller than a full one, then two more tries that find nothing; or
- a chat that never had a full batch, then three tries that find nothing; or
- three or more tries over the patience period (Settings → Advanced → *Patience*) with nothing new.

If Messages goes quiet without any sign that it reached the start, the exporter does what a page refresh would: it reopens the chat once and carries on, keeping everything already read. Only if it's still quiet after that is the chat treated as complete, and the evidence says so.

The evidence is saved in the chat's `progress.json`, for example *"The last batch had 12 messages (a full one has 50), then 2 more tries over 26s found nothing older"*. If Messages keeps showing its spinner without sending anything (the phone is offline, say), the run stops for that chat without calling it complete.

### Back up everything

Settings → **Back up everything…** (or the popup's More options) reads your whole conversation list, shows how many chats are new, unfinished or already backed up, and asks you to confirm on the Messages page. Then it backs up each conversation in turn, reading each back to its first message; chats already backed up only get what's new. The list and how far it got are kept in `backup-state.json`, so if it stops, the next **Back up everything** carries on with the chats it hadn't done.

At the end, the coverage check compares every conversation in Messages with the library: Backup health and the viewer's About tab say how many are completely backed up, and name any that aren't (with a **Back up the ones not backed up** button). Archived chats aren't in Messages' main list, so open and back up those one by one.

Options: full-size photos, and **double-check each chat by reading it a second time**. That reopens each chat after its backup, reads the whole history again and compares: anything the first read missed is added and noted.

### How complete is each chat?

Every time a chat is saved it gets these checks, kept in its `progress.json`:

| Check | Passes when |
|---|---|
| Reached the first message | the evidence above, from this run or an earlier one |
| Newest messages saved | the newest messages on screen at the end of the backup are all in the backup (any that arrived during the run are added) |
| No duplicates | no Google message ID appears twice |
| In time order | no message is earlier than the one before it |
| Media | every photo, GIF, video and audio file is saved (failed ones are listed; none still to fetch) |
| Contact card | names and numbers were read from the chat's Details page |
| Second read | (with double-check) reading the chat again found nothing new |

The chat is then **Verified complete** (every check passed), **Complete** (first message reached and all media in, with minor warnings such as a photo that couldn't be saved), **From phone** (brought in from a phone backup: every message the phone had; a backup from Google Messages checks it to the first message later), **Unfinished**, or **Needs attention**. `verification.json` in the library lists every chat's status and problems, plus the coverage check.

### Bringing in earlier exports and phone backups

Settings → *Tools* → **Bring in files…** (a zip) or **Bring in a folder…**. Pick one export, several zips, or a folder that holds many (such as Downloads/Google Messages Exports): every export and zip found inside is imported. For each chat:
- it joins its folder in the library, matched by Google's conversation ID (or a new folder if the library doesn't have it)
- only messages and media the library doesn't have yet are added, and photos the library is missing for messages it already has are filled in
- each copied file's SHA-256 is checked against the one its export recorded, and any mismatch is logged
- the originals aren't changed

A chat new to the library shows as *Unfinished* ("Not yet read from Messages") until a backup reads it in full from Messages, since an older export may have stopped short of the first message. **Add them to my backup list** after an import makes that one click.

**Getting a phone backup from Google Drive:** download it in your browser and wait until it's finished; it should be the backup's full size (gigabytes with photos). For a big file Drive first says it can't scan it for viruses: click **Download anyway**. An empty (0 bytes) or half-downloaded file is refused with a message saying so; download it again.

**A phone backup** made with the Android app (**Bring in files…**, the `.tar` file the app saved, and its updates file too if you use one: pick both, and the big one goes in first; see [Back up a phone with the Android app](#back-up-a-phone-with-the-android-app)):
- each chat joins the chat in your backup with the same phone numbers (from its contact card, or its name if it's named by a number), however the numbers are written; one your backup doesn't have becomes a new chat, named as on the phone
- a phone message counts as already there when your backup has one from the same side, in the same minute (or the minute either side), with the same text, or a photo for a photo; so nothing is added twice, even where Google Messages for Web showed a photo and its caption as two messages
- received messages take the names your backup already uses for those people; phone messages keep their exact time and the phone's message number
- photos come in as the phone has them, with checksums like any other
Phone backups are quick: years of texts come in in seconds. Chats from a phone backup show as **From phone**, not unfinished. Its starred contacts (Android's Favorites) and contact photos come along, so those chats come first in lists and show their photos. A phone backup made without photos lists where its photos were: they show as *not fetched yet*, and come in when the phone backup is updated with photos and brought in again, or when the extension backs up that chat from Google Messages with photos on.

**Backing up from Google Messages after a phone backup:** each message on the page recognises the phone's copy of it (same side, within a minute, same text or photo), takes Google's message ID from then on, and gets its missing photos if photos are on. A photo and its caption that the web shows as two messages both match the one phone message. Messages the phone never stored (some sent chat messages, during Google's bug) match nothing and are added. A chat that came only from the phone is found by its name, or by its number however it's written.

## What's saved for each message

Everything Google Messages for Web shows, so the conversation can be archived or recreated:

- Google's message ID, the sender, sent or received, the time (normalised, with its precision and the exact text shown) and the date heading above it
- the text, any reply quote, and the full on-screen accessibility label
- **delivery status** (sent, delivered, read, failed), **reactions** and who sent them, and whether it was **edited**; these are kept up to date if they change later
- **link and map previews** (address and title), every **link**, and non-photo **attachments**
- how the message is built (its parts, such as text, photo, reply) and its page attributes
- each photo, GIF, video and voice note: its file, size, where it came from and its SHA-256
- optionally, the message's exact page markup (Settings → Advanced)

And for each conversation: its **events** ("Alice named the group…"), the contact card (names, numbers, photos, encryption), and what the page said about it (group or not, RCS or SMS/MMS where Messages shows it).

## Photos: the master list

Every photo, GIF, video and voice note in a chat is listed in the chat's `media-index.json` (and `media-index.csv` for spreadsheets), with its status:

| Status | Meaning |
|---|---|
| Full size | Saved from Google Messages' full-size viewer, or the chat picture was already full size |
| Thumbnail | Saved at the size shown in the chat; can be upgraded later |
| Saved as sent | GIFs, videos, audio and other files, saved exactly as Messages has them |
| Not fetched yet | Listed, not saved yet (a speed run, or a backup that stopped) |
| Couldn't be saved | Tried and failed; the reason is noted |
| Not saved (by choice) | Link-preview pictures from other websites, unless you allow them in Settings |
| Left out (another copy kept) | A GIF's still picture, or a second copy of a photo in the same message |

The list also has each file's name, size in pixels and bytes, SHA-256, where it came from, and when a thumbnail was upgraded. Because the backup knows exactly which photos still need work, it doesn't have to search the chat again for everything:

- **Speed run.** Choose **Speed run** when a backup asks to start, or in "Back up everything". Every message is saved, and every photo is listed but not fetched. The chat shows "Messages saved, photos to fetch".
- **Fetch photos later.** The popup's **Fetch N photos** goes back in the chat only as far as the oldest photo still to fetch, saves just those, and retries ones that failed. Settings → Backups → **Fetch … photos** does it for every chat at once (and **Retry failed photos** for failed ones), and each chat's ⋯ menu does it for that chat.
- **Upgrade thumbnails later.** Backed up without full-size photos? **Upgrade N to full size** opens each thumbnail in Messages' viewer, saves the full-size photo and removes the thumbnail. Its details are kept in the list ("upgraded from a 512×384 thumbnail on 2026-10-25").
- **Check every photo** (Settings → Tools) opens every saved photo and video and checks it's there, unchanged (SHA-256) and the size the list says. If any have gone missing, **Fetch the missing ones again** gets just those back, at the size they were.

The viewer's Media tab can show each status too, including the ones without a file.

## Labels and folders

In the viewer, **🏷 Labels** above a chat (or the 🏷 beside a message's time) lets you label whole chats or single messages: **Favorites, Family, Friends, Work, Important, Spam**, or labels you add yourself (start a name with an emoji to give it that icon). Each label becomes a **folder** above the chat list; chats labelled **Spam** are kept out of "All chats". Search can filter by label, and search results exported as CSV include them.

Labels can be added or changed at any time after a backup: in the viewer, from the popup's **🏷 Labels and flags…** on an open chat, or in the viewer's **Review** tab. They're saved in your backup folder (`labels.json`, with your flags and notes) when you open it with **Open my backup**, so they're there next time and in the folder's own `index.html`. They're your notes, so they aren't part of the checksums, and a backup never changes them.

## Deleting a chat from your backup

In Settings → Backups, a chat's ⋯ menu → **Delete from backup…** (or the bin icon above a chat when you use **Open my backup**) takes that conversation out of your backup, after asking. It never touches Google Messages or your phone.

- Its files are moved into `removed-chats/<date>/` in your backup folder, so it can still be recovered until you delete that folder.
- The backup's index, checksums and log are updated, and the deletion is recorded in `export-info.json`.
- **Don't back it up again** (ticked by default) takes it off the chats kept up to date and makes "Back up everything" skip it; it then doesn't count as missing in the coverage check. Backing it up yourself from the popup brings it back.

Single messages can't be deleted, so each chat stays a faithful copy.

## Conversations from other apps

Your archive can hold your chats from other apps too, beside your text messages: **WhatsApp, Telegram, Discord, Instagram, Messenger and TikTok**. Each app has its own way to export your chats; Settings → *Tools* → **Bring in conversations** → *Where each file comes from* lists them. Then:

1. In Settings → *Tools* → **Bring in conversations**, click **Bring in files…** and pick what the app gave you: WhatsApp's chat .zip (or .txt), Telegram's export folder or result.json, Discord's package.zip, Instagram's or Facebook's download .zip (and Messenger's download of its encrypted chats), or TikTok's .zip or .json. For an export you've unzipped, or a folder of WhatsApp chats, use **Bring in a folder…**. A download that came in several parts: unzip them all into one folder and bring in the folder.
2. It says what it found (chats and messages) before adding anything. If the export doesn't say which name is yours (a WhatsApp group, say), it asks **Which one is you?** once per app, and remembers.
3. The chats join your archive under `conversations/<App>/` in your backup folder, with status **Imported**. Photos and videos come too when the export has them; ones it left out are listed as not saved.

Good to know:
- **Bring in a newer export later** and only what's new is added. Every message keeps the app's own ID (or a stable stand-in), so nothing is added twice.
- **Each app's chats stay separate**: your texts and your WhatsApp chat with Alice are two conversations. So are **texts from a second number**: a phone backup from another phone (or a work number) is kept apart, labelled "Google Messages · <its number>". The phone backup says its own number when the phone knows it; if your archive already has texts and doesn't know their number yet, Settings asks once whether they're from the same number. The viewer links them: a chat's header shows **Also in WhatsApp · Telegram**, and **All apps** in the chat list shows one app at a time.
- **Discord's data package has only the messages you sent**, never other people's, and its attachments are links to Discord's servers. Those chats say so.
- WhatsApp caps how much one export holds; a very long chat may come in partly.
- **Messenger's end-to-end encrypted chats** (most chats since 2024) aren't in Facebook's "Download your information". Download them in Messenger on a computer: Settings → Privacy & safety → End-to-end encrypted chats → Message storage → **Download secure storage data**, and bring in that .zip too. Choose **JSON** for Facebook's and Instagram's download; the HTML version can't be read.
- Other apps' chats can't be backed up from Google Messages or restored to a phone; those are for text messages.
- **iMessage and Signal** aren't supported yet.
- **Settings → Apps** has a card for each app: how to get its export, what your archive has from it and when it last came in, and **Bring in … files…**.
- **From your Android phone:** share a chat to the Message Archivist app from WhatsApp (⋮ → More → **Export chat** → Message Archivist), or a download you got on the phone from Facebook, Instagram, TikTok or Discord (or use **Add a file…** in that app's section of the app). It goes into your next phone backup and comes in with it, so you needn't move each export to your computer.

## Codes and spam

The viewer keeps chats of **verification codes**, **promotions and spam**, and **other automated texts** (alerts and deliveries from short codes and business names) out of All chats, People, Search, Media and Analysis. They're in folders of their own above the chat list: 🔑 Codes, 📣 Promotions and 🤖 Automated. **Show them everywhere** puts them back in.

- Each chat is judged by who sent it and what came in. A group, a chat you've labelled, and a chat you've talked in (three messages of yours, or any reply to a contact) are never one of these.
- Got one wrong? Open the chat and click **It's not** beside what it says it is (in "Open my backup"). It stays with your chats from then on.
- **To leave them out of your archive altogether**, go to Settings → *Leave out of your archive* and tick verification codes, promotions and spam, or other automated texts. "Back up everything" then skips those chats, and so does **Bring in files…**. Backing up one chat yourself, and your automatic backup list, still save what you chose.
- **Find the ones already in my archive…** lists the chats already saved and, if you click **Move them out of my archive**, moves them into the `removed-chats` folder in your backup folder. Delete that folder to remove them for good. "Back up everything" leaves them out from then on, unless you untick the box again.

## People

The viewer's **People** tab shows everyone you have a one-to-one chat with, and puts each person's chats together across apps, accounts and numbers.

- Chats that share a **phone number** (your texts and WhatsApp with the same number), an **email address** or an **app username** (one Telegram contact seen from two accounts) are one person by themselves.
- Chats with only the **same name** are suggested: the button above the list ("3 pairs of people have the same name…") shows each pair with **Same person** and **Not the same**, and a button to join them all.
- On a person's page: **Rename…**, **Same person as…** (type a name, number or handle), and **Not them** beside a chat to take it off. The page lists their chats and groups and has one timeline of every message between you, newest first.
- Each one-to-one chat's header says who it's with (click the name for their page), where else they are, and, with a dashed outline, chats that may be them.
- Changes are saved in your backup folder (`people.json`, `people.js`) from **Open my backup**; the folder's `index.html` shows them but can't change them.

## Obsidian

Settings → *Tools* → **Obsidian** → **Write the notes** turns your archive into an Obsidian vault. In Obsidian, choose **Open folder as vault** and pick your **backup folder itself** (not the Obsidian folder inside it, or photos won't show).

- `Obsidian/Message Archivist.md` is the place to start; `People/` has a note per person, `Chats/` a note per chat (by app), each with its messages: a short chat in its own note, a longer one a note a year, a busy year a note a month. Photos and videos are shown where they were sent, from the chats' own folders.
- `Calendar/` has a note a year (months, people of the year, new people, what was talked about, events, busiest days) and a note a month, day by day: who you talked to that day, each a link to that day in the chat, its photos and what happened. `Events.md` has the events found in your messages: your birthday and a calendar of everyone's (from your contacts, or from birthday wishes), milestones (congratulations, with a guess at what for), travel, photo days, holiday greetings and who you meet up with. `Photos/` has every photo and video by day, across chats.
- A person's note starts with the gist (how much you talk, who sends more, how fast you each reply, who starts your conversations and what you talk about), then their chats, the **moments** (first message, busiest day, longest conversation, longest streak, longest silence, most recent: each a link to that day in the messages), the years in a table, when you talk, their **connections** (people named in your chats, people whose chats name them, people they're in groups with), its **events** (a likely birthday, meeting up, milestones, travel, photo days, holidays), and what you've shared: `People/<name>/<name> photos.md` and `… links.md`; `… timeline.md` has everything notable with them, year by year. A group chat's note starts with who talks most in it and its events.
- **Your whole address book** comes with a phone backup made with *Save all my contacts* on (the Android app's Settings): People uses it to tie chats from every app to the right contact (by number or email, and in texts, WhatsApp and Signal by a name only one contact has) and to name them as on your phone; it's kept as `contacts.json`.
- From a phone backup, a person's note also has what your phone's contacts know: their photo, starred, nickname, company and job title, birthday (with how many of their birthdays you were in touch on), labels (each a note in `Labels/`, linking everyone with it) and relations (linked when they're in People). A contact's other numbers and emails also join their chats into one person.
- `Topics/` has a note for each word or phrase that stands out in your chats with more than one person (or group chat), linking them, with when it first and last came up and the day it came up most; `Topics.md` lists them. `People.md` lists who you've talked to most recently and who you've lost touch with. People you've never written to are **one-way** (tagged `one-way`, listed apart, and left out of topics, mentions and those lists): filter the graph with `-tag:#one-way` to hide them.
- Notes have properties for Obsidian (and Dataview): a person's numbers, handles, apps, message count, sent and received, conversations and who starts them, topics, connections and first and last dates; a chat's app, people, labels (as tags) and dates.
- **Keep them up to date after every backup and import** writes only what changed. Anything you write below the "Your notes" line of a person, chat, topic, year or month note stays; the message notes are rewritten when their messages change. Calendar notes link to many people: filter the graph with `-path:Obsidian/Calendar` to see people and topics alone.
- A chat removed from your backup takes its notes with it, unless you wrote in them.
- **Delete the notes…** deletes the whole Obsidian folder after two confirmations (the first says how many notes you've written in and any files of your own in it). It can't be undone; your backup isn't touched, and *Write the notes* makes them again, but not what you wrote. It also turns off "Keep them up to date" (in the app, turn off the extension's switch too).

## The app

The same Settings page and viewer can be an app of their own: open [trikhster.github.io/message-archivist/app](https://trikhster.github.io/message-archivist/app/) in Chrome or Edge and click **Install** in the address bar. It opens in its own window with its own icon, works offline, and does everything with your archive except backing up Google Messages, which stays here in the extension.

- **Choose the same folder** this extension saves to. The app asks for access to it once, by itself (the extension's permission is the extension's); choose **Allow on every visit**.
- **Its settings and past runs are its own.** The backup folder is what's shared; both write their logs into its `logs/` folder.
- **Open a phone backup with it** (Finder or Explorer → Open with → Message Archivist) to bring it in.
- When a new version is ready it says so; it starts the next time you open the app, or at once with **Restart now**.

## The Android app

Message Archivist also comes as an Android app that backs a phone's texts up into one file, keeps that file up to date, and puts backups back into a phone's messages. Download `message-archivist-android-v<version>.apk` from the newest release on the project's [Releases page](https://github.com/trikhster/message-archivist/releases) on the phone and open it (Android asks to allow installing apps from your browser or Files). Every release is signed with the same key, so later versions install over it.

### Back up a phone with the Android app
1. Open Message Archivist on the phone and tap **Back up this phone**. Allow it to read your texts (and contacts, so chats have names).
2. It shows how many messages, chats and photos there are. Leave **Include photos and videos** on for a complete copy (or turn it off for a small, quick file and add the photos later), tap **Save backup** and choose where: Downloads, Google Drive, anywhere the phone offers.
3. When it's saved, turn on **Back up automatically** to keep that file up to date by itself, and **Share** sends it anywhere you like.

**Other apps' chats on the phone.** Below Google Messages, the app has a section for WhatsApp, Messenger, Instagram, TikTok and Discord. Share an export to Message Archivist (WhatsApp: open a chat → ⋮ → More → **Export chat**; the others: share the .zip you downloaded) or tap **Add a file…** in its section: it waits there until your next backup, goes into the backup file, and comes into your archive when you bring that file in on your computer. **Remove** takes one that's still waiting back out.

**Settings** (the gear on the app's first screen): **Back up by itself** on or off, which file (on the phone or online), how often (every hour, 6 hours, 12 hours, day or week, or a custom number of hours or days, from 1 hour to 30 days), photos, only while charging, only on Wi-Fi, and a notice after each backup. The first screen says whether your texts are backed up, when, and to where.

**Updating a backup.** **Update a backup instead…** (on the screen before Save) picks a backup made before and adds only what's new: the messages since, and its photos if it was made without them and **Include photos and videos** is on now. Messages deleted from the phone since stay in the backup. A daily backup does the same, about once a day in the background when the battery isn't low (and, for a file on Google Drive, on Wi-Fi); the app's first screen shows how the last one went, with **Back up now** and **Turn off**. On the phone's own storage an update adds to the file in place in seconds; Google Drive can't add to a file, so a backup there would be copied to the phone, updated and uploaded whole each time. **Upload less: a small updates file** (Settings, for a file online) avoids that: runs write only what's new into a small second file beside it, and the big file catches up now and then. Bring in (or restore) the big file first, then the updates file; anything already there is skipped.

**Then on your computer:** Settings → *Tools* → **Bring in files…** (see [Bringing in earlier exports and phone backups](#bringing-in-earlier-exports-and-phone-backups)). Bring the file in again whenever you like; only what's new is added.

Backing up doesn't change your SMS app. Chat (RCS) messages are included as Google Messages stores them on the phone; at the moment it doesn't store some that you send, so those are only in a backup made with the extension, which adds them next time it backs up those chats.

### Put your texts back on an Android phone

1. **Have a backup file:** one made with **Back up this phone** (above), or make one here: in Settings → **Phone restore**, click **Make the restore file**. It writes `restore-to-phone/restore-<date>.tar` in your backup folder: every chat with a phone number, its messages in order, and its photos and videos. The tab shows beforehand which chats have no phone number yet (with a button to back them up again, which saves their contact cards). Years of texts and photos are fine: the file is written a little at a time.
2. **Install the Android app** on the phone (above).
3. **Copy the file to the phone** (USB, Google Drive, …), open Message Archivist on the phone and **Choose restore file**. It shows what's in the file and roughly how long it takes; every chat is ticked, so untick any you don't want, then tap **Restore**.
4. Android asks to make Message Archivist your **SMS app**: say yes. Only the SMS app may add messages, so it needs to be, for the length of the restore. A progress notification shows how it's going; you can leave the app. Texts that arrive meanwhile are kept. A picture message arriving meanwhile is fetched by Google Messages afterwards.
5. When it's done, tap **Switch back to Google Messages** and accept when it asks to be your SMS app again (or Settings → Apps → Default apps → SMS app).

Good to know:
- **Nothing is added twice.** Messages already on the phone are skipped, so you can restore again after a stop, or restore a newer file later.
- **Group chats** need your own phone number in each message you received; the app reads it from the phone, or asks you to type it if the phone doesn't know it.
- **Times** are to the minute, as Google Messages shows them; messages sent in the same minute keep their order. (A phone backup's times are exact.) **RCS** chats go back as ordinary texts and picture messages. iPhones can't import texts.
- **Using SMS Backup & Restore instead?** The Phone restore tab can also make its XML file (under "Using SMS Backup & Restore instead?").

## Contact cards

For every chat, the extension opens Google Messages' **Details** page and saves:
- each participant's name and number
- their contact photo, at the size Messages shows it (80×80)
- whether the chat is end-to-end encrypted

These are saved as `contact.json` and `contact/<name>.png` in the chat's folder. In the viewer, the photos replace initials, numbers appear in the chat header, and the About tab lists every contact card.

## Settings

Settings has five tabs.

- **Home:** a plain answer to "Am I backed up?": how many chats and messages, when it last saved, which chats aren't finished (**Finish them now**), photos still to fetch (**Fetch them now**), and after "Back up everything" whether every conversation in Google Messages is in the backup. Buttons: **Open my backup**, **Back up everything…**, **See every chat**. Until there's a backup, Home shows the three setup steps.
- **Backups:** every chat, in one list: the ones in your backup and the ones set to back up by themselves. Each row shows the chat's messages and dates, its status (Verified complete, Complete, Messages saved, photos to fetch, Unfinished, Needs attention, Not backed up yet, Folder missing), its photos by status, and **By itself** (Off, when you click "Back up automatic chats now", every hour, 6 hours, 12 hours, day or week). **Back up** / **Continue** runs it now; ⋯ has **Fetch photos**, **Upgrade to full size**, **Open in my backup** and **Delete from backup…**. Click a row for its checks and the evidence. Filter by Needs attention, Unfinished, Photos to fetch, Thumbnails or Backed up by itself, or search by name. Above the list, the fix-it buttons that apply: **Continue … unfinished**, **Back up … not backed up yet**, **Fetch … photos**, **Upgrade … thumbnails**, **Retry failed photos**. **Add chats…** ticks several chats from your conversation list; **Back up automatic chats now** runs every chat set to back up by itself.
- **Phone restore:** the SMS Backup & Restore file (see [Put your texts back on an Android phone](#put-your-texts-back-on-an-android-phone)).
- **Tools:** **Check no files have changed** (recomputes every file's SHA-256 and reports anything changed or missing), **Check every photo** (every saved photo against its chat's master list), **Find duplicate photos** (pictures earlier versions saved twice in a message, and leftover identical files; the extra copies move into `removed-duplicates/<date>/`, nothing is deleted), **Bring in conversations** (**Bring in files…** or **…a folder**: phone backups from the Android app, other apps' exports and older exports, each recognised by itself), and **Past runs**: the last 30 runs; open one to see its full log.
- **Settings:** **Basic**: backup folder, photos on or off, photo quality (full size, or as shown in the chat), what happens to Google Messages' window during a backup (small window in a corner, a window of its own, or left where it is), notifications, theme. **Advanced**: the corner, patience (how long to wait for older messages), full-size photos while older messages load, reading each chat twice in "Back up everything", link-preview pictures, keeping each message's page markup, where date-range zips go, and a case reference for legal use.

### First-time defaults
Everything a later restore to a phone needs is on from the start: photos, at full size, and each chat's contact card with its numbers. Google Messages works in a small window in the corner during backups, a notification says when one finishes, and the restore file includes photos. Settings from 0.4.x are carried over where they were changed on purpose.

### Logs for troubleshooting

Each run's log (`logs/` in the library, and Recent runs) starts with the options used, the window size, whether Chrome was online, where it saved and the totals. Besides what the progress panel shows, it has lines marked `DEBUG`: the state of the page when each chat starts, every loading pass (how long it waited, messages on the page before and after, whether Messages' spinner was showing, the scroll position, whether the tab was hidden), why each photo couldn't be fetched (which website, what came back), errors on the page, each chat's checks, and how long the contact card, history, media and checks took. Message text isn't included beyond what the panel shows.

## What the library contains

```
My Messages Backup/                    (the backup folder you chose)
  index.html, viewer.js, library.js,   the offline viewer and its theme
  theme.*
  data.js                              a summary of every chat, read by the viewer
  messages.csv                         every message of every chat: IDs, times, senders, text, replies, media and their SHA-256
  verification.json                    each chat's status and problems, and which conversations in Messages aren't backed up
  export-info.json                     tool version, browser, timezone, case note, and a record of every backup and import
  backup-state.json                    the conversation list and progress of "Back up everything"
  logs/2026-10-23 14.26.41 - backup.txt   the full log of each run
  SHA256SUMS.txt                       a SHA-256 checksum for every file
  labels.json, labels.js               your labels, flags and notes (not in the checksums)
  people.json, people.js               who's who, from the People tab (not in the checksums)
  Obsidian/                            notes for Obsidian, if you write them (not in the checksums)
  conversations/
    Mom/                               named after the contact, or the number if not a contact
      messages.json                    everything per message (see below); compact JSON, any JSON viewer formats it
      progress.json                    how far the backup has got, the evidence it reached the first message, and its checks
      media-index.json, .csv           every photo and video with its status (the master list)
      journal/                         messages saved during a run, before they're folded into messages.json (removed when done)
      chat.js, messages.csv            this chat for the viewer, and as a spreadsheet
      contact.json, contact/Mom.png    contact card: names, numbers, photos, encryption
      media/2026-10-03 14.05 - Mom.jpg
```

A backup only rewrites the files of the chats it changed, plus the small summary files, so saving stays quick however big the library gets.

For each message, `messages.json` keeps:

- Google's message ID
- the sender, and whether it was sent or received
- the normalised timestamp, its precision, and the exact time text the page showed
- the text, and any reply quote
- the on-screen accessibility label, word for word
- for each photo or file: its name, dimensions, size in bytes, source (full-size viewer or chat thumbnail), SHA-256, and any copies left out

### Verifying a copy

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Run that inside the backup folder. Every file listed should report `OK`; anything changed, corrupted or missing is flagged. Each backup and import adds new files to the list and keeps the earlier checksums for files it didn't touch.

## The viewer

Click **Open my backup** in the popup, or open Settings: it opens on your backup, with its views (Chats, People, Contacts…) and the rest of Settings in one menu down the left. **Contacts** shows everyone as a circle with their name or number below; click someone for every chat with them. The same viewer is also saved in the backup folder as `index.html`, which works offline straight from disk, without the extension.

- **Lists:** every list of chats and people puts favourites first (pinned in Google Messages, a starred contact on your phone, or labelled Favorites), then names A–Z, then chats known only by a number; numbers are shown one way everywhere, such as (555) 020-0001.
- **Chats:** the conversation list, find-in-chat, people filters, media only, jump to a month, and a Google Photos-style month/year scrubber. Hover a time to see the raw timestamp and the message ID. As in Google Messages, a run of messages from one person in the same minute shows its time once, under the last one; reactions show as a small pill under the message, including the ones a phone saves as texts (`❤️ to “See you soon”`, `Loved “…”`), which are shown on the message they're about rather than as messages. Long chats are drawn a month at a time as you scroll, and photos are read from the backup folder only when they come near the screen, so a chat of years of daily texts opens quickly.
- **Search:** searches every chat for words (which also find longer words: *photo* finds *photos*), or a word or phrase in quotes for whole words only (*"now"* doesn't find *know*).
  - Filter by chat, person, sent or received, media, replies, links, day of week, hour, or date range.
  - A matches-per-month chart sits above the results; click a month to narrow the search to it.
  - **Export CSV** saves the results.
- **Media:** a gallery grouped by month. The photo viewer shows dimensions, status, source and SHA-256. Filter by status (full size, thumbnails, not fetched yet, couldn't be saved, left out…), with how many there are of each; the ones without a file show as a placeholder that opens the message in the chat.
- **Review:** everything you've flagged or labelled, in one place: flagged messages with their notes first, then each label with its chats and messages. Filter by flag or label, chat or words; change flags, notes and labels right there; click a message to see it in the chat. **Print / PDF** and **Export CSV** work on what's shown.
- **Analysis:** filter by chat, person and period (All time, Last 7 days, Last 30 days, Last 3 months, Last 12 months, This year, Last year, Custom).
  - **Summary cards:** totals, active days, busiest day, longest streak, words per message, typical reply times, who starts conversations.
  - **Messages per month** and a **Weekly breakout** (Monday-start weeks).
  - **Year in review:** a calendar of every day of the year, with the year's highlights.
  - **Day of week × hour** heatmap.
  - **People** table: messages, share, words, media, conversations started, typical reply, first and last message.
  - **How fast replies come**, **Longest silences**.
  - **Mentioned:** websites, email addresses and phone numbers.
  - **Most used words and emoji.** Clicking a word finds that whole word; a reaction sent as a text counts as its emoji, not as the words it quotes.
  - **Everything is clickable:** a bar, day, square, person, silence, link or word opens exactly those messages.
- **About:** the library's details, how complete it is (each chat's status, and the coverage of conversations in Messages), how to verify it, the history of every run, and each chat's Google conversation ID. Unfinished chats are also marked in the chat list.

### Reviewing and reporting

- **Flag messages:** click ☆ beside a message's time to flag it, with an optional note.
  - Flagged messages are outlined, and "★ n flagged" in the header opens them in the Review tab; Search also has a "Flagged ★" filter.
  - With **Open my backup**, flags and notes are saved in your backup folder (`labels.json`), so they stay with the backup; flags made in this browser before 0.4.5.0 are moved there the first time. The folder's own `index.html` shows them, and keeps any you add there in that browser. They're included in CSV exports and printouts.
- **Print or save as PDF:** the print button in a chat, or **Print / PDF** in Search or Review, makes a paginated report with:
  - a header: the chat, participants and numbers, date range, archive details, case reference, and print time and timezone
  - every message, with its photos, replies and flags

  Choose "Save as PDF" in the print dialog.
- **Share flags:** on the About tab, **Export flags…** saves your flags and notes to a file, and **Import flags…** loads someone else's. Messages are matched even if the other person's copy of the archive was made separately, and notes on the same message are merged.
- **Context in search:** tick "Show surrounding messages" to see the two messages before and after each match.
- **Keyboard shortcuts** (press <kbd>?</kbd> in the viewer):

  | Key | Action |
  |---|---|
  | 1–6 | Switch tabs: Chats, Search, Media, Review, Analysis, About |
  | / | Search |
  | n / N | Next / previous match in the chat |
  | j / k | Next / previous chat |
  | p | Print |
  | t | Light / dark theme |

### Analyze without saving

**Analyze without saving** in the popup reads the open chat (text only, with your date range) and opens the same viewer over the Messages page. Close it to get back to Messages; nothing is written to disk.

## Photos and resolution

Files are saved byte for byte, exactly as Messages for Web has them, never re-compressed. Each one is checked by its first bytes to confirm it really is a photo, video or audio file. Anything else (such as a web page served in place of an image) is retried and then logged, never saved as a broken file.

**One copy of each picture.** Messages sometimes shows the same picture twice in a message: a GIF and its still preview, or a small thumbnail beside the full-size photo. The exporter compares the pictures in each message by what they look like (a tiny fingerprint that's the same at any size, so two different photos never match) and keeps only the best copy: the GIF over its still frame, otherwise the larger picture. Pictures in link and map previews are saved as "preview" media and never opened. A link preview's picture usually lives on the linked website (Spotify, TikTok, a news site…), which the extension isn't allowed to read by default, so it's noted as *not saved* rather than failed. To save those too, tick **Save link and map preview pictures from other websites** in Settings → Advanced → *Link-preview pictures* (Chrome asks to let the extension read any website; it's only used for those pictures), then use **Fetch photos** in the popup or **Retry failed photos** in Settings. With **Full-size photos** on, the larger of the chat thumbnail and the full-screen viewer image is kept, and `messages.json` records which one it was. RCS photos usually arrive full size. SMS/MMS photos, including texts from businesses and short codes, are shrunk by the carrier before they reach your phone, so the small copy is the only one that exists.

## Limitations

- Messages for Web loads history from your phone, so the phone must stay online.
- Archived chats aren't in the main list. Open them and export each one directly.
- A date-range zip is limited to 4 GB and 65,535 files. Backups into the folder have no such limit.
- Scheduled jobs need a messages.google.com tab open and Chrome running.
- If an export comes out empty or wrong after a Google update, use **Copy page diagnostics** in the popup. It copies the page structure with message text masked, which shows what changed in Google's markup.
