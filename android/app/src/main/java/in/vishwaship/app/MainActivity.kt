package `in`.vishwaship.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.razorpay.Checkout
import com.razorpay.PaymentData
import com.razorpay.PaymentResultWithDataListener
import `in`.vishwaship.app.ui.AppRoot
import `in`.vishwaship.app.ui.theme.VishwashipTheme
import `in`.vishwaship.app.ui.wallet.PaymentEvent
import `in`.vishwaship.app.ui.wallet.PaymentEvents

class MainActivity : ComponentActivity(), PaymentResultWithDataListener {
    private var link by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Checkout.preload(applicationContext)
        link = linkFrom(intent)
        setContent {
            VishwashipTheme {
                Surface { AppRoot(application as VishwashipApp, link, onDeepLinkHandled = { link = null }) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        link = linkFrom(intent)
    }

    /**
     * Accepts only: our internal push links, and App Links on the configured web host
     * (/portal/orders/<id>/, /portal/support/<id>/, /app/recharge/<id>/). Everything else is ignored.
     */
    private fun linkFrom(i: Intent?): String? {
        val u = i?.data ?: return null
        val id = Regex("""^[\w-]{1,64}$""")
        if (u.scheme == "vishwaship-app" && u.host == "open") return `in`.vishwaship.app.push.Push.safeLink(u.path)
        if (u.scheme != "https" || u.host != BuildConfig.WEB_HOST) return null
        val parts = u.pathSegments
        return when {
            parts.size >= 3 && parts[0] == "portal" && parts[1] == "orders" && id.matches(parts[2]) -> "/orders/${parts[2]}"
            parts.size >= 3 && parts[0] == "portal" && parts[1] == "support" && id.matches(parts[2]) -> "/support/${parts[2]}"
            parts.size >= 3 && parts[0] == "app" && parts[1] == "recharge" && id.matches(parts[2]) -> {
                PaymentEvents.flow.tryEmit(PaymentEvent.CashfreeReturned(parts[2])); "/recharge/${parts[2]}"
            }
            else -> null
        }
    }

    // Razorpay SDK callbacks: the app only forwards them; the server verifies the signature and amount before crediting.
    override fun onPaymentSuccess(paymentId: String?, data: PaymentData?) {
        val orderId = data?.orderId; val sig = data?.signature
        if (paymentId != null && orderId != null && sig != null) PaymentEvents.flow.tryEmit(PaymentEvent.RazorpaySuccess(paymentId, orderId, sig))
    }

    override fun onPaymentError(code: Int, description: String?, data: PaymentData?) {
        PaymentEvents.flow.tryEmit(PaymentEvent.RazorpayFailure(code, description?.take(200)))
    }
}
