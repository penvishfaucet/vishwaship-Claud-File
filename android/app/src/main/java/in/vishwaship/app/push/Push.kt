package `in`.vishwaship.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import `in`.vishwaship.app.BuildConfig
import `in`.vishwaship.app.MainActivity
import `in`.vishwaship.app.R
import `in`.vishwaship.app.VishwashipApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

object Push {
    val configured get() = BuildConfig.FIREBASE_APP_ID.isNotBlank() && BuildConfig.FIREBASE_PROJECT_ID.isNotBlank()

    /** Firebase starts only when this build carries a Firebase project (no google-services.json is bundled). */
    fun initFirebaseIfConfigured(ctx: Context) {
        if (!configured || FirebaseApp.getApps(ctx).isNotEmpty()) return
        FirebaseApp.initializeApp(ctx, FirebaseOptions.Builder()
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build())
    }

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        listOf(
            Triple("shipments", R.string.channel_shipments, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("wallet", R.string.channel_wallet, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("support", R.string.channel_support, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("account", R.string.channel_account, NotificationManager.IMPORTANCE_LOW),
        ).forEach { (id, name, imp) ->
            nm.createNotificationChannel(NotificationChannel(id, ctx.getString(name), imp).apply { lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE })
        }
    }

    /** Registers this install's token with the server (bound to the current session). */
    suspend fun syncToken(app: VishwashipApp, enabled: Boolean) {
        if (!configured) return
        val token = if (enabled) runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() else null
        runCatching { app.repo.registerPush(token) }
        if (!enabled) runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
    }

    /** Only in-app paths the app knows are accepted; anything else opens the inbox. */
    fun safeLink(link: String?): String = when {
        link == null -> "/alerts"
        Regex("""^/(orders|support)/[\w-]{1,64}$""").matches(link) -> link
        link in setOf("/wallet", "/kyc", "/alerts") -> link
        else -> "/alerts"
    }
}

/**
 * Data-only messages from the server (see src/server/mobile/push.ts): a generic title per kind and an opaque link.
 * Notifications are PRIVATE on the lock screen and never contain amounts, addresses, mobiles or OTPs.
 */
class PushService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        val app = application as VishwashipApp
        if (app.repo.isSignedIn) scope.launch { runCatching { app.repo.registerPush(token) } }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val app = application as VishwashipApp
        if (!app.repo.isSignedIn) return // signed out on this device: never show account alerts
        val d = msg.data
        val alertId = d["alertId"] ?: return
        val link = Push.safeLink(d["link"])
        val open = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW; data = Uri.parse("vishwaship-app://open$link"); flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(this, alertId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, d["channel"] ?: "account")
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentTitle(d["title"] ?: "Vishwaship update")
            .setContentText("Tap to view in Vishwaship")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(this, d["channel"] ?: "account").setSmallIcon(R.mipmap.ic_launcher_foreground).setContentTitle("Vishwaship").setContentText("New update").build())
            .setAutoCancel(true).setContentIntent(pi).build()
        // Respect a denied/revoked permission (Android 13+); the alert still waits in the in-app inbox.
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        // alertId as the tag: a duplicate delivery replaces the same notification instead of adding another
        runCatching { NotificationManagerCompat.from(this).notify(alertId, 1, n) }
    }
}
