package `in`.vishwaship.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// ---- auth / account (GET /api/mobile/v1/me) ----
@Serializable data class Session(val token: String, val expiresAt: String, val refreshAfter: String? = null, val me: Me? = null)
@Serializable data class Me(
    val user: MeUser, val org: MeOrg, val onboarding: Onboarding, val wallet: WalletBalance,
    val credits: Int = 0, val unreadAlerts: Int = 0, val openTickets: Int = 0,
    val modules: Map<String, Boolean> = emptyMap(), val plan: Plan? = null,
)
@Serializable data class MeUser(val id: String, val name: String, val email: String? = null, val mobile: String? = null, val emailVerified: Boolean = false, val mobileVerified: Boolean = false)
@Serializable data class MeOrg(val id: String, val name: String, val businessName: String, val gstin: String? = null, val kycStatus: String, val profileComplete: Boolean)
@Serializable data class Onboarding(val step: String, val reasons: List<String> = emptyList(), val message: String? = null)
@Serializable data class WalletBalance(val availablePaise: Long = 0, val postedPaise: Long = 0, val reservedPaise: Long = 0)
@Serializable data class Plan(val id: String, val name: String)
@Serializable data class AppConfig(val minSupportedVersionCode: Int = 1, val pushAvailable: Boolean = false, val links: Map<String, String> = emptyMap())

// ---- orders (same row shape as the web Orders page) ----
@Serializable data class TabCounts(
    val drafts: Int = 0, val new: Int = 0, val courier_assigned: Int = 0, val pickups: Int = 0, val in_transit: Int = 0,
    val out_for_delivery: Int = 0, val delivered: Int = 0, val ndr: Int = 0, val rto_in_transit: Int = 0, val rto_delivered: Int = 0,
    val all: Int = 0, val archive: Int = 0,
)
@Serializable data class Addr(
    val name: String? = null, val mobile: String? = null, val line1: String? = null, val line2: String? = null, val city: String? = null,
    val district: String? = null, val state: String? = null, val pincode: String? = null, val label: String? = null, val contactName: String? = null, val email: String? = null,
)
@Serializable data class Product(val name: String, val sku: String = "", val qty: Int = 1)
@Serializable data class Pkg(val count: Int, val l: Double, val b: Double, val h: Double, val kg: Double)
@Serializable data class ChargeLine(val label: String, val amount: Long)
@Serializable data class Breakdown(val lines: List<ChargeLine> = emptyList(), val gst: Long? = null, val quoteTotal: Long? = null, val booked: Long = 0, val adjustment: Adjustment? = null, val total: Long = 0)
@Serializable data class Adjustment(val amount: Long, val label: String, val at: String)
@Serializable data class ShipmentInfo(
    val id: String, val carrierCode: String, val carrierName: String, val serviceName: String, val awb: String? = null, val lr: String? = null,
    val pieces: Int = 0, val bookingStatus: String, val status: String, val pickupStatus: String, val lastLocation: String? = null,
    val lastEventAt: String? = null, val etaDate: String? = null, val deliveredAt: String? = null,
    val labelFormats: List<String> = emptyList(), val cancellable: Boolean = false,
)
@Serializable data class OrderRow(
    val id: String, val orderNumber: String, val createdAt: String, val source: String = "manual", val mode: String, val direction: String = "forward",
    val orderStatus: String, val archived: Boolean = false, val invoiceNumber: String? = null,
    val products: List<Product> = emptyList(), val boxes: Int = 0, val isMps: Boolean = false, val packages: List<Pkg> = emptyList(),
    val actualGrams: Int = 0, val volumetricGrams: Int = 0, val chargeableGrams: Int? = null, val carrierGrams: Int? = null,
    val payment: String, val invoicePaise: Long = 0, val codPaise: Long = 0, val chargedPaise: Long? = null, val bookedPaise: Long? = null,
    val receiverFreightPaise: Long = 0, val breakdown: Breakdown? = null, val consignee: Addr = Addr(), val pickup: Addr? = null, val warehouseId: String? = null,
    val shipment: ShipmentInfo? = null, val cancellableOrder: Boolean = false,
)
@Serializable data class OrdersPage(val rows: List<OrderRow>, val total: Int, val page: Int, val pageSize: Int, val counts: TabCounts = TabCounts())
@Serializable data class HomeData(val range: DateRange, val counts: TabCounts, val recent: List<OrderRow>)
@Serializable data class DateRange(val from: String, val to: String)
@Serializable data class TimelineEvent(val status: String, val raw: String? = null, val location: String? = null, val at: String, val remark: String? = null)
@Serializable data class NdrCase(val id: String, val kind: String, val reason: String? = null, val attempt: Int = 1, val deadlineAt: String? = null, val status: String, val requestedAction: String? = null)
@Serializable data class OrderDetail(val order: OrderRow, val timeline: List<TimelineEvent> = emptyList(), val ndr: NdrCase? = null)

// ---- quotes & booking ----
@Serializable data class QuoteLine(val code: String, val label: String, val sellPreTax: Long)
@Serializable data class Payer(val sender: Long = 0, val receiver: Long = 0)
@Serializable data class Offer(
    val quoteId: String, val carrierCode: String, val carrierName: String, val serviceName: String, val mode: String,
    val etaDays: Int? = null, val chargeableWeightGrams: Int = 0, val lines: List<QuoteLine> = emptyList(),
    val sellingSubtotal: Long = 0, val gst: Long = 0, val total: Long = 0, val expiresAt: String, val isDemo: Boolean = false,
    val paymentMode: String = "prepaid", val payer: Payer = Payer(),
)
@Serializable data class QuoteResult(val offers: List<Offer> = emptyList(), val notices: List<String> = emptyList())
@Serializable data class CreatedOrder(val orderId: String, val orderNumber: String? = null, val replay: Boolean = false)
@Serializable data class Booked(val ok: Boolean = true, val shipmentId: String, val awb: String? = null, val state: String? = null)
@Serializable data class PincodeInfo(val pin: String, val city: String, val state: String, val partial: Boolean = false)

// ---- addresses ----
@Serializable data class Warehouse(
    val id: String, val code: String? = null, val label: String, val contactName: String, val mobile: String, val mobileVerified: Boolean = false,
    val email: String? = null, val line1: String, val line2: String? = null, val pincode: String, val city: String, val state: String, val isDefault: Boolean = false,
)
@Serializable data class Warehouses(val warehouses: List<Warehouse>)

// ---- wallet ----
@Serializable data class PassbookItem(
    val id: String, val at: String, val type: String, val title: String, val direction: String, val amountPaise: Long, val status: String,
    val description: String = "", val reference: String? = null, val orderId: String? = null, val orderNumber: String? = null, val awb: String? = null,
    val balanceAfterPaise: Long? = null,
)
@Serializable data class RechargeRow(val id: String, val method: String, val status: String, val amountPaise: Long, val payablePaise: Long? = null, val paidPaise: Long? = null, val utr: String? = null, val createdAt: String, val walletCredited: Boolean = false)
@Serializable data class GatewayOption(val gateway: String, val mode: String)
@Serializable data class ManualQuote(val rechargePaise: Long = 0, val discountPaise: Long = 0, val payablePaise: Long = 0)
@Serializable data class ManualUpi(val upiId: String = "", val payeeName: String = "", val instructions: String = "", val discountBps: Int = 0, val minPaise: Long = 0, val maxPaise: Long = 0, val hasQr: Boolean = false)
@Serializable data class RechargeOptions(val gateways: List<GatewayOption> = emptyList(), val onlineMinPaise: Long = 0, val onlineMaxPaise: Long = 0, val manual: ManualUpi? = null)
@Serializable data class CodTotals(val collected: Long = 0, val paid: Long = 0, val scheduled: Long = 0, val deductions: Long = 0, val unbatched: Long = 0)
@Serializable data class CodRow(val orderId: String, val orderNumber: String, val awb: String? = null, val status: String, val cod: Long, val state: String)
@Serializable data class CodData(val totals: CodTotals = CodTotals(), val rows: List<CodRow> = emptyList())
@Serializable data class WalletData(val balance: WalletBalance, val passbook: List<PassbookItem>, val recharges: List<RechargeRow>, val recharge: RechargeOptions, val cod: CodData? = null)
@Serializable data class StartRecharge(val mode: String, val rechargeId: String, val amountPaise: Long, val razorpayOrderId: String? = null, val keyId: String? = null, val paymentSessionId: String? = null, val cashfreeMode: String? = null)
@Serializable data class RechargeStatus(val id: String, val method: String, val status: String, val statusLabel: String, val creditPaise: Long, val reference: String? = null, val balancePaise: Long? = null, val decisionNote: String? = null)
@Serializable data class ManualSubmitted(val id: String, val requestNumber: String? = null, val ticketNumber: String? = null, val message: String? = null)

// ---- inbox, support, kyc ----
@Serializable data class Alert(val id: String, val kind: String, val title: String, val link: String, val read: Boolean, val createdAt: String)
@Serializable data class Alerts(val alerts: List<Alert>, val unread: Int)
@Serializable data class Ticket(val id: String, val number: String, val category: String, val subject: String, val status: String, val orderId: String? = null, val orderNumber: String? = null, val awb: String? = null, val createdAt: String, val updatedAt: String? = null)
@Serializable data class Tickets(val tickets: List<Ticket>)
@Serializable data class TicketMessage(val id: String, val fromSupport: Boolean, val body: String, val attachments: JsonElement? = null, val createdAt: String)
@Serializable data class TicketThread(val ticket: Ticket, val messages: List<TicketMessage>)
@Serializable data class CreatedTicket(val id: String, val number: String? = null)
@Serializable data class KycLatest(val id: String, val status: String, val maskedNumber: String? = null, val reason: String? = null, val uploadedAt: String, val reviewedAt: String? = null)
@Serializable data class KycDoc(val type: String, val label: String, val required: Boolean, val numberLabel: String, val latest: KycLatest? = null)
@Serializable data class Kyc(val status: String, val documents: List<KycDoc>)
@Serializable data class Manifest(val id: String, val manifestNo: String? = null, val awbCount: Int = 0, val pdfUrl: String)
@Serializable data class DeletionRequest(val id: String, val status: String)
