# Security

Please report security problems privately using GitHub's
**Security → Report a vulnerability** on this repository, rather than in a public issue.

This includes anything that could expose message content, write outside the
folder the user chose, or let a web page other than messages.google.com send
commands to the extension; and, in the Android app, anything that
lets another app read, change or send your messages through it, or makes a
backup or restore touch something other than the file you chose.

Only the newest release is supported. The project is pre-production (versions
0.x). Each release's notes give the SHA-256 of the extension zip and the APK
and the fingerprint of the key the APK is signed with; an APK signed with
another key isn't from this project.

Fixes are released as patch versions and noted in [CHANGELOG.md](CHANGELOG.md).
