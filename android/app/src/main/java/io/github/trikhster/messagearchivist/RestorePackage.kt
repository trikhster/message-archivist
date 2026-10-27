package io.github.trikhster.messagearchivist

import org.json.JSONObject
import java.io.BufferedReader
import java.io.FileInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * A restore package: made by the Message Archivist extension (Settings → Phone
 * restore), or by this app backing a phone up. A tar file of
 * `media/<n>.<ext>`, `threads/<nnnn>.ndjson` (one message per line) and
 * `manifest.json`. See notes/Restore package.md in the project.
 *
 * Opening it reads only the 512-byte headers (seeking past each file), so a
 * package of many gigabytes is indexed in a moment; messages and photos are
 * then read as they're restored. A name that appears twice (a chat's messages
 * written again by an update) means its last copy.
 */
class RestorePackage(private val channel: FileChannel, private val closer: AutoCloseable) : AutoCloseable {
    constructor(input: FileInputStream) : this(input.channel, input)

    private val entries = HashMap<String, Pair<Long, Long>>() // name -> (data offset, size)
    val manifest: JSONObject
    /** Where the entries end (the end-of-archive blocks start): an update adds from here. */
    val end: Long

    init {
        val header = ByteBuffer.allocate(512)
        var pos = 0L
        val total = channel.size()
        while (pos + 512 <= total) {
            header.clear()
            channel.read(header, pos)
            val h = header.array()
            if (h.all { it.toInt() == 0 }) break
            val name = text(h, 0, 100).let { n -> text(h, 345, 155).let { p -> if (p.isNotEmpty()) "$p/$n" else n } }
            val size = text(h, 124, 12).trim().ifEmpty { "0" }.toLong(8)
            if (pos + 512 + size > total) break // cut short (an update that stopped): ignore the rest
            entries[name] = (pos + 512) to size
            pos += 512 + (size + 511) / 512 * 512
        }
        end = pos
        val m = entries["manifest.json"] ?: throw IllegalArgumentException("This isn’t a Message Archivist backup (no manifest).")
        manifest = JSONObject(open(m).readBytes().toString(Charsets.UTF_8))
        require(manifest.optString("format") == FORMAT) { "This isn’t a Message Archivist backup." }
        require(manifest.optInt("version") <= VERSION) { "This restore file is from a newer version. Update Message Archivist first." }
    }

    private fun text(b: ByteArray, off: Int, len: Int): String {
        var end = off
        while (end < off + len && b[end].toInt() != 0) end++
        return String(b, off, end - off, Charsets.UTF_8)
    }

    // Each entry is read at its own position (positional reads never move the
    // file's shared position), so a chat's messages and its photos can be read
    // at the same time.
    private fun open(entry: Pair<Long, Long>): InputStream = Slice(channel, entry.first, entry.second)

    /** A file in the package (a photo, say), or null if it isn't there. */
    fun openEntry(name: String): InputStream? = entries[name]?.let { open(it) }

    fun size(name: String): Long = entries[name]?.second ?: 0

    /** The names of every file in the package. */
    val names: Set<String> get() = entries.keys

    /** A file's bytes (a chat's messages; not for photos, which can be large). */
    fun bytes(name: String): ByteArray? = entries[name]?.let { e -> open(e).use { it.readBytes() } }

    /**
     * Every message of one thread, oldest first, one JSON object at a time. A
     * thread kept up to date by daily backups is in several pieces (`files`,
     * version 2), each adding what was new that day.
     */
    fun messages(thread: JSONObject, each: (JSONObject) -> Unit) {
        for (file in threadFiles(thread)) {
            val e = entries[file] ?: continue
            BufferedReader(InputStreamReader(open(e), Charsets.UTF_8), 1 shl 16).useLines { lines ->
                for (line in lines) if (line.isNotBlank()) each(JSONObject(line))
            }
        }
    }

    override fun close() = closer.close()

    /** One tar entry: `size` bytes from `start`, read by position. */
    private class Slice(private val ch: FileChannel, private var pos: Long, size: Long) : InputStream() {
        private val end = pos + size
        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos >= end) return -1
            val n = ch.read(ByteBuffer.wrap(b, off, minOf(len.toLong(), end - pos).toInt()), pos)
            if (n > 0) pos += n
            return n
        }
        override fun available(): Int = minOf(end - pos, Int.MAX_VALUE.toLong()).toInt()
    }

    companion object {
        const val FORMAT = "gm-restore"
        // 1: one file per thread. 2: a thread can be in several (`files`).
        const val VERSION = 2

        fun threadFiles(thread: JSONObject): List<String> =
            thread.optJSONArray("files")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: listOf(thread.getString("file"))
    }
}
