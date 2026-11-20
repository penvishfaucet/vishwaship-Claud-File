package `in`.vishwaship.app.ui.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.core.Weights
import `in`.vishwaship.app.data.OrderRow
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.data.TabCounts
import `in`.vishwaship.app.ui.common.EmptyState
import `in`.vishwaship.app.ui.common.ErrorState
import `in`.vishwaship.app.ui.common.Load
import `in`.vishwaship.app.ui.common.LinkText
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.common.SecondaryButton
import `in`.vishwaship.app.ui.common.SectionCard
import `in`.vishwaship.app.ui.common.Skeleton
import `in`.vishwaship.app.ui.common.StatusChip
import `in`.vishwaship.app.ui.common.rememberLoad

/** Website Orders tabs (same keys as the server's tabSql). */
val ORDER_TABS = listOf(
    "all" to "All", "new" to "New", "drafts" to "Drafts", "courier_assigned" to "Ready to ship", "pickups" to "Pickups",
    "in_transit" to "In transit", "out_for_delivery" to "Out for delivery", "delivered" to "Delivered", "ndr" to "NDR",
    "rto_in_transit" to "RTO in transit", "rto_delivered" to "RTO delivered", "archive" to "Archive",
)
fun TabCounts.of(key: String) = when (key) {
    "all" -> all; "new" -> new; "drafts" -> drafts; "courier_assigned" -> courier_assigned; "pickups" -> pickups; "in_transit" -> in_transit
    "out_for_delivery" -> out_for_delivery; "delivered" -> delivered; "ndr" -> ndr; "rto_in_transit" -> rto_in_transit; "rto_delivered" -> rto_delivered; else -> archive
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OrdersScreen(repo: Repository, initialTab: String, lockTab: Boolean, openOrder: (String) -> Unit, onCreate: () -> Unit) {
    var tab by rememberSaveable(initialTab) { mutableStateOf(initialTab) }
    var query by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    var payment by rememberSaveable { mutableStateOf<String?>(null) }
    var type by rememberSaveable { mutableStateOf<String?>(null) }
    var days by rememberSaveable { mutableIntStateOf(30) }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var showFilters by rememberSaveable { mutableStateOf(false) }
    val from = java.time.LocalDate.now(Dates.IST).minusDays((days - 1).toLong()).toString()
    val l = rememberLoad(tab, applied, payment, type, days, page) { repo.orders(tab, page, applied.ifBlank { null }, payment, type, from, Dates.today()) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(query, { query = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Order ID, AWB / LR or mobile") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                trailingIcon = { if (query != applied) IconButton(onClick = { applied = query.trim(); page = 1 }) { Icon(Icons.Outlined.Search, "Search") } })
            IconButton(onClick = { showFilters = true }) { Icon(Icons.Outlined.FilterList, "Filters") }
        }
        if (!lockTab) {
            val counts = (l.state as? Load.Ok)?.data?.counts
            LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ORDER_TABS) { (k, label) ->
                    FilterChip(selected = tab == k, onClick = { tab = k; page = 1 }, label = { Text(counts?.let { "$label (${it.of(k)})" } ?: label) })
                }
            }
        }
        PullToRefreshBox(isRefreshing = false, onRefresh = l.reload, modifier = Modifier.fillMaxSize()) {
            when (val s = l.state) {
                is Load.Loading -> Skeleton()
                is Load.Failed -> ErrorState(s.message, l.reload)
                is Load.Ok -> if (s.data.rows.isEmpty()) {
                    EmptyState(if (applied.isNotBlank()) "No orders match \"$applied\"" else "No orders here", "Last $days days", if (tab == "all" || tab == "new") "Add Order" to onCreate else null)
                } else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(s.data.rows, key = { it.id }) { OrderCard(it, openOrder) }
                    item {
                        val pages = (s.data.total + s.data.pageSize - 1) / s.data.pageSize
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            SecondaryButton("Previous", enabled = page > 1) { page-- }
                            Text("Page $page of ${pages.coerceAtLeast(1)} · ${s.data.total} orders")
                            SecondaryButton("Next", enabled = page < pages) { page++ }
                        }
                    }
                }
            }
        }
    }
    if (showFilters) ModalBottomSheet(onDismissRequest = { showFilters = false }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Filters", style = MaterialTheme.typography.titleLarge)
            Text("Date range")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(7, 30, 90, 180).forEach { d -> FilterChip(days == d, { days = d; page = 1 }, { Text("Last $d days") }) } }
            Text("Payment")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(null to "Any", "prepaid" to "Prepaid", "cod" to "COD", "fod" to "FOD").forEach { (k, v) -> FilterChip(payment == k, { payment = k; page = 1 }, { Text(v) }) } }
            Text("Shipment type")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(null to "Any", "B2C" to "B2C", "MPS" to "B2C multi-box", "B2B" to "B2B").forEach { (k, v) -> FilterChip(type == k, { type = k; page = 1 }, { Text(v) }) } }
            PrimaryButton("Show results", Modifier.fillMaxWidth()) { showFilters = false }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
fun OrderCard(o: OrderRow, openOrder: (String) -> Unit) {
    SectionCard(Modifier.clickable(role = Role.Button, onClickLabel = "Open order ${o.orderNumber}") { openOrder(o.id) }) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            LinkText(o.orderNumber, { openOrder(o.id) }, Modifier.weight(1f))
            StatusChip(o.shipment?.status ?: o.orderStatus)
        }
        Text("${o.consignee.name ?: ""} · ${o.consignee.city ?: ""} ${o.consignee.pincode ?: ""}".trim(), style = MaterialTheme.typography.bodyMedium)
        o.shipment?.let { s ->
            Text("${s.carrierName} · ${s.serviceName}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            (s.awb ?: s.lr)?.let { Text("AWB/LR $it", style = MaterialTheme.typography.bodyMedium) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${o.mode}${if (o.isMps) " · MPS" else ""} · ${o.boxes} box${if (o.boxes == 1) "" else "es"} · ${Weights.kg(o.chargeableGrams ?: o.actualGrams)}", style = MaterialTheme.typography.labelSmall)
            Text(when (o.payment) { "cod" -> "COD ${Money.format(o.codPaise)}"; "fod" -> "FOD"; else -> "Prepaid" }, style = MaterialTheme.typography.labelSmall)
        }
        Text(Dates.dateTime(o.createdAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Dashboard tiles: tap opens the matching Orders/NDR tab. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatusTiles(c: TabCounts, open: (String) -> Unit) {
    val tiles = listOf("new" to "New", "courier_assigned" to "Ready to ship", "pickups" to "Pickups", "in_transit" to "In transit",
        "out_for_delivery" to "Out for delivery", "delivered" to "Delivered", "ndr" to "NDR", "rto_in_transit" to "RTO")
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 4) {
        tiles.forEach { (k, label) ->
            AssistChip(onClick = { open(k) }, label = {
                Column(Modifier.padding(vertical = 6.dp)) {
                    Text("${c.of(k) + if (k == "rto_in_transit") c.rto_delivered else 0}", style = MaterialTheme.typography.titleLarge)
                    Text(label, style = MaterialTheme.typography.labelSmall)
                }
            }, modifier = Modifier.weight(1f))
        }
    }
}
