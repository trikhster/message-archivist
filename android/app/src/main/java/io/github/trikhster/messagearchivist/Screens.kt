package io.github.trikhster.messagearchivist

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TriStateCheckbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import org.json.JSONObject

/** What the screen can ask the activity to do. */
interface Actions {
    fun choose()
    fun restore()
    fun stop()
    fun switchBack()
    fun openDefaultApps()
    fun reset()
    fun backUp()
    fun saveBackup()
    fun updateBackup()
    fun setDaily(on: Boolean)
    fun dailyNow()
    fun dailyOff()
    fun openSettings()
    fun closeSettings()
    fun dailyChoose(newFile: Boolean)
    fun dailyChange(s: Daily.Setup)
    fun openAppSettings()
    fun shareBackup()
    fun home()
}

private enum class Phase { WELCOME, LOADING, SETTINGS, REVIEW, BACKUP_REVIEW, RUNNING, DONE, BACKUP_DONE }

private val nf: NumberFormat = NumberFormat.getIntegerInstance()
private fun n(v: Number) = nf.format(v)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RestoreApp(ui: UiState, a: Actions) {
    val phase = when {
        ui.running || ui.starting -> Phase.RUNNING
        ui.backingUp && (ui.backup != null || ui.error != null) -> Phase.BACKUP_DONE
        ui.result != null || ui.error != null -> Phase.DONE
        ui.loading -> Phase.LOADING
        ui.settings -> Phase.SETTINGS
        ui.phone != null -> Phase.BACKUP_REVIEW
        ui.manifest != null -> Phase.REVIEW
        else -> Phase.WELCOME
    }
    // Back from a review goes to the start, not out of the app.
    BackHandler(enabled = phase == Phase.REVIEW || phase == Phase.BACKUP_REVIEW || phase == Phase.BACKUP_DONE) { a.home() }
    BackHandler(enabled = phase == Phase.DONE) { a.reset() }
    BackHandler(enabled = phase == Phase.SETTINGS) { a.closeSettings() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (phase == Phase.SETTINGS) R.string.settings else R.string.app_name), fontWeight = FontWeight.Medium) },
                navigationIcon = {
                    if (phase == Phase.SETTINGS) IconButton(onClick = a::closeSettings) { Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.navigate_back)) }
                    else Icon(painterResource(R.drawable.ic_restore), null, Modifier.padding(start = 16.dp, end = 8.dp), tint = MaterialTheme.colorScheme.primary)
                },
                actions = {
                    if (phase == Phase.WELCOME) IconButton(onClick = a::openSettings) { Icon(painterResource(R.drawable.ic_settings), stringResource(R.string.settings)) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        bottomBar = {
            when (phase) {
                Phase.REVIEW -> ReviewBar(ui, a)
                Phase.BACKUP_REVIEW -> BackupBar(ui, a)
                else -> Unit
            }
        },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { pad ->
        AnimatedContent(
            targetState = phase,
            transitionSpec = { fadeIn(tween(240)) togetherWith fadeOut(tween(120)) },
            label = "phase",
            modifier = Modifier.padding(pad).fillMaxSize(),
        ) { p ->
            when (p) {
                Phase.WELCOME -> Welcome(ui, a)
                Phase.LOADING -> Loading(ui)
                Phase.SETTINGS -> SettingsScreen(ui, a)
                Phase.REVIEW -> Review(ui, a)
                Phase.BACKUP_REVIEW -> BackupReview(ui, a)
                Phase.RUNNING -> Running(ui, a)
                Phase.DONE -> Done(ui, a)
                Phase.BACKUP_DONE -> BackupDone(ui, a)
            }
        }
    }
}

// ---------- pieces ----------

@Composable
private fun Hero(@DrawableRes icon: Int, container: Color, content: Color) {
    Surface(shape = CircleShape, color = container, modifier = Modifier.size(80.dp)) {
        Box(contentAlignment = Alignment.Center) { Icon(painterResource(icon), null, Modifier.size(40.dp), tint = content) }
    }
}

@Composable
private fun Avatar(title: String, group: Boolean) {
    val letter = title.firstOrNull { it.isLetter() }?.uppercaseChar()
    Box(Modifier.size(40.dp).clip(CircleShape).background(avatarColor(title)), contentAlignment = Alignment.Center) {
        when {
            group -> Icon(painterResource(R.drawable.ic_group), null, Modifier.size(22.dp), tint = Color.White)
            letter != null -> Text(letter.toString(), color = Color.White, style = MaterialTheme.typography.titleMedium)
            else -> Icon(painterResource(R.drawable.ic_person), null, Modifier.size(22.dp), tint = Color.White)
        }
    }
}

@Composable
private fun Stat(@DrawableRes icon: Int, value: String, label: String, modifier: Modifier = Modifier, note: String? = null) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(painterResource(icon), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(6.dp))
        Text(value, style = MaterialTheme.typography.titleLarge)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (note != null) Text(note, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun InfoCard(@DrawableRes icon: Int, title: String, text: String, container: Color, content: Color, action: (@Composable () -> Unit)? = null) {
    Card(colors = CardDefaults.cardColors(containerColor = container, contentColor = content), shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(painterResource(icon), null, Modifier.size(24.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                if (text.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(text, style = MaterialTheme.typography.bodyMedium)
                }
                if (action != null) { Spacer(Modifier.height(8.dp)); action() }
            }
        }
    }
}

/** Shown on every screen while this app is the SMS app and nothing is restoring. */
@Composable
private fun StillDefault(ui: UiState, a: Actions) {
    AnimatedVisibility(ui.isDefault && !ui.running && !ui.starting, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        Box(Modifier.padding(bottom = 16.dp)) {
            InfoCard(R.drawable.ic_warning, stringResource(R.string.still_default_title), stringResource(R.string.still_default_text),
                MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) {
                FilledTonalButton(onClick = a::switchBack) { Text(stringResource(R.string.switch_back)) }
            }
        }
    }
}

// Restore speed, measured on the emulator (38,281 messages in 7½ minutes): texts go
// in by the hundred, a picture or group message takes several writes of its own.
private const val SMS_PER_SEC = 250.0
private const val MMS_PER_SEC = 15.0
private const val BYTES_PER_SEC = 15e6

/** Work for one message on average in this file, counting a text as 1. */
private fun workPerMessage(c: JSONObject): Double {
    val all = c.optInt("messages")
    return if (all > 0) (c.optInt("sms") + c.optInt("mms") * SMS_PER_SEC / MMS_PER_SEC) / all else 1.0
}

private fun minutesText(ctx: android.content.Context, seconds: Double): String = when {
    seconds < 90 -> ctx.getString(R.string.less_than_minute)
    seconds < 3600 -> ctx.getString(R.string.n_minutes, Math.round(seconds / 60).toInt())
    else -> ctx.getString(R.string.n_hours, "%.1f".format(seconds / 3600))
}

private fun sizeText(bytes: Long) = when {
    bytes >= 1_000_000_000 -> "%.1f GB".format(bytes / 1e9)
    bytes >= 1_000_000 -> "%.0f MB".format(bytes / 1e6)
    else -> "%d KB".format(maxOf(1, bytes / 1000))
}

private fun year(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).year

// ---------- welcome ----------

@Composable
private fun Welcome(ui: UiState, a: Actions) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
        StillDefault(ui, a)
        StatusCard(ui, a)
        if (ui.smsDenied) {
            Spacer(Modifier.height(16.dp))
            InfoCard(R.drawable.ic_warning, stringResource(R.string.needs_read_sms_title), stringResource(R.string.needs_read_sms),
                MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) {
                FilledTonalButton(onClick = a::openAppSettings) { Text(stringResource(R.string.app_settings)) }
            }
        }
        Spacer(Modifier.height(16.dp))
        // Backup: what it does, then go.
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(vertical = 12.dp)) {
                CardTitle(R.drawable.ic_backup, stringResource(R.string.backup_card))
                Text(stringResource(R.string.backup_card_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                Button(onClick = a::backUp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().height(52.dp)) {
                    Icon(painterResource(R.drawable.ic_backup), null, Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.backup_card), style = MaterialTheme.typography.titleSmall)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        // Restore: the three steps, then the file.
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(vertical = 12.dp)) {
                CardTitle(R.drawable.ic_restore, stringResource(R.string.restore_card))
                listOf(R.string.step1 to R.string.step1_text, R.string.step2 to R.string.step2_text, R.string.step3 to R.string.step3_text).forEachIndexed { i, (t, d) ->
                    ListItem(
                        headlineContent = { Text(stringResource(t), style = MaterialTheme.typography.titleSmall) },
                        supportingContent = { Text(stringResource(d)) },
                        leadingContent = {
                            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(32.dp)) {
                                Box(contentAlignment = Alignment.Center) { Text("${i + 1}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer) }
                            }
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                }
                ui.loadError?.let {
                    Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        InfoCard(R.drawable.ic_error, stringResource(R.string.failed_title), it, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
                FilledTonalButton(onClick = a::choose, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().height(52.dp)) {
                    Icon(painterResource(R.drawable.ic_folder_open), null, Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.choose), style = MaterialTheme.typography.titleSmall)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

// "3 hours ago", or "just now".
@Composable
private fun ago(at: Long): String =
    if (System.currentTimeMillis() - at < 60_000) stringResource(R.string.just_now)
    else android.text.format.DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), android.text.format.DateUtils.MINUTE_IN_MILLIS).toString().lowercase()

// "every hour", "every 6 hours", "every day", "every 3 days", "every week".
@Composable
private fun everyText(hours: Int): String = when {
    hours <= 1 -> stringResource(R.string.every_hour)
    hours == 24 -> stringResource(R.string.every_day)
    hours == 168 -> stringResource(R.string.every_week)
    hours % 24 == 0 -> stringResource(R.string.every_n_days, hours / 24)
    else -> stringResource(R.string.every_n_hours, hours)
}

/** Every so many hours or days, from 1 hour to 30 days (Daily.HOURS). */
@Composable
private fun CustomEveryDialog(current: Int, onDismiss: () -> Unit, onSet: (Int) -> Unit) {
    var days by remember { mutableStateOf(current >= 24 && current % 24 == 0) }
    var text by remember { mutableStateOf((if (days) current / 24 else current).toString()) }
    val hours = text.toIntOrNull()?.let { if (days) it * 24 else it }
    val ok = hours != null && hours in Daily.HOURS
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.s_custom_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = text, onValueChange = { v -> text = v.filter(Char::isDigit).take(3) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = !ok, modifier = Modifier.fillMaxWidth(),
                )
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(selected = !days, onClick = { days = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text(stringResource(R.string.s_custom_hours)) }
                    SegmentedButton(selected = days, onClick = { days = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text(stringResource(R.string.s_custom_days)) }
                }
                Text(stringResource(R.string.s_custom_range), style = MaterialTheme.typography.bodySmall, color = if (ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton(onClick = { hours?.let(onSet) }, enabled = ok) { Text(stringResource(R.string.s_ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.s_cancel)) } },
    )
}

// The first thing on the first screen: are this phone's texts backed up?
// Backed up (with when, and where), backing up but not yet run, the last run
// failed, or not backed up yet; this phone's counts; and what to do.
@Composable
private fun StatusCard(ui: UiState, a: Actions) {
    val d = ui.daily
    val last = ui.dailyLast
    val problem = d != null && last?.error != null
    val safe = d != null && last != null && !problem
    val (container, content) = when {
        problem -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        d != null -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        else -> MaterialTheme.colorScheme.surfaceContainerHigh to MaterialTheme.colorScheme.onSurface
    }
    Card(colors = CardDefaults.cardColors(containerColor = container, contentColor = content), shape = RoundedCornerShape(28.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = content.copy(alpha = 0.12f), contentColor = content, modifier = Modifier.size(52.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(painterResource(when { problem -> R.drawable.ic_error; safe -> R.drawable.ic_check_circle; d != null -> R.drawable.ic_schedule; else -> R.drawable.ic_backup }), null, Modifier.size(28.dp))
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(when { problem -> R.string.home_problem; safe -> R.string.home_safe; d != null -> R.string.home_auto_on; else -> R.string.home_not_yet }), style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(2.dp))
                    Text(when {
                        problem -> last!!.error!!
                        safe -> stringResource(R.string.home_safe_when, ago(last!!.at), d!!.name)
                        d != null -> stringResource(R.string.home_soon, everyText(d.everyHours), d.name)
                        else -> stringResource(R.string.home_not_yet_text)
                    }, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
            }
            ui.homeCounts?.let { c ->
                Spacer(Modifier.height(14.dp))
                Text(stringResource(R.string.home_counts, n(c.messages), n(c.threads), n(c.media)), style = MaterialTheme.typography.bodySmall, color = content.copy(alpha = 0.8f))
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (d != null) Button(onClick = a::dailyNow) { Text(stringResource(R.string.back_up_now)) }
                else Button(onClick = a::openSettings) { Text(stringResource(R.string.s_auto_on)) }
                Spacer(Modifier.width(8.dp))
                // The card's own text colour: the theme's primary can be too close to the card in some phone colour schemes.
                TextButton(onClick = a::openSettings, colors = ButtonDefaults.textButtonColors(contentColor = content)) { Text(stringResource(R.string.settings)) }
            }
        }
    }
}

@Composable
private fun CardTitle(@DrawableRes icon: Int, title: String) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Text(title, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun Loading(ui: UiState) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(strokeCap = StrokeCap.Round)
        Spacer(Modifier.height(16.dp))
        Text(stringResource(ui.loadingText), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ---------- settings ----------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun SettingsScreen(ui: UiState, a: Actions) {
    val d = ui.daily
    var choosing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
        SectionTitle(stringResource(R.string.s_auto))
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(vertical = 8.dp)) {
                SettingRow(R.drawable.ic_schedule, stringResource(R.string.s_auto_on), stringResource(R.string.s_auto_on_text), d != null) { on ->
                    if (!on) { a.dailyOff(); choosing = false } else choosing = true
                }
                AnimatedVisibility(choosing || (d == null && choosing), enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(stringResource(R.string.s_auto_choose), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { choosing = false; a.dailyChoose(true) }) { Text(stringResource(R.string.s_new_file)) }
                            OutlinedButton(onClick = { choosing = false; a.dailyChoose(false) }) { Text(stringResource(R.string.s_existing_file)) }
                        }
                    }
                }
                if (d != null) {
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.s_file)) },
                        supportingContent = { Text("${d.name}\n${stringResource(if (Daily.isLocal(d.uri)) R.string.s_on_phone else R.string.s_online)}") },
                        leadingContent = { Icon(painterResource(R.drawable.ic_folder_open), null) },
                        trailingContent = { TextButton(onClick = { choosing = !choosing }) { Text(stringResource(R.string.s_change)) } },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(stringResource(R.string.s_how_often), style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.height(8.dp))
                        // The usual choices, and any number of hours or days.
                        val options = listOf(1 to R.string.s_every_1, 6 to R.string.s_every_6, 12 to R.string.s_every_12, 24 to R.string.s_every_24, 168 to R.string.s_every_168)
                        val custom = options.none { it.first == d.everyHours }
                        var customOpen by remember { mutableStateOf(false) }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            options.forEach { (h, label) ->
                                FilterChip(selected = d.everyHours == h, onClick = { a.dailyChange(d.copy(everyHours = h)) }, label = { Text(stringResource(label)) })
                            }
                            FilterChip(selected = custom, onClick = { customOpen = true },
                                label = { Text(if (custom) everyText(d.everyHours).replaceFirstChar { it.uppercase() } else stringResource(R.string.s_every_custom)) })
                        }
                        if (customOpen) CustomEveryDialog(d.everyHours, { customOpen = false }) { customOpen = false; a.dailyChange(d.copy(everyHours = it)) }
                        Spacer(Modifier.height(4.dp))
                        Text(stringResource(R.string.s_often_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (!Daily.isLocal(d.uri) && d.everyHours < 12) {
                            Spacer(Modifier.height(4.dp))
                            Text(stringResource(R.string.s_often_online), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                    SettingRow(R.drawable.ic_photo, stringResource(R.string.s_media), stringResource(R.string.s_media_text), d.withMedia) { a.dailyChange(d.copy(withMedia = it)) }
                    SettingRow(R.drawable.ic_battery, stringResource(R.string.s_charging), stringResource(R.string.s_charging_text), d.charging) { a.dailyChange(d.copy(charging = it)) }
                    SettingRow(R.drawable.ic_wifi, stringResource(R.string.s_wifi), stringResource(R.string.s_wifi_text), d.wifi) { a.dailyChange(d.copy(wifi = it)) }
                    SettingRow(R.drawable.ic_notifications, stringResource(R.string.s_notify), stringResource(R.string.s_notify_text), d.notify) { a.dailyChange(d.copy(notify = it)) }
                    val last = ui.dailyLast
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.s_last)) },
                        supportingContent = {
                            Text(when {
                                last == null -> stringResource(R.string.s_never)
                                last.error != null -> stringResource(R.string.daily_last_error, ago(last.at), last.error)
                                else -> stringResource(R.string.s_last_line, ago(last.at), n(last.added))
                            }, color = if (last?.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        },
                        leadingContent = { Icon(painterResource(if (last?.error != null) R.drawable.ic_error else R.drawable.ic_check_circle), null) },
                        trailingContent = { TextButton(onClick = a::dailyNow) { Text(stringResource(R.string.back_up_now)) } },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                }
            }
        }
        SectionTitle(stringResource(R.string.s_about))
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(vertical = 8.dp)) {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.app_name)) },
                    supportingContent = { Text(stringResource(R.string.s_version, BuildConfig.VERSION_NAME) + "\n" + stringResource(R.string.s_privacy)) },
                    leadingContent = { Icon(painterResource(R.drawable.ic_restore), null, tint = MaterialTheme.colorScheme.primary) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
                ListItem(
                    headlineContent = { Text(stringResource(R.string.s_permissions)) },
                    supportingContent = { Text(stringResource(R.string.s_permissions_text)) },
                    leadingContent = { Icon(painterResource(R.drawable.ic_settings), null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable(onClick = a::openAppSettings),
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp))
}

// One setting: what it is, a line on what it does, and its switch (the whole row toggles it).
@Composable
private fun SettingRow(@DrawableRes icon: Int, title: String, text: String, on: Boolean, change: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(text) },
        leadingContent = { Icon(painterResource(icon), null) },
        trailingContent = { Switch(checked = on, onCheckedChange = change) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable { change(!on) },
    )
}

// ---------- review ----------

@Composable
private fun Review(ui: UiState, a: Actions) {
    val ctx = LocalContext.current
    val m = ui.manifest ?: return
    val c = m.getJSONObject("counts")
    val made = runCatching { Instant.parse(m.getString("created_at")).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)) }.getOrDefault("")
    val all = ui.threads.isNotEmpty() && ui.threads.all { ui.selected[it.file] == true }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
        item { StillDefault(ui, a) }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
                Column(Modifier.padding(20.dp)) {
                    Text(stringResource(R.string.backup_from, made), style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(4.dp))
                    // For the chats ticked, as a share of the whole file.
                    val chosen = ui.threads.filter { ui.selected[it.file] == true }.sumOf { it.messages }
                    val share = if (c.optInt("messages") > 0) chosen.toDouble() / c.optInt("messages") else 1.0
                    val est = (c.optInt("sms") / SMS_PER_SEC + c.optInt("mms") / MMS_PER_SEC + c.optLong("media_bytes") / BYTES_PER_SEC) * share
                    Text(stringResource(R.string.restore_time, minutesText(ctx, est)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(20.dp))
                    Row(Modifier.fillMaxWidth()) {
                        Stat(R.drawable.ic_chat, n(c.optInt("messages")), stringResource(R.string.stat_messages), Modifier.weight(1f))
                        Stat(R.drawable.ic_person, n(c.optInt("threads")), stringResource(R.string.stat_chats), Modifier.weight(1f))
                        Stat(R.drawable.ic_photo, n(c.optInt("media")), stringResource(R.string.stat_photos), Modifier.weight(1f),
                            note = if (c.optInt("media") > 0) sizeText(c.optLong("media_bytes")) else null)
                    }
                }
            }
        }
        item {
            Spacer(Modifier.height(16.dp))
            InfoCard(R.drawable.ic_info, stringResource(R.string.sms_role_title), stringResource(R.string.sms_role_text),
                MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
        }
        item {
            AnimatedVisibility(ui.askSelf, enter = expandVertically() + fadeIn()) {
                Column(Modifier.padding(top = 16.dp)) {
                    Text(stringResource(R.string.self_title), style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.self_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = ui.self, onValueChange = { ui.self = it }, singleLine = true, placeholder = { Text(stringResource(R.string.self_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chats_header), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(start = 8.dp))
                Text(stringResource(R.string.select_all), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val some = ui.threads.any { ui.selected[it.file] == true }
                TriStateCheckbox(state = when { all -> ToggleableState.On; some -> ToggleableState.Indeterminate; else -> ToggleableState.Off },
                    onClick = { val on = !all; ui.threads.forEach { ui.selected[it.file] = on } })
            }
        }
        items(ui.threads, key = { it.file }) { t ->
            val on = ui.selected[t.file] == true
            val years = if (t.first > 0) year(t.first).let { f -> year(t.last).let { l -> if (f == l) "$f" else "$f – $l" } } else ""
            ListItem(
                headlineContent = { Text(RestoreService.shown(t.title), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                supportingContent = { Text(stringResource(R.string.chat_line, n(t.messages), if (t.group) "${stringResource(R.string.group)} · $years" else years)) },
                leadingContent = { Avatar(t.title, t.group) },
                trailingContent = { Checkbox(checked = on, onCheckedChange = { ui.selected[t.file] = it }) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clip(RoundedCornerShape(16.dp)).clickable { ui.selected[t.file] = !on },
            )
        }
    }
}

@Composable
private fun ReviewBar(ui: UiState, a: Actions) {
    val count = ui.threads.filter { ui.selected[it.file] == true }.sumOf { it.messages }
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 3.dp) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
            ui.message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp)) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = a::choose) { Text(stringResource(R.string.choose_other)) }
                Spacer(Modifier.weight(1f))
                Button(onClick = a::restore, enabled = count > 0, modifier = Modifier.height(48.dp)) {
                    Text(if (count > 0) stringResource(R.string.restore_n, n(count)) else stringResource(R.string.none_selected))
                }
            }
        }
    }
}

// ---------- backing up ----------

@Composable
private fun BackupReview(ui: UiState, a: Actions) {
    val p = ui.phone ?: return
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(20.dp)) {
                Text(stringResource(R.string.phone_title), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.phone_sub), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
                Row(Modifier.fillMaxWidth()) {
                    Stat(R.drawable.ic_chat, n(p.messages), stringResource(R.string.stat_messages), Modifier.weight(1f))
                    Stat(R.drawable.ic_person, n(p.threads), stringResource(R.string.stat_chats), Modifier.weight(1f))
                    Stat(R.drawable.ic_photo, n(p.media), stringResource(R.string.stat_photos), Modifier.weight(1f))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
            ListItem(
                headlineContent = { Text(stringResource(R.string.backup_media), style = MaterialTheme.typography.titleSmall) },
                supportingContent = { Text(stringResource(R.string.backup_media_text)) },
                trailingContent = { Switch(checked = ui.withMedia, onCheckedChange = { ui.withMedia = it }) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { ui.withMedia = !ui.withMedia }.padding(vertical = 4.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        if (p.messages == 0) {
            InfoCard(R.drawable.ic_warning, stringResource(R.string.no_messages), "", MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
        } else {
            InfoCard(R.drawable.ic_info, stringResource(R.string.backup_what_title), stringResource(R.string.backup_what_text),
                MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
            Spacer(Modifier.height(16.dp))
            // Bringing a backup made before up to date.
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text(stringResource(R.string.update_existing_text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = a::updateBackup, modifier = Modifier.fillMaxWidth()) {
                        Icon(painterResource(R.drawable.ic_folder_open), null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.update_existing))
                    }
                }
            }
        }
    }
}

@Composable
private fun BackupBar(ui: UiState, a: Actions) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 3.dp) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = a::home) { Text(stringResource(R.string.back)) }
            Spacer(Modifier.weight(1f))
            Button(onClick = a::saveBackup, enabled = (ui.phone?.messages ?: 0) > 0, modifier = Modifier.height(48.dp)) {
                Icon(painterResource(R.drawable.ic_backup), null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.save_backup))
            }
        }
    }
}

@Composable
private fun BackupDone(ui: UiState, a: Actions) {
    val r = ui.backup
    val failed = ui.error != null
    val name = ui.backupName ?: ""
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(16.dp))
        when {
            failed -> Hero(R.drawable.ic_error, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
            r?.stopped == true -> Hero(R.drawable.ic_warning, MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
            else -> Hero(R.drawable.ic_check_circle, MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer)
        }
        Spacer(Modifier.height(20.dp))
        Text(stringResource(when { failed -> R.string.backup_failed; r?.stopped == true -> R.string.backup_stopped; r?.updated == true -> R.string.backup_updated; else -> R.string.backup_done }),
            style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(when {
            failed -> ui.error!!
            r?.stopped == true -> stringResource(R.string.backup_stopped_sub, name, n(r.threads))
            r?.updated == true -> stringResource(R.string.backup_updated_sub, n(r.added), n(r.mediaAdded), name, n(r.messages), n(r.threads), sizeText(r.bytes))
            else -> stringResource(R.string.backup_done_sub, n(r?.messages ?: 0), n(r?.threads ?: 0), name, sizeText(r?.bytes ?: 0))
        } + (if ((r?.failedMedia ?: 0) > 0) "\n" + stringResource(R.string.backup_media_failed, n(r!!.failedMedia)) else "") +
            (if ((r?.mediaWaiting ?: 0) > 0) "\n" + stringResource(R.string.photos_waiting, n(r!!.mediaWaiting)) else ""),
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (r != null) {
            Spacer(Modifier.height(24.dp))
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(vertical = 18.dp)) {
                    Stat(R.drawable.ic_chat, n(r.messages), stringResource(R.string.stat_messages), Modifier.weight(1f))
                    Stat(R.drawable.ic_person, n(r.threads), stringResource(R.string.stat_chats), Modifier.weight(1f))
                    Stat(R.drawable.ic_photo, n(r.media), stringResource(R.string.stat_photos), Modifier.weight(1f))
                }
            }
            if (ui.canShare && !r.stopped) {
                Spacer(Modifier.height(16.dp))
                // Every day from now on, to this file.
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.daily_title), style = MaterialTheme.typography.titleSmall) },
                        supportingContent = { Text(stringResource(R.string.daily_text, name, everyText(ui.daily?.everyHours ?: 24))) },
                        leadingContent = { Icon(painterResource(R.drawable.ic_schedule), null, tint = MaterialTheme.colorScheme.primary) },
                        trailingContent = { Switch(checked = ui.dailyHere, onCheckedChange = { a.setDaily(it) }) },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.clickable { a.setDaily(!ui.dailyHere) }.padding(vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            InfoCard(R.drawable.ic_info, stringResource(R.string.backup_next_title), stringResource(R.string.backup_next_text),
                MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.height(24.dp))
        if (r != null && ui.canShare) {
            Button(onClick = a::shareBackup, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Icon(painterResource(R.drawable.ic_share), null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.share))
            }
            Spacer(Modifier.height(8.dp))
        }
        TextButton(onClick = a::home) { Text(stringResource(R.string.done)) }
    }
}

// ---------- restoring ----------

@Composable
private fun Running(ui: UiState, a: Actions) {
    val ctx = LocalContext.current
    val frac = if (ui.total > 0) ui.done.toFloat() / ui.total else 0f
    val shown by animateFloatAsState(frac, tween(400), label = "progress")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(16.dp))
        Box(contentAlignment = Alignment.Center) {
            if (ui.total > 0) {
                CircularProgressIndicator(progress = { shown }, modifier = Modifier.size(200.dp), strokeWidth = 12.dp,
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHighest, strokeCap = StrokeCap.Round)
            } else {
                CircularProgressIndicator(modifier = Modifier.size(200.dp), strokeWidth = 12.dp, trackColor = MaterialTheme.colorScheme.surfaceContainerHighest, strokeCap = StrokeCap.Round)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (ui.total > 0) "${(frac * 100).toInt()}%" else "…", style = MaterialTheme.typography.displaySmall)
                if (ui.total > 0) Text(stringResource(R.string.of_total, n(ui.done), n(ui.total)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(28.dp))
        Text(stringResource(if (ui.backingUp) R.string.backing_up else R.string.restoring), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(ui.thread.ifEmpty { stringResource(R.string.getting_ready) }, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val secs = (System.currentTimeMillis() - ui.startedAt) / 1000.0
        // Restoring: by work rather than message count, as picture messages are much
        // slower and a chat's texts and pictures don't come evenly. Backing up: the
        // backup times texts and pictures itself (PhoneBackup.secondsLeft).
        val left = when {
            ui.backingUp -> ui.left.takeIf { it >= 0 }
            ui.done > 50 && secs > 3 -> {
                val per = ui.manifest?.let { workPerMessage(it.getJSONObject("counts")) } ?: 1.0
                val worked = ui.sms + ui.mms * SMS_PER_SEC / MMS_PER_SEC + ui.skipped
                (ui.total - ui.done) * per / (worked / secs)
            }
            else -> null
        }
        if (left != null) {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_schedule), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.time_left, minutesText(ctx, left)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(28.dp))
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(vertical = 18.dp)) {
                if (ui.backingUp) {
                    Stat(R.drawable.ic_chat, n(ui.done), stringResource(R.string.stat_messages), Modifier.weight(1f))
                    Stat(R.drawable.ic_person, n(ui.chats), stringResource(R.string.stat_chats), Modifier.weight(1f))
                    Stat(R.drawable.ic_photo, n(ui.media), stringResource(R.string.stat_photos), Modifier.weight(1f))
                } else {
                    Stat(R.drawable.ic_chat, n(ui.sms), stringResource(R.string.count_texts), Modifier.weight(1f))
                    Stat(R.drawable.ic_photo, n(ui.mms), stringResource(R.string.count_pictures), Modifier.weight(1f))
                    Stat(R.drawable.ic_check_circle, n(ui.skipped), stringResource(R.string.count_already), Modifier.weight(1f))
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        OutlinedButton(onClick = a::stop, enabled = !ui.stopping) { Text(stringResource(if (ui.stopping) R.string.stopping else R.string.stop)) }
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.leave_ok), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

// ---------- done ----------

@Composable
private fun Done(ui: UiState, a: Actions) {
    val r = ui.result
    val failed = ui.error != null
    val restored = (r?.sms ?: 0) + (r?.mms ?: 0)
    val nothingNew = !failed && r != null && !r.stopped && restored == 0 && r.skipped > 0 // the same file again
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(16.dp))
        when {
            failed -> Hero(R.drawable.ic_error, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
            r?.stopped == true -> Hero(R.drawable.ic_warning, MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
            else -> Hero(R.drawable.ic_check_circle, MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer)
        }
        Spacer(Modifier.height(20.dp))
        Text(stringResource(when { failed -> R.string.failed_title; r?.stopped == true -> R.string.stopped_title; nothingNew -> R.string.nothing_new_title; else -> R.string.done_title }),
            style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(when {
            failed -> ui.error!!
            r?.stopped == true -> stringResource(R.string.stopped_sub, n(restored))
            nothingNew -> stringResource(R.string.nothing_new_sub, n(r!!.skipped))
            else -> stringResource(R.string.done_sub, n(restored))
        } + if ((r?.failed ?: 0) > 0) "\n" + stringResource(R.string.failed_count, n(r!!.failed)) else "",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (r != null) {
            Spacer(Modifier.height(24.dp))
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(vertical = 18.dp)) {
                    Stat(R.drawable.ic_chat, n(r.sms), stringResource(R.string.count_texts), Modifier.weight(1f))
                    Stat(R.drawable.ic_photo, n(r.mms), stringResource(R.string.count_pictures), Modifier.weight(1f))
                    Stat(R.drawable.ic_check_circle, n(r.skipped), stringResource(R.string.count_already), Modifier.weight(1f))
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        if (ui.isDefault) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer), shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(painterResource(R.drawable.ic_swap), null, Modifier.size(22.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.switch_title), style = MaterialTheme.typography.titleMedium)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(stringResource(R.string.switch_text), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = a::switchBack, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(stringResource(R.string.open_messages)) }
                    TextButton(onClick = a::openDefaultApps, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onPrimaryContainer)) { Text(stringResource(R.string.open_default_apps)) }
                }
            }
        } else if (!failed && r?.stopped != true) {
            InfoCard(R.drawable.ic_check_circle, stringResource(R.string.all_set_title), stringResource(R.string.all_set),
                MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer)
        }
        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = a::reset) { Text(stringResource(when { failed -> R.string.try_again; r?.stopped == true -> R.string.restore_again; else -> R.string.done })) }
    }
}
