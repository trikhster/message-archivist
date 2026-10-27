package io.github.trikhster.messagearchivist

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.Telephony
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.time.Instant
import java.util.TimeZone

/**
 * Backs this phone's texts and picture messages up into a package in the
 * extension's restore format (see RestorePackage and notes/Restore package.md),
 * so it can go back onto this or another phone, or into the extension's library.
 *
 * Either a new file (`previous` null), or one made before, brought up to date:
 * `out` then writes after `previous`'s entries. For each chat on the phone:
 * - new to the file: all of it, one `threads/<nnnn>.ndjson`;
 * - in the file, nothing changed among the messages it has: only the newer
 *   ones, as one more piece of the chat (`files`), so a daily backup of years
 *   of texts reads and writes only the day's messages;
 * - in the file, but older messages came along (after a restore, say) or its
 *   photos are wanted now and weren't before: the whole chat again, merged
 *   with what the file has (messages deleted from the phone since are kept,
 *   photos already in the file aren't copied twice).
 * Photos go through a temporary file (a tar header needs the size first);
 * the manifest goes last, so a stopped backup is a whole file of the chats
 * done so far.
 *
 * Needs READ_SMS; with READ_CONTACTS, chats are named as on the phone,
 * otherwise by number.
 */
class PhoneBackup(
    private val ctx: Context,
    out: OutputStream,
    private val previous: RestorePackage?,
    private val withMedia: Boolean,
    private val onProgress: (Progress) -> Unit,
    private val cancelled: () -> Boolean,
) {
    data class Summary(val sms: Int, val mms: Int, val threads: Int, val media: Int) { val messages get() = sms + mms }
    // secondsLeft: null until there's enough to go on (and for an update, which is quick).
    data class Progress(val done: Int, val total: Int, val thread: String, val chats: Int, val media: Int, val secondsLeft: Double?)
    // For an update, `added` and `mediaAdded` are what this run added; the rest are the whole file's.
    data class Result(
        val threads: Int, val messages: Int, val sms: Int, val mms: Int, val media: Int, val mediaWaiting: Int, val failedMedia: Int,
        val bytes: Long, val stopped: Boolean, val added: Int, val mediaAdded: Int, val updated: Boolean,
    )

    private val cr = ctx.contentResolver
    private val tar = TarWriter(out)
    private val contacts = ctx.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    private val people = HashMap<String, Person?>() // address -> the phone's contact for it
    private val photoFiles = HashMap<String, String>() // address -> its contact photo in the package
    private val copiedSizes = HashMap<String, Long>()
    private var total = 0
    private var done = 0
    private var chats = 0
    private var mediaAdded = 0
    private var failedMedia = 0
    private var added = 0
    private var title = ""
    private var lastTick = 0L
    private var nextMedia = 1
    private var nextPhoto = 1
    // For the time left: texts are read by the thousand, a picture message
    // takes several reads (and its photos copied), so each is timed apart.
    private var counts = Summary(0, 0, 0, 0)
    private var smsDone = 0
    private var mmsDone = 0
    private var smsNanos = 0L
    private var mmsNanos = 0L

    private class Chat(val id: Long, val addrs: List<String>)
    // A contact on the phone: their name, whether they're starred (Favorites), and their photo.
    private class Person(val name: String?, val starred: Boolean, val photo: String?)
    private class Item(val date: Long, val json: JSONObject)

    fun run(): Result {
        counts = summary(ctx)
        total = counts.messages
        // What the file has: its chats by who's in them, and the numbers to carry on from.
        val old = LinkedHashMap<String, JSONObject>()
        var nextThread = 1
        previous?.let { p ->
            val a = p.manifest.optJSONArray("threads") ?: JSONArray()
            for (i in 0 until a.length()) a.getJSONObject(i).let { t ->
                old[key(t.getJSONArray("addresses").strings())] = t
                t.optJSONArray("people")?.objects()?.forEach { pp -> pp.optString("photo").ifEmpty { null }?.let { f -> photoFiles[pp.getString("address")] = f } }
            }
            for (n in p.names) {
                Regex("""^threads/(\d+)""").find(n)?.let { nextThread = maxOf(nextThread, it.groupValues[1].toInt() + 1) }
                Regex("""^media/(\d+)\.""").find(n)?.let { nextMedia = maxOf(nextMedia, it.groupValues[1].toInt() + 1) }
                Regex("""^contacts/(\d+)\.""").find(n)?.let { nextPhoto = maxOf(nextPhoto, it.groupValues[1].toInt() + 1) }
            }
        }
        val list = LinkedHashMap<String, JSONObject>() // the new manifest's threads: the phone's, newest first, then the file's others
        var stopped = false
        for (chat in chats()) {
            if (cancelled()) { stopped = true; break }
            title = chat.addrs.joinToString(", ") { nameOf(it) ?: it }.ifEmpty { "Unknown" }
            tick(force = true)
            val k = key(chat.addrs)
            val was = old[k]
            val entry = if (was == null) newChat(chat, "threads/%04d.ndjson".format(nextThread)) else updateChat(chat, was)
            if (cancelled()) { stopped = true; break } // this chat isn't finished: it stays as it was
            if (entry == null) continue // nothing to back up in it
            if (was == null) nextThread++
            list[k] = entry
            chats++
            tick(force = true)
        }
        for ((k, t) in old) if (k !in list) list[k] = withStats(t)
        val all = list.values
        val sum = { f: String -> all.sumOf { it.optLong(f) } }
        val manifest = JSONObject().apply {
            put("format", RestorePackage.FORMAT)
            put("version", if (all.any { RestorePackage.threadFiles(it).size > 1 }) 2 else 1)
            put("created_at", previous?.manifest?.optString("created_at")?.ifEmpty { null } ?: Instant.now().toString())
            if (previous != null) put("updated_at", Instant.now().toString())
            put("tool", "Message Archivist")
            put("tool_version", BuildConfig.VERSION_NAME)
            put("source", "phone")
            put("timezone", TimeZone.getDefault().id)
            if (stopped) put("stopped", true)
            put("counts", JSONObject().apply {
                put("threads", all.size); put("messages", sum("messages")); put("sms", sum("sms")); put("mms", sum("mms"))
                put("media", sum("media")); put("media_bytes", sum("media_bytes")); put("media_waiting", sum("media_waiting"))
            })
            // Each run: when, and what it added.
            val history = previous?.manifest?.optJSONArray("history") ?: JSONArray()
            put("history", history.put(JSONObject().apply { put("at", Instant.now().toString()); put("added", added); put("media_added", mediaAdded); if (stopped) put("stopped", true) }))
            put("threads", JSONArray(all))
        }
        tar.add("manifest.json", manifest.toString(2).toByteArray(Charsets.UTF_8))
        tar.finish()
        val c = manifest.getJSONObject("counts")
        return Result(c.getInt("threads"), c.getInt("messages"), c.getInt("sms"), c.getInt("mms"), c.getInt("media"), c.getInt("media_waiting"),
            failedMedia, tar.written, stopped, added, mediaAdded, previous != null)
    }

    // A chat the file doesn't have yet: all of it.
    private fun newChat(chat: Chat, file: String): JSONObject? {
        val items = ArrayList<Item>()
        texts(chat, items, since = null)
        pictures(chat, items, since = null)
        if (cancelled() || items.isEmpty()) return null
        items.sortBy { it.date } // stable: same-time messages keep their order
        for (i in items) copyParts(i.json)
        tar.add(file, lines(items.map { it.json }))
        added += items.size
        return entry(chat, listOf(file), stats(items.map { it.json }))
    }

    // A chat the file has. See the class comment for the three cases.
    private fun updateChat(chat: Chat, was: JSONObject): JSONObject? {
        val p = previous!!
        val last = was.optLong("last")
        val before = count(Telephony.Sms.CONTENT_URI, "thread_id = ? AND type IN (1, 2) AND date <= ?", chat.id, last) +
            count(Telephony.Mms.CONTENT_URI, "thread_id = ? AND msg_box IN (1, 2) AND date <= ?", chat.id, last / 1000)
        // Photos wanted that the file doesn't have (or a file from before they were counted).
        val photosToGet = withMedia && was.optInt("media_waiting", -1) != 0 && was.optInt("mms", -1) != 0
        val files = RestorePackage.threadFiles(was)
        if (before <= was.optInt("messages") && !photosToGet) {
            done += before
            val items = ArrayList<Item>()
            texts(chat, items, since = last)
            pictures(chat, items, since = last)
            if (cancelled()) return null
            val base = withStats(was)
            if (items.isEmpty()) return describe(chat, base)
            items.sortBy { it.date }
            for (i in items) copyParts(i.json)
            val piece = files.first().removeSuffix(".ndjson") + ".${files.size + 1}.ndjson"
            tar.add(piece, lines(items.map { it.json }))
            added += items.size
            return entry(chat, files + piece, Stats.of(base).plus(stats(items.map { it.json })))
        }
        // The whole chat, merged with what the file has.
        val items = ArrayList<Item>()
        texts(chat, items, since = null)
        pictures(chat, items, since = null)
        if (cancelled()) return null
        val kept = LinkedHashMap<String, JSONObject>()
        p.messages(was) { m -> kept[msgKey(m)] = m }
        val had = kept.size
        val onPhone = HashSet<String>()
        for (i in items) {
            val k = msgKey(i.json)
            onPhone += k
            kept[k] = kept[k]?.let { mergeLine(it, i.json) } ?: i.json
        }
        val merged = kept.values.sortedBy { it.getLong("date") }
        // Photos only for messages still on the phone (a deleted one's photo is gone).
        for (m in merged) if (msgKey(m) in onPhone) copyParts(m)
        added += kept.size - had
        val bytes = lines(merged)
        val before2 = files.mapNotNull { p.bytes(it) }.fold(ByteArray(0)) { a, b -> a + b }
        if (bytes.contentEquals(before2)) return describe(chat, withStats(was))
        tar.add(files.first(), bytes)
        return entry(chat, listOf(files.first()), stats(merged))
    }

    // The same message in the file and on the phone (or another phone it was
    // restored to): the same time, direction and text.
    private fun msgKey(m: JSONObject) = "${m.getLong("date")}|${m.getInt("box")}|${m.optString("text")}"

    // The phone's version of a message the file has, with the file's photos
    // where it has them (so they aren't copied again) and its first phone ID.
    // If the file's version has photos the phone's doesn't, the file's stays.
    private fun mergeLine(old: JSONObject, new: JSONObject): JSONObject {
        val op = old.optJSONArray("parts")?.objects().orEmpty()
        val np = new.optJSONArray("parts")?.objects().orEmpty()
        if (op.count { it.has("file") } > np.size) return old
        np.forEachIndexed { i, p -> op.getOrNull(i)?.takeIf { it.has("file") && it.optString("ct") == p.optString("ct") }?.let { o -> new.getJSONArray("parts").put(i, part(o.getString("file"), p)) } }
        old.optString("src_id").ifEmpty { null }?.let { new.put("src_id", it) }
        return new
    }

    // A thread's manifest entry, with what's needed to update it next time
    // without reading it: its counts, first and last times, photos saved and waiting.
    private fun entry(chat: Chat, files: List<String>, s: Stats) = describe(chat, JSONObject().apply {
        put("file", files.first())
        if (files.size > 1) put("files", JSONArray(files))
        s.into(this)
    })

    // Who the chat is with, as the phone's contacts have them now (so a chat
    // with nothing new still gets a renamed or newly starred contact).
    private fun describe(chat: Chat, j: JSONObject) = j.apply {
        put("title", title)
        put("addresses", JSONArray(chat.addrs))
        put("group", chat.addrs.size > 1)
        // So received messages can be put under their sender's name.
        put("names", JSONObject().apply { chat.addrs.forEach { a -> nameOf(a)?.let { put(a, it) } } })
        // Who's starred in the phone's contacts (Favorites), and their photos.
        put("people", JSONArray(chat.addrs.map { a ->
            val p = personOf(a)
            JSONObject().apply {
                put("address", a)
                p?.name?.let { put("name", it) }
                if (p?.starred == true) put("starred", true)
                photoOf(a, p)?.let { put("photo", it) }
            }
        }))
    }

    // A contact's photo, into the package once (and kept by later updates).
    private fun photoOf(a: String, p: Person?): String? {
        photoFiles[a]?.let { return it }
        val uri = p?.photo ?: return null
        val bytes = try { cr.openInputStream(Uri.parse(uri))?.use { it.readBytes() } } catch (_: Exception) { null } ?: return null
        val file = "contacts/${nextPhoto++}.jpg"
        tar.add(file, bytes)
        photoFiles[a] = file
        return file
    }

    private data class Stats(val messages: Int, val sms: Int, val mms: Int, val first: Long, val last: Long, val media: Int, val waiting: Int, val bytes: Long) {
        fun plus(o: Stats) = Stats(messages + o.messages, sms + o.sms, mms + o.mms, minOf(first, o.first), maxOf(last, o.last), media + o.media, waiting + o.waiting, bytes + o.bytes)
        fun into(j: JSONObject) {
            j.put("messages", messages); j.put("sms", sms); j.put("mms", mms)
            if (messages > 0) { j.put("first", first); j.put("last", last) }
            j.put("media", media); j.put("media_waiting", waiting); j.put("media_bytes", bytes)
        }
        companion object {
            fun of(t: JSONObject) = Stats(t.optInt("messages"), t.optInt("sms"), t.optInt("mms"), t.optLong("first", Long.MAX_VALUE), t.optLong("last"),
                t.optInt("media"), t.optInt("media_waiting"), t.optLong("media_bytes"))
        }
    }

    private fun stats(lines: List<JSONObject>): Stats {
        var media = 0
        var waiting = 0
        var bytes = 0L
        for (l in lines) for (p in l.optJSONArray("parts")?.objects().orEmpty()) {
            if (!p.has("file")) { waiting++; continue }
            media++
            val f = p.getString("file")
            bytes += copiedSizes[f] ?: previous?.size(f) ?: 0L
        }
        return Stats(lines.size, lines.count { it.optString("kind") == "sms" }, lines.count { it.optString("kind") == "mms" },
            lines.minOfOrNull { it.getLong("date") } ?: Long.MAX_VALUE, lines.maxOfOrNull { it.getLong("date") } ?: 0L, media, waiting, bytes)
    }

    // A thread from the file, with its counts (worked out once, for a file made before they were kept).
    private fun withStats(t: JSONObject): JSONObject {
        val copy = JSONObject(t.toString())
        if (t.has("sms") && t.has("media_waiting")) return copy
        val lines = ArrayList<JSONObject>()
        previous?.messages(t) { lines += it }
        return copy.also { stats(lines).into(it) }
    }

    private fun lines(list: List<JSONObject>): ByteArray {
        val b = ByteArrayOutputStream()
        for (m in list) b.write((m.toString() + "\n").toByteArray(Charsets.UTF_8))
        return b.toByteArray()
    }

    private fun tick(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastTick < 250) return
        lastTick = now
        onProgress(Progress(minOf(done, total), total, title, chats, mediaAdded, if (previous == null) secondsLeft() else null))
    }

    // Each kind at its own measured speed; picture messages at a cautious
    // guess until some have been read.
    private fun secondsLeft(): Double? {
        if (smsDone + mmsDone < 50) return null
        val smsRate = if (smsDone > 0 && smsNanos > 0) smsDone / (smsNanos / 1e9) else 2000.0
        val mmsRate = if (mmsDone >= 20 && mmsNanos > 0) mmsDone / (mmsNanos / 1e9) else 20.0
        return maxOf(0, counts.sms - smsDone) / smsRate + maxOf(0, counts.mms - mmsDone) / mmsRate
    }

    private fun count(uri: Uri, where: String, thread: Long, upTo: Long): Int =
        cr.query(uri, arrayOf("_id"), where, arrayOf("$thread", "$upTo"), null)?.use { it.count } ?: 0

    // Every chat on the phone with who's in it, newest first. Android keeps
    // each chat's people as ids into a table of addresses.
    private fun chats(): List<Chat> {
        val address = HashMap<Long, String>()
        cr.query(Uri.parse("content://mms-sms/canonical-addresses"), arrayOf("_id", "address"), null, null, null)?.use { c ->
            while (c.moveToNext()) address[c.getLong(0)] = c.getString(1) ?: ""
        }
        val list = ArrayList<Chat>()
        cr.query(THREADS, arrayOf("_id", "recipient_ids"), null, null, "date DESC")?.use { c ->
            while (c.moveToNext()) {
                val ids = (c.getString(1) ?: "").split(' ').mapNotNull { it.toLongOrNull() }
                list += Chat(c.getLong(0), ids.mapNotNull { address[it] }.flatMap(::addrs).filter { it.isNotEmpty() }.distinct())
            }
        }
        return list
    }

    // Texts received (type 1) and sent (2), all or those after `since`.
    // Drafts, and texts that failed or are still waiting to go, were never
    // really sent, so they're left out.
    private fun texts(chat: Chat, into: MutableList<Item>, since: Long?) {
        cr.query(Telephony.Sms.CONTENT_URI, arrayOf("_id", "address", "date", "type", "body"),
            "thread_id = ? AND type IN (1, 2)" + (if (since != null) " AND date > ?" else ""),
            listOfNotNull("${chat.id}", since?.toString()).toTypedArray(), "date ASC")?.use { c ->
            var last = System.nanoTime()
            while (c.moveToNext()) {
                if (cancelled()) break
                val box = c.getInt(3)
                val a = addr(c.getString(1) ?: "")
                into += Item(c.getLong(2), JSONObject().apply {
                    put("date", c.getLong(2))
                    put("box", box)
                    put("kind", "sms")
                    put("addrs", JSONArray(chat.addrs.ifEmpty { listOf(a) }))
                    if (box == 1 && a.isNotEmpty()) put("from", a)
                    put("text", c.getString(4) ?: "")
                    put("src_id", "sms:${c.getLong(0)}")
                })
                val now = System.nanoTime()
                smsNanos += now - last; last = now
                done++; smsDone++; tick()
            }
        }
    }

    // Picture and group messages (and RCS chats, which Google Messages keeps
    // as MMS): the message, its parts (text, and each photo or video, listed
    // here and copied later by copyParts) and its sender.
    private fun pictures(chat: Chat, into: MutableList<Item>, since: Long?) {
        cr.query(Telephony.Mms.CONTENT_URI, arrayOf("_id", "date", "msg_box", "sub"),
            "thread_id = ? AND msg_box IN (1, 2)" + (if (since != null) " AND date > ?" else ""),
            listOfNotNull("${chat.id}", since?.let { "${it / 1000}" }).toTypedArray(), "date ASC")?.use { c ->
            var last = System.nanoTime()
            while (c.moveToNext()) {
                if (cancelled()) break
                val id = c.getLong(0)
                val date = c.getLong(1) * 1000 // MMS dates are in seconds
                val box = c.getInt(2)
                val texts = ArrayList<String>()
                val parts = JSONArray()
                cr.query(Uri.parse("content://mms/$id/part"), arrayOf("_id", "ct", "name", "cl", "text"), null, null, "seq ASC")?.use { p ->
                    while (p.moveToNext()) {
                        val ct = p.getString(1) ?: ""
                        when {
                            ct == "application/smil" -> Unit // the layout, not content
                            ct.startsWith("text/") -> (p.getString(4) ?: readText(p.getLong(0)))?.let { if (it.isNotBlank()) texts += it }
                            else -> parts.put(JSONObject().apply { put("ct", ct); (p.getString(2) ?: p.getString(3))?.let { put("name", it) }; put("id", p.getLong(0)) })
                        }
                    }
                }
                into += Item(date, JSONObject().apply {
                    put("date", date)
                    put("box", box)
                    put("kind", "mms")
                    put("addrs", JSONArray(chat.addrs))
                    if (box == 1) sender(id)?.let { put("from", it) }
                    c.getString(3)?.let { if (it.isNotBlank()) put("subject", it) }
                    if (texts.isNotEmpty()) put("text", texts.joinToString("\n"))
                    if (parts.length() > 0) put("parts", parts)
                    put("src_id", "mms:$id")
                })
                val now = System.nanoTime()
                mmsNanos += now - last; last = now
                done++; mmsDone++; tick()
            }
        }
    }

    // The photos and videos of one message: copied in if photos are wanted and
    // the file doesn't have them already; otherwise listed without a file, so
    // they're known to be there (and a later backup with photos adds them).
    private fun copyParts(m: JSONObject) {
        val parts = m.optJSONArray("parts") ?: return
        for (i in 0 until parts.length()) {
            val p = parts.getJSONObject(i)
            if (p.has("file") || !withMedia || !p.has("id")) continue
            val t0 = System.nanoTime()
            copyMedia(p.getLong("id"), p.getString("ct"), p.optString("name").ifEmpty { null })?.let { parts.put(i, part(it, p)) }
            mmsNanos += System.nanoTime() - t0
        }
    }

    // A part, in the order the file writes it: file (if any), type, name, phone ID.
    private fun part(file: String?, p: JSONObject) = JSONObject().apply {
        file?.let { put("file", it) }
        put("ct", p.optString("ct"))
        p.optString("name").ifEmpty { null }?.let { put("name", it) }
        if (p.has("id")) put("id", p.getLong("id"))
    }

    // Who sent a received picture message (address type 137 is "from").
    private fun sender(id: Long): String? =
        cr.query(Uri.parse("content://mms/$id/addr"), arrayOf("address"), "type = 137", null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.takeIf { it != "insert-address-token" }?.let(::addr) else null
        }

    // A long text part is sometimes kept in a file of its own rather than in the row.
    private fun readText(partId: Long): String? = try {
        cr.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (_: Exception) { null }

    // One photo or video into the package. It's read into a temporary file
    // first: a part that can't be read is skipped and counted, while a failure
    // writing the package itself stops the backup (the file would be broken).
    private fun copyMedia(partId: Long, ct: String, name: String?): String? {
        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(ct)
            ?: name?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.length in 1..5 } ?: "bin"
        val tmp = File(ctx.cacheDir, "backup-part.tmp")
        try {
            val ok = try {
                cr.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { i -> tmp.outputStream().use { i.copyTo(it) } } != null
            } catch (_: Exception) { false }
            if (!ok) { failedMedia++; return null }
            val file = "media/${nextMedia++}.$ext"
            tmp.inputStream().use { tar.add(file, tmp.length(), it) }
            copiedSizes[file] = tmp.length()
            mediaAdded++
            return file
        } finally {
            tmp.delete()
        }
    }

    private fun nameOf(a: String): String? = personOf(a)?.name

    private fun personOf(a: String): Person? {
        if (a in people) return people[a]
        val p = if (!contacts || a.none { it.isDigit() }) null else try {
            cr.query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(a)),
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME, ContactsContract.PhoneLookup.STARRED, ContactsContract.PhoneLookup.PHOTO_THUMBNAIL_URI), null, null, null)
                ?.use { c -> if (c.moveToFirst()) Person(c.getString(0), c.getInt(1) == 1, c.getString(2)) else null }
        } catch (_: Exception) { null }
        people[a] = p
        return p
    }

    companion object {
        private val THREADS: Uri = Uri.parse("content://mms-sms/conversations?simple=true")

        // As the extension writes them: a number as digits and +; an email
        // address (picture messages to email) in lower case; a name businesses
        // text from ("AMAZON") as it is.
        fun addr(a: String): String {
            val t = a.trim()
            return when {
                '@' in t -> t.lowercase()
                t.any { it.isLetter() } -> t
                else -> t.filter { it.isDigit() || it == '+' }
            }
        }

        // One address as Android has it can be several people: "5550100001;5550100002"
        // (stuck together as one long number, these were read as one person). Split
        // on ; and , and on spaces when every piece is a whole number by itself.
        fun addrs(a: String): List<String> {
            val parts = a.split(';', ',').map { it.trim() }.filter { it.isNotEmpty() }
            return parts.flatMap { p ->
                val words = p.split(Regex("\\s+"))
                if (words.size > 1 && words.all { w -> w.count { it.isDigit() } >= 7 && w.all { it.isDigit() || it == '+' || it == '-' || it == '(' || it == ')' || it == '.' } }) words else listOf(p)
            }.map(::addr)
        }

        // A chat's identity in a file: who's in it.
        private fun key(addrs: List<String>) = addrs.map(::addr).sorted().joinToString(",")

        private fun JSONArray.strings() = (0 until length()).map { getString(it) }
        private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

        /** How much there is to back up, for the screen before it starts. */
        fun summary(ctx: Context): Summary {
            val cr = ctx.contentResolver
            fun count(uri: Uri, where: String?) = try { cr.query(uri, arrayOf("_id"), where, null, null)?.use { it.count } ?: 0 } catch (_: Exception) { 0 }
            return Summary(
                sms = count(Telephony.Sms.CONTENT_URI, "type IN (1, 2)"),
                mms = count(Telephony.Mms.CONTENT_URI, "msg_box IN (1, 2)"),
                threads = count(THREADS, null),
                media = count(Uri.parse("content://mms/part"), "ct NOT LIKE 'text/%' AND ct != 'application/smil'"),
            )
        }
    }
}

/** Writes a tar file a file at a time, with the same headers as the extension (GMLib.tarHeader). */
class TarWriter(private val out: OutputStream) {
    var written = 0L
        private set

    fun add(name: String, bytes: ByteArray) = add(name, bytes.size.toLong(), bytes.inputStream())

    fun add(name: String, size: Long, data: InputStream) {
        write(header(name, size))
        val buf = ByteArray(1 shl 16)
        var left = size
        while (left > 0) {
            val n = data.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) throw IllegalStateException("$name ended early")
            out.write(buf, 0, n); written += n; left -= n
        }
        val pad = ((512 - size % 512) % 512).toInt()
        if (pad > 0) write(ByteArray(pad))
    }

    fun finish() {
        write(ByteArray(1024))
        out.flush()
    }

    private fun write(b: ByteArray) { out.write(b); written += b.size }

    private fun header(name: String, size: Long): ByteArray {
        val h = ByteArray(512)
        fun put(s: String, off: Int) { s.toByteArray(Charsets.US_ASCII).copyInto(h, off) }
        fun oct(n: Long, len: Int) = n.toString(8).padStart(len - 1, '0') + "\u0000"
        require(name.length <= 100) { "Name too long for the package: $name" }
        put(name, 0)
        put("0000644\u0000", 100)
        put("0000000\u0000", 108)
        put("0000000\u0000", 116)
        put(oct(size, 12), 124)
        put(oct(System.currentTimeMillis() / 1000, 12), 136)
        put("        ", 148) // the checksum is summed with these as spaces
        h[156] = '0'.code.toByte()
        put("ustar\u0000", 257)
        put("00", 263)
        val sum = h.sumOf { it.toInt() and 0xff }
        put(sum.toString(8).padStart(6, '0') + "\u0000 ", 148)
        return h
    }
}

/** Writes into a file from a given position, without moving its shared position (an update adds after the old entries). */
class ChannelOut(private val ch: FileChannel, var position: Long) : OutputStream() {
    override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
    override fun write(b: ByteArray, off: Int, len: Int) {
        val buf = ByteBuffer.wrap(b, off, len)
        while (buf.hasRemaining()) position += ch.write(buf, position)
    }
}
