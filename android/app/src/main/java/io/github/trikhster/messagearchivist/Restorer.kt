package io.github.trikhster.messagearchivist

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.Telephony
import org.json.JSONObject

/**
 * Puts a restore package's messages into the phone's SMS and MMS database.
 * Only works while this app is the default SMS app (Android ignores writes
 * from anyone else).
 *
 * - Texts in a one-to-one chat go in as SMS, a few hundred at a time.
 * - Group messages, and messages with photos or videos, go in as MMS: the
 *   message, then each part (the text, each file), then who it's from and to.
 * - Anything already on the phone (same chat, same time, same direction) is
 *   skipped, so running a restore twice doesn't duplicate anything.
 */
class Restorer(
    private val ctx: Context,
    private val pkg: RestorePackage,
    // This phone's own number. A received group message lists everyone it was
    // sent to, this phone included; without it, Google Messages shows the
    // message as a one-to-one chat with the sender instead of in the group.
    private val selfNumber: String?,
    // The thread files to restore (the chats picked on screen), or null for all.
    private val only: Set<String>?,
    private val onProgress: (Progress) -> Unit,
    private val cancelled: () -> Boolean,
) {
    data class Result(val sms: Int, val mms: Int, val skipped: Int, val failed: Int, val stopped: Boolean)
    data class Progress(val done: Int, val total: Int, val thread: String, val sms: Int, val mms: Int, val skipped: Int)

    private val cr = ctx.contentResolver
    private val smsHave = HashSet<String>()
    private val mmsHave = HashSet<String>()

    fun run(): Result {
        loadExisting()
        val all = pkg.manifest.getJSONArray("threads")
        val threads = (0 until all.length()).map { all.getJSONObject(it) }.filter { only == null || it.getString("file") in only }
        val total = threads.sumOf { it.optInt("messages") }
        var done = 0
        var sms = 0
        var mms = 0
        var skipped = 0
        var failed = 0
        val batch = ArrayList<ContentValues>(BATCH)
        fun flush() {
            if (batch.isEmpty()) return
            sms += cr.bulkInsert(Telephony.Sms.CONTENT_URI, batch.toTypedArray())
            batch.clear()
        }
        for (t in threads) {
            if (cancelled()) break
            val addrs = t.getJSONArray("addresses").let { a -> (0 until a.length()).map { a.getString(it) } }
            val threadId = Telephony.Threads.getOrCreateThreadId(ctx, addrs.toSet())
            val title = t.optString("title")
            pkg.messages(t) { m ->
                if (cancelled()) return@messages
                try {
                    val date = m.getLong("date")
                    val box = m.getInt("box")
                    if (m.getString("kind") == "sms") {
                        val type = if (box == 2) Telephony.Sms.MESSAGE_TYPE_SENT else Telephony.Sms.MESSAGE_TYPE_INBOX
                        if (!smsHave.add("$threadId|$date|$type")) skipped++
                        else batch += ContentValues().apply {
                            put(Telephony.Sms.THREAD_ID, threadId)
                            put(Telephony.Sms.ADDRESS, addrs[0])
                            put(Telephony.Sms.BODY, m.optString("text"))
                            put(Telephony.Sms.DATE, date)
                            put(Telephony.Sms.DATE_SENT, date)
                            put(Telephony.Sms.TYPE, type)
                            put(Telephony.Sms.READ, 1)
                            put(Telephony.Sms.SEEN, 1)
                            put(Telephony.Sms.STATUS, Telephony.Sms.STATUS_NONE)
                        }
                        if (batch.size >= BATCH) flush()
                    } else {
                        flush() // keep the order the messages were in
                        if (!mmsHave.add("$threadId|${date / 1000}|$box")) skipped++
                        else if (insertMms(threadId, addrs, m)) mms++ else failed++
                    }
                } catch (e: Exception) {
                    failed++
                }
                done++
                if (done % 100 == 0) onProgress(Progress(done, total, title, sms + batch.size, mms, skipped))
            }
            flush()
            onProgress(Progress(done, total, title, sms, mms, skipped))
        }
        flush()
        return Result(sms, mms, skipped, failed, cancelled())
    }

    // What's already on the phone, as "thread|time|direction".
    private fun loadExisting() {
        cr.query(Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms.THREAD_ID, Telephony.Sms.DATE, Telephony.Sms.TYPE), null, null, null)?.use { c ->
            while (c.moveToNext()) smsHave.add("${c.getLong(0)}|${c.getLong(1)}|${c.getInt(2)}")
        }
        cr.query(Telephony.Mms.CONTENT_URI, arrayOf(Telephony.Mms.THREAD_ID, Telephony.Mms.DATE, Telephony.Mms.MESSAGE_BOX), null, null, null)?.use { c ->
            while (c.moveToNext()) mmsHave.add("${c.getLong(0)}|${c.getLong(1)}|${c.getInt(2)}")
        }
    }

    private fun insertMms(threadId: Long, addrs: List<String>, m: JSONObject): Boolean {
        val sent = m.getInt("box") == 2
        val seconds = m.getLong("date") / 1000
        // Parts with a file: one backed up without photos lists them without.
        val parts = m.optJSONArray("parts")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optString("file").isNotEmpty() } }.orEmpty()
        val text = m.optString("text", "")
        val values = ContentValues().apply {
            put(Telephony.Mms.THREAD_ID, threadId)
            put(Telephony.Mms.DATE, seconds)
            put(Telephony.Mms.DATE_SENT, seconds)
            put(Telephony.Mms.MESSAGE_BOX, if (sent) Telephony.Mms.MESSAGE_BOX_SENT else Telephony.Mms.MESSAGE_BOX_INBOX)
            put(Telephony.Mms.READ, 1)
            put(Telephony.Mms.SEEN, 1)
            put(Telephony.Mms.MESSAGE_TYPE, if (sent) 128 else 132) // m-send-req / m-retrieve-conf
            put(Telephony.Mms.MMS_VERSION, 0x12)
            put(Telephony.Mms.CONTENT_TYPE, "application/vnd.wap.multipart.related")
            put(Telephony.Mms.TEXT_ONLY, if (parts.isEmpty()) 1 else 0)
        }
        val uri = cr.insert(Telephony.Mms.CONTENT_URI, values) ?: return false
        val id = ContentUris.parseId(uri)
        val partUri = Uri.parse("content://mms/$id/part")
        if (text.isNotEmpty()) {
            cr.insert(partUri, ContentValues().apply {
                put(Telephony.Mms.Part.MSG_ID, id)
                put(Telephony.Mms.Part.SEQ, 0)
                put(Telephony.Mms.Part.CONTENT_TYPE, "text/plain")
                put(Telephony.Mms.Part.CHARSET, 106) // UTF-8
                put(Telephony.Mms.Part.CONTENT_ID, "<text0>")
                put(Telephony.Mms.Part.CONTENT_LOCATION, "text0.txt")
                put(Telephony.Mms.Part.TEXT, text)
            })
        }
        for ((k, p) in parts.withIndex()) {
            val name = p.optString("name", p.getString("file").substringAfterLast('/'))
            val part = cr.insert(partUri, ContentValues().apply {
                put(Telephony.Mms.Part.MSG_ID, id)
                put(Telephony.Mms.Part.SEQ, 0)
                put(Telephony.Mms.Part.CONTENT_TYPE, p.optString("ct", "application/octet-stream"))
                put(Telephony.Mms.Part.NAME, name)
                put(Telephony.Mms.Part.FILENAME, name)
                put(Telephony.Mms.Part.CONTENT_ID, "<part$k>")
                put(Telephony.Mms.Part.CONTENT_LOCATION, name)
            }) ?: continue
            pkg.openEntry(p.getString("file"))?.use { input -> cr.openOutputStream(part)?.use { out -> input.copyTo(out, 1 shl 16) } }
        }
        // Who it's from (137) and to (151). A sent message is from this phone.
        val addrUri = Uri.parse("content://mms/$id/addr")
        val from = if (sent) "insert-address-token" else m.optString("from").ifEmpty { addrs[0] }
        fun addr(a: String, type: Int) = cr.insert(addrUri, ContentValues().apply {
            put(Telephony.Mms.Addr.MSG_ID, id)
            put(Telephony.Mms.Addr.ADDRESS, a)
            put(Telephony.Mms.Addr.TYPE, type)
            put(Telephony.Mms.Addr.CHARSET, 106)
        })
        addr(from, 137)
        for (a in addrs) if (sent || a != from) addr(a, 151)
        if (!sent && addrs.size > 1 && !selfNumber.isNullOrBlank()) addr(selfNumber, 151)
        return true
    }

    companion object {
        private const val BATCH = 400
    }
}
