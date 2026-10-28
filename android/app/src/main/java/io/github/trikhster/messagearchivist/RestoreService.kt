package io.github.trikhster.messagearchivist

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.provider.DocumentsContract
import android.provider.Telephony
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.text.NumberFormat
import kotlin.concurrent.thread

/** How the current (or last) restore or backup is going; the screen reads it a few times a second. */
object RestoreState {
    @Volatile var starting = false // asked for, service not running yet
    @Volatile var running = false
    @Volatile var backingUp = false // the job is a backup of this phone, not a restore
    @Volatile var startedAt = 0L
    @Volatile var done = 0
    @Volatile var total = 0
    @Volatile var thread = ""
    @Volatile var sms = 0
    @Volatile var mms = 0
    @Volatile var skipped = 0
    @Volatile var result: Restorer.Result? = null
    @Volatile var error: String? = null
    @Volatile var stop = false
    // A backup's progress and result (done, total and thread above are shared).
    @Volatile var chats = 0
    @Volatile var media = 0
    @Volatile var left = -1.0 // seconds; below 0 while unknown
    @Volatile var backup: PhoneBackup.Result? = null
    @Volatile var backupName: String? = null

    // The last result is also saved: switching back to Google Messages takes the
    // SMS permissions away, and Android ends this app's process when it does, so
    // the screen would otherwise forget how the restore went.
    private const val PREFS = "last_restore"

    fun save(ctx: Context, uri: Uri?, path: String?) {
        val r = result
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply {
            if (r != null) { putInt("sms", r.sms); putInt("mms", r.mms); putInt("skipped", r.skipped); putInt("failed", r.failed); putBoolean("stopped", r.stopped) }
            error?.let { putString("error", it) }
            uri?.let { putString("uri", it.toString()) }
            path?.let { putString("path", it) }
        }.apply()
    }

    /** Brings back the last result after a restart; returns the file it came from. */
    fun load(ctx: Context): Pair<Uri?, String?>? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.contains("sms") && !p.contains("error")) return null
        if (p.contains("sms")) result = Restorer.Result(p.getInt("sms", 0), p.getInt("mms", 0), p.getInt("skipped", 0), p.getInt("failed", 0), p.getBoolean("stopped", false))
        error = p.getString("error", null)
        return p.getString("uri", null)?.let(Uri::parse) to p.getString("path", null)
    }

    fun clear(ctx: Context) {
        result = null; error = null
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}

/**
 * Runs a restore, or a backup of this phone, in the foreground (with a
 * notification and a wake lock), so years of messages can go in or out with
 * the screen off or another app open.
 */
class RestoreService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every start must go to the foreground within seconds, even one that
        // arrives while a restore is already running (it's then ignored).
        Notifications.channels(this)
        val n = progressNotification(this, RestoreState.done, RestoreState.total, getString(R.string.getting_ready), intent?.action == ACTION_BACKUP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(ID, n)
        if (intent?.action == ACTION_STOP) { RestoreState.stop = true; return START_NOT_STICKY }
        if (RestoreState.running) return START_NOT_STICKY
        if (intent?.action == ACTION_BACKUP) { backup(intent); return START_NOT_STICKY }
        val uri = intent?.data
        val only = intent?.getStringArrayExtra(EXTRA_THREADS)?.toSet()
        val path = intent?.getStringExtra(EXTRA_PATH)
        val self = intent?.getStringExtra(EXTRA_SELF)?.ifBlank { null } ?: ownNumber(this)
        RestoreState.apply { running = true; starting = false; backingUp = false; startedAt = System.currentTimeMillis(); done = 0; total = 0; thread = ""; sms = 0; mms = 0; skipped = 0; result = null; error = null; stop = false }
        thread(name = "restore") {
            val lock = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MessageArchivist:restore")
            lock.acquire(6 * 60 * 60 * 1000L)
            try {
                if (!isDefaultSmsApp(this)) throw IllegalStateException(getString(R.string.not_default))
                open(this, uri, path).use { pkg ->
                    val nm = getSystemService(NotificationManager::class.java)
                    var lastNote = 0L
                    val r = Restorer(this, pkg, self, only, { p ->
                        RestoreState.apply { done = p.done; total = p.total; thread = shown(p.thread); sms = p.sms; mms = p.mms; skipped = p.skipped }
                        val now = System.currentTimeMillis()
                        if (now - lastNote > 1000) { lastNote = now; nm.notify(ID, progressNotification(this, p.done, p.total, shown(p.thread))) }
                    }, { RestoreState.stop }).run()
                    RestoreState.result = r
                    Log.i(TAG, "restored sms=${r.sms} mms=${r.mms} skipped=${r.skipped} failed=${r.failed} stopped=${r.stopped}")
                }
            } catch (e: Exception) {
                RestoreState.error = e.message ?: e.toString()
                Log.e(TAG, "restore failed", e)
            } finally {
                lock.release()
                RestoreState.save(this, uri, path)
                RestoreState.running = false
                Notifications.finished(this)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    // A backup of this phone into the file picked on screen, new or brought up
    // to date (or, in debug builds, a path given by a test). A new backup that
    // fails leaves no file; an update that fails leaves the file as it was.
    private fun backup(intent: Intent) {
        val uri = intent.data
        val path = intent.getStringExtra(EXTRA_BACKUP_PATH)
        val withMedia = intent.getBooleanExtra(EXTRA_MEDIA, true)
        val update = intent.getBooleanExtra(EXTRA_UPDATE, false)
        // The chats chosen on screen (none: every chat).
        val only = intent.getStringArrayExtra(EXTRA_ONLY)?.toSet()
        // "Back up now" of the automatic backup: the same run as the job's (Daily.run).
        val auto = intent.getBooleanExtra(EXTRA_AUTO, false).let { if (it) Daily.setup(this)?.takeIf { s -> s.uri == uri } else null }
        RestoreState.apply {
            running = true; starting = false; backingUp = true; startedAt = System.currentTimeMillis(); done = 0; total = 0; thread = ""
            chats = 0; media = 0; left = -1.0; backup = null; error = null; stop = false; backupName = intent.getStringExtra(EXTRA_NAME) ?: path?.substringAfterLast('/')
        }
        thread(name = "backup") {
            val lock = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MessageArchivist:backup")
            lock.acquire(6 * 60 * 60 * 1000L)
            try {
                val nm = getSystemService(NotificationManager::class.java)
                var lastNote = 0L
                val progress = { p: PhoneBackup.Progress ->
                    RestoreState.apply { done = p.done; total = p.total; thread = shown(p.thread); chats = p.chats; media = p.media; left = p.secondsLeft ?: -1.0 }
                    val now = System.currentTimeMillis()
                    if (now - lastNote > 1000) { lastNote = now; nm.notify(ID, progressNotification(this, p.done, p.total, shown(p.thread), backup = true)) }
                }
                val r = if (auto != null) Daily.run(this, auto, progress) { RestoreState.stop }.also { ran ->
                    // Only the updates file was written: that's the file the result is about.
                    if (ran.updatesOnly) RestoreState.backupName = auto.updatesName
                }.result else BackupFiles.run(this, uri, path, update, withMedia, only, progress) { RestoreState.stop }
                RestoreState.backup = r
                Log.i(TAG, "backed up chats=${r.threads} sms=${r.sms} mms=${r.mms} media=${r.media} waiting=${r.mediaWaiting} failedMedia=${r.failedMedia} bytes=${r.bytes} added=${r.added} mediaAdded=${r.mediaAdded} updated=${r.updated} stopped=${r.stopped} leftOut=${r.leftOut} chosen=${r.chosen}")
                // The daily backup of this file counts this run as today's (not one of only some chats).
                if (uri != null && only == null && Daily.setup(this)?.uri == uri) Daily.record(this, r.added, null)
            } catch (e: Exception) {
                val why = BackupFiles.why(this, e)
                RestoreState.error = why
                Log.e(TAG, "backup failed", e)
                // The automatic backup's file: the failure is its last run (the first
                // screen says so, not the run before that worked), and the file stays.
                if (uri != null && only == null && Daily.setup(this)?.uri == uri) Daily.record(this, 0, why)
                else if (uri != null && !update) try { DocumentsContract.deleteDocument(contentResolver, uri) } catch (_: Exception) { /* nothing to tidy */ }
            } finally {
                lock.release()
                RestoreState.running = false
                Notifications.backedUp(this)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    companion object {
        const val TAG = "MessageArchivist"
        const val EXTRA_PATH = "restore_path"
        const val EXTRA_SELF = "self_number"
        const val EXTRA_THREADS = "threads"
        const val ACTION_STOP = "io.github.trikhster.messagearchivist.STOP"
        const val ACTION_BACKUP = "io.github.trikhster.messagearchivist.BACKUP"
        const val EXTRA_MEDIA = "with_media"
        const val EXTRA_NAME = "file_name"
        const val EXTRA_BACKUP_PATH = "backup_path"
        const val EXTRA_UPDATE = "update"
        const val EXTRA_AUTO = "auto"
        const val EXTRA_ONLY = "only_chats"
        private const val ID = 1

        /**
         * Whether this app holds the SMS role. Android 10+ is asked about the role
         * itself: Telephony.Sms.getDefaultSmsPackage() returns null to a
         * non-system SMS app asking about itself (it also checks a cell-broadcast
         * app-op only system apps can be given).
         */
        fun isDefaultSmsApp(ctx: Context): Boolean =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ctx.getSystemService(android.app.role.RoleManager::class.java).isRoleHeld(android.app.role.RoleManager.ROLE_SMS)
            else Telephony.Sms.getDefaultSmsPackage(ctx) == ctx.packageName

        /**
         * This phone's own number, if the phone knows it. Readable by the default
         * SMS app; many carriers don't store it on the SIM, so it can be null.
         */
        fun ownNumber(ctx: Context): String? {
            // Two ways, each allowed in different cases: tried one after the other.
            // Both are inside try: a refused permission is a SecurityException, caught here.
            @Suppress("MissingPermission")
            val viaSubscription = if (Build.VERSION.SDK_INT >= 33) try {
                ctx.getSystemService(android.telephony.SubscriptionManager::class.java)
                    .getPhoneNumber(android.telephony.SubscriptionManager.getDefaultSmsSubscriptionId())
            } catch (_: Exception) { null } else null
            val viaTelephony = if (viaSubscription.isNullOrBlank()) try {
                @Suppress("DEPRECATION", "MissingPermission") ctx.getSystemService(android.telephony.TelephonyManager::class.java).line1Number
            } catch (_: Exception) { null } else null
            return (viaSubscription?.ifBlank { null } ?: viaTelephony)?.filter { it.isDigit() || it == '+' }?.ifBlank { null }
        }

        /** The package from a picked file (content://), or a path (debug builds, for tests). */
        fun open(ctx: Context, uri: Uri?, path: String?): RestorePackage {
            val input: FileInputStream = when {
                uri != null -> ParcelFileDescriptor.AutoCloseInputStream(ctx.contentResolver.openFileDescriptor(uri, "r") ?: throw IllegalArgumentException("Couldn’t open that file."))
                path != null && BuildConfig.DEBUG -> FileInputStream(File(path))
                else -> throw IllegalArgumentException("No restore file chosen.")
            }
            return try { RestorePackage(input) } catch (e: Exception) { input.close(); throw e }
        }

        /**
         * A chat's name with its numbers shown as the extension shows them
         * (GMLib.formatNumber): "(555) 020-0015" in North America, "+44 770
         * 090 0123" elsewhere; names, short codes and business names as they are.
         */
        fun shown(title: String): String = title.split(", ").joinToString(", ") { t ->
            val raw = t.trim()
            val d = raw.filter { it.isDigit() }
            when {
                !Regex("""^\+?[\d\s().-]{3,}$""").matches(raw) -> raw
                d.length == 10 || (d.length == 11 && d[0] == '1') -> d.takeLast(10).let { "(${it.substring(0, 3)}) ${it.substring(3, 6)}-${it.substring(6)}" }
                raw.startsWith("+") && d.length in 11..15 -> d.takeLast(10).let { "+${d.dropLast(10)} ${it.substring(0, 3)} ${it.substring(3, 6)} ${it.substring(6)}" }
                else -> raw
            }
        }

        /** 38,281 rather than 38281, in the phone's own style. */
        fun count(v: Int): String = NumberFormat.getIntegerInstance().format(v)

        fun progressNotification(ctx: Context, done: Int, total: Int, title: String, backup: Boolean = false): Notification {
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            val stop = PendingIntent.getService(ctx, 1, Intent(ctx, RestoreService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
            val pct = if (total > 0) done * 100 / total else 0
            return Notification.Builder(ctx, Notifications.PROGRESS)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(when {
                    total == 0 -> ctx.getString(if (backup) R.string.backing_up else R.string.restoring)
                    else -> ctx.getString(if (backup) R.string.backing_up_pct else R.string.restoring_pct, pct)
                })
                .setContentText(if (total > 0) ctx.getString(R.string.progress_line, count(done), count(total), title) else title)
                .setProgress(total, done, total == 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .addAction(Notification.Action.Builder(null, ctx.getString(R.string.stop), stop).build())
                .build()
        }
    }
}

object Notifications {
    const val PROGRESS = "progress"
    const val ALERTS = "alerts"

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(PROGRESS, ctx.getString(R.string.channel_progress), NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(ALERTS, ctx.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun alert(ctx: Context, id: Int, title: String, text: String, switchBack: Boolean = false) {
        channels(ctx)
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val b = Notification.Builder(ctx, ALERTS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
        // "Open Google Messages": it asks to be the SMS app again.
        if (switchBack) ctx.packageManager.getLaunchIntentForPackage(MESSAGES)?.let {
            b.addAction(Notification.Action.Builder(null, ctx.getString(R.string.open_messages), PendingIntent.getActivity(ctx, 2, it, PendingIntent.FLAG_IMMUTABLE)).build())
        }
        ctx.getSystemService(NotificationManager::class.java).notify(id, b.build())
    }

    const val MESSAGES = "com.google.android.apps.messaging"

    fun finished(ctx: Context) {
        val r = RestoreState.result
        val err = RestoreState.error
        alert(ctx, 2, ctx.getString(if (err != null) R.string.restore_failed else R.string.restore_done),
            err ?: ctx.getString(R.string.done_line, RestoreService.count((r?.sms ?: 0) + (r?.mms ?: 0))), switchBack = err == null)
    }

    fun backedUp(ctx: Context) {
        val r = RestoreState.backup
        val err = RestoreState.error
        alert(ctx, 5, ctx.getString(when { err != null -> R.string.backup_failed; r?.stopped == true -> R.string.backup_stopped; r?.updated == true -> R.string.backup_updated; else -> R.string.backup_done }),
            err ?: if (r?.updated == true) ctx.getString(R.string.update_line, RestoreService.count(r.added), RestoreState.backupName ?: "")
            else ctx.getString(R.string.backup_line, RestoreService.count(r?.messages ?: 0), RestoreService.count(r?.threads ?: 0), RestoreState.backupName ?: ""))
    }

    fun dailyFailed(ctx: Context, why: String) = alert(ctx, 6, ctx.getString(R.string.daily_failed), why)

    fun dailyDone(ctx: Context, added: Int, name: String) =
        alert(ctx, 6, ctx.getString(R.string.daily_done), ctx.getString(R.string.update_line, RestoreService.count(added), name))

    fun incoming(ctx: Context, from: String) =
        alert(ctx, 3, ctx.getString(R.string.incoming_title), ctx.getString(R.string.incoming_text, from))

    fun incomingMms(ctx: Context) =
        alert(ctx, 4, ctx.getString(R.string.incoming_mms_title), ctx.getString(R.string.incoming_mms_text))
}
