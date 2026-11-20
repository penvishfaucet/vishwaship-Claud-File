package `in`.vishwaship.app.ui.wallet

import android.app.Activity
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.razorpay.Checkout
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.FileActions
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Validators
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.data.WalletData
import `in`.vishwaship.app.ui.common.Field
import `in`.vishwaship.app.ui.common.KeyValue
import `in`.vishwaship.app.ui.common.LinkText
import `in`.vishwaship.app.ui.common.LoadView
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.common.SecondaryButton
import `in`.vishwaship.app.ui.common.SectionCard
import `in`.vishwaship.app.ui.common.StatusChip
import `in`.vishwaship.app.ui.common.rememberLoad
import `in`.vishwaship.app.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Razorpay SDK results (MainActivity implements the SDK listener and forwards here). */
sealed interface PaymentEvent {
    data class RazorpaySuccess(val paymentId: String, val orderId: String, val signature: String) : PaymentEvent
    data class RazorpayFailure(val code: Int, val description: String?) : PaymentEvent
    data class CashfreeReturned(val rechargeId: String) : PaymentEvent
}
object PaymentEvents { val flow = MutableSharedFlow<PaymentEvent>(extraBufferCapacity = 4) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(repo: Repository, openRecharge: Boolean, openOrder: (String) -> Unit, onBalanceChanged: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var showRecharge by rememberSaveable { mutableStateOf(openRecharge) }
    val l = rememberLoad(tab) { repo.wallet(withCod = tab == 2) }
    Column {
        TabRow(selectedTabIndex = tab) {
            listOf("Passbook", "Recharges", "COD remittance").forEachIndexed { i, t -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t) }) }
        }
        PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
            LoadView(l) { w ->
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item {
                        SectionCard {
                            Text("Available balance", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(Money.format(w.balance.availablePaise), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            if (w.balance.reservedPaise > 0) Text("${Money.format(w.balance.reservedPaise)} on hold for bookings in progress", style = MaterialTheme.typography.labelSmall)
                            PrimaryButton("Recharge wallet") { showRecharge = true }
                        }
                    }
                    when (tab) {
                        0 -> if (w.passbook.isEmpty()) item { Text("No transactions in the last 90 days.") } else items(w.passbook, key = { it.id }) { p ->
                            SectionCard {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) { Text(p.title, fontWeight = FontWeight.SemiBold); Text(Dates.dateTime(p.at), style = MaterialTheme.typography.labelSmall) }
                                    Text((if (p.direction == "credit") "+ " else if (p.direction == "debit") "− " else "") + Money.format(p.amountPaise),
                                        color = if (p.direction == "credit") Brand.Success else if (p.direction == "debit") Brand.Danger else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
                                }
                                if (p.description.isNotBlank()) Text(p.description, style = MaterialTheme.typography.bodyMedium)
                                p.orderNumber?.let { n -> p.orderId?.let { id -> LinkText(n, { openOrder(id) }) } }
                                p.awb?.let { Text("AWB $it", style = MaterialTheme.typography.labelSmall) }
                                p.reference?.let { Text("Ref $it", style = MaterialTheme.typography.labelSmall) }
                                Row { StatusChip(p.status); Spacer(Modifier.weight(1f)); p.balanceAfterPaise?.let { Text("Balance ${Money.format(it)}", style = MaterialTheme.typography.labelSmall) } }
                            }
                        }
                        1 -> if (w.recharges.isEmpty()) item { Text("No recharges yet.") } else items(w.recharges, key = { it.id }) { r ->
                            SectionCard {
                                Row { Text(Money.format(r.amountPaise), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); StatusChip(r.status) }
                                Text("${r.method.replaceFirstChar { it.uppercase() }} · ${Dates.dateTime(r.createdAt)}", style = MaterialTheme.typography.bodyMedium)
                                r.utr?.let { Text("UTR $it", style = MaterialTheme.typography.labelSmall) }
                                Text(if (r.walletCredited) "Credited to wallet" else "Not credited", style = MaterialTheme.typography.labelSmall, color = if (r.walletCredited) Brand.Success else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        else -> w.cod?.let { c ->
                            item {
                                SectionCard {
                                    KeyValue("Collected (delivered)", Money.format(c.totals.collected)); KeyValue("Remitted", Money.format(c.totals.paid))
                                    KeyValue("Scheduled", Money.format(c.totals.scheduled)); KeyValue("Awaiting remittance", Money.format(c.totals.unbatched)); KeyValue("Deductions", Money.format(c.totals.deductions))
                                }
                            }
                            items(c.rows, key = { it.orderId }) { r ->
                                SectionCard { Row { LinkText(r.orderNumber, { openOrder(r.orderId) }, Modifier.weight(1f)); Text(Money.format(r.cod), fontWeight = FontWeight.Bold) }; Text(r.state, style = MaterialTheme.typography.labelSmall) }
                            }
                        }
                    }
                    item { Spacer(Modifier.height(72.dp)) }
                }
                if (showRecharge) RechargeSheet(repo, w, onDismiss = { showRecharge = false }, onDone = { showRecharge = false; l.reload(); onBalanceChanged() })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun RechargeSheet(repo: Repository, w: WalletData, onDismiss: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val opts = w.recharge
    val methods = opts.gateways.map { it.gateway } + listOfNotNull(opts.manual?.let { "manual" })
    var method by rememberSaveable { mutableStateOf(methods.firstOrNull()) }
    var amount by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<String?>(null) }
    var pending by rememberSaveable { mutableStateOf<String?>(null) } // recharge id awaiting a verified status
    var utr by rememberSaveable { mutableStateOf("") }
    var paid by rememberSaveable { mutableStateOf("") }
    var proof by remember { mutableStateOf<Pair<java.io.File, String>?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? -> uri?.let { proof = FileActions.importPicked(ctx, it) ?: run { err = "The screenshot must be an image up to 10 MB."; null } } }
    val rupees = amount.filter(Char::isDigit).toLongOrNull() ?: 0

    /** Poll the server (which re-checks with the gateway) until the recharge is credited, failed or clearly pending. */
    suspend fun settle(id: String) {
        busy = "Confirming payment with the bank…"
        repeat(8) { i ->
            val s = runCatching { repo.rechargeStatus(id) }.getOrNull()
            if (s != null && s.status != "payment_pending" && s.status != "created") {
                result = if (s.status == "credited") "Wallet credited ${Money.format(s.creditPaise)}. New balance ${Money.format(s.balancePaise)}." else "Payment ${s.statusLabel.lowercase()}. ${s.decisionNote ?: "Your wallet was not charged for this recharge."}"
                pending = null; busy = null; return
            }
            delay(if (i < 3) 2000L else 5000L)
        }
        result = "Payment is still being confirmed. It will appear in Recharges; you will get an alert when it is credited. Do not pay again."
        busy = null
    }

    LaunchedEffect(Unit) {
        pending?.let { settle(it) } // reopened after the app was killed during payment: check before anything else
        PaymentEvents.flow.collect { e ->
            when (e) {
                is PaymentEvent.RazorpaySuccess -> { runCatching { repo.verifyRazorpay(e.paymentId, e.orderId, e.signature) }; pending?.let { settle(it) } }
                is PaymentEvent.RazorpayFailure -> { pending?.let { repo.cancelRecharge(it); settle(it) }; if (e.code != Checkout.PAYMENT_CANCELED) err = e.description ?: "Payment failed." }
                is PaymentEvent.CashfreeReturned -> settle(e.rechargeId)
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (busy == null) onDismiss() }) {
        Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Recharge wallet", style = MaterialTheme.typography.titleLarge)
            result?.let { Text(it, color = if (it.startsWith("Wallet credited")) Brand.Success else MaterialTheme.colorScheme.onSurface); PrimaryButton("Done", Modifier.fillMaxWidth(), onClick = onDone); return@Column }
            if (methods.isEmpty()) { Text("Online recharge is not available right now. Please contact support."); return@Column }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                methods.forEach { m -> FilterChip(method == m, { method = m }, { Text(when (m) { "razorpay" -> "Razorpay (UPI, cards, netbanking)"; "cashfree" -> "Cashfree"; else -> "Manual UPI / QR" }) }) }
            }
            Field("Amount (₹)", amount, { amount = it.filter(Char::isDigit).take(8) }, keyboard = KeyboardType.Number,
                supporting = if (method == "manual") opts.manual?.let { "Between ${Money.format(it.minPaise)} and ${Money.format(it.maxPaise)}" } else "Between ${Money.format(opts.onlineMinPaise)} and ${Money.format(opts.onlineMaxPaise)}")
            if (method == "manual") opts.manual?.let { m ->
                val discount = Math.round(rupees * 100.0 * m.discountBps / 10_000)
                SectionCard {
                    Text("Pay exactly ${Money.format(rupees * 100 - discount)}", style = MaterialTheme.typography.titleMedium, color = Brand.OrangeAction)
                    if (m.discountBps > 0) Text("${m.discountBps / 100.0}% UPI benefit: you pay ${Money.format(rupees * 100 - discount)}, the wallet gets ${Money.format(rupees * 100)} after verification.", style = MaterialTheme.typography.bodyMedium)
                    KeyValue("UPI ID", m.upiId); KeyValue("Payee", m.payeeName)
                    Text(m.instructions, style = MaterialTheme.typography.bodyMedium)
                    if (m.hasQr) LinkText("Open QR code", { CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(repo.qrUrl())) })
                }
                Field("UTR / transaction reference", utr, { utr = it.uppercase().filter(Char::isLetterOrDigit).take(30) }, error = if (utr.isNotEmpty() && !Validators.utr.matches(utr)) "6–30 letters or digits" else null)
                Field("Amount you paid (₹)", paid, { paid = it.take(10) }, keyboard = KeyboardType.Decimal)
                SecondaryButton(if (proof == null) "Attach payment screenshot" else "Screenshot attached ✓") { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
            }
            err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            busy?.let { Text(it) }
            PrimaryButton(if (method == "manual") "Submit for verification" else "Pay ${if (rupees > 0) Money.format(rupees * 100) else ""}", Modifier.fillMaxWidth(), busy = busy != null,
                enabled = rupees > 0 && (method != "manual" || (Validators.utr.matches(utr) && proof != null))) {
                err = null
                scope.launch {
                    try {
                        when (method) {
                            "manual" -> {
                                busy = "Submitting…"
                                val r = repo.submitManualRecharge(rupees, utr, java.time.Instant.now().toString(), paid.ifBlank { "0" }, "Submitted from the Android app", proof!!.first, proof!!.second)
                                result = r.message ?: "Request ${r.requestNumber ?: ""} submitted. We'll credit your wallet once the payment is verified."
                                busy = null
                            }
                            "razorpay" -> {
                                busy = "Opening Razorpay…"
                                val s = repo.startRecharge(rupees, "razorpay"); pending = s.rechargeId
                                if (s.mode != "razorpay" || s.keyId == null || s.razorpayOrderId == null) { settle(s.rechargeId); return@launch }
                                val co = Checkout().apply { setKeyID(s.keyId) }
                                co.open(ctx as Activity, JSONObject().apply {
                                    put("name", "Vishwaship"); put("description", "Wallet recharge"); put("order_id", s.razorpayOrderId)
                                    put("currency", "INR"); put("amount", s.amountPaise); put("theme", JSONObject().put("color", "#C94A0B"))
                                })
                                busy = "Waiting for Razorpay…"
                            }
                            "cashfree" -> {
                                busy = "Opening Cashfree…"
                                val s = repo.startRecharge(rupees, "cashfree"); pending = s.rechargeId
                                val sid = s.paymentSessionId ?: run { settle(s.rechargeId); return@launch }
                                CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(repo.api.url("/pay/cashfree/#sid=${Uri.encode(sid)}&mode=${s.cashfreeMode ?: "production"}")))
                                busy = "Complete the payment in the Cashfree page…"
                            }
                        }
                    } catch (e: ApiException) { err = e.message; busy = null }
                }
            }
            pending?.let { id -> SecondaryButton("Check payment status", Modifier.fillMaxWidth()) { scope.launch { settle(id) } } }
            Spacer(Modifier.height(24.dp))
        }
    }
}
