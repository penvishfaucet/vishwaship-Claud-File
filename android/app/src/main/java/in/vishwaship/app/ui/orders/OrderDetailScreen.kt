package `in`.vishwaship.app.ui.orders

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.R
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.FileActions
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Weights
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.OrderDetail
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.ui.common.Field
import `in`.vishwaship.app.ui.common.KeyValue
import `in`.vishwaship.app.ui.common.LoadView
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.common.SecondaryButton
import `in`.vishwaship.app.ui.common.SectionCard
import `in`.vishwaship.app.ui.common.StatusChip
import `in`.vishwaship.app.ui.common.rememberLoad
import `in`.vishwaship.app.ui.theme.Brand
import kotlinx.coroutines.launch
import java.io.File

/** Thermal and A4 formats the server renders (src/lib/org-settings.ts LABEL_FORMATS). */
val LABEL_FORMATS = listOf(
    "thermal_4x6" to "4×6 in", "thermal_3x4" to "3×4 in", "thermal_4x4" to "4×4 in", "thermal_2x4" to "2×4 in",
    "thermal_38x100" to "38×100 mm", "a4_2up" to "A4 2-up", "a4_4up" to "A4 4-up", "original" to "Courier label",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OrderDetailScreen(repo: Repository, orderId: String, openTicket: (String) -> Unit, openCreateTicket: (String) -> Unit) {
    val l = rememberLoad(orderId) { repo.order(orderId) }
    PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
        LoadView(l) { d -> Detail(repo, d, l.reload, openCreateTicket) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Detail(repo: Repository, d: OrderDetail, reload: () -> Unit, openCreateTicket: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val o = d.order
    val s = o.shipment
    var busy by remember { mutableStateOf<String?>(null) }
    var msg by remember { mutableStateOf<String?>(null) }
    var file by remember { mutableStateOf<Pair<File, String>?>(null) }
    var format by rememberSaveable { mutableStateOf(s?.labelFormats?.firstOrNull { it.startsWith("thermal") } ?: "thermal_4x6") }
    var confirmCancel by remember { mutableStateOf(false) }
    var ndrAddress by remember { mutableStateOf<String?>(null) }

    fun run(label: String, block: suspend () -> Unit) {
        busy = label; msg = null
        scope.launch { try { block() } catch (e: ApiException) { msg = e.message } finally { busy = null } }
    }

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row { Text(o.orderNumber, style = MaterialTheme.typography.headlineSmall, color = Brand.Link, modifier = Modifier.weight(1f)); StatusChip(s?.status ?: o.orderStatus) }
            Text("Created ${Dates.dateTime(o.createdAt)} · ${o.mode} · ${o.source}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        busy?.let { item { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(it) } }
        msg?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }

        // Only what the backend has confirmed is shown: AWB/LR and courier appear after a confirmed booking.
        if (s != null && s.bookingStatus == "confirmed") item {
            SectionCard {
                Text("Shipment", style = MaterialTheme.typography.titleMedium)
                KeyValue("Courier", "${s.carrierName} · ${s.serviceName}")
                KeyValue("AWB", s.awb); s.lr?.let { KeyValue("LR", it) }
                KeyValue("Pickup", s.pickupStatus.replace('_', ' ')); s.etaDate?.let { KeyValue("Expected delivery", Dates.date(it)) }
                s.lastLocation?.let { KeyValue("Last location", it) }
                Text("Labels & manifest", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    LABEL_FORMATS.filter { (k, _) -> s.labelFormats.isEmpty() || k in s.labelFormats }.forEach { (k, v) -> FilterChip(format == k, { format = k }, { Text(v) }) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Download Label", Modifier.weight(1f)) { run("Downloading label…") { file = repo.downloadLabel(s.id, format, ctx.cacheDir) to "Label ${o.orderNumber}" } }
                    PrimaryButton("Download Manifest", Modifier.weight(1f)) {
                        run("Preparing manifest…") { val m = repo.createManifest(null, s.id, null, null); file = repo.downloadManifest(m, ctx.cacheDir) to "Manifest ${m.manifestNo ?: ""}" }
                    }
                }
                Text(stringResource(R.string.manifest_notice), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Brand.OrangeAction)
                file?.let { (f, title) ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton("Open") { if (!FileActions.open(ctx, f)) msg = "No PDF viewer installed. Use Share or Print." }
                        SecondaryButton("Share") { FileActions.share(ctx, f, title) }
                        SecondaryButton("Print") { FileActions.print(ctx, f, title) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (s.pickupStatus == "not_scheduled" && o.warehouseId != null) SecondaryButton("Schedule pickup") {
                        run("Requesting pickup…") { repo.schedulePickup(o.warehouseId ?: throw ApiException(422, "validation_error", "This order has no pickup address"), Dates.today(), listOf(s.id)); reload() }
                    }
                    SecondaryButton("Refresh tracking") { run("Checking with the courier…") { repo.refreshTracking(s.id); reload() } }
                    SecondaryButton("Invoice") { run("Downloading invoice…") { file = repo.downloadInvoice(s.id, ctx.cacheDir) to "Invoice ${o.orderNumber}" } }
                }
            }
        } else if (s != null && s.bookingStatus in setOf("pending", "ambiguous")) item {
            SectionCard {
                Text("Booking is being confirmed", style = MaterialTheme.typography.titleMedium)
                Text("The courier has not confirmed this booking yet. Do not book it again: check the status here first. Any wallet hold is released automatically if the booking fails.")
                PrimaryButton("Check status") { reload() }
            }
        }

        d.ndr?.takeIf { it.status == "open" }?.let { n ->
            item {
                SectionCard {
                    Text(if (n.kind == "rto") "Return to origin" else "Delivery exception (NDR)", style = MaterialTheme.typography.titleMedium, color = Brand.Danger)
                    KeyValue("Reason", n.reason); KeyValue("Attempt", "${n.attempt}"); n.deadlineAt?.let { KeyValue("Respond by", Dates.dateTime(it)) }
                    if (n.kind == "ndr") FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("Re-attempt") { run("Requesting re-attempt…") { repo.ndrAction(n.id, "reattempt"); reload() } }
                        SecondaryButton("Correct address") { ndrAddress = o.consignee.line1 ?: "" }
                        SecondaryButton("Return (RTO)") { run("Requesting RTO…") { repo.ndrAction(n.id, "rto"); reload() } }
                    }
                }
            }
        }

        item {
            SectionCard {
                Text("Addresses", style = MaterialTheme.typography.titleMedium)
                o.pickup?.let { KeyValue("Pickup", listOfNotNull(it.label, it.line1, it.city, it.pincode).joinToString(", ")) }
                KeyValue("Deliver to", listOfNotNull(o.consignee.name, o.consignee.line1, o.consignee.line2, o.consignee.city, o.consignee.state, o.consignee.pincode).joinToString(", "))
            }
        }
        item {
            SectionCard {
                Text("Packages & weight", style = MaterialTheme.typography.titleMedium)
                o.packages.forEach { p -> KeyValue("${p.count} × box", "${p.l}×${p.b}×${p.h} cm · ${p.kg} kg each") }
                KeyValue("Total boxes", "${o.boxes}")
                KeyValue("Actual weight", Weights.kg(o.actualGrams))
                KeyValue("Volumetric weight", Weights.kg(o.volumetricGrams))
                KeyValue("Chargeable (booking)", Weights.kg(o.chargeableGrams))
                o.carrierGrams?.let { KeyValue("Carrier-adjusted", Weights.kg(it)) }
            }
        }
        item {
            SectionCard {
                Text("Products & payment", style = MaterialTheme.typography.titleMedium)
                o.products.forEach { KeyValue(it.name, "× ${it.qty}") }
                KeyValue("Payment", when (o.payment) { "cod" -> "COD"; "fod" -> "FOD"; else -> "Prepaid" })
                if (o.codPaise > 0) KeyValue("COD amount", Money.format(o.codPaise))
                KeyValue("Invoice value", Money.format(o.invoicePaise))
                o.breakdown?.let { b ->
                    HorizontalDivider()
                    b.lines.forEach { KeyValue(it.label, Money.format(it.amount)) }
                    b.gst?.let { KeyValue("GST", Money.format(it)) }
                    b.adjustment?.let { KeyValue(it.label, Money.format(it.amount)) }
                    KeyValue("Charged", Money.format(b.total))
                }
            }
        }
        if (d.timeline.isNotEmpty()) {
            item { Text("Tracking", style = MaterialTheme.typography.titleMedium) }
            items(d.timeline) { e ->
                Column(Modifier.padding(start = 8.dp)) {
                    Text(e.raw ?: e.status.replace('_', ' '), fontWeight = FontWeight.Medium)
                    Text(listOfNotNull(e.location, Dates.dateTime(e.at)).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Get help") { openCreateTicket(o.orderNumber) }
                if (s?.cancellable == true || o.cancellableOrder) SecondaryButton("Cancel order") { confirmCancel = true }
            }
            Spacer(Modifier.height(72.dp))
        }
    }

    if (confirmCancel) AlertDialog(onDismissRequest = { confirmCancel = false },
        title = { Text("Cancel ${o.orderNumber}?") },
        text = { Text(if (s != null) "The courier booking will be cancelled. Any eligible shipping charge is refunded to your wallet by the server." else "This order has not been booked; it will be cancelled.") },
        confirmButton = { TextButton(onClick = { confirmCancel = false; run("Cancelling…") { repo.cancel(o.id, "Cancelled from the app"); reload() } }) { Text("Cancel order") } },
        dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text("Keep it") } })

    ndrAddress?.let { current ->
        AlertDialog(onDismissRequest = { ndrAddress = null }, title = { Text("Correct delivery address") },
            text = { Field("Address line", current, { ndrAddress = it }) },
            confirmButton = { TextButton(enabled = current.trim().length >= 5, onClick = { val v = current.trim(); ndrAddress = null; run("Sending correction…") { repo.ndrAction(d.ndr!!.id, "update_address", line1 = v); reload() } }) { Text("Send") } },
            dismissButton = { TextButton(onClick = { ndrAddress = null }) { Text("Close") } })
    }
}
