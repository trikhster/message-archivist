package io.github.trikhster.messagearchivist

import android.Manifest
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.storage.StorageManager
import android.system.ErrnoException
import android.system.OsConstants
import android.text.format.DateUtils
import android.text.format.Formatter
import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Where a backup goes: a new file, written from the start; or a backup made
 * before, brought up to date (PhoneBackup with `previous`). An update adds to
 * the file in place when its storage can write anywhere in a file (the
 * phone's own storage, an SD card); online storage such as Google Drive
 * can't, so the file is copied here, updated, and written back whole; the
 * automatic backup's file online keeps that copy on the phone (PhoneCopy), so
 * it isn't downloaded every time. A file online that reads back empty soon
 * after this app wrote it is still being uploaded: it's left alone rather
 * than written whole again (notUploadedYet).
 */
object BackupFiles {
    // `only`: the keys of the chats chosen on screen (null: every chat).
    fun run(
        ctx: Context, uri: Uri?, path: String?, update: Boolean, withMedia: Boolean, only: Set<String>?,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result = write(ctx, uri, path, update, withMedia, only, onProgress, cancelled).also { r ->
        // Other apps' exports this file has now (a run that worked): their copies on the phone can go.
        if (r.exports.isNotEmpty()) Exports.written(ctx, r.exports, uri?.let { Exports.nameOf(ctx, it) } ?: path?.substringAfterLast('/') ?: "")
    }

    private fun write(
        ctx: Context, uri: Uri?, path: String?, update: Boolean, withMedia: Boolean, only: Set<String>?,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val cr = ctx.contentResolver
        val debugPath = path?.takeIf { uri == null && BuildConfig.DEBUG }
        if (uri != null && PhoneCopy.wanted(ctx, uri)) return throughPhoneCopy(ctx, uri, update, withMedia, only, onProgress, cancelled)
        // A file that's still empty (just chosen for the daily backup) gets a whole backup.
        val empty = update && uri != null && try { cr.openFileDescriptor(uri, "r")?.use { it.statSize == 0L } ?: false } catch (_: Exception) { false }
        if (empty) notUploadedYet(ctx, uri!!)?.let { throw IllegalStateException(it) }
        if (!update || empty) {
            val out = when {
                uri != null -> (try { cr.openOutputStream(uri, "wt") } catch (_: Exception) { null }) ?: cr.openOutputStream(uri, "w")
                debugPath != null -> FileOutputStream(File(debugPath))
                else -> null
            } ?: throw IllegalArgumentException("No file chosen for the backup.")
            return try {
                out.buffered(1 shl 16).use { PhoneBackup(ctx, it, null, withMedia, onProgress, cancelled, only = only).run() }.also { if (uri != null) wrote(ctx, uri, it.bytes) }
            } catch (e: Exception) {
                // The automatic backup's empty file, cut short: emptied again, so the
                // next run starts over instead of finding a file that isn't a backup.
                // (A new file that fails is deleted by RestoreService.)
                if (empty) try { cr.openOutputStream(uri!!, "wt")?.close() } catch (_: Exception) { }
                throw e
            }
        }
        if (debugPath != null) return RandomAccessFile(debugPath, "rw").use { f -> update(ctx, f.channel, f.channel, withMedia, only, onProgress, cancelled) }
            .let { it.copy(bytes = compact(File(debugPath), it.bytes)) }
        uri ?: throw IllegalArgumentException("No backup chosen to update.")
        // In place, if the file can be written anywhere (a pipe can't: size -1).
        val pfd = try { cr.openFileDescriptor(uri, "rw") } catch (_: Exception) { null }
        if (pfd != null && pfd.statSize >= 0) pfd.use {
            val inCh = FileInputStream(it.fileDescriptor).channel
            val outCh = FileOutputStream(it.fileDescriptor).channel
            return update(ctx, inCh, outCh, withMedia, only, onProgress, cancelled)
        }
        pfd?.close()
        // Through a copy.
        val tmp = File(ctx.cacheDir, "backup-update.tar")
        try {
            cr.openInputStream(uri)?.use { i -> tmp.outputStream().use { i.copyTo(it, 1 shl 16) } } ?: throw IllegalStateException("Couldn’t read that backup.")
            val r = RandomAccessFile(tmp, "rw").use { f -> update(ctx, f.channel, f.channel, withMedia, only, onProgress, cancelled) }
                .let { it.copy(bytes = compact(tmp, it.bytes)) }
            upload(ctx, uri, tmp)
            wrote(ctx, uri, r.bytes)
            return r
        } finally {
            tmp.delete()
        }
    }

    // The automatic backup's file online, with its copy on the phone: the copy
    // is brought up to date in place (made first from the file online, once)
    // and uploaded whole. The file online is never read back after that.
    private fun throughPhoneCopy(
        ctx: Context, uri: Uri, update: Boolean, withMedia: Boolean, only: Set<String>?,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val f = PhoneCopy.file(ctx)
        if (!PhoneCopy.has(ctx, uri)) {
            PhoneCopy.clear(ctx)
            if (update) ctx.contentResolver.openInputStream(uri)?.use { i -> f.outputStream().use { i.copyTo(it, 1 shl 16) } } ?: throw IllegalStateException("Couldn’t read that backup.")
        }
        val whole = !update || f.length() == 0L
        if (whole && update) notUploadedYet(ctx, uri)?.let { f.delete(); throw IllegalStateException(it) }
        val r = try {
            if (whole) f.outputStream().buffered(1 shl 16).use { PhoneBackup(ctx, it, null, withMedia, onProgress, cancelled, only = only).run() }
            else RandomAccessFile(f, "rw").use { update(ctx, it.channel, it.channel, withMedia, only, onProgress, cancelled) }.let { it.copy(bytes = compact(f, it.bytes)) }
        } catch (e: Exception) {
            // A whole backup cut short isn't a copy of anything, nor is a file just
            // downloaded that couldn't be updated; an update of a kept copy that
            // failed leaves it as it was (its old entries are intact).
            if (whole || !PhoneCopy.has(ctx, uri)) PhoneCopy.clear(ctx)
            throw e
        }
        // Kept even if the upload fails: the next run adds to it and uploads it again.
        try { upload(ctx, uri, f) } finally { PhoneCopy.keep(ctx, uri) }
        wrote(ctx, uri, r.bytes)
        return r
    }

    // A file this app owns (its phone copy, a download for one run, a test
    // file), rewritten without the entries later ones replaced (each run's old
    // manifest, a chat written again) once they're a quarter of it. Written
    // beside it and renamed over it, so it's never half done; if that can't
    // be done (no room), it stays as it is. Returns the file's size. A file
    // picked on the phone itself is never rewritten like this: it can't be
    // replaced in one step, and a phone switched off halfway would break it.
    private const val COMPACT_MIN = 1L shl 20

    private fun compact(f: File, size: Long): Long = try {
        val (dead, live) = RandomAccessFile(f, "r").use { r -> RestorePackage(r.channel) {}.let { it.deadBytes to it.live } }
        val out = File(f.parentFile, f.name + ".compact")
        if (dead < COMPACT_MIN || dead * 4 < size || (f.parentFile?.usableSpace ?: 0) < size - dead + COMPACT_MIN) size
        else {
            RandomAccessFile(f, "r").use { src ->
                FileOutputStream(out).use { o ->
                    val dst = o.channel
                    for ((_, at, n) in live) {
                        val end = at + 512 + (n + 511) / 512 * 512
                        var p = at
                        while (p < end) p += src.channel.transferTo(p, end - p, dst)
                    }
                    dst.write(java.nio.ByteBuffer.allocate(1024))
                    dst.force(true)
                }
            }
            if (out.renameTo(f)) f.length() else size.also { out.delete() }
        }
    } catch (e: Exception) {
        Log.w(RestoreService.TAG, "compacting skipped", e)
        File(f.parentFile, f.name + ".compact").delete()
        size
    }

    /** What went wrong, in words: a full phone said plainly ("ENOSPC" means nothing to anyone), anything else as it is. */
    fun why(ctx: Context, e: Throwable): String {
        if (isGone(e)) return GONE
        if (!isFull(e)) return e.message ?: e.toString()
        // Free as the phone's storage settings show it (Android keeps some back from apps).
        return "This phone ran out of space (${Formatter.formatShortFileSize(ctx, ctx.noBackupFilesDir.usableSpace)} free now). A backup is made on the phone before it goes anywhere, photos and all. " +
            "Free up some space, or turn off Include photos and videos for a much smaller file, then back up again."
    }

    /**
     * Whether `e` is the file itself out of reach: deleted, moved or replaced
     * (on Google Drive, say), which also takes away the app's permission to it.
     */
    fun isGone(e: Throwable) = generateSequence(e) { it.cause }.any { it is SecurityException || it is java.io.FileNotFoundException }

    const val GONE = "Message Archivist can’t open the backup file any more: it was probably deleted, moved or replaced (on Google Drive, say), which also takes away the app’s permission to it. " +
        "Choose the file again in Settings → Backup file → Change, or make a new one."

    /** Whether `e` is the phone's storage being full. */
    fun isFull(e: Throwable) = generateSequence(e) { it.cause }.any { (it as? ErrnoException)?.errno == OsConstants.ENOSPC || it.message?.contains("ENOSPC") == true }

    private fun upload(ctx: Context, uri: Uri, from: File) {
        val cr = ctx.contentResolver
        val out = (try { cr.openOutputStream(uri, "wt") } catch (_: Exception) { null }) ?: cr.openOutputStream(uri, "w") ?: throw IllegalStateException("Couldn’t write the backup back.")
        out.use { o -> from.inputStream().use { it.copyTo(o, 1 shl 16) } }
    }

    // What this app last wrote into each file online, and when. Google Drive
    // uploads a file in the background, and until it has, the file reads back
    // empty (and shows 0 bytes on Drive). A run that finds it so soon after
    // writing it shouldn't write the whole backup again: that only queues one
    // more upload of the same backup, and it isn't any closer to being online.
    private const val WROTE = "backup_files"
    private val UPLOAD_WAIT = TimeUnit.DAYS.toMillis(1)

    private fun wrote(ctx: Context, uri: Uri, bytes: Long) {
        if (!Daily.isLocal(uri)) ctx.getSharedPreferences(WROTE, Context.MODE_PRIVATE).edit().putString(uri.toString(), "$bytes ${System.currentTimeMillis()}").apply()
    }

    // Why not to write `uri` whole again, if it's empty only because it hasn't been uploaded yet.
    // After a day it's written again (the upload may have been lost).
    private fun notUploadedYet(ctx: Context, uri: Uri): String? {
        val (bytes, at) = ctx.getSharedPreferences(WROTE, Context.MODE_PRIVATE).getString(uri.toString(), null)
            ?.split(' ')?.mapNotNull { it.toLongOrNull() }?.takeIf { it.size == 2 } ?: return null
        if (bytes <= 0 || System.currentTimeMillis() - at > UPLOAD_WAIT) return null
        return "The backup written at ${DateUtils.formatDateTime(ctx, at, DateUtils.FORMAT_SHOW_TIME)} (${Formatter.formatShortFileSize(ctx, bytes)}) hasn’t been uploaded yet: online, the file is still empty. " +
            "It’s brought up to date once it has. If it stays empty, open the Google Drive app and check its uploads: some Wi-Fi networks (a guest or work one) hold them up."
    }

    /**
     * The updates file: a whole new package, written over what `uri` had, of
     * the messages after `since` (ms) only. Small, so rewriting and uploading
     * it each time costs little (see Daily.run).
     */
    fun writeUpdates(
        ctx: Context, uri: Uri, withMedia: Boolean, since: Long, baseName: String,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val cr = ctx.contentResolver
        val out = (try { cr.openOutputStream(uri, "wt") } catch (_: Exception) { null }) ?: cr.openOutputStream(uri, "w")
            ?: throw IllegalStateException("Couldn’t write the updates file.")
        return out.buffered(1 shl 16).use { PhoneBackup(ctx, it, null, withMedia, onProgress, cancelled, since = since, updatesFor = baseName).run() }
    }

    // New entries go where the old ones end (over the end-of-archive blocks),
    // then the file is cut to its new length.
    private fun update(
        ctx: Context, inCh: FileChannel, outCh: FileChannel, withMedia: Boolean, only: Set<String>?,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val prev = try { RestorePackage(inCh) {} } catch (e: Exception) { throw IllegalArgumentException("That file isn’t a backup from Message Archivist.") }
        val out = ChannelOut(outCh, prev.end)
        val buffered = BufferedOutputStream(out, 1 shl 16)
        val r = PhoneBackup(ctx, buffered, prev, withMedia, onProgress, cancelled, only = only).run()
        buffered.flush()
        outCh.truncate(out.position)
        outCh.force(true)
        return r.copy(bytes = out.position) // the whole file's size, not just what was added
    }
}

/**
 * A copy on the phone of the automatic backup's file online (Settings → "Keep
 * a copy on this phone", on unless turned off). Each update goes into it in
 * place and it's then uploaded whole, so the file online isn't downloaded
 * first, and a slow upload (0 bytes on Drive) can't be read back as an empty
 * file. It's in the app's own storage (noBackupFilesDir, left out of
 * Android's backup of the app), so nothing else can read it, and uninstalling
 * the app deletes it. Kept only while the phone has room to spare.
 */
object PhoneCopy {
    private const val PREFS = "phone_copy"
    private const val MIN_FREE = 1L shl 30 // left free after keeping it: 1 GB, or a tenth of the phone's storage if more

    fun file(ctx: Context) = File(ctx.noBackupFilesDir, "backup-copy.tar")

    /**
     * Whether `uri` is the automatic backup's file online, with a copy wanted,
     * and the phone has room for it: a copy is the whole backup, so one isn't
     * started on a phone that's already short of space (a copy it has is kept
     * up to date, and dropped after the run if it's then short).
     */
    fun wanted(ctx: Context, uri: Uri): Boolean {
        if (Daily.setup(ctx)?.let { it.uri == uri && it.keepCopy && !Daily.isLocal(uri) } != true) return false
        if (has(ctx, uri) || room(ctx)) return true
        prefs(ctx).edit().putBoolean("short", true).apply()
        return false
    }

    /** Whether the copy on the phone is a whole copy of `uri` (it's marked only after a run that worked). */
    fun has(ctx: Context, uri: Uri) = prefs(ctx).getString("uri", null) == uri.toString() && file(ctx).length() > 0

    /** The copy's size, if there's one of `uri`. */
    fun bytes(ctx: Context, uri: Uri) = if (has(ctx, uri)) file(ctx).length() else 0L

    /** Whether the last run left it out because the phone was short of space. */
    fun shortOfSpace(ctx: Context) = prefs(ctx).getBoolean("short", false)

    // After a run: marked as the copy of `uri` if the phone still has room to spare, else removed.
    fun keep(ctx: Context, uri: Uri) {
        val f = file(ctx)
        val room = room(ctx)
        if (f.length() > 0 && room) prefs(ctx).edit().putString("uri", uri.toString()).remove("short").apply()
        else { f.delete(); prefs(ctx).edit().remove("uri").putBoolean("short", !room).apply() }
    }

    // Room to spare: a tenth of the phone's storage free (at least 1 GB), as
    // Android counts it, cached data it can clear included.
    private fun room(ctx: Context): Boolean {
        val dir = ctx.noBackupFilesDir
        val free = try { ctx.getSystemService(StorageManager::class.java).let { it.getAllocatableBytes(it.getUuidForPath(dir)) } } catch (_: Exception) { dir.usableSpace }
        return free >= maxOf(MIN_FREE, dir.totalSpace / 10)
    }

    fun clear(ctx: Context) {
        file(ctx).delete()
        prefs(ctx).edit().clear().apply()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/**
 * Backing up by itself: a scheduled job brings the chosen backup file up to
 * date every hour, 6 or 12 hours, day or week, or every so many hours or days
 * (Settings, 1 hour to 30 days), when the battery isn't low, and
 * if asked only while charging or on Wi-Fi (the default for a file on Google
 * Drive or other online storage). Only what's new is added, so it takes
 * seconds. A run that goes wrong says so in a notification (and one that
 * works, if asked); the app shows the last run.
 *
 * A file online (Google Drive) can't be added to: each run adds to its copy
 * on the phone (PhoneCopy; without one, a copy downloaded for the run) and
 * uploads it whole, which for years of photos is gigabytes.
 * With an updates file beside it (`updatesUri`), runs write only what's new
 * since the big file was last brought up to date, into that small file; the
 * big one is brought up to date (and the updates file emptied) only when the
 * updates uploaded since add up to its size, or every 90 days. Over time
 * that uploads a small fraction of rewriting the big file every run.
 */
object Daily {
    private const val PREFS = "daily_backup"
    private const val JOB = 7
    private val LOCAL = setOf("com.android.externalstorage.documents", "com.android.providers.downloads.documents", "com.android.providers.media.documents")

    /** How often it may be asked to run: every hour to every 30 days. */
    val HOURS = 1..720

    data class Setup(
        val uri: Uri, val name: String, val withMedia: Boolean,
        val everyHours: Int = 24, val charging: Boolean = false, val wifi: Boolean = !isLocal(uri), val notify: Boolean = false,
        val updatesUri: Uri? = null, val updatesName: String? = null,
        val keepCopy: Boolean = true, // a file online: keep a copy on the phone (PhoneCopy)
    )
    /** The updates file's state: when the big file was last brought up to date, its size, and what's been uploaded since. */
    data class Base(val at: Long, val bytes: Long, val updatesSum: Long)

    // Messages can reach the phone dated earlier than they arrive (a picture
    // message fetched later): the updates file reaches this far back too.
    private val MARGIN = TimeUnit.DAYS.toMillis(2)
    private val FOLD_AFTER = TimeUnit.DAYS.toMillis(90)
    data class Last(val at: Long, val added: Int, val error: String?)

    fun isLocal(uri: Uri) = uri.authority in LOCAL

    fun setup(ctx: Context): Setup? = prefs(ctx).let { p ->
        p.getString("uri", null)?.let { u ->
            val uri = Uri.parse(u)
            Setup(uri, p.getString("name", "") ?: "", p.getBoolean("media", true), p.getInt("every", 24).coerceIn(HOURS), p.getBoolean("charging", false), p.getBoolean("wifi", !isLocal(uri)), p.getBoolean("notify", false),
                p.getString("updates_uri", null)?.let(Uri::parse), p.getString("updates_name", null), p.getBoolean("copy", true))
        }
    }
    fun base(ctx: Context): Base = prefs(ctx).let { Base(it.getLong("base_at", 0), it.getLong("base_bytes", 0), it.getLong("updates_sum", 0)) }

    /**
     * One automatic run (the job, or "Back up now"): the big file brought up
     * to date, or with an updates file, usually just that rewritten.
     */
    data class Ran(val result: PhoneBackup.Result, val updatesOnly: Boolean)

    fun run(ctx: Context, s: Setup, onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean): Ran {
        val started = System.currentTimeMillis()
        val u = s.updatesUri
        val b = base(ctx)
        val p = prefs(ctx)
        if (u != null && b.at > 0 && b.updatesSum < b.bytes && started - b.at < FOLD_AFTER) {
            val r = BackupFiles.writeUpdates(ctx, u, s.withMedia, b.at - MARGIN, s.name, onProgress, cancelled)
            if (r.stopped) return Ran(r, true)
            // The file holds everything since the big file's update; what's new is the difference.
            val before = p.getInt("updates_msgs", 0)
            p.edit().putLong("updates_sum", b.updatesSum + r.bytes).putInt("updates_msgs", r.messages).apply()
            return Ran(r.copy(added = maxOf(0, r.messages - before), mediaAdded = maxOf(0, r.media - p.getInt("updates_media", 0))), true)
                .also { p.edit().putInt("updates_media", r.media).apply() }
        }
        // The big file brought up to date; then the updates file starts again (all but empty).
        val r = BackupFiles.run(ctx, s.uri, null, update = true, withMedia = s.withMedia, only = null, onProgress, cancelled)
        if (r.stopped) return Ran(r, false)
        p.edit().putLong("base_at", started).putLong("base_bytes", r.bytes).putLong("updates_sum", 0).putInt("updates_msgs", 0).putInt("updates_media", 0).apply()
        if (u != null) BackupFiles.writeUpdates(ctx, u, s.withMedia, started - MARGIN, s.name, {}, cancelled).let { w ->
            p.edit().putInt("updates_msgs", w.messages).putInt("updates_media", w.media).apply()
        }
        return Ran(r, false)
    }

    /**
     * Starts using an updates file beside the big one. The big file's last
     * run (if it worked) is when it was last brought up to date; else the
     * next run does that first.
     */
    fun useUpdates(ctx: Context, s: Setup, updates: Uri, name: String, baseBytes: Long) {
        enable(ctx, s.copy(updatesUri = updates, updatesName = name))
        val l = last(ctx)
        prefs(ctx).edit().apply {
            if (l != null && l.error == null && baseBytes > 0) { putLong("base_at", l.at - TimeUnit.HOURS.toMillis(1)); putLong("base_bytes", baseBytes) } else { remove("base_at"); remove("base_bytes") }
            putLong("updates_sum", 0); putInt("updates_msgs", 0); putInt("updates_media", 0)
        }.apply()
    }

    fun last(ctx: Context): Last? = prefs(ctx).takeIf { it.contains("at") }?.let { Last(it.getLong("at", 0), it.getInt("added", 0), it.getString("error", null)) }

    /** Turns it on, or changes how it runs (the last run is kept unless the file changed). */
    fun enable(ctx: Context, s: Setup) {
        val sameFile = setup(ctx)?.uri == s.uri
        prefs(ctx).edit().putString("uri", s.uri.toString()).putString("name", s.name).putBoolean("media", s.withMedia)
            .putInt("every", s.everyHours).putBoolean("charging", s.charging).putBoolean("wifi", s.wifi).putBoolean("notify", s.notify).putBoolean("copy", s.keepCopy)
            .apply {
                if (s.updatesUri != null) putString("updates_uri", s.updatesUri.toString()).putString("updates_name", s.updatesName) else { remove("updates_uri"); remove("updates_name") }
                if (!sameFile) { remove("at"); remove("added"); remove("error"); remove("base_at"); remove("base_bytes"); remove("updates_sum") }
            }.apply()
        // The copy on the phone is of the old file, or no longer wanted.
        if (!sameFile || !s.keepCopy || isLocal(s.uri)) PhoneCopy.clear(ctx)
        val period = TimeUnit.HOURS.toMillis(s.everyHours.coerceIn(HOURS).toLong())
        // Android may refuse a job (a constraint it doesn't allow): say so on
        // the first screen ("The last backup didn't work") rather than crash.
        try { ctx.getSystemService(JobScheduler::class.java).schedule(JobInfo.Builder(JOB, ComponentName(ctx, DailyBackupService::class.java))
            // A quarter of the period is the window Android may run it in (15 minutes at least).
            .setPeriodic(period, maxOf(TimeUnit.MINUTES.toMillis(15), period / 4))
            .setRequiresBatteryNotLow(true)
            .setRequiresCharging(s.charging)
            .setPersisted(true)
            .setRequiredNetworkType(if (s.wifi) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_NONE)
            .build())
        } catch (e: Exception) {
            Log.e(RestoreService.TAG, "automatic backup couldn't be scheduled", e)
            record(ctx, 0, "Android wouldn’t schedule it: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    /**
     * Schedules it again if it's on but Android has nothing scheduled (a
     * schedule Android refused, say, or one an update dropped). Called when
     * the app comes to the front.
     */
    fun ensureScheduled(ctx: Context) {
        val s = setup(ctx) ?: return
        if (ctx.getSystemService(JobScheduler::class.java).getPendingJob(JOB) == null) enable(ctx, s)
    }

    fun disable(ctx: Context) {
        ctx.getSystemService(JobScheduler::class.java).cancel(JOB)
        prefs(ctx).edit().clear().apply()
        PhoneCopy.clear(ctx)
    }

    fun record(ctx: Context, added: Int, error: String?) {
        prefs(ctx).edit().putLong("at", System.currentTimeMillis()).putInt("added", added).apply { if (error != null) putString("error", error) else remove("error") }.apply()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** The daily job: an update of the chosen backup, in the background. */
class DailyBackupService : JobService() {
    @Volatile private var stop = false

    override fun onStartJob(params: JobParameters): Boolean {
        val s = Daily.setup(this) ?: return false
        if (RestoreState.running) return false // a restore or backup is on: today's can wait
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            fail(getString(R.string.daily_no_permission))
            return false
        }
        stop = false
        thread(name = "daily-backup") {
            var again = false
            try {
                val r = Daily.run(this, s, onProgress = {}, cancelled = { stop }).result
                Log.i(RestoreService.TAG, "daily backup added=${r.added} media=${r.mediaAdded} bytes=${r.bytes} stopped=${r.stopped}")
                again = r.stopped
                Daily.record(this, r.added, null)
                if (s.notify && !r.stopped) Notifications.dailyDone(this, r.added, s.name)
            } catch (e: Exception) {
                Log.e(RestoreService.TAG, "daily backup failed", e)
                fail(BackupFiles.why(this, e))
            }
            jobFinished(params, again)
        }
        return true
    }

    // Android stops long jobs: what's done is kept (the file is whole), and it carries on next time.
    override fun onStopJob(params: JobParameters): Boolean {
        stop = true
        return true
    }

    private fun fail(why: String) {
        Daily.record(this, 0, why)
        Notifications.dailyFailed(this, why)
    }
}
