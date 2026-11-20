package `in`.vishwaship.app.core

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

/** All money from the server is integer paise. Display only; the app never computes a price. */
object Money {
    private val inr: NumberFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 2; minimumFractionDigits = 2 }
    fun format(paise: Long?): String = if (paise == null) "—" else inr.format(paise / 100.0)
    fun format(paise: Int?): String = format(paise?.toLong())
    /** "1,234.50" typed by a customer → paise; null when not a valid amount. */
    fun parseRupees(text: String): Long? {
        val t = text.replace(",", "").trim()
        if (!Regex("""^\d{1,9}(\.\d{1,2})?$""").matches(t)) return null
        return (t.toBigDecimal() * 100.toBigDecimal()).toLong()
    }
}

/** IST everywhere, like the website. */
object Dates {
    val IST: ZoneId = ZoneId.of("Asia/Kolkata")
    private val dt = DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a", Locale("en", "IN"))
    private val d = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale("en", "IN"))
    fun dateTime(iso: String?): String = iso?.let { runCatching { dt.format(Instant.parse(it).atZone(IST)) }.getOrNull() } ?: "—"
    fun date(iso: String?): String = iso?.let { runCatching { d.format(Instant.parse(it).atZone(IST)) }.getOrNull() } ?: "—"
    fun today(): String = java.time.LocalDate.now(IST).toString()
}

/**
 * Display-only weight preview while the customer types (actual vs volumetric at the 5000 divisor the web form shows).
 * The chargeable weight that is billed always comes from the server's quote (service-specific divisor, slabs, rounding).
 */
object Weights {
    data class Box(val count: Int, val lengthCm: Double, val breadthCm: Double, val heightCm: Double, val weightKg: Double)
    data class Summary(val boxes: Int, val actualKg: Double, val volumetricKg: Double) {
        val estimatedChargeableKg: Double get() = maxOf(actualKg, volumetricKg)
    }
    fun summarize(boxes: List<Box>, divisor: Int = 5000): Summary {
        val valid = boxes.filter { it.count > 0 }
        val actual = valid.sumOf { it.count * it.weightKg }
        val vol = valid.sumOf { it.count * ceil(it.lengthCm * it.breadthCm * it.heightCm / divisor * 1000) / 1000 }
        return Summary(valid.sumOf { it.count }, round3(actual), round3(vol))
    }
    fun kg(grams: Int?): String = if (grams == null) "—" else "${"%.2f".format(grams / 1000.0)} kg"
    private fun round3(v: Double) = Math.round(v * 1000) / 1000.0
}

object Validators {
    val pin = Regex("""^[1-9]\d{5}$""")
    fun mobile(raw: String): String? = raw.filter(Char::isDigit).replace(Regex("""^(91|0)(?=\d{10}$)"""), "").takeIf { Regex("""^[6-9]\d{9}$""").matches(it) }
    fun email(raw: String) = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(raw.trim())
    /** Same address characters the server accepts. */
    fun addressText(raw: String) = Regex("""^[\w\s.,\-/#]*$""").matches(raw)
    val utr = Regex("""^[A-Z0-9]{6,30}$""")
}
