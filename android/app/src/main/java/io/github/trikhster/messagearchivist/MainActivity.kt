package io.github.trikhster.messagearchivist

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.provider.Settings
import android.provider.Telephony
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalDate
import kotlinx.coroutines.delay
import org.json.JSONObject
import kotlin.concurrent.thread

/** A chat in the restore file, as the review screen lists it. */
data class ThreadInfo(val file: String, val title: String, val group: Boolean, val messages: Int, val first: Long, val last: Long)

/** Everything the screens show. The restore's own progress is copied in from RestoreState a few times a second. */
class UiState {
    var manifest by mutableStateOf<JSONObject?>(null)
    var threads by mutableStateOf<List<ThreadInfo>>(emptyList())
    val selected = mutableStateMapOf<String, Boolean>()
    var loading by mutableStateOf(false)
    var loadingText by mutableStateOf(R.string.reading_file)
    var loadError by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var isDefault by mutableStateOf(false)
    var askSelf by mutableStateOf(false)
    var self by mutableStateOf("")

    var running by mutableStateOf(false)
    var starting by mutableStateOf(false)
    var stopping by mutableStateOf(false)
    var startedAt by mutableStateOf(0L)
    var done by mutableStateOf(0)
    var total by mutableStateOf(0)
    var thread by mutableStateOf("")
    var sms by mutableStateOf(0)
    var mms by mutableStateOf(0)
    var skipped by mutableStateOf(0)
    var result by mutableStateOf<Restorer.Result?>(null)
    var error by mutableStateOf<String?>(null)

    // Backing up this phone.
    var phone by mutableStateOf<PhoneBackup.Summary?>(null)
    var withMedia by mutableStateOf(true)
    var smsDenied by mutableStateOf(false)
    var canShare by mutableStateOf(false)
    var backingUp by mutableStateOf(false)
    var chats by mutableStateOf(0)
    var media by mutableStateOf(0)
    var left by mutableStateOf(-1.0)
    var backup by mutableStateOf<PhoneBackup.Result?>(null)
    var backupName by mutableStateOf<String?>(null)
    var backupMedia by mutableStateOf(true) // whether the backup just made had photos
    var daily by mutableStateOf<Daily.Setup?>(null)
    var dailyLast by mutableStateOf<Daily.Last?>(null)
    var dailyHere by mutableStateOf(false) // the daily backup is the file just made or updated
    var settings by mutableStateOf(false)
    var homeCounts by mutableStateOf<PhoneBackup.Summary?>(null) // this phone's messages, for the first screen

    fun sync(default: Boolean) {
        val s = RestoreState
        isDefault = default
        running = s.running; starting = s.starting; stopping = s.stop && s.running
        startedAt = s.startedAt; done = s.done; total = s.total; thread = s.thread
        sms = s.sms; mms = s.mms; skipped = s.skipped; result = s.result; error = s.error
        backingUp = s.backingUp; chats = s.chats; media = s.media; left = s.left; backup = s.backup; backupName = s.backupName
    }
}

/**
 * The one screen (see Screens.kt): choose a restore file, review it and pick
 * chats, restore, then switch back to Google Messages; or back this phone up
 * into a file.
 */
class MainActivity : ComponentActivity(), Actions {
    private val ui = UiState()
    private var uri: Uri? = null
    private var path: String? = null
    private var askedNotifications = false
    private var autoStart = false // tests: start once the file is read
    private var backupUri: Uri? = null
    private var lastDailyCheck = 0L

    private val pick = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked == null) return@registerForActivityResult
        try { contentResolver.takePersistableUriPermission(picked, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { /* this session only */ }
        clearResult(); uri = picked; path = null; load()
    }
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { askRole() }
    private val role = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (isDefault()) startRestore() else ui.message = getString(R.string.needs_default)
    }
    // Backing up: reading texts (and contacts, for names; notifications, for progress), then where to save.
    private val readPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (canReadSms()) countPhone() else ui.smsDenied = true
    }
    // The file is kept writable for good: the daily backup updates it in the background.
    private val saveAs = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-tar")) { picked ->
        if (picked != null) { keep(picked); startBackup(picked, update = false, withMedia = ui.withMedia) }
    }
    private val toUpdate = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked != null) { keep(picked); startBackup(picked, update = true, withMedia = ui.withMedia) }
    }
    // Settings → Automatic backup: the file it keeps up to date (made now, or one made before).
    private val autoNew = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-tar")) { picked ->
        if (picked != null) startAuto(picked, update = false)
    }
    private val autoExisting = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked != null) startAuto(picked, update = true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // After a restart (see RestoreState.save): the last result, and for one
        // that stopped or failed, its file again, so Restore again can carry on.
        if (!RestoreState.running && RestoreState.result == null && RestoreState.error == null) {
            RestoreState.load(this)?.let { (u, p) ->
                if (RestoreState.error != null || RestoreState.result?.stopped == true) { uri = u; path = p; if (u != null || p != null) load(quiet = true) }
            }
        }
        handle(intent)
        setContent {
            RestoreTheme {
                LaunchedEffect(Unit) {
                    while (true) {
                        ui.sync(isDefault())
                        if (System.currentTimeMillis() - lastDailyCheck > 2000) syncDaily()
                        if (ui.running || ui.starting) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        delay(250)
                    }
                }
                RestoreApp(ui, this)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        countHome()
    }

    // This phone's counts for the first screen, if it may read texts.
    private fun countHome() {
        if (!canReadSms()) return
        thread { val c = PhoneBackup.summary(this); runOnUiThread { ui.homeCounts = c } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    // A file opened from Files or Drive; or, in debug builds, a path given by a test.
    private fun handle(intent: Intent?) {
        intent ?: return
        if (intent.action == Intent.ACTION_VIEW && intent.data != null) { clearResult(); uri = intent.data; path = null; load() }
        // Debug builds, for tests: back up into a file the app can write, at once.
        val testBackup = intent.getStringExtra(RestoreService.EXTRA_BACKUP_PATH)
        if (BuildConfig.DEBUG && testBackup != null && canReadSms()) {
            Log.i(RestoreService.TAG, "test backup to $testBackup")
            RestoreState.apply { starting = true; backingUp = true; backup = null; error = null }
            startForegroundService(Intent(this, RestoreService::class.java).setAction(RestoreService.ACTION_BACKUP)
                .putExtra(RestoreService.EXTRA_BACKUP_PATH, testBackup).putExtra(RestoreService.EXTRA_MEDIA, intent.getBooleanExtra("media", true))
                .putExtra(RestoreService.EXTRA_UPDATE, intent.getBooleanExtra("update", false)))
            return
        }
        val testPath = intent.getStringExtra(RestoreService.EXTRA_PATH)
        if (BuildConfig.DEBUG && testPath != null) {
            clearResult(); path = testPath; uri = null
            autoStart = intent.getBooleanExtra("auto", false) && isDefault()
            Log.i(RestoreService.TAG, "test file $testPath auto=$autoStart")
            load()
        }
    }

    // quiet: reopening a saved file in the background, where a file that's gone
    // just means starting over, not an error to show.
    private fun load(quiet: Boolean = false) {
        ui.loading = true; ui.loadingText = R.string.reading_file; ui.loadError = null; ui.message = null; ui.askSelf = false
        thread {
            try {
                val m = RestoreService.open(this, uri, path).use { it.manifest }
                val arr = m.getJSONArray("threads")
                val list = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
                    ThreadInfo(it.getString("file"), it.optString("title"), it.optBoolean("group"), it.optInt("messages"), it.optLong("first"), it.optLong("last"))
                }.sortedByDescending { it.last }
                runOnUiThread {
                    ui.manifest = m; ui.threads = list
                    ui.selected.clear(); list.forEach { ui.selected[it.file] = true }
                    ui.loading = false
                    if (autoStart) { autoStart = false; startRestore() }
                }
            } catch (e: Exception) {
                runOnUiThread { ui.manifest = null; ui.loadError = if (quiet) null else e.message ?: e.toString(); ui.loading = false }
            }
        }
    }

    private fun isDefault() = RestoreService.isDefaultSmsApp(this)

    // ---------- actions ----------

    override fun choose() = pick.launch(arrayOf("*/*"))

    // Notifications (Android 13+, asked once), then the SMS role, then go.
    override fun restore() {
        ui.message = null
        if (Build.VERSION.SDK_INT >= 33 && !askedNotifications && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotifications = true
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        askRole()
    }

    private fun askRole() {
        if (isDefault()) { startRestore(); return }
        role.launch(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) getSystemService(RoleManager::class.java).createRequestRoleIntent(RoleManager.ROLE_SMS)
            else Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, packageName))
    }

    private fun startRestore() {
        val chosen = ui.threads.filter { ui.selected[it.file] == true }
        if (chosen.isEmpty()) return
        // Group chats need this phone's own number (see Restorer). Readable now that
        // this is the SMS app; if the phone doesn't know it, ask once.
        if (chosen.any { it.group } && ui.self.isBlank()) {
            val own = RestoreService.ownNumber(this)
            if (own != null) ui.self = own
            else if (!ui.askSelf) { ui.askSelf = true; return }
        }
        Log.i(RestoreService.TAG, "starting restore (${chosen.size} chats, own number ${if (ui.self.isBlank()) "unknown" else "found"})")
        val i = Intent(this, RestoreService::class.java).setData(uri).putExtra(RestoreService.EXTRA_PATH, path)
            .putExtra(RestoreService.EXTRA_SELF, ui.self)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (chosen.size < ui.threads.size) i.putExtra(RestoreService.EXTRA_THREADS, chosen.map { it.file }.toTypedArray())
        RestoreState.starting = true
        startForegroundService(i)
    }

    override fun stop() { RestoreState.stop = true }

    override fun switchBack() {
        packageManager.getLaunchIntentForPackage(Notifications.MESSAGES)?.let { startActivity(it) } ?: openDefaultApps()
    }

    override fun openDefaultApps() {
        startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
    }

    // After a restore that stopped or failed: back to its file, to carry on. After
    // one that finished: back to the start, for another file.
    override fun reset() {
        val finished = RestoreState.error == null && RestoreState.result?.stopped == false
        clearResult()
        if (finished || ui.manifest == null) { ui.manifest = null; ui.threads = emptyList(); uri = null; path = null }
    }

    private fun clearResult() {
        RestoreState.clear(this)
        ui.result = null; ui.error = null
    }

    // ---------- backing up ----------

    private fun canReadSms() = checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    override fun backUp() {
        ui.smsDenied = false
        val want = listOfNotNull(Manifest.permission.READ_SMS, Manifest.permission.READ_CONTACTS,
            if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (want.isEmpty()) countPhone() else readPerms.launch(want.toTypedArray())
    }

    private fun countPhone() {
        ui.loading = true; ui.loadingText = R.string.counting
        thread {
            val s = PhoneBackup.summary(this)
            runOnUiThread { ui.phone = s; ui.loading = false }
        }
    }

    override fun saveBackup() = saveAs.launch(getString(R.string.backup_file_name, LocalDate.now().toString()))

    override fun updateBackup() = toUpdate.launch(arrayOf("*/*"))

    private fun keep(uri: Uri) {
        try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        catch (_: SecurityException) { /* this session only: no daily backup to it */ }
    }

    private fun startBackup(to: Uri, update: Boolean, withMedia: Boolean, name: String? = null) {
        val shown = name ?: contentResolver.query(to, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            ?: to.lastPathSegment ?: ""
        backupUri = to
        ui.canShare = true
        ui.backupMedia = withMedia
        RestoreState.apply { starting = true; backingUp = true; backup = null; error = null; backupName = shown }
        startForegroundService(Intent(this, RestoreService::class.java).setAction(RestoreService.ACTION_BACKUP).setData(to)
            .putExtra(RestoreService.EXTRA_MEDIA, withMedia).putExtra(RestoreService.EXTRA_NAME, shown).putExtra(RestoreService.EXTRA_UPDATE, update)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
    }

    // ---------- every day ----------

    private fun syncDaily() {
        lastDailyCheck = System.currentTimeMillis()
        ui.daily = Daily.setup(this)
        ui.dailyLast = Daily.last(this)
        ui.dailyHere = ui.daily != null && ui.daily?.uri == backupUri
    }

    override fun setDaily(on: Boolean) {
        val u = backupUri ?: return
        if (on) Daily.enable(this, Daily.Setup(u, ui.backupName ?: "", ui.backupMedia)) else Daily.disable(this)
        syncDaily()
    }

    override fun dailyNow() {
        val d = Daily.setup(this) ?: return
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) { backUp(); return }
        startBackup(d.uri, update = true, withMedia = d.withMedia, name = d.name)
    }

    override fun dailyOff() {
        Daily.disable(this)
        syncDaily()
    }

    // ---------- settings ----------

    override fun openSettings() { ui.settings = true; syncDaily() }
    override fun closeSettings() { ui.settings = false }

    override fun dailyChoose(newFile: Boolean) {
        if (!canReadSms()) { backUp(); return }
        if (newFile) autoNew.launch(getString(R.string.backup_file_name, LocalDate.now().toString())) else autoExisting.launch(arrayOf("*/*"))
    }

    override fun dailyChange(s: Daily.Setup) {
        Daily.enable(this, s)
        syncDaily()
    }

    // Turning automatic backups on: the file is kept, set as the one to keep
    // up to date, and backed up now (a new file whole; one made before, what's new).
    private fun startAuto(uri: Uri, update: Boolean) {
        keep(uri)
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: uri.lastPathSegment ?: ""
        val was = Daily.setup(this)
        val s = Daily.Setup(uri, name, was?.withMedia ?: true, was?.everyHours ?: 24, was?.charging ?: false, if (was != null && Daily.isLocal(was.uri) == Daily.isLocal(uri)) was.wifi else !Daily.isLocal(uri), was?.notify ?: false)
        Daily.enable(this, s)
        syncDaily()
        ui.settings = false
        startBackup(uri, update = update, withMedia = s.withMedia, name = name)
    }

    override fun shareBackup() {
        val u = backupUri ?: return
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/x-tar")
            .putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null))
    }

    override fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    // Back to the start: from a review, or after a backup.
    override fun home() {
        if (RestoreState.running) return
        if (RestoreState.backingUp) RestoreState.apply { backup = null; error = null; backingUp = false }
        ui.phone = null; ui.backup = null; ui.backingUp = false; ui.canShare = false; backupUri = null
        ui.manifest = null; ui.threads = emptyList(); uri = null; path = null; ui.message = null
    }
}
