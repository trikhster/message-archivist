package io.github.trikhster.messagearchivist

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.zip.ZipFile

/**
 * Other apps' exports for the phone backup (notes/Restore package.md →
 * Exports): a chat shared to this app from WhatsApp ("Export chat"), or a
 * download shared or added here (Apps). Each is copied into the app's own
 * storage, filesDir/exports/<id>/ (its files numbered, and export.json),
 * because a share's permission ends with it. The next backup run writes the
 * ones waiting into the backup file (PhoneBackup); once a run to a backup
 * file has worked (BackupFiles.run), their copies go and the record stays, to
 * show what went where. An updates file carries the ones waiting too, until
 * its big file catches up. The same files shared twice are one export.
 */
object Exports {
    class Part(val name: String, val file: File, val bytes: Long)

    /** `inFile`: the backup file it went into (null: waiting for the next backup). */
    class Item(val id: String, val app: String?, val title: String?, val addedAt: Long, val parts: List<Part>, val bytes: Long, val inFile: String?, val writtenAt: Long) {
        val waiting get() = inFile == null
    }

    /** What was shared isn't an export from an app this knows (Apps.detect). */
    class NotAnExport : Exception("not an export")

    private const val META = "export.json"
    private fun root(ctx: Context) = File(ctx.filesDir, "exports")

    /** Every export, newest first. */
    fun all(ctx: Context): List<Item> = (root(ctx).listFiles() ?: emptyArray()).mapNotNull { read(it) }.sortedByDescending { it.addedAt }

    fun waiting(ctx: Context) = all(ctx).filter { it.waiting }

    private fun read(dir: File): Item? = try {
        val j = JSONObject(File(dir, META).readText())
        val parts = j.getJSONArray("files").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
            .map { Part(it.getString("name"), File(dir, it.getString("file")), it.getLong("bytes")) }
        Item(j.getString("id"), j.optString("app").ifEmpty { null }, j.optString("title").ifEmpty { null }, j.getLong("added_at"),
            parts, parts.sumOf { it.bytes }, j.optString("in_file").ifEmpty { null }, j.optLong("written_at"))
    } catch (_: Exception) { null }

    /**
     * Copies what was shared or picked into one export. `app`: the app it was
     * added for (Add a file… in its section), taken when the files don't say;
     * a share must be recognisable by itself, or it's NotAnExport.
     */
    fun add(ctx: Context, uris: List<Uri>, app: String? = null): Item {
        require(uris.isNotEmpty()) { "Nothing was shared." }
        val tmp = File(root(ctx), ".adding-${System.nanoTime()}").apply { mkdirs() }
        try {
            val sha = MessageDigest.getInstance("SHA-256")
            val parts = uris.mapIndexed { i, u ->
                val name = nameOf(ctx, u) ?: "file-${i + 1}"
                val file = File(tmp, "${i + 1}${ext(name)}")
                val input = ctx.contentResolver.openInputStream(u) ?: throw IllegalStateException("Couldn’t read $name.")
                DigestInputStream(input, sha).use { d -> file.outputStream().use { d.copyTo(it, 1 shl 16) } }
                Part(name, file, file.length())
            }
            val names = parts.map { it.name }
            val zip = parts.firstOrNull { it.name.endsWith(".zip", true) }?.file
            val found = zip?.let { z -> try { ZipFile(z).use { f -> detectIn(names, f) } } catch (_: Exception) { null } } ?: Apps.detect(names)
            val which = found ?: app ?: throw NotAnExport()
            val id = sha.digest().joinToString("") { "%02x".format(it) }.take(16)
            val dir = File(root(ctx), id)
            // Shared before: the same export, as it was.
            read(dir)?.let { return it }
            val meta = JSONObject().put("id", id).put("app", which).put("title", if (which == "whatsapp") Apps.title(names) ?: "" else "")
                .put("added_at", System.currentTimeMillis())
                .put("files", JSONArray(parts.map { JSONObject().put("name", it.name).put("file", it.file.name).put("bytes", it.bytes) }))
            File(tmp, META).writeText(meta.toString())
            dir.deleteRecursively()
            if (!tmp.renameTo(dir)) throw IllegalStateException("Couldn’t keep it in the app’s storage.")
            return read(dir) ?: throw IllegalStateException("Couldn’t keep it in the app’s storage.")
        } finally {
            tmp.deleteRecursively()
        }
    }

    // A zip's paths, and the start of its JSON files, for Apps.detect.
    private fun detectIn(names: List<String>, zip: ZipFile): String? {
        val inside = zip.entries().asSequence().filter { !it.isDirectory }.map { it.name }.toList()
        return Apps.detect(names, inside) { path ->
            zip.entries().asSequence().firstOrNull { it.name.lowercase() == path }?.let { e ->
                zip.getInputStream(e).use { s ->
                    val buf = ByteArray(4000)
                    var n = 0
                    while (n < buf.size) { val r = s.read(buf, n, buf.size - n); if (r < 0) break; n += r }
                    String(buf, 0, n, Charsets.UTF_8)
                }
            }
        }
    }

    /** Written into the backup file `file` (BackupFiles.run worked): the copies go, the record stays. */
    fun written(ctx: Context, ids: Collection<String>, file: String) {
        for (id in ids) {
            val dir = File(root(ctx), id)
            val j = try { JSONObject(File(dir, META).readText()) } catch (_: Exception) { continue }
            j.getJSONArray("files").let { a -> (0 until a.length()).forEach { File(dir, a.getJSONObject(it).getString("file")).delete() } }
            File(dir, META).writeText(j.put("in_file", file).put("written_at", System.currentTimeMillis()).toString())
        }
    }

    /** An export no longer wanted (one waiting: it won't go into a backup). */
    fun remove(ctx: Context, id: String) {
        if (id.isNotEmpty() && !id.contains('/')) File(root(ctx), id).deleteRecursively()
    }

    /** A file's name as the app that has it shows it. */
    fun nameOf(ctx: Context, uri: Uri): String? = try {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null }
    } catch (_: Exception) { null } ?: uri.lastPathSegment?.substringAfterLast('/')

    // A file's extension, for its entry in the backup: ".zip", ".txt" (letters and digits only).
    fun ext(name: String) = Regex("""\.[A-Za-z0-9]{1,8}$""").find(name)?.value?.lowercase() ?: ""
}
