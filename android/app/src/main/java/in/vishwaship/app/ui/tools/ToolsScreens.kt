package `in`.vishwaship.app.ui.tools

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.R
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.FileActions
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Validators
import `in`.vishwaship.app.core.Weights
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.BoxInput
import `in`.vishwaship.app.data.QuoteResult
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.data.Warehouse
import `in`.vishwaship.app.ui.common.Field
import `in`.vishwaship.app.ui.common.KeyValue
import `in`.vishwaship.app.ui.common.LinkText
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.common.SecondaryButton
import `in`.vishwaship.app.ui.common.SectionCard
import `in`.vishwaship.app.ui.theme.Brand
import kotlinx.coroutines.launch
import java.io.File

/** Rate Calculator: same /api/portal/quote as the website, so the same inputs give the same customer-facing rates. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RatesScreen(repo: Repository, onBook: () -> Unit) {
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf("B2C") }
    var from by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf("") }
    var payment by rememberSaveable { mutableStateOf("prepaid") }
    var cod by rememberSaveable { mutableStateOf("") }
    var value by rememberSaveable { mutableStateOf("") }
    var count by rememberSaveable { mutableStateOf("1") }
    var l by rememberSaveable { mutableStateOf("") }; var b by rememberSaveable { mutableStateOf("") }; var h by rememberSaveable { mutableStateOf("") }
    var kg by rememberSaveable { mutableStateOf("") }
    var res by remember { mutableStateOf<QuoteResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { if (from.isBlank()) runCatching { repo.warehouses() }.getOrNull()?.let { ws -> (ws.firstOrNull { it.isDefault } ?: ws.firstOrNull())?.let { from = it.pincode } } }
    val ok = Validators.pin.matches(from) && Validators.pin.matches(to) && listOf(l, b, h, kg).all { (it.toDoubleOrNull() ?: 0.0) > 0 } && (count.toIntOrNull() ?: 0) > 0 && (payment != "cod" || (cod.toDoubleOrNull() ?: 0.0) > 0)
    Column(Modifier.verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Rate Calculator", style = MaterialTheme.typography.headlineSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(mode == "B2C", { mode = "B2C"; if (payment == "fod") payment = "prepaid" }, { Text("Parcel (B2C)") }); FilterChip(mode == "B2B", { mode = "B2B" }, { Text("Heavy / cargo (B2B)") })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field("Pickup PIN", from, { from = it.filter(Char::isDigit).take(6) }, Modifier.weight(1f), keyboard = KeyboardType.Number)
            Field("Delivery PIN", to, { to = it.filter(Char::isDigit).take(6) }, Modifier.weight(1f), keyboard = KeyboardType.Number)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field("Boxes", count, { count = it.filter(Char::isDigit).take(3) }, Modifier.weight(1f), keyboard = KeyboardType.Number)
            Field("Kg per box", kg, { kg = it.take(7) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field("L cm", l, { l = it.take(6) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal); Field("W cm", b, { b = it.take(6) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal); Field("H cm", h, { h = it.take(6) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal)
        }
        val s = Weights.summarize(listOf(Weights.Box(count.toIntOrNull() ?: 0, l.toDoubleOrNull() ?: 0.0, b.toDoubleOrNull() ?: 0.0, h.toDoubleOrNull() ?: 0.0, kg.toDoubleOrNull() ?: 0.0)))
        Text("Actual ${s.actualKg} kg · Volumetric ${s.volumetricKg} kg (est.)", style = MaterialTheme.typography.labelSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(payment == "prepaid", { payment = "prepaid" }, { Text("Prepaid") }); FilterChip(payment == "cod", { payment = "cod" }, { Text("COD") })
            if (mode == "B2B") FilterChip(payment == "fod", { payment = "fod" }, { Text("FOD") })
        }
        if (payment == "cod") Field("COD amount ₹", cod, { cod = it.take(9) }, keyboard = KeyboardType.Decimal)
        Field("Shipment value ₹ (optional)", value, { value = it.take(10) }, keyboard = KeyboardType.Decimal)
        err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        PrimaryButton("Check rates", Modifier.fillMaxWidth(), enabled = ok, busy = busy) {
            busy = true; err = null
            scope.launch {
                try { res = repo.quote(mode, from, to, payment, cod.toDoubleOrNull(), value.toDoubleOrNull(), listOf(BoxInput(count.toInt(), l.toDouble(), b.toDouble(), h.toDouble(), kg.toDouble()))) }
                catch (e: ApiException) { err = e.message } finally { busy = false }
            }
        }
        res?.let { r ->
            if (r.offers.isEmpty()) Text("No courier serves this route with these details.")
            r.offers.forEach { o ->
                val ctx = LocalContext.current
                val logo = remember(o.carrierCode) { ctx.resources.getIdentifier("courier_" + o.carrierCode.lowercase().replace('-', '_'), "drawable", ctx.packageName) }
                SectionCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (logo != 0) { Image(painterResource(logo), "${o.carrierName} logo", Modifier.height(26.dp).width(64.dp)); Spacer(Modifier.width(8.dp)) }
                        Column(Modifier.weight(1f)) { Text(o.carrierName, fontWeight = FontWeight.SemiBold); Text("${o.serviceName} · ${o.mode}${o.etaDays?.let { " · ETA $it days" } ?: ""}", style = MaterialTheme.typography.bodyMedium) }
                        Text(Money.format(o.total), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    }
                    Text("Chargeable ${Weights.kg(o.chargeableWeightGrams)} · GST ${Money.format(o.gst)} · valid till ${Dates.dateTime(o.expiresAt)}", style = MaterialTheme.typography.labelSmall)
                    o.lines.forEach { KeyValue(it.label, Money.format(it.sellPreTax)) }
                }
            }
            r.notices.forEach { Text("• $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (r.offers.isNotEmpty()) PrimaryButton("Book a shipment", Modifier.fillMaxWidth(), onClick = onBook)
        }
        Spacer(Modifier.height(72.dp))
    }
}

/** Track: own shipments open in-app; any AWB opens the public tracking page. */
@Composable
fun TrackScreen(repo: Repository, openOrder: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Track shipment", style = MaterialTheme.typography.headlineSmall)
        Field("AWB / LR or Order ID", q, { q = it.trim().take(40) })
        err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        PrimaryButton("Track", Modifier.fillMaxWidth(), enabled = q.length >= 4, busy = busy) {
            busy = true; err = null
            scope.launch {
                try {
                    val r = repo.orders("all", 1, q, null, null, java.time.LocalDate.now(Dates.IST).minusDays(365).toString(), Dates.today())
                    val hit = r.rows.firstOrNull { it.orderNumber.equals(q, true) || it.shipment?.awb.equals(q, true) || it.shipment?.lr.equals(q, true) } ?: r.rows.firstOrNull()
                    if (hit != null) openOrder(hit.id)
                    else CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(repo.api.url("/track/?awb=${Uri.encode(q)}")))
                } catch (e: ApiException) { err = e.message } finally { busy = false }
            }
        }
    }
}

/** Daily bulk manifest (server groups by pickup location and courier, business timezone IST). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ManifestScreen(repo: Repository) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var date by rememberSaveable { mutableStateOf(Dates.today()) }
    var warehouses by remember { mutableStateOf<List<Warehouse>>(emptyList()) }
    var wh by rememberSaveable { mutableStateOf<String?>(null) }
    var file by remember { mutableStateOf<Pair<File, String>?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { repo.warehouses() }.onSuccess { warehouses = it } }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Daily manifest", style = MaterialTheme.typography.headlineSmall)
        Text("All shipments booked on the day, with AWB/LR, courier, pickup and carton counts and a signature space for the pickup agent.", style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(0L, 1L, 2L).forEach { back -> val d = java.time.LocalDate.now(Dates.IST).minusDays(back).toString(); FilterChip(date == d, { date = d }, { Text(if (back == 0L) "Today" else if (back == 1L) "Yesterday" else d) }) }
        }
        if (warehouses.size > 1) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(wh == null, { wh = null }, { Text("All pickup locations") }); warehouses.forEach { w -> FilterChip(wh == w.id, { wh = w.id }, { Text(w.label) }) }
        }
        err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        PrimaryButton("Download Manifest", Modifier.fillMaxWidth(), busy = busy) {
            busy = true; err = null
            scope.launch {
                try { val m = repo.createManifest(date, null, null, wh); info = "Manifest ${m.manifestNo ?: ""}: ${m.awbCount} shipments"; file = repo.downloadManifest(m, ctx.cacheDir) to "Manifest ${m.manifestNo ?: date}" }
                catch (e: ApiException) { err = e.message } finally { busy = false }
            }
        }
        Text(stringResource(R.string.manifest_notice), fontWeight = FontWeight.SemiBold, color = Brand.OrangeAction)
        info?.let { Text(it) }
        file?.let { (f, t) -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { SecondaryButton("Open") { if (!FileActions.open(ctx, f)) err = "No PDF viewer installed. Use Share or Print." }; SecondaryButton("Share") { FileActions.share(ctx, f, t) }; SecondaryButton("Print") { FileActions.print(ctx, f, t) } } }
    }
}
