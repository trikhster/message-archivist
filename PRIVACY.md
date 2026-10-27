# Privacy policy

Message Archivist's Chrome extension runs entirely in your browser.

- **No data leaves your computer.** The extension has no server, analytics, tracking or advertising. It never sends your messages, contacts, photos or settings anywhere.
- **What it reads:** only the messages.google.com tab you're using, and only while a backup, analysis or scheduled job runs. That includes each chat's Details page: participants' names, numbers and contact photos, and whether the chat is end-to-end encrypted.
- **What it writes:**
  - files in the backup folder you choose and allow access to (messages, photos, each chat's list of photos, contact cards, logs, checksums), including pieces saved during a run (`journal/`) that are removed once they're folded in
  - date-range copies you ask for, downloaded as zip files
  - its own settings and run history (including run logs), kept in Chrome's local extension storage on your computer
- **Other apps' exports:** when you bring in an export from WhatsApp, Telegram, Discord, Instagram, Messenger or TikTok, the extension reads the file or folder you pick, on your computer, and copies its chats and media into your backup folder. It never signs in to those apps or contacts them; it remembers which name is yours in each app (in Chrome's local extension storage) so it needn't ask again.
- **What it opens:** "Open my backup" reads your backup folder to show it, and saves the labels, flags and notes you add there (`labels.json`); nothing is uploaded. "Check every photo" in Settings only reads your backup folder. "Make the restore file" writes a file for SMS Backup & Restore into your backup folder; it only goes to a phone if you copy it there.
- **The Android app** reads only the restore file you choose and writes its messages into the phone's messages. It has no internet permission and sends nothing anywhere. While it restores it is your SMS app (Android requires that to add messages); it saves texts that arrive meanwhile to your inbox, reads the phone's own number (for group chats) and shows notifications. It keeps nothing after the restore. When you **back up the phone** with it, it reads the phone's texts and picture messages (and, if you allow it, your contacts: names, whether they're starred, and their photos, for the chats in the backup) and writes them into the file you choose; that file stays wherever you save or share it. Backing up doesn't make it your SMS app. If you turn on automatic backup (**Back up automatically** after a backup, or **Back up by itself** in its Settings), it does the same in the background as often as you choose (from every hour to every 30 days), into the file you chose (if that's on Google Drive, the Drive app uploads it; the app itself still has no internet access). If you bring such a file into the extension (Settings → Tools), the extension reads it on your computer and adds its messages and photos to your backup folder; nothing is uploaded.
- **Deleting a chat** from the backup moves its files into `removed-chats/` in your backup folder; delete that folder to remove them for good. Google Messages and your phone aren't touched.
- **Windows:** to keep working while you use Chrome, a backup can move the Google Messages tab into its own window (and, if you choose, make that window small and move it to a corner of the screen), and a scheduled backup can open Google Messages in a window and close it afterwards.
- **Logs:** each run's log, kept in the backup folder and in Settings → Past runs, includes chat names, contact names and numbers, times and file names, but not message text. "Copy log" only copies it to your clipboard; you decide whether to share it. Remove anything private before posting it publicly.
- **Diagnostics:** "Copy page diagnostics" copies the page's structure to your clipboard with all message text masked. It isn't sent anywhere.

## Permissions and why they're needed

| Permission | Used for |
|---|---|
| Access to messages.google.com | Reading the conversation you're backing up or analysing. |
| Access to googleusercontent.com, google.com, googleapis.com, gstatic.com | Downloading the photos, videos and map previews Messages shows in the chat. |
| Access to other websites (**optional**, off unless you turn it on in Settings) | Downloading the pictures in link previews (Spotify, TikTok, news sites…). Used only for those pictures. |
| storage, unlimitedStorage | Saving your settings, schedules and run history locally. |
| downloads | Putting date-range zip files into the Downloads subfolder you choose. |
| alarms | Checking every 15 minutes whether a scheduled backup is due. |
| notifications | Telling you when a backup finishes, if you turn that on. |
| scripting, activeTab | Starting the exporter on a Messages tab that was open before the extension was installed or reloaded, and stopping that page opening new tabs while a backup runs. |

Questions or concerns: [open an issue](https://github.com/trikhster/message-archivist/issues) on GitHub. Please don't include message content or contact details.
