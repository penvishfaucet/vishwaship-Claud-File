package `in`.vishwaship.app.ui.create

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Validators
import `in`.vishwaship.app.core.Weights
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.AppJson
import `in`.vishwaship.app.data.Offer
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
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.random.Random

@Serializable data class BoxDraft(val count: String = "1", val l: String = "", val b: String = "", val h: String = "", val kg: String = "")
@Serializable data class ProductDraft(val name: String = "", val qty: String = "1", val price: String = "", val sku: String = "", val hsn: String = "")

/** The whole draft survives rotation and process death (saved as JSON in the saved-state bundle). */
@Serializable data class OrderDraft(
    val step: Int = 0,
    /** Generated once per draft: the server returns the same order for a repeated save (idempotent). */
    val orderNumber: String = "APP-" + LocalDateTime.now(Dates.IST).format(DateTimeFormatter.ofPattern("yyMMddHHmm")) + "-" + Random.nextInt(1000, 9999),
    val warehouseId: String = "",
    val name: String = "", val mobile: String = "", val altMobile: String = "", val email: String = "", val gstin: String = "",
    val pincode: String = "", val city: String = "", val state: String = "", val line1: String = "", val line2: String = "",
    val packageType: String = "parcel", val rovType: String = "owner",
    val boxes: List<BoxDraft> = listOf(BoxDraft()), val products: List<ProductDraft> = listOf(ProductDraft()),
    val invoiceNumber: String = "", val payment: String = "prepaid", val codAmount: String = "", val ewayBill: String = "",
    val orderId: String? = null, val quoteId: String? = null,
)

private val DraftSaver = Saver<OrderDraft, String>({ AppJson.encodeToString(OrderDraft.serializer(), it) }, { AppJson.decodeFromString(OrderDraft.serializer(), it) })
private val STEPS = listOf("Addresses", "Packages", "Courier & Payment", "Confirmation")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CreateOrderScreen(repo: Repository, quick: Boolean, walletPaise: Long?, onBooked: (String) -> Unit, openOrder: (String) -> Unit, openRecharge: () -> Unit, addAddress: () -> Unit) {
    var d by rememberSaveable(stateSaver = DraftSaver) { mutableStateOf(OrderDraft()) }
    var warehouses by remember { mutableStateOf<List<Warehouse>?>(null) }
    var offers by remember { mutableStateOf<List<Offer>?>(null) }
    var notices by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var issues by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var pinMsg by remember { mutableStateOf<String?>(null) }
    var bookedAwb by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { repo.warehouses() }.onSuccess { w -> warehouses = w; if (d.warehouseId.isBlank()) w.firstOrNull { it.isDefault }?.let { d = d.copy(warehouseId = it.id) } ?: w.firstOrNull()?.let { d = d.copy(warehouseId = it.id) } }
            .onFailure { err = (it as? ApiException)?.message ?: "Could not load pickup addresses" }
    }
    // Courier step reopened after process death: fetch the quotes again for the saved order
    LaunchedEffect(d.step, d.orderId) { if (d.step == 2 && d.orderId != null && offers == null && busy == null) { busy = "Getting rates…"; runCatching { repo.quoteOrder(d.orderId!!) }.onSuccess { offers = it.offers; notices = it.notices }.onFailure { err = (it as? ApiException)?.message }; busy = null } }

    fun lookupPin(pin: String) {
        if (!Validators.pin.matches(pin)) return
        scope.launch {
            pinMsg = "Looking up PIN…"
            try { val p = repo.pincode(pin); d = d.copy(city = p.city, state = p.state); pinMsg = if (p.partial) "Check the city: only the district was found" else "${p.city}, ${p.state}" }
            catch (e: ApiException) { pinMsg = e.message }
        }
    }

    val summary = Weights.summarize(d.boxes.map { Weights.Box(it.count.toIntOrNull() ?: 0, it.l.toDoubleOrNull() ?: 0.0, it.b.toDoubleOrNull() ?: 0.0, it.h.toDoubleOrNull() ?: 0.0, it.kg.toDoubleOrNull() ?: 0.0) })
    val invoiceTotal = d.products.sumOf { (it.qty.toIntOrNull() ?: 0) * (it.price.replace(",", "").toDoubleOrNull() ?: 0.0) }
    val heavy = d.packageType == "heavy"

    fun step1Errors(): Map<String, String> = buildMap {
        if (d.warehouseId.isBlank()) put("warehouseId", "Select a pickup address")
        if (d.name.trim().length < 2) put("buyer.name", "Buyer/Receiver name is required")
        if (Validators.mobile(d.mobile) == null) put("buyer.mobile", "Enter a 10-digit mobile number")
        if (d.email.isNotBlank() && !Validators.email(d.email)) put("buyer.email", "Enter a valid email")
        if (!Validators.pin.matches(d.pincode)) put("buyer.pincode", "Enter a 6-digit PIN code")
        if (d.city.trim().length < 2) put("buyer.city", "City is required")
        if (d.state.trim().length < 2) put("buyer.state", "State is required")
        if (d.line1.isBlank() || !Validators.addressText(d.line1)) put("buyer.line1", "Address Line 1 is required (letters, numbers and . , - / # only)")
        if (!Validators.addressText(d.line2)) put("buyer.line2", "Only these special characters are allowed: . , - / #")
    }
    fun step2Errors(): Map<String, String> = buildMap {
        d.boxes.forEachIndexed { i, b ->
            if ((b.count.toIntOrNull() ?: 0) < 1) put("boxes.$i.count", "At least 1 box")
            listOf("l" to b.l, "b" to b.b, "h" to b.h).forEach { (k, v) -> if ((v.toDoubleOrNull() ?: 0.0) <= 0) put("boxes.$i.$k", "Required") }
            if ((b.kg.toDoubleOrNull() ?: 0.0) <= 0) put("boxes.$i.kg", "Weight per box is required")
        }
        d.products.forEachIndexed { i, p ->
            if (p.name.isBlank()) put("products.$i.name", "Product name is required")
            if ((p.qty.toIntOrNull() ?: 0) < 1) put("products.$i.qty", "Quantity must be at least 1")
            if ((p.price.replace(",", "").toDoubleOrNull() ?: 0.0) < 0.01) put("products.$i.unitPriceRupees", "Unit price is required")
        }
        if (d.payment == "fod" && !heavy) put("paymentType", "FOD is only for heavy (B2B) shipments")
        if (d.payment == "cod" && d.codAmount.isNotBlank() && (d.codAmount.toDoubleOrNull() ?: 0.0) <= 0) put("codAmountRupees", "Enter the COD amount")
        if (invoiceTotal > 50_000 && heavy && !Regex("""^\d{12}$""").matches(d.ewayBill)) put("ewayBill", "E-Way Bill number (12 digits) is required above ₹50,000 for heavy shipments")
    }

    fun formJson() = buildJsonObject {
        put("orderNumber", d.orderNumber); put("orderDate", Dates.today()); put("invoiceNumber", d.invoiceNumber)
        putJsonObject("buyer") {
            put("name", d.name.trim()); put("mobile", d.mobile); put("altMobile", d.altMobile); put("email", d.email.trim()); put("gstin", d.gstin)
            put("line1", d.line1.trim()); put("line2", d.line2.trim()); put("pincode", d.pincode); put("city", d.city.trim()); put("state", d.state.trim())
        }
        put("billingSame", true)
        put("products", JsonArray(d.products.map { p -> buildJsonObject { put("name", p.name.trim()); put("qty", p.qty.toIntOrNull() ?: 1); put("unitPriceRupees", p.price.replace(",", "").toDoubleOrNull() ?: 0.0); put("sku", p.sku); put("hsn", p.hsn) } }))
        put("paymentType", d.payment)
        if (d.payment == "cod" && d.codAmount.isNotBlank()) put("codAmountRupees", d.codAmount.toDoubleOrNull() ?: 0.0)
        put("warehouseId", d.warehouseId); put("packageType", d.packageType); if (heavy) put("rovType", d.rovType)
        put("boxes", JsonArray(d.boxes.map { b -> buildJsonObject { put("count", b.count.toIntOrNull() ?: 1); put("lengthCm", b.l.toDouble()); put("breadthCm", b.b.toDouble()); put("heightCm", b.h.toDouble()); put("weightKg", b.kg.toDouble()) } }))
        put("ewayBill", d.ewayBill)
    }

    fun toCourierStep() {
        issues = step2Errors(); if (issues.isNotEmpty()) { err = "Please correct the highlighted fields"; return }
        busy = "Saving order…"; err = null
        scope.launch {
            try {
                val created = d.orderId ?: repo.createOrder(formJson()).orderId
                d = d.copy(orderId = created, step = 2)
                busy = "Getting live rates…"
                val q = repo.quoteOrder(created); offers = q.offers; notices = q.notices
            } catch (e: ApiException) {
                err = e.message
                (e.body?.get("issues") as? JsonArray)?.let { arr -> issues = arr.associate { val o = it as kotlinx.serialization.json.JsonObject; (o["path"] as JsonPrimitive).content to (o["message"] as JsonPrimitive).content } }
            } finally { busy = null }
        }
    }

    fun book() {
        val orderId = d.orderId ?: return; val quoteId = d.quoteId ?: return
        busy = "Booking with the courier…"; err = null
        scope.launch {
            try {
                val r = repo.book(orderId, quoteId)
                bookedAwb = r.awb ?: ""
                onBooked(orderId)
            } catch (e: ApiException) {
                when (e.code) {
                    "insufficient_balance" -> err = "${e.message} Recharge your wallet, then book again: your order is saved."
                    "quote_expired" -> { err = "These rates expired. Fresh rates are shown below."; d = d.copy(step = 2, quoteId = null); offers = null; runCatching { repo.quoteOrder(orderId) }.onSuccess { offers = it.offers } }
                    "price_changed" -> { err = "The courier's price changed. Review the new total before booking."; d = d.copy(quoteId = (e.body?.get("newQuoteId") as? JsonPrimitive)?.content) }
                    "already_booked" -> { openOrder(orderId); return@launch }
                    // WhatsApp COD confirmation is on: the server books after the buyer confirms (or cancels on decline)
                    "cod_hold" -> { onBooked(orderId); return@launch }
                    else -> err = if (e.status == 202 || e.isNetwork) "We could not confirm the booking yet. Do not book again: open the order to check its status." else e.message
                }
                if (e.status == 202 || e.isNetwork) openOrder(orderId)
            } finally { busy = null }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            STEPS.forEachIndexed { i, s -> Text("${i + 1}. $s", style = MaterialTheme.typography.labelSmall, fontWeight = if (i == d.step) FontWeight.Bold else FontWeight.Normal, color = if (i == d.step) Brand.OrangeAction else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f)) }
        }
        busy?.let { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (quick) "Quick Order" else "Add Order", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            Text("Order ID ${d.orderNumber}", style = MaterialTheme.typography.labelSmall)
            when (d.step) {
                0 -> {
                    SectionCard {
                        Text("Pickup address", style = MaterialTheme.typography.titleMedium)
                        val ws = warehouses
                        if (ws == null) Text("Loading…") else if (ws.isEmpty()) { Text("Add a pickup address first."); SecondaryButton("Add pickup address", onClick = addAddress) }
                        else ws.forEach { w ->
                            Row(Modifier.fillMaxWidth().clickable(role = Role.RadioButton) { d = d.copy(warehouseId = w.id) }, verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = d.warehouseId == w.id, onClick = { d = d.copy(warehouseId = w.id) })
                                Column { Text("${w.label}${if (w.isDefault) " (default)" else ""}", fontWeight = FontWeight.Medium); Text("${w.line1}, ${w.city} ${w.pincode} · ${w.contactName}", style = MaterialTheme.typography.bodyMedium)
                                    if (!w.mobileVerified) Text("Pickup mobile not verified yet", color = Brand.Warning, style = MaterialTheme.typography.labelSmall) }
                            }
                        }
                        issues["warehouseId"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    }
                    SectionCard {
                        Text("Deliver to", style = MaterialTheme.typography.titleMedium)
                        Field("Buyer / receiver name", d.name, { d = d.copy(name = it) }, error = issues["buyer.name"])
                        Field("Mobile", d.mobile, { d = d.copy(mobile = it.take(14)) }, keyboard = KeyboardType.Phone, error = issues["buyer.mobile"])
                        Field("Email (optional)", d.email, { d = d.copy(email = it) }, keyboard = KeyboardType.Email, error = issues["buyer.email"], supporting = "Optional: used for pickup and delivery emails when provided")
                        Field("PIN code", d.pincode, { v -> val pin = v.filter(Char::isDigit).take(6); d = d.copy(pincode = pin); if (pin.length == 6) lookupPin(pin) }, keyboard = KeyboardType.Number, error = issues["buyer.pincode"], supporting = pinMsg)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Field("City / district", d.city, { d = d.copy(city = it) }, Modifier.weight(1f), error = issues["buyer.city"])
                            Field("State", d.state, { d = d.copy(state = it) }, Modifier.weight(1f), error = issues["buyer.state"])
                        }
                        Field("House / building, street", d.line1, { d = d.copy(line1 = it) }, error = issues["buyer.line1"])
                        Field("Locality / landmark (optional)", d.line2, { d = d.copy(line2 = it) }, error = issues["buyer.line2"])
                        if (!quick) Field("Buyer GSTIN (optional)", d.gstin, { d = d.copy(gstin = it.uppercase().take(15)) })
                    }
                }
                1 -> {
                    SectionCard {
                        Text("Package type", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(d.packageType == "parcel", { d = d.copy(packageType = "parcel", payment = if (d.payment == "fod") "prepaid" else d.payment) }, { Text("Parcel (below 10 kg) · B2C") })
                            FilterChip(heavy, { d = d.copy(packageType = "heavy") }, { Text("Heavy (10 kg+) · B2B") })
                        }
                        if (heavy) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(d.rovType == "owner", { d = d.copy(rovType = "owner") }, { Text("ROV Owner's risk") })
                            FilterChip(d.rovType == "carrier", { d = d.copy(rovType = "carrier") }, { Text("ROV Carrier's risk") })
                        }
                    }
                    SectionCard {
                        Text("Boxes (L × W × H in cm, weight per box)", style = MaterialTheme.typography.titleMedium)
                        d.boxes.forEachIndexed { i, b ->
                            fun set(nb: BoxDraft) { d = d.copy(boxes = d.boxes.toMutableList().also { it[i] = nb }) }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Box group ${i + 1}", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                                if (d.boxes.size > 1) IconButton(onClick = { d = d.copy(boxes = d.boxes.filterIndexed { j, _ -> j != i }) }) { Icon(Icons.Outlined.Delete, "Remove box group ${i + 1}") }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Field("Identical boxes", b.count, { set(b.copy(count = it.filter(Char::isDigit).take(3))) }, Modifier.weight(1f), keyboard = KeyboardType.Number, error = issues["boxes.$i.count"])
                                Field("Kg per box", b.kg, { set(b.copy(kg = it.take(7))) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal, error = issues["boxes.$i.kg"])
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Field("L", b.l, { set(b.copy(l = it.take(6))) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal, error = issues["boxes.$i.l"])
                                Field("W", b.b, { set(b.copy(b = it.take(6))) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal, error = issues["boxes.$i.b"])
                                Field("H", b.h, { set(b.copy(h = it.take(6))) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal, error = issues["boxes.$i.h"])
                            }
                        }
                        if (!quick) TextButton(onClick = { d = d.copy(boxes = d.boxes + BoxDraft()) }) { Text("+ Add another box size") }
                        KeyValue("Total boxes", "${summary.boxes}")
                        KeyValue("Actual weight", "${summary.actualKg} kg")
                        KeyValue("Volumetric weight (est.)", "${summary.volumetricKg} kg")
                        Text("Chargeable weight is confirmed with each courier's rate on the next step.", style = MaterialTheme.typography.labelSmall)
                    }
                    SectionCard {
                        Text("Products", style = MaterialTheme.typography.titleMedium)
                        d.products.forEachIndexed { i, p ->
                            fun set(np: ProductDraft) { d = d.copy(products = d.products.toMutableList().also { it[i] = np }) }
                            Field("Product name", p.name, { set(p.copy(name = it)) }, error = issues["products.$i.name"])
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Field("Qty", p.qty, { set(p.copy(qty = it.filter(Char::isDigit).take(5))) }, Modifier.weight(1f), keyboard = KeyboardType.Number, error = issues["products.$i.qty"])
                                Field("Unit price ₹", p.price, { set(p.copy(price = it.take(10))) }, Modifier.weight(1f), keyboard = KeyboardType.Decimal, error = issues["products.$i.unitPriceRupees"])
                            }
                            if (!quick) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Field("SKU (optional)", p.sku, { set(p.copy(sku = it)) }, Modifier.weight(1f))
                                Field("HSN (optional)", p.hsn, { set(p.copy(hsn = it.filter(Char::isDigit).take(8))) }, Modifier.weight(1f), keyboard = KeyboardType.Number)
                            }
                        }
                        if (!quick) TextButton(onClick = { d = d.copy(products = d.products + ProductDraft()) }) { Text("+ Add product") }
                        KeyValue("Invoice value", Money.format((invoiceTotal * 100).toLong()))
                        if (!quick) Field("Invoice number (optional)", d.invoiceNumber, { d = d.copy(invoiceNumber = it) })
                        if (invoiceTotal > 50_000) Field("E-Way Bill number" + if (heavy) "" else " (optional)", d.ewayBill, { d = d.copy(ewayBill = it.filter(Char::isDigit).take(12)) }, keyboard = KeyboardType.Number, error = issues["ewayBill"])
                    }
                    SectionCard {
                        Text("Payment", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(d.payment == "prepaid", { d = d.copy(payment = "prepaid") }, { Text("Prepaid") })
                            FilterChip(d.payment == "cod", { d = d.copy(payment = "cod") }, { Text("Cash on Delivery") })
                            if (heavy) FilterChip(d.payment == "fod", { d = d.copy(payment = "fod") }, { Text("Freight on Delivery") })
                        }
                        if (d.payment == "cod") Field("COD amount ₹", d.codAmount, { d = d.copy(codAmount = it.take(10)) }, keyboard = KeyboardType.Decimal, supporting = "Leave empty to collect the invoice value", error = issues["codAmountRupees"])
                        issues["paymentType"]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    }
                }
                2 -> {
                    val os = offers
                    if (os == null) Text("Getting live rates…")
                    else if (os.isEmpty()) SectionCard { Text("No courier serves this route with these details right now."); notices.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) } }
                    else os.forEach { o -> OfferCard(o, d.quoteId == o.quoteId) { d = d.copy(quoteId = o.quoteId) } }
                }
                else -> {
                    val o = offers?.firstOrNull { it.quoteId == d.quoteId }
                    val w = warehouses?.firstOrNull { it.id == d.warehouseId }
                    SectionCard {
                        Text("Review", style = MaterialTheme.typography.titleMedium)
                        KeyValue("Pickup", w?.let { "${it.label}, ${it.city} ${it.pincode}" })
                        KeyValue("Consignee", "${d.name}, ${d.city} ${d.pincode}")
                        KeyValue("Cartons", "${summary.boxes}")
                        KeyValue("Service", o?.let { "${it.carrierName} · ${it.serviceName}" })
                        KeyValue("Chargeable weight", Weights.kg(o?.chargeableWeightGrams))
                        KeyValue("Payment", when (d.payment) { "cod" -> "COD ${d.codAmount.ifBlank { "(invoice value)" }}"; "fod" -> "Freight on Delivery"; else -> "Prepaid" })
                        o?.let { KeyValue("Shipping (incl. GST)", Money.format(it.total)); if (it.payer.receiver > 0) KeyValue("Collected from receiver", Money.format(it.payer.receiver)); KeyValue("Debited from wallet", Money.format(it.payer.sender)) }
                        KeyValue("Wallet balance", Money.format(walletPaise))
                        o?.let { Text("Rate valid until ${Dates.dateTime(it.expiresAt)}", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
            err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (err?.contains("Recharge") == true) SecondaryButton("Recharge wallet", onClick = openRecharge)
            Spacer(Modifier.height(80.dp))
        }
        // Step buttons sit above the system navigation bar and away from the floating action button
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Once saved, the order's addresses and packages are fixed (the quote is priced on them): going back from
            // the courier step starts a fresh draft instead; the saved order stays under Orders → New.
            if (d.step == 2 && d.orderId != null) SecondaryButton("Start over", Modifier.weight(1f), enabled = busy == null) { err = null; offers = null; d = OrderDraft(warehouseId = d.warehouseId) }
            else if (d.step > 0) SecondaryButton("Back", Modifier.weight(1f), enabled = busy == null) { err = null; d = d.copy(step = d.step - 1) }
            when (d.step) {
                0 -> PrimaryButton("Next: Packages", Modifier.weight(2f)) { issues = step1Errors(); if (issues.isEmpty()) { err = null; d = d.copy(step = 1) } else err = "Please correct the highlighted fields" }
                1 -> PrimaryButton("Save & get rates", Modifier.weight(2f), busy = busy != null) { toCourierStep() }
                2 -> PrimaryButton("Next: Confirm", Modifier.weight(2f), enabled = d.quoteId != null) { d = d.copy(step = 3) }
                else -> PrimaryButton("Book shipment", Modifier.weight(2f), busy = busy != null, enabled = d.quoteId != null) { book() }
            }
        }
    }
}

@Composable
private fun OfferCard(o: Offer, selected: Boolean, onSelect: () -> Unit) {
    val ctx = LocalContext.current
    val logo = remember(o.carrierCode) { ctx.resources.getIdentifier("courier_" + o.carrierCode.lowercase().replace('-', '_'), "drawable", ctx.packageName) }
    SectionCard(Modifier.clickable(role = Role.RadioButton, onClick = onSelect)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = onSelect)
            if (logo != 0) Image(androidx.compose.ui.res.painterResource(logo), contentDescription = "${o.carrierName} logo", modifier = Modifier.height(28.dp).width(72.dp))
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(o.carrierName, fontWeight = FontWeight.SemiBold); Text("${o.serviceName} · ${o.mode}", style = MaterialTheme.typography.bodyMedium)
                Text(listOfNotNull(o.etaDays?.let { "ETA $it days" }, "Chargeable ${Weights.kg(o.chargeableWeightGrams)}", if (o.paymentMode == "cod") "COD" else null).joinToString(" · "), style = MaterialTheme.typography.labelSmall)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(Money.format(o.total), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("incl. GST ${Money.format(o.gst)}", style = MaterialTheme.typography.labelSmall)
            }
        }
        if (selected) o.lines.forEach { KeyValue(it.label, Money.format(it.sellPreTax)) }
        if (o.isDemo) Text("Demo rate (no carrier connected)", color = Brand.Warning, style = MaterialTheme.typography.labelSmall)
    }
}
