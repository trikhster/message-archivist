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
/** How Choose chats lists the phone's chats. */
enum class ChatSort { NEWEST, OLDEST, MOST_MESSAGES, FEWEST_MESSAGES, LARGEST, SMALLEST, NAME }

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
    var backupOnline by mutableStateOf(false) // whether it went to a file online (Google Drive), which uploads it later
    var daily by mutableStateOf<Daily.Setup?>(null)
    var dailyLast by mutableStateOf<Daily.Last?>(null)
    var dailyHere by mutableStateOf(false) // the daily backup is the file just made or updated
    var copyBytes by mutableStateOf(0L) // the copy on the phone of the automatic backup's file online (PhoneCopy)
    var leaveOut by mutableStateOf<Set<String>>(emptySet()) // what phone backups leave out (Clutter)
    // Backing up only some chats (Back up this phone → Chats): the phone's
    // chats once read, which are ticked, the types hidden (a chat of a hidden
    // type isn't backed up), how they're listed, how much each holds once
    // worked out, and whether that list is open.
    var phoneChats by mutableStateOf<List<PhoneBackup.ChatInfo>?>(null)
    val ticked = mutableStateMapOf<String, Boolean>()
    var hidden by mutableStateOf<Set<String>>(emptySet())
    var chatSort by mutableStateOf(ChatSort.NEWEST)
    var chatSizes by mutableStateOf<Map<String, Long>?>(null)
    var choosing by mutableStateOf(false)
    /** The chats a backup is of, or null for a backup like any other (ChatChoice.chosen). */
    val only: Set<String>? get() = phoneChats?.let { all -> ChatChoice.chosen(all, { ticked[it] == true }, hidden, leaveOut) }
    var saveContacts by mutableStateOf(false) // phone backups save every contact (ContactBook)
    var copyShort by mutableStateOf(false) // left out by the last run: the phone was short of space
    var settings by mutableStateOf(false)
    var homeCounts by mutableStateOf<PhoneBackup.Summary?>(null) // this phone's messages, for the first screen
    // Other apps' exports for the phone backup (Exports): every one, and what a
    // share or Add a file… just added, or why it couldn't.
    var exports by mutableStateOf<List<Exports.Item>>(emptyList())
    var added by mutableStateOf<Exports.Item?>(null)
    var addError by mutableStateOf<String?>(null)

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
    private var sizing = false // working out the chats' sizes (Choose chats)
    private var addingFor: String? = null // the app whose section's Add a file… was tapped

    private val pick = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked == null) return@registerForActivityResult
        try { contentResolver.takePersistableUriPermission(picked, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) { /* this session only */ }
        clearResult(); uri = picked; path = null; load()
    }
    // An app's section → Add a file…: its downloaded export (or a chat's files), for the phone backup.
    private val addFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { picked ->
        if (picked.isNotEmpty()) addExports(picked, addingFor)
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
        if (picked != null) { keep(picked); startBackup(picked, update = false, withMedia = ui.withMedia, only = ui.only) }
    }
    private val toUpdate = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked != null) { keep(picked); startBackup(picked, update = true, withMedia = ui.withMedia, only = ui.only) }
    }
    // Settings → Automatic backup: the file it keeps up to date (made now, or one made before).
    private val autoNew = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-tar")) { picked ->
        if (picked != null) startAuto(picked, update = false)
    }
    private val autoExisting = registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked != null) startAuto(picked, update = true)
    }
    private val updatesNew = registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-tar")) { picked ->
        val d = Daily.setup(this)
        if (picked == null || d == null) return@registerForActivityResult
        keep(picked)
        fun info(u: Uri, col: String) = try { contentResolver.query(u, arrayOf(col), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null } } catch (_: Exception) { null }
        Daily.useUpdates(this, d, picked, info(picked, OpenableColumns.DISPLAY_NAME) ?: picked.lastPathSegment ?: "", info(d.uri, OpenableColumns.SIZE)?.toLongOrNull() ?: 0L)
        syncDaily()
        // Filled now, rather than left an empty file until the next run.
        dailyNow()
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

    // A file opened from Files or Drive; another app's export shared to it; or,
    // in debug builds, a path given by a test.
    private fun handle(intent: Intent?) {
        intent ?: return
        if (intent.action == Intent.ACTION_VIEW && intent.data != null) { clearResult(); uri = intent.data; path = null; load() }
        if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
            val got = shared(intent)
            intent.action = Intent.ACTION_MAIN // handled: not again when the screen is made again (turned, say)
            addExports(got, null)
            return
        }
        // Debug builds, for tests: back up into a file the app can write, at once
        // (only some chats: --esa only <keys>, a group's commas written \, which am keeps).
        val testBackup = intent.getStringExtra(RestoreService.EXTRA_BACKUP_PATH)
        if (BuildConfig.DEBUG && testBackup != null && canReadSms()) {
            Log.i(RestoreService.TAG, "test backup to $testBackup")
            RestoreState.apply { starting = true; backingUp = true; backup = null; error = null }
            startForegroundService(Intent(this, RestoreService::class.java).setAction(RestoreService.ACTION_BACKUP)
                .putExtra(RestoreService.EXTRA_BACKUP_PATH, testBackup).putExtra(RestoreService.EXTRA_MEDIA, intent.getBooleanExtra("media", true))
                .putExtra(RestoreService.EXTRA_UPDATE, intent.getBooleanExtra("update", false)).putExtra(RestoreService.EXTRA_ONLY, intent.getStringArrayExtra("only")?.map { it.replace("\\,", ",") }?.toTypedArray()))
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
        ui.phoneChats = null; ui.ticked.clear(); ui.choosing = false // every chat, until some are chosen
        ui.hidden = emptySet(); ui.chatSort = ChatSort.NEWEST; ui.chatSizes = null
        thread {
            val s = PhoneBackup.summary(this)
            runOnUiThread { ui.phone = s; ui.loading = false }
        }
    }

    override fun saveBackup() = saveAs.launch(getString(R.string.backup_file_name, LocalDate.now().toString()))

    override fun updateBackup() = toUpdate.launch(arrayOf("*/*"))

    // Choosing chats: the phone's are read the first time the list opens, then
    // how much each holds, in the background while it's open.
    override fun chooseChats() {
        ui.choosing = true
        if (ui.phoneChats != null) { workOutSizes(); return }
        ui.leaveOut = Clutter.chosen(this)
        thread {
            val list = PhoneBackup.chatList(this)
            runOnUiThread {
                if (!ui.choosing || ui.phoneChats != null) return@runOnUiThread // closed meanwhile: read again next time
                ui.phoneChats = list
                asTheyStart()
                workOutSizes()
            }
        }
    }

    // Every chat ticked and the kinds Settings leaves out hidden: a backup like any other.
    private fun asTheyStart() {
        ui.ticked.clear(); ui.phoneChats?.forEach { ui.ticked[it.key] = true }
        ui.hidden = ui.leaveOut
    }

    private fun workOutSizes() {
        if (ui.chatSizes != null || sizing) return
        sizing = true
        thread {
            val sizes = PhoneBackup.chatSizes(this) { !ui.choosing } // stops when the list closes
            runOnUiThread {
                sizing = false
                if (sizes != null) ui.chatSizes = sizes else if (ui.choosing) workOutSizes() // opened again as it stopped
            }
        }
    }

    override fun chatsDone() {
        ui.choosing = false
        // Nothing chosen would be no backup at all: back to how they started.
        if (ui.only?.isEmpty() == true) asTheyStart()
    }

    override fun allChats() = asTheyStart()

    private fun keep(uri: Uri) {
        try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        catch (_: SecurityException) { /* this session only: no daily backup to it */ }
    }

    // only: the chats chosen (null: every chat).
    private fun startBackup(to: Uri, update: Boolean, withMedia: Boolean, name: String? = null, auto: Boolean = false, only: Set<String>? = null) {
        val shown = name ?: try { contentResolver.query(to, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } } catch (_: Exception) { null }
            ?: to.lastPathSegment ?: ""
        backupUri = to
        ui.canShare = true
        ui.backupMedia = withMedia
        ui.backupOnline = !Daily.isLocal(to)
        RestoreState.apply { starting = true; backingUp = true; backup = null; error = null; backupName = shown }
        // Passing the file on needs the app's permission to it, which Android takes
        // away when the file is deleted or replaced (on Drive, say): say so, don't crash.
        try {
            startForegroundService(Intent(this, RestoreService::class.java).setAction(RestoreService.ACTION_BACKUP).setData(to)
                .putExtra(RestoreService.EXTRA_MEDIA, withMedia).putExtra(RestoreService.EXTRA_NAME, shown).putExtra(RestoreService.EXTRA_UPDATE, update).putExtra(RestoreService.EXTRA_AUTO, auto)
                .apply { if (only != null) putExtra(RestoreService.EXTRA_ONLY, only.toTypedArray()) }
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
        } catch (e: SecurityException) {
            Log.w(RestoreService.TAG, "backup file out of reach", e)
            ui.canShare = false
            RestoreState.apply { starting = false; error = BackupFiles.GONE }
            if (auto) Daily.record(this, 0, BackupFiles.GONE)
        }
    }

    // ---------- every day ----------

    private fun syncDaily() {
        lastDailyCheck = System.currentTimeMillis()
        Daily.ensureScheduled(this)
        ui.daily = Daily.setup(this)
        ui.dailyLast = Daily.last(this)
        ui.dailyHere = ui.daily != null && ui.daily?.uri == backupUri
        ui.copyBytes = ui.daily?.let { PhoneCopy.bytes(this, it.uri) } ?: 0L
        ui.copyShort = PhoneCopy.shortOfSpace(this)
        ui.leaveOut = Clutter.chosen(this)
        ui.saveContacts = ContactBook.on(this)
        ui.exports = Exports.all(this) // a backup in the background may have taken some in
    }

    override fun setDaily(on: Boolean) {
        val u = backupUri ?: return
        // Keeps how often, charging, Wi-Fi and notifications as they were set
        // (Wi-Fi only follows the file when it moves between the phone and online).
        val was = Daily.setup(this)
        if (on) Daily.enable(this, Daily.Setup(u, ui.backupName ?: "", ui.backupMedia, was?.everyHours ?: 24, was?.charging ?: false,
            if (was != null && Daily.isLocal(was.uri) == Daily.isLocal(u)) was.wifi else !Daily.isLocal(u), was?.notify ?: false, keepCopy = was?.keepCopy ?: true))
        else Daily.disable(this)
        syncDaily()
    }

    override fun dailyNow() {
        val d = Daily.setup(this) ?: return
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) { backUp(); return }
        startBackup(d.uri, update = true, withMedia = d.withMedia, name = d.name, auto = true)
    }

    // An updates file beside a backup kept online (Daily.useUpdates): made here, next to it.
    override fun dailyUpdates(on: Boolean) {
        val d = Daily.setup(this) ?: return
        if (on) updatesNew.launch(getString(R.string.updates_file_name, d.name.removeSuffix(".tar")))
        else { Daily.enable(this, d.copy(updatesUri = null, updatesName = null)); syncDaily() }
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

    // Codes, promotions or automated texts left out of every phone backup from now on.
    override fun leaveOut(kind: String, on: Boolean) {
        Clutter.choose(this, kind, on)
        ui.leaveOut = Clutter.chosen(this)
    }

    // Every contact saved into phone backups from now on (or no longer).
    override fun saveContacts(on: Boolean) {
        ContactBook.set(this, on)
        ui.saveContacts = ContactBook.on(this)
    }

    // Turning automatic backups on: the file is kept, set as the one to keep
    // up to date, and backed up now (a new file whole; one made before, what's new).
    private fun startAuto(uri: Uri, update: Boolean) {
        keep(uri)
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: uri.lastPathSegment ?: ""
        val was = Daily.setup(this)
        val s = Daily.Setup(uri, name, was?.withMedia ?: true, was?.everyHours ?: 24, was?.charging ?: false, if (was != null && Daily.isLocal(was.uri) == Daily.isLocal(uri)) was.wifi else !Daily.isLocal(uri), was?.notify ?: false,
            keepCopy = was?.keepCopy ?: true)
        Daily.enable(this, s)
        syncDaily()
        ui.settings = false
        // As an automatic run: a new file is still empty, so it's written whole,
        // and if that fails it's kept (emptied) and the failure shown, rather
        // than deleted like any new backup that fails, which left the automatic
        // backup pointing at a file that's gone.
        startBackup(uri, update = true, withMedia = s.withMedia, name = name, auto = true)
    }

    override fun shareBackup() {
        val u = backupUri ?: return
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/x-tar")
            .putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null))
    }

    override fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    // ---------- other apps ----------

    // What was shared: one file or several, as the stream or only as the clip.
    private fun shared(intent: Intent): List<Uri> {
        @Suppress("DEPRECATION")
        val streams: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM))
            else -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()
        }
        val clip = intent.clipData?.let { c -> (0 until c.itemCount).mapNotNull { c.getItemAt(it).uri } } ?: emptyList()
        return (streams + clip).distinct()
    }

    // An export copied into the app's storage, for the next backup (Exports):
    // shared to the app, or picked with Add a file… in an app's section (`app`).
    // Copying a big download takes a moment; the share's permission lasts while
    // this screen does.
    private fun addExports(uris: List<Uri>, app: String?) {
        ui.added = null; ui.addError = null; ui.settings = false
        if (uris.isEmpty()) { ui.addError = getString(R.string.share_no_file); return }
        ui.loading = true; ui.loadingText = R.string.share_adding
        thread {
            val r = runCatching { Exports.add(this, uris, app) }
            runOnUiThread {
                ui.loading = false
                ui.exports = Exports.all(this)
                r.onSuccess { ui.added = it }.onFailure { e ->
                    Log.w(RestoreService.TAG, "export not added: ${e.javaClass.simpleName}") // no file names: they can name people
                    ui.addError = if (e is Exports.NotAnExport) getString(R.string.share_not_export) else getString(R.string.share_failed, e.message ?: e.toString())
                }
            }
        }
    }

    override fun addExport(app: String) { addingFor = app; addFiles.launch(arrayOf("*/*")) }
    override fun removeExport(id: String) { Exports.remove(this, id); ui.exports = Exports.all(this) }
    override fun dismissAdded() { ui.added = null; ui.addError = null }

    // Back to the start: from a review, or after a backup.
    override fun home() {
        if (RestoreState.running) return
        if (RestoreState.backingUp) RestoreState.apply { backup = null; error = null; backingUp = false }
        ui.phone = null; ui.backup = null; ui.backingUp = false; ui.canShare = false; backupUri = null
        ui.phoneChats = null; ui.ticked.clear(); ui.choosing = false; ui.hidden = emptySet(); ui.chatSort = ChatSort.NEWEST; ui.chatSizes = null
        ui.manifest = null; ui.threads = emptyList(); uri = null; path = null; ui.message = null
    }
}
