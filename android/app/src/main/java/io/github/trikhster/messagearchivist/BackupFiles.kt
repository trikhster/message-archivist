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
 * can't, so the file is copied here, updated, and written back whole.
 */
object BackupFiles {
    fun run(
        ctx: Context, uri: Uri?, path: String?, update: Boolean, withMedia: Boolean,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val cr = ctx.contentResolver
        val debugPath = path?.takeIf { uri == null && BuildConfig.DEBUG }
        // A file that's still empty (just chosen for the daily backup) gets a whole backup.
        val empty = update && uri != null && try { cr.openFileDescriptor(uri, "r")?.use { it.statSize == 0L } ?: false } catch (_: Exception) { false }
        if (!update || empty) {
            val out = when {
                uri != null -> (try { cr.openOutputStream(uri, "wt") } catch (_: Exception) { null }) ?: cr.openOutputStream(uri, "w")
                debugPath != null -> FileOutputStream(File(debugPath))
                else -> null
            } ?: throw IllegalArgumentException("No file chosen for the backup.")
            return out.buffered(1 shl 16).use { PhoneBackup(ctx, it, null, withMedia, onProgress, cancelled).run() }
        }
        if (debugPath != null) return RandomAccessFile(debugPath, "rw").use { f -> update(ctx, f.channel, f.channel, withMedia, onProgress, cancelled) }
        uri ?: throw IllegalArgumentException("No backup chosen to update.")
        // In place, if the file can be written anywhere (a pipe can't: size -1).
        val pfd = try { cr.openFileDescriptor(uri, "rw") } catch (_: Exception) { null }
        if (pfd != null && pfd.statSize >= 0) pfd.use {
            val inCh = FileInputStream(it.fileDescriptor).channel
            val outCh = FileOutputStream(it.fileDescriptor).channel
            return update(ctx, inCh, outCh, withMedia, onProgress, cancelled)
        }
        pfd?.close()
        // Through a copy.
        val tmp = File(ctx.cacheDir, "backup-update.tar")
        try {
            cr.openInputStream(uri)?.use { i -> tmp.outputStream().use { i.copyTo(it, 1 shl 16) } } ?: throw IllegalStateException("Couldn’t read that backup.")
            val r = RandomAccessFile(tmp, "rw").use { f -> update(ctx, f.channel, f.channel, withMedia, onProgress, cancelled) }
            val out = (try { cr.openOutputStream(uri, "wt") } catch (_: Exception) { null }) ?: cr.openOutputStream(uri, "w") ?: throw IllegalStateException("Couldn’t write the backup back.")
            out.use { o -> tmp.inputStream().use { it.copyTo(o, 1 shl 16) } }
            return r
        } finally {
            tmp.delete()
        }
    }

    // New entries go where the old ones end (over the end-of-archive blocks),
    // then the file is cut to its new length.
    private fun update(
        ctx: Context, inCh: FileChannel, outCh: FileChannel, withMedia: Boolean,
        onProgress: (PhoneBackup.Progress) -> Unit, cancelled: () -> Boolean,
    ): PhoneBackup.Result {
        val prev = try { RestorePackage(inCh) {} } catch (e: Exception) { throw IllegalArgumentException("That file isn’t a backup from Message Archivist.") }
        val out = ChannelOut(outCh, prev.end)
        val buffered = BufferedOutputStream(out, 1 shl 16)
        val r = PhoneBackup(ctx, buffered, prev, withMedia, onProgress, cancelled).run()
        buffered.flush()
        outCh.truncate(out.position)
        outCh.force(true)
        return r.copy(bytes = out.position) // the whole file's size, not just what was added
    }
}

/**
 * Backing up by itself: a scheduled job brings the chosen backup file up to
 * date every hour, 6 or 12 hours, day or week, or every so many hours or days
 * (Settings, 1 hour to 30 days), when the battery isn't low, and
 * if asked only while charging or on Wi-Fi (the default for a file on Google
 * Drive or other online storage). Only what's new is added, so it takes
 * seconds. A run that goes wrong says so in a notification (and one that
 * works, if asked); the app shows the last run.
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
    )
    data class Last(val at: Long, val added: Int, val error: String?)

    fun isLocal(uri: Uri) = uri.authority in LOCAL

    fun setup(ctx: Context): Setup? = prefs(ctx).let { p ->
        p.getString("uri", null)?.let { u ->
            val uri = Uri.parse(u)
            Setup(uri, p.getString("name", "") ?: "", p.getBoolean("media", true), p.getInt("every", 24).coerceIn(HOURS), p.getBoolean("charging", false), p.getBoolean("wifi", !isLocal(uri)), p.getBoolean("notify", false))
        }
    }
    fun last(ctx: Context): Last? = prefs(ctx).takeIf { it.contains("at") }?.let { Last(it.getLong("at", 0), it.getInt("added", 0), it.getString("error", null)) }

    /** Turns it on, or changes how it runs (the last run is kept unless the file changed). */
    fun enable(ctx: Context, s: Setup) {
        val sameFile = setup(ctx)?.uri == s.uri
        prefs(ctx).edit().putString("uri", s.uri.toString()).putString("name", s.name).putBoolean("media", s.withMedia)
            .putInt("every", s.everyHours).putBoolean("charging", s.charging).putBoolean("wifi", s.wifi).putBoolean("notify", s.notify)
            .apply { if (!sameFile) { remove("at"); remove("added"); remove("error") } }.apply()
        val period = TimeUnit.HOURS.toMillis(s.everyHours.coerceIn(HOURS).toLong())
        ctx.getSystemService(JobScheduler::class.java).schedule(JobInfo.Builder(JOB, ComponentName(ctx, DailyBackupService::class.java))
            // A quarter of the period is the window Android may run it in (15 minutes at least).
            .setPeriodic(period, maxOf(TimeUnit.MINUTES.toMillis(15), period / 4))
            .setRequiresBatteryNotLow(true)
            .setRequiresCharging(s.charging)
            .setPersisted(true)
            .setRequiredNetworkType(if (s.wifi) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_NONE)
            .build())
    }

    fun disable(ctx: Context) {
        ctx.getSystemService(JobScheduler::class.java).cancel(JOB)
        prefs(ctx).edit().clear().apply()
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
                val r = BackupFiles.run(this, s.uri, null, update = true, withMedia = s.withMedia, onProgress = {}, cancelled = { stop })
                Log.i(RestoreService.TAG, "daily backup added=${r.added} media=${r.mediaAdded} stopped=${r.stopped}")
                again = r.stopped
                Daily.record(this, r.added, null)
                if (s.notify && !r.stopped) Notifications.dailyDone(this, r.added, s.name)
            } catch (e: Exception) {
                Log.e(RestoreService.TAG, "daily backup failed", e)
                fail(e.message ?: e.toString())
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
