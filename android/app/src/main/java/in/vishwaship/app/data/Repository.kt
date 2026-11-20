package `in`.vishwaship.app.data

import `in`.vishwaship.app.BuildConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.io.File
import java.net.URLEncoder
import java.util.UUID

/**
 * Every call goes to the existing Vishwaship backend: /api/mobile/v1 for app-specific reads and sign-in, and the
 * same /api/portal endpoints the website uses for every change (booking, quotes, recharge, tickets, KYC…),
 * so the server rules, prices and ledger are shared. The app never computes a price or a balance.
 */
class Repository(val api: Api, private val store: SecureStore) {
    private inline fun <reified T> parse(s: String): T = AppJson.decodeFromString(s)
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    private val device get() = buildJsonObject { put("installId", store.installId); put("appVersion", BuildConfig.VERSION_NAME) }

    val isSignedIn get() = store.token != null

    private fun keep(s: Session): Session { store.token = s.token; store.refreshAfter = s.refreshAfter; return s }

    // ---------- auth ----------
    suspend fun login(identifier: String, password: String) = keep(parse<Session>(api.send("POST", "/api/mobile/v1/auth/login", buildJsonObject {
        put("identifier", identifier); put("password", password); put("device", device)
    }.toString())))

    /** purpose = "signup" | "reset". The code is emailed; it is never returned. */
    suspend fun requestEmailCode(email: String, purpose: String) { api.send("POST", "/api/auth/signup-otp", buildJsonObject { put("email", email); put("purpose", purpose) }.toString()) }

    suspend fun signup(name: String, email: String, otp: String, password: String) = keep(parse<Session>(api.send("POST", "/api/mobile/v1/auth/signup", buildJsonObject {
        put("name", name); put("email", email); put("otp", otp); put("password", password); put("acceptTerms", true); put("device", device)
    }.toString())))

    suspend fun resetPassword(email: String, otp: String, password: String) = keep(parse<Session>(api.send("POST", "/api/mobile/v1/auth/reset", buildJsonObject {
        put("email", email); put("otp", otp); put("password", password); put("device", device)
    }.toString())))

    /** Rotate the token once a day while the app is used; a 401 here means the session really ended. */
    suspend fun refreshIfDue() {
        val due = store.refreshAfter?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() } ?: return
        if (java.time.Instant.now().isAfter(due)) keep(parse<Session>(api.send("POST", "/api/mobile/v1/auth/refresh")))
    }

    /** Server first (revoke token + detach push), then always wipe local state, even offline. */
    suspend fun logout() {
        runCatching { api.send("POST", "/api/mobile/v1/auth/logout") }
        store.clearSession()
    }
    fun forgetLocally() = store.clearSession()

    suspend fun config() = parse<AppConfig>(api.get("/api/mobile/v1/config"))
    suspend fun me() = parse<Me>(api.get("/api/mobile/v1/me"))
    suspend fun registerPush(token: String?) { api.send("PUT", "/api/mobile/v1/devices", buildJsonObject { if (token == null) put("pushToken", null as String?) else put("pushToken", token); put("appVersion", BuildConfig.VERSION_NAME) }.toString()) }
    suspend fun requestAccountDeletion(reason: String) = parse<DeletionRequest>(api.send("POST", "/api/mobile/v1/account/delete", buildJsonObject { put("reason", reason) }.toString()))

    // ---------- dashboard & orders ----------
    suspend fun home() = parse<HomeData>(api.get("/api/mobile/v1/home"))
    suspend fun orders(tab: String, page: Int, q: String?, payment: String?, type: String?, from: String?, to: String?) =
        parse<OrdersPage>(api.get("/api/mobile/v1/orders", mapOf("tab" to tab, "page" to page.toString(), "size" to "25", "q" to q, "payment" to payment, "type" to type, "from" to from, "to" to to)))
    suspend fun order(id: String) = parse<OrderDetail>(api.get("/api/mobile/v1/orders/${enc(id)}"))
    suspend fun pincode(pin: String) = parse<PincodeInfo>(api.get("/api/portal/pincode/${enc(pin)}"))
    suspend fun warehouses() = parse<Warehouses>(api.get("/api/mobile/v1/warehouses")).warehouses

    /** Rate Calculator: POST /api/portal/quote — identical payload to the website, so identical quotes. */
    suspend fun quote(mode: String, origin: String, dest: String, payment: String, codRupees: Double?, declaredRupees: Double?, boxes: List<BoxInput>) =
        parse<QuoteResult>(api.send("POST", "/api/portal/quote", buildJsonObject {
            put("mode", mode); put("originPincode", origin); put("destinationPincode", dest); put("paymentType", payment)
            if (codRupees != null) put("codAmountRupees", codRupees)
            if (declaredRupees != null) put("declaredValueRupees", declaredRupees)
            put("packages", JsonArray(boxes.map { it.json() }))
        }.toString()))

    /** Create Order (same form schema as the website). The Order ID makes repeated taps return the first order. */
    suspend fun createOrder(form: JsonObject) = parse<CreatedOrder>(api.send("POST", "/api/portal/orders/form", form.toString()))
    suspend fun quoteOrder(orderId: String) = parse<QuoteResult>(api.send("POST", "/api/portal/orders/${enc(orderId)}/quote"))
    /** One idempotent server booking action: the quote id is the key (a second tap gets already_booked). */
    suspend fun book(orderId: String, quoteId: String) = parse<Booked>(api.send("POST", "/api/portal/orders/${enc(orderId)}/book", buildJsonObject { put("quoteId", quoteId) }.toString()))
    suspend fun cancel(orderId: String, reason: String) { api.send("POST", "/api/portal/orders/${enc(orderId)}/cancel", buildJsonObject { put("reason", reason) }.toString()) }
    suspend fun schedulePickup(warehouseId: String, date: String, shipmentIds: List<String>) {
        api.send("POST", "/api/portal/pickups", buildJsonObject { put("warehouseId", warehouseId); put("date", date); put("shipmentIds", JsonArray(shipmentIds.map(::JsonPrimitive))) }.toString())
    }
    suspend fun ndrAction(ndrId: String, action: String, line1: String? = null, mobile: String? = null) {
        api.send("POST", "/api/portal/ndr/${enc(ndrId)}", buildJsonObject { put("action", action); line1?.let { put("line1", it) }; mobile?.let { put("mobile", it) } }.toString())
    }
    suspend fun refreshTracking(shipmentId: String) { api.send("POST", "/api/portal/shipments/${enc(shipmentId)}/refresh") }

    // ---------- documents ----------
    suspend fun downloadLabel(shipmentId: String, format: String, dir: File) =
        api.download("/api/portal/labels?ids=${enc(shipmentId)}&format=${enc(format)}", File(dir, "documents/label-$shipmentId-$format.pdf"))
    suspend fun createManifest(date: String?, shipmentId: String?, carrierCode: String?, warehouseId: String?) =
        parse<Manifest>(api.send("POST", "/api/portal/manifests", buildJsonObject {
            date?.let { put("date", it) }; shipmentId?.let { put("shipmentId", it) }; carrierCode?.let { put("carrierCode", it) }; warehouseId?.let { put("warehouseId", it) }
        }.toString()))
    suspend fun downloadManifest(m: Manifest, dir: File) = api.download(m.pdfUrl, File(dir, "documents/manifest-${m.manifestNo ?: m.id}.pdf"))
    suspend fun downloadInvoice(shipmentId: String, dir: File) = api.download("/api/portal/shipments/${enc(shipmentId)}/invoice", File(dir, "documents/invoice-$shipmentId.pdf"))

    // ---------- wallet ----------
    suspend fun wallet(withCod: Boolean = false) = parse<WalletData>(api.get("/api/mobile/v1/wallet", mapOf("cod" to if (withCod) "1" else null)))
    suspend fun startRecharge(rupees: Long, gateway: String) = parse<StartRecharge>(api.send("POST", "/api/portal/recharge", buildJsonObject {
        put("amountRupees", rupees); put("gateway", gateway); put("client", "android")
    }.toString()))
    /** Razorpay success callback → server verifies the signature and amount with Razorpay; only then credits. */
    suspend fun verifyRazorpay(paymentId: String, orderId: String, signature: String) {
        api.send("POST", "/api/portal/recharge/verify", buildJsonObject { put("razorpay_payment_id", paymentId); put("razorpay_order_id", orderId); put("razorpay_signature", signature) }.toString())
    }
    suspend fun cancelRecharge(id: String) { runCatching { api.send("POST", "/api/portal/recharge/${enc(id)}/cancel") } }
    /** Status check (the server re-checks pending payments with the gateway). Safe to call any number of times. */
    suspend fun rechargeStatus(id: String) = parse<RechargeStatus>(api.get("/api/portal/recharge/${enc(id)}"))
    suspend fun submitManualRecharge(rupees: Long, utr: String, paidAtIso: String, paidRupees: String, remarks: String, proof: File, mime: String) =
        parse<ManualSubmitted>(api.multipart("/api/portal/recharge/manual", mapOf("amountRupees" to rupees.toString(), "utr" to utr, "paidAt" to paidAtIso, "paidRupees" to paidRupees, "remarks" to remarks), "file" to proof, mime))
    fun qrUrl() = api.url("/api/portal/recharge/qr")

    // ---------- inbox, support, kyc ----------
    suspend fun alerts() = parse<Alerts>(api.get("/api/mobile/v1/alerts"))
    suspend fun markAlertsRead(ids: List<String>?) { api.send("POST", "/api/mobile/v1/alerts", buildJsonObject { if (ids == null) put("all", true) else put("ids", JsonArray(ids.map(::JsonPrimitive))) }.toString()) }
    suspend fun tickets() = parse<Tickets>(api.get("/api/mobile/v1/tickets")).tickets
    suspend fun ticket(id: String) = parse<TicketThread>(api.get("/api/mobile/v1/tickets/${enc(id)}"))
    /** The idempotency key is created once per draft, so a retried submit returns the same ticket. */
    suspend fun createTicket(category: String, ref: String, comment: String, idem: String, file: File?, mime: String?) =
        parse<CreatedTicket>(api.multipart("/api/portal/support/tickets", mapOf("category" to category, "ref" to ref, "comment" to comment, "idem" to idem), file?.let { "file" to it }, mime))
    suspend fun replyTicket(id: String, body: String, clientId: String, file: File?, mime: String?) {
        api.multipart("/api/portal/support/tickets/${enc(id)}/messages", mapOf("body" to body, "cid" to clientId), file?.let { "file" to it }, mime)
    }
    suspend fun kyc() = parse<Kyc>(api.get("/api/mobile/v1/kyc"))
    suspend fun uploadKyc(docType: String, number: String, ifsc: String?, file: File, mime: String) {
        api.multipart("/api/portal/kyc", buildMap { put("docType", docType); put("number", number); ifsc?.let { put("ifsc", it) } }, "file" to file, mime)
    }
    suspend fun setNotification(channel: String, event: String, enabled: Boolean) {
        api.send("PUT", "/api/portal/notifications", buildJsonObject { put("channel", channel); put("event", event); put("enabled", enabled) }.toString())
    }

    companion object { fun newKey() = UUID.randomUUID().toString() }
}

data class BoxInput(val count: Int, val lengthCm: Double, val breadthCm: Double, val heightCm: Double, val weightKg: Double) {
    fun json() = buildJsonObject { put("count", count); put("lengthCm", lengthCm); put("breadthCm", breadthCm); put("heightCm", heightCm); put("weightKg", weightKg) }
}
