package io.github.trikhster.messagearchivist

import android.app.Service
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.provider.Telephony
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

// The parts Android requires before it lets an app become the default SMS app.
// This app only holds that role while a restore runs; these make sure nothing
// is lost meanwhile and point people back to Google Messages.

/** A text arriving while this is the default SMS app: saved to the inbox, so it's there afterwards. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (parts.isNullOrEmpty()) return
        val from = parts[0].displayOriginatingAddress ?: ""
        ctx.contentResolver.insert(Telephony.Sms.Inbox.CONTENT_URI, ContentValues().apply {
            put(Telephony.Sms.ADDRESS, from)
            put(Telephony.Sms.BODY, parts.joinToString("") { it.displayMessageBody ?: "" })
            put(Telephony.Sms.DATE, System.currentTimeMillis())
            put(Telephony.Sms.DATE_SENT, parts[0].timestampMillis)
            put(Telephony.Sms.READ, 0)
            put(Telephony.Sms.SEEN, 0)
        })
        Notifications.incoming(ctx, from)
    }
}

/**
 * A picture message arriving while this is the default SMS app. Downloading it
 * needs a full messaging app, so this says so; the phone's carrier keeps it for
 * a while, and Google Messages can fetch it once it's the default again.
 */
class MmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION) Notifications.incomingMms(ctx)
    }
}

/** "Send a text" from another app: this app doesn't send texts, so it points to Google Messages. */
class ComposeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            RestoreTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(painterResource(R.drawable.ic_chat), null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
                        Text(stringResource(R.string.cant_send_title), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                        Text(stringResource(R.string.cant_send), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                        Button(onClick = {
                            packageManager.getLaunchIntentForPackage(Notifications.MESSAGES)?.let { startActivity(it) }
                            finish()
                        }) { Text(stringResource(R.string.open_messages)) }
                    }
                }
            }
        }
    }
}

/** Quick replies to calls ("respond via message"): not sent by this app. */
class HeadlessSmsSendService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopSelf(startId)
        return START_NOT_STICKY
    }
}
