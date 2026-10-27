---
tags: [research]
updated: 2026-10-26
---
# Android direct connection (research)

**Question:** could the extension read messages straight from the Android phone, instead of scrolling Google Messages for Web, to make backups faster?

## Findings
- **ADB over USB from Chrome is possible.** Tango (ya-webadb) is an ADB client in TypeScript that runs in Chromium over WebUSB. It needs USB debugging on, the user to pick the device, and no desktop `adb` server holding it. It would have to be bundled (this project has no build step or dependencies).
- **But ADB can't read the messages.** `adb shell content query --uri content://sms` fails: the SMS/MMS provider requires `READ_SMS`, which the shell user doesn't hold, and Google treats that as intended. Only a rooted phone, or an app that holds the permission, can read it.
- **An app on the phone can.** Google Messages stores RCS chats in the phone's SMS/MMS database as MMS, so an app with SMS access sees SMS, MMS and RCS. That app already exists: **SMS Backup & Restore** (SyncTech) backs everything up to an XML file in minutes, with exact timestamps and phone numbers. Since mid-2026 a Google Messages bug stops *outgoing* RCS messages being written to that database, so they're missing from phone-side backups until Google fixes it; Google Messages for Web still shows them.
- Writing our own Android helper app (installed with ADB, then queried) would duplicate SMS Backup & Restore, need SMS permissions that Android restricts, and need distribution outside the Play Store.

## What was decided (2026-10-26)
The owner chose to **build our own Android app** instead of relying on SMS Backup & Restore: [[Android app]], restoring from our own [[Restore package]]. Restore first; then (0.5.0.0) the same app backs a phone up too, with `READ_SMS` alone (no SMS role needed), into the same format. The extension brings that file into its library (Settings → Tools → Bring in a phone backup…): the fast first backup described below.

## Original recommendation
Don't connect to the phone directly. Instead, **import SMS Backup & Restore's XML** into the library:
1. On the phone, SMS Backup & Restore makes a backup (minutes, even for years of texts, with second-precision times and real numbers).
2. The extension imports it: chats matched to Google Messages conversations by phone number, messages merged by time + sender + text, photos written to `media/`, checksums and the master list updated.
3. Google Messages for Web is then only needed for what the phone file lacks (recent outgoing RCS during the Google bug, contact cards and pictures), with a normal backup that stops at messages already saved.

That makes the first backup of years of history take minutes instead of hours, and it uses the same format the restore file already writes, so the round trip phone → library → phone is lossless. Effort: a streaming XML reader (files can be gigabytes), number-to-chat matching, and merge rules for messages seen both ways. A good candidate for 5.1.

Sources: [adb-export on content://sms](https://github.com/sromku/adb-export), [SyncTech: RCS messages](https://www.synctech.com.au/faqs/rcs-messages/), [SyncTech: outgoing RCS not backed up](https://www.synctech.com.au/?p=2295), [ya-webadb](https://github.com/ckandroidproject/ya-webadb).
