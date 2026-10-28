package io.github.trikhster.messagearchivist

import android.Manifest
import android.content.ContentResolver
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
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream
import java.time.Instant
import java.util.TimeZone

/**
 * Backs this phone's texts and picture messages up into a package in the
 * extension's restore format (see RestorePackage and notes/Restore package.md),
 * so it can go back onto this or another phone, or into the extension's library.
 *
 * Either a new file (`previous` null), or one made before, brought up to date:
 * `out` then writes after `previous`'s entries. For each chat on the phone:
 * - new to the file: all of it, one `threads/<nnnn>.ndjson.gz`;
 * - in the file, nothing changed among the messages it has: only the newer
 *   ones, as one more piece of the chat (`files`), so a daily backup of years
 *   of texts reads and writes only the day's messages;
 * - in the file, but older messages came along (after a restore, say) or its
 *   photos are wanted now and weren't before: the whole chat again, merged
 *   with what the file has (messages deleted from the phone since are kept,
 *   photos already in the file aren't copied twice).
 * Or an updates file (`since` set, `previous` null): a whole new package of
 * only the messages after `since` (ms), every chat's, with their photos, so a
 * backup kept online needn't rewrite its big file every time (Daily.run).
 * It restores and imports like any package, after the big one.
 * A chat's messages are gzipped (text shrinks about tenfold; format version
 * 3). A photo or video already in the file, byte for byte (the same picture
 * sent again, or forwarded), isn't stored twice: both messages point at it.
 * Photos go through a temporary file (a tar header needs the size first);
 * the manifest goes last, so a stopped backup is a whole file of the chats
 * done so far.
 *
 * Or only the chats chosen on screen (`only`: their keys): a new file has
 * just those; a file brought up to date updates just those, and keeps its
 * other chats as they were. A chat chosen by name is backed up even if it's
 * one Settings leaves out.
 *
 * Chats of codes, promotions or automated texts that Settings leaves out
 * (Clutter.chosen) aren't written, and a file that had them drops them from
 * its manifest (their old pieces stay unused, as for a chat written again).
 *
 * Needs READ_SMS; with READ_CONTACTS, chats are named as on the phone,
 * otherwise by number, and each person carries the rest of their contact
 * (cardOf), for the archive's People and notes.
 *
 * Other apps' exports shared to this app or added here (Exports) go in too,
 * each once per file: `exports/<n>/<k>.<ext>`, listed in the manifest's
 * `exports`, for the extension to read with the app's module.
 */
class PhoneBackup(
    private val ctx: Context,
    out: OutputStream,
    private val previous: RestorePackage?,
    private val withMedia: Boolean,
    private val onProgress: (Progress) -> Unit,
    private val cancelled: () -> Boolean,
    private val since: Long? = null,
    private val updatesFor: String? = null,
    private val only: Set<String>? = null,
) {
    data class Summary(val sms: Int, val mms: Int, val threads: Int, val media: Int) { val messages get() = sms + mms }
    // secondsLeft: null until there's enough to go on (and for an update, which is quick).
    data class Progress(val done: Int, val total: Int, val thread: String, val chats: Int, val media: Int, val secondsLeft: Double?)
    // For an update, `added` and `mediaAdded` are what this run added; the rest are the whole file's.
    data class Result(
        val threads: Int, val messages: Int, val sms: Int, val mms: Int, val media: Int, val mediaWaiting: Int, val failedMedia: Int,
        val bytes: Long, val stopped: Boolean, val added: Int, val mediaAdded: Int, val updated: Boolean,
        // Chats left out this run as codes, promotions or automated texts (Settings).
        val leftOut: Int = 0,
        // How many chats were chosen on screen (0: every chat).
        val chosen: Int = 0,
        // Other apps' exports this run wrote (Exports ids).
        val exports: List<String> = emptyList(),
    )
    /** A chat on the phone, to choose from: `key` is how a backup knows it; `kind`, what Clutter makes of it (codes, promotions, automated texts), if anything. */
    data class ChatInfo(val key: String, val title: String, val messages: Int, val last: Long, val group: Boolean, val kind: String? = null)

    private val cr = ctx.contentResolver
    private val tar = TarWriter(out)
    private val contacts = ctx.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    // What Settings leaves out (Clutter), and what this run left out: by kind, and the chats' keys.
    private val leaveOut = Clutter.chosen(ctx)
    private val leftOut = LinkedHashMap<String, Int>()
    private val leftKeys = HashSet<String>()
    private val people = HashMap<String, Person?>() // address -> the phone's contact for it
    private val cards = HashMap<Long, JSONObject?>() // contact -> the rest of what the phone knows of them (cardOf)
    private val photoFiles = HashMap<String, String>() // address -> its contact photo in the package
    private val copiedSizes = HashMap<String, Long>()
    // Photos and videos in the file by size, and the fingerprints worked out so far, to store each one once.
    private val bySize = HashMap<Long, MutableList<String>>()
    private val digests = HashMap<String, String>()
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
    private class Person(val name: String?, val starred: Boolean, val photo: String?, val id: Long? = null, val key: String? = null)
    private class Item(val date: Long, val json: JSONObject)

    fun run(): Result {
        // Every chat, or only those chosen on screen.
        val todo = chats().let { all -> only?.let { o -> all.filter { key(it.addrs) in o } } ?: all }
        counts = if (only == null) summary(ctx, since) else Summary(todo.sumOf { smsIn(it) }, todo.sumOf { mmsIn(it) }, todo.size, 0)
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
                Regex("""^media/(\d+)\.""").find(n)?.let { nextMedia = maxOf(nextMedia, it.groupValues[1].toInt() + 1); bySize.getOrPut(p.size(n)) { ArrayList() } += n }
                Regex("""^contacts/(\d+)\.""").find(n)?.let { nextPhoto = maxOf(nextPhoto, it.groupValues[1].toInt() + 1) }
            }
        }
        val list = LinkedHashMap<String, JSONObject>() // the new manifest's threads: the phone's, newest first, then the file's others
        var stopped = false
        for (chat in todo) {
            if (cancelled()) { stopped = true; break }
            title = chat.addrs.joinToString(", ") { nameOf(it) ?: it }.ifEmpty { "Unknown" }
            tick(force = true)
            val k = key(chat.addrs)
            val was = old[k]
            // Codes, promotions or automated texts Settings leaves out: not written,
            // and dropped from the file if it had them.
            val kind = if (leaveOut.isEmpty() || only != null) null else kindOf(chat)
            if (kind != null && kind in leaveOut) {
                leftOut[kind] = (leftOut[kind] ?: 0) + 1
                leftKeys += k
                done += messagesIn(chat)
                continue
            }
            val entry = if (was == null) newChat(chat, "threads/%04d.ndjson.gz".format(nextThread)) else updateChat(chat, was)
            if (cancelled()) { stopped = true; break } // this chat isn't finished: it stays as it was
            if (entry == null) continue // nothing to back up in it
            if (was == null) nextThread++
            list[k] = entry
            chats++
            tick(force = true)
        }
        for ((k, t) in old) if (k !in list && k !in leftKeys) list[k] = withStats(t)
        val all = list.values
        val book = addressBook()
        val exports = exports(stopped)
        val sum = { f: String -> all.sumOf { it.optLong(f) } }
        val manifest = JSONObject().apply {
            put("format", RestorePackage.FORMAT)
            put("version", when {
                all.any { t -> RestorePackage.threadFiles(t).any { it.endsWith(".gz") } } -> 3
                all.any { RestorePackage.threadFiles(it).size > 1 } -> 2
                else -> 1
            })
            put("created_at", previous?.manifest?.optString("created_at")?.ifEmpty { null } ?: Instant.now().toString())
            if (previous != null) put("updated_at", Instant.now().toString())
            put("tool", "Message Archivist")
            put("tool_version", BuildConfig.VERSION_NAME)
            put("source", "phone")
            // Whose phone: its own number, when the phone knows it, so the archive
            // keeps a second number's texts apart (the extension's accounts).
            RestoreService.ownNumber(ctx)?.let { put("owner", JSONObject().put("number", it)) }
            // An updates file: what's after `since`, for the backup named here.
            if (since != null) { put("updates_since", Instant.ofEpochMilli(since).toString()); updatesFor?.let { put("updates_for", it) } }
            put("timezone", TimeZone.getDefault().id)
            if (stopped) put("stopped", true)
            // Chats left out this run, by kind (Settings: codes, promotions, automated texts).
            if (leftOut.isNotEmpty()) put("left_out", JSONObject(leftOut as Map<*, *>))
            // Every contact (Settings: Save all my contacts), in its own entry.
            book?.let { put("address_book", it) }
            // Other apps' exports shared to this app (Exports), for the archive.
            if (exports.length() > 0) put("exports", exports)
            put("counts", JSONObject().apply {
                put("threads", all.size); put("messages", sum("messages")); put("sms", sum("sms")); put("mms", sum("mms"))
                put("media", sum("media")); put("media_bytes", sum("media_bytes")); put("media_waiting", sum("media_waiting"))
            })
            // Each run: when, and what it added (the last HISTORY runs: the manifest is written again every run).
            val was = previous?.manifest?.optJSONArray("history") ?: JSONArray()
            val history = JSONArray().apply { for (i in maxOf(0, was.length() - HISTORY + 1) until was.length()) put(was.get(i)) }
            put("history", history.put(JSONObject().apply {
                put("at", Instant.now().toString()); put("added", added); put("media_added", mediaAdded)
                if (only != null) put("chosen", todo.size) // only the chats chosen on screen
                if (stopped) put("stopped", true)
            }))
            put("threads", JSONArray(all))
        }
        tar.add("manifest.json", manifest.toString().toByteArray(Charsets.UTF_8)) // compact: it's written again every run
        tar.finish()
        val c = manifest.getJSONObject("counts")
        return Result(c.getInt("threads"), c.getInt("messages"), c.getInt("sms"), c.getInt("mms"), c.getInt("media"), c.getInt("media_waiting"),
            failedMedia, tar.written, stopped, added, mediaAdded, previous != null, leftOut.values.sum(), if (only != null) todo.size else 0, exportsWritten)
    }

    // The manifest's `exports`: the file's own (those still in it), then each
    // export waiting on the phone (Exports) that it doesn't have, written as
    // exports/<n>/<k>.<ext>. A stopped run leaves them waiting.
    private val exportsWritten = ArrayList<String>()
    private fun exports(stopped: Boolean): JSONArray {
        val list = JSONArray()
        val have = HashSet<String>()
        var next = 1
        previous?.let { p ->
            for (n in p.names) Regex("""^exports/(\d+)/""").find(n)?.let { next = maxOf(next, it.groupValues[1].toInt() + 1) }
            p.manifest.optJSONArray("exports")?.objects()?.forEach { x ->
                if (x.optJSONArray("files")?.objects()?.all { it.optString("entry") in p.names } == true && have.add(x.optString("id"))) list.put(x)
            }
        }
        if (stopped) return list
        for (x in Exports.waiting(ctx)) {
            if (x.id in have || x.parts.any { !it.file.exists() }) continue
            if (cancelled()) break
            title = x.title ?: Apps.of(x.app)?.label ?: x.parts.first().name
            tick(force = true)
            val n = next++
            val files = JSONArray()
            x.parts.forEachIndexed { k, part ->
                val entry = "exports/$n/${k + 1}${Exports.ext(part.name)}"
                part.file.inputStream().use { tar.add(entry, part.bytes, it) }
                files.put(JSONObject().put("entry", entry).put("name", part.name).put("bytes", part.bytes))
            }
            list.put(JSONObject().put("id", x.id).put("app", x.app ?: "").put("title", x.title ?: "")
                .put("added_at", Instant.ofEpochMilli(x.addedAt).toString()).put("files", files))
            have += x.id
            exportsWritten += x.id
        }
        return list
    }

    // A chat the file doesn't have yet: all of it.
    private fun newChat(chat: Chat, file: String): JSONObject? {
        val items = ArrayList<Item>()
        texts(chat, items, since = since)
        pictures(chat, items, since = since)
        if (cancelled() || items.isEmpty()) return null
        items.sortBy { it.date } // stable: same-time messages keep their order
        for (i in items) copyParts(i.json)
        addThread(file, lines(items.map { it.json }))
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
            val piece = base(files.first()) + ".${files.size + 1}.ndjson.gz"
            addThread(piece, lines(items.map { it.json }))
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
        // Written again gzipped, under the chat's own number (its old pieces are left unused, for compacting).
        val whole = base(files.first()) + ".ndjson.gz"
        addThread(whole, bytes)
        return entry(chat, listOf(whole), stats(merged))
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
                cardOf(p)?.let { put("contact", it) }
            }
        }))
    }

    // Every contact, when Settings saves them all: written as ContactBook.ENTRY
    // when they've changed since the file's copy (the manifest says when they
    // were read and how many). Turned off, a file that had them gets an empty
    // book in its place, so compacting drops the old one. Null: none.
    private fun addressBook(): JSONObject? {
        val had = previous?.manifest?.optJSONObject("address_book")
        if (!ContactBook.on(ctx) || !contacts) {
            if (had != null && (had.optInt("contacts") > 0)) addThread(ContactBook.ENTRY, bookText(JSONArray(), Instant.now().toString()))
            return null
        }
        val all = ContactBook.all(cr)
        val same = had != null && previous?.bytes(ContactBook.ENTRY)?.let { b ->
            try { JSONObject(String(b, Charsets.UTF_8)).optJSONArray("contacts")?.toString() == all.toString() } catch (_: Exception) { false }
        } == true
        if (same) return had
        val at = Instant.now().toString()
        addThread(ContactBook.ENTRY, bookText(all, at))
        return JSONObject().put("file", ContactBook.ENTRY).put("contacts", all.length()).put("captured_at", at)
    }
    private fun bookText(all: JSONArray, at: String) =
        JSONObject().put("format", ContactBook.FORMAT).put("version", 1).put("captured_at", at).put("contacts", all).toString().toByteArray(Charsets.UTF_8)

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

    // A chat's file: gzipped when its name says so (every one written now; older backups' stay as they are).
    private fun addThread(name: String, text: ByteArray) {
        if (!name.endsWith(".gz")) { tar.add(name, text); return }
        val b = ByteArrayOutputStream(text.size / 6 + 64)
        GZIPOutputStream(b, 1 shl 16).use { it.write(text) }
        tar.add(name, b.toByteArray())
    }

    // "threads/0001" from "threads/0001.ndjson", ".ndjson.gz", or a piece "threads/0001.2.ndjson(.gz)".
    private fun base(file: String) = file.removeSuffix(".gz").removeSuffix(".ndjson").replace(Regex("""\.\d+$"""), "")

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

    private fun count(uri: Uri, where: String, vararg args: String): Int =
        cr.query(uri, arrayOf("_id"), where, arrayOf(*args), null)?.use { it.count } ?: 0

    // A chat's texts and picture messages this run reads (all, or those after `since`).
    private fun smsIn(chat: Chat): Int =
        if (since == null) count(Telephony.Sms.CONTENT_URI, "thread_id = ? AND type IN (1, 2)", "${chat.id}")
        else count(Telephony.Sms.CONTENT_URI, "thread_id = ? AND type IN (1, 2) AND date > ?", "${chat.id}", "$since")
    private fun mmsIn(chat: Chat): Int =
        if (since == null) count(Telephony.Mms.CONTENT_URI, "thread_id = ? AND msg_box IN (1, 2)", "${chat.id}")
        else count(Telephony.Mms.CONTENT_URI, "thread_id = ? AND msg_box IN (1, 2) AND date > ?", "${chat.id}", "${since / 1000}")
    // For the progress, when a chat is left out.
    private fun messagesIn(chat: Chat): Int = smsIn(chat) + mmsIn(chat)

    // Which of Clutter's kinds a one-to-one chat is, judged by who it's with
    // and everything in it (not only what's new). A starred contact never is;
    // a chat you've talked in isn't either, and isn't read to find out.
    private fun kindOf(chat: Chat): String? {
        val a = chat.addrs.singleOrNull() ?: return null
        val person = personOf(a)
        if (person?.starred == true) return null
        val sender = Clutter.senderOf(person?.name ?: a, a, group = false)
        val mine = count(Telephony.Sms.CONTENT_URI, "thread_id = ? AND type = 2", "${chat.id}") + count(Telephony.Mms.CONTENT_URI, "thread_id = ? AND msg_box = 2", "${chat.id}")
        if (mine >= 3 || (sender == "contact" && mine > 0)) return null
        val lines = ArrayList<Pair<Boolean, String>>()
        cr.query(Telephony.Sms.CONTENT_URI, arrayOf("type", "body"), "thread_id = ? AND type IN (1, 2)", arrayOf("${chat.id}"), null)?.use { c ->
            while (c.moveToNext()) lines += (c.getInt(0) == 2) to (c.getString(1) ?: "")
        }
        // Picture messages' words (Google Messages keeps RCS chats as these).
        cr.query(Telephony.Mms.CONTENT_URI, arrayOf("_id", "msg_box"), "thread_id = ? AND msg_box IN (1, 2)", arrayOf("${chat.id}"), null)?.use { c ->
            while (c.moveToNext()) lines += (c.getInt(1) == 2) to mmsText(c.getLong(0))
        }
        return Clutter.kind(sender, Clutter.traits(lines))
    }

    // A picture message's text parts, joined.
    private fun mmsText(id: Long): String {
        val texts = ArrayList<String>()
        cr.query(Uri.parse("content://mms/$id/part"), arrayOf("_id", "ct", "text"), null, null, "seq ASC")?.use { p ->
            while (p.moveToNext()) if ((p.getString(1) ?: "").startsWith("text/")) (p.getString(2) ?: readText(p.getLong(0)))?.let { if (it.isNotBlank()) texts += it }
        }
        return texts.joinToString("\n")
    }

    private fun chats(): List<Chat> = threads(cr).map { Chat(it.id, it.addrs) }

    // The phone's chats to choose from (chatList), named as a backup names them, each with what Clutter makes of it.
    private fun choices(): List<ChatInfo> {
        val list = threads(cr).filter { it.addrs.isNotEmpty() }
        val counted = list.any { it.messages > 0 } // a phone that doesn't keep each chat's count: counted here
        return list.mapNotNull { t ->
            val chat = Chat(t.id, t.addrs)
            val n = if (counted) t.messages else messagesIn(chat)
            if (n == 0) null
            else ChatInfo(key(t.addrs), t.addrs.joinToString(", ") { nameOf(it) ?: it }, n, t.date, t.addrs.size > 1, kindOf(chat))
        }.distinctBy { it.key }
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
            // A full phone isn't a photo that can't be read: that stops the backup.
            val sha = MessageDigest.getInstance("SHA-256")
            val ok = try {
                cr.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { i -> tmp.outputStream().use { DigestInputStream(i, sha).copyTo(it) } } != null
            } catch (e: Exception) { if (BackupFiles.isFull(e)) throw e; false }
            if (!ok) { failedMedia++; return null }
            val size = tmp.length()
            val digest = sha.digest().joinToString("") { "%02x".format(it) }
            mediaAdded++
            // The same bytes already in the file: point at them (only a file of the same size can be).
            bySize[size]?.firstOrNull { digestOf(it) == digest }?.let { return it }
            val file = "media/${nextMedia++}.$ext"
            tmp.inputStream().use { tar.add(file, size, it) }
            copiedSizes[file] = size
            digests[file] = digest
            bySize.getOrPut(size) { ArrayList() } += file
            return file
        } finally {
            tmp.delete()
        }
    }

    // A photo's fingerprint: worked out when it was copied in this run, else read once from the file.
    private fun digestOf(file: String): String? = digests[file] ?: previous?.openEntry(file)?.use { i ->
        val sha = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(1 shl 16)
        while (true) { val n = i.read(buf); if (n < 0) break; sha.update(buf, 0, n) }
        sha.digest().joinToString("") { "%02x".format(it) }
    }?.also { digests[file] = it }

    private fun nameOf(a: String): String? = personOf(a)?.name

    private fun personOf(a: String): Person? {
        if (a in people) return people[a]
        val p = if (!contacts || a.none { it.isDigit() }) null else try {
            cr.query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(a)),
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME, ContactsContract.PhoneLookup.STARRED, ContactsContract.PhoneLookup.PHOTO_THUMBNAIL_URI,
                    ContactsContract.PhoneLookup._ID, ContactsContract.PhoneLookup.LOOKUP_KEY), null, null, null)
                ?.use { c -> if (c.moveToFirst()) Person(c.getString(0), c.getInt(1) == 1, c.getString(2), c.getLong(3), c.getString(4)) else null }
        } catch (_: Exception) { null }
        people[a] = p
        return p
    }

    // The rest of what the phone's contacts know about someone (ContactBook),
    // for the archive's People and notes: the contact (`key`, so their chats
    // from every number join up), their other numbers and email addresses,
    // nickname, work, birthday, labels and relations. Null when there's
    // nothing more than the name.
    private fun cardOf(p: Person?): JSONObject? {
        val id = p?.id ?: return null
        if (id in cards) return cards[id]
        val card = ContactBook.read(cr, labelNames, id)[id]?.apply {
            remove("name"); remove("starred") // the person has these already
            if ((optJSONArray("numbers")?.length() ?: 0) <= 1) remove("numbers")
        }
        return card?.takeIf { it.length() > 0 }.also { cards[id] = it }
    }
    private val labelNames: Map<Long, String> by lazy { ContactBook.labels(cr) }

    companion object {
        private const val HISTORY = 100
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

        // Every chat on the phone with who's in it, how many messages and when
        // the last was, newest first. Android keeps each chat's people as ids
        // into a table of addresses.
        private class PhoneChat(val id: Long, val addrs: List<String>, val messages: Int, val date: Long)
        private fun threads(cr: ContentResolver): List<PhoneChat> {
            val address = HashMap<Long, String>()
            cr.query(Uri.parse("content://mms-sms/canonical-addresses"), arrayOf("_id", "address"), null, null, null)?.use { c ->
                while (c.moveToNext()) address[c.getLong(0)] = c.getString(1) ?: ""
            }
            val list = ArrayList<PhoneChat>()
            cr.query(THREADS, arrayOf("_id", "recipient_ids", "message_count", "date"), null, null, "date DESC")?.use { c ->
                while (c.moveToNext()) {
                    val ids = (c.getString(1) ?: "").split(' ').mapNotNull { it.toLongOrNull() }
                    list += PhoneChat(c.getLong(0), ids.mapNotNull { address[it] }.flatMap(::addrs).filter { it.isNotEmpty() }.distinct(), c.getInt(2), c.getLong(3))
                }
            }
            return list
        }

        /** The phone's chats to choose from, newest first, named as in its contacts (Back up this phone → Chats). Only reads them. */
        fun chatList(ctx: Context): List<ChatInfo> =
            PhoneBackup(ctx, object : OutputStream() { override fun write(b: Int) {} }, null, withMedia = false, onProgress = {}, cancelled = { false }).choices()

        /**
         * How much each chat holds on the phone, by key: its texts' and picture
         * messages' words, and its photos and videos, each one's size asked of
         * the phone (a while, with thousands). Null if `cancelled` stops it.
         */
        fun chatSizes(ctx: Context, cancelled: () -> Boolean): Map<String, Long>? {
            val cr = ctx.contentResolver
            val keyOf = HashMap<Long, String>()
            for (t in threads(cr)) if (t.addrs.isNotEmpty()) keyOf[t.id] = key(t.addrs)
            val bytes = HashMap<String, Long>()
            fun add(thread: Long, n: Long) { keyOf[thread]?.let { k -> bytes[k] = (bytes[k] ?: 0L) + n } }
            fun fileSize(part: Long) = try {
                cr.openFileDescriptor(Uri.parse("content://mms/part/$part"), "r")?.use { maxOf(0L, it.statSize) } ?: 0L
            } catch (_: Exception) { 0L }
            cr.query(Telephony.Sms.CONTENT_URI, arrayOf("thread_id", "body"), "type IN (1, 2)", null, null)?.use { c ->
                while (c.moveToNext()) {
                    if (cancelled()) return null
                    add(c.getLong(0), (c.getString(1)?.length ?: 0).toLong())
                }
            }
            // Picture messages: which chat each is in, then their parts.
            val chatOf = HashMap<Long, Long>()
            cr.query(Telephony.Mms.CONTENT_URI, arrayOf("_id", "thread_id"), "msg_box IN (1, 2)", null, null)?.use { c ->
                while (c.moveToNext()) chatOf[c.getLong(0)] = c.getLong(1)
            }
            cr.query(Uri.parse("content://mms/part"), arrayOf("_id", "mid", "ct", "text"), null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    if (cancelled()) return null
                    val thread = chatOf[c.getLong(1)] ?: continue
                    val ct = c.getString(2) ?: ""
                    when {
                        ct == "application/smil" -> Unit
                        // A long text part is sometimes a file of its own.
                        ct.startsWith("text/") -> add(thread, c.getString(3)?.length?.toLong() ?: fileSize(c.getLong(0)))
                        else -> add(thread, fileSize(c.getLong(0)))
                    }
                }
            }
            return bytes
        }

        private fun JSONArray.strings() = (0 until length()).map { getString(it) }
        private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

        /** How much there is to back up, for the screen before it starts. */
        // This phone's messages, chats and photos (those after `since`, ms, when given).
        fun summary(ctx: Context, since: Long? = null): Summary {
            val cr = ctx.contentResolver
            fun count(uri: Uri, where: String?) = try { cr.query(uri, arrayOf("_id"), where, null, null)?.use { it.count } ?: 0 } catch (_: Exception) { 0 }
            return Summary(
                sms = count(Telephony.Sms.CONTENT_URI, "type IN (1, 2)" + (since?.let { " AND date > $it" } ?: "")),
                mms = count(Telephony.Mms.CONTENT_URI, "msg_box IN (1, 2)" + (since?.let { " AND date > ${it / 1000}" } ?: "")),
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
