package `in`.vishwaship.app.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.data.Me
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.ui.common.EmptyState
import `in`.vishwaship.app.ui.common.LoadView
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.common.SecondaryButton
import `in`.vishwaship.app.ui.common.SectionCard
import `in`.vishwaship.app.ui.common.rememberLoad
import `in`.vishwaship.app.ui.orders.OrderCard
import `in`.vishwaship.app.ui.orders.StatusTiles
import `in`.vishwaship.app.ui.theme.Brand

/**
 * Home: status counts first (tap → matching Orders/NDR tab), then quick actions, wallet, KYC notice and recent
 * shipments. The old promotional tiles (COD Available, Parcel from ₹28, Cargo) are intentionally not shown here.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(repo: Repository, me: Me?, go: (String) -> Unit) {
    val l = rememberLoad { repo.home() }
    PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
        LoadView(l) { h ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item {
                    Text("Hello${me?.user?.name?.let { ", ${it.substringBefore(' ')}" } ?: ""}", style = MaterialTheme.typography.headlineSmall)
                    Text("Shipments in the last 30 days (${Dates.date(h.range.from + "T00:00:00Z")} – today)", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item {
                    SectionCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text("Total orders", color = MaterialTheme.colorScheme.onSurfaceVariant); Text("${h.counts.all}", style = MaterialTheme.typography.headlineSmall) }
                            Column(Modifier.weight(1f)) { Text("Delivered", color = MaterialTheme.colorScheme.onSurfaceVariant); Text("${h.counts.delivered}", style = MaterialTheme.typography.headlineSmall, color = Brand.Success) }
                            Column(Modifier.weight(1f)) { Text("Needs action", color = MaterialTheme.colorScheme.onSurfaceVariant); Text("${h.counts.ndr + h.counts.new}", style = MaterialTheme.typography.headlineSmall, color = Brand.OrangeAction) }
                        }
                        StatusTiles(h.counts) { tab -> go(if (tab == "ndr") "ndr" else "orders?tab=$tab") }
                    }
                }
                item {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        AssistChip({ go("create") }, { Text("Add Order") }, leadingIcon = { Icon(Icons.Outlined.AddBox, null) })
                        AssistChip({ go("create?quick=1") }, { Text("Quick Order") }, leadingIcon = { Icon(Icons.Outlined.Bolt, null) })
                        AssistChip({ go("rates") }, { Text("Rate Calculator") }, leadingIcon = { Icon(Icons.Outlined.Calculate, null) })
                        AssistChip({ go("track") }, { Text("Track") }, leadingIcon = { Icon(Icons.Outlined.LocalShipping, null) })
                        AssistChip({ go("manifest") }, { Text("Daily manifest") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.ReceiptLong, null) })
                    }
                }
                item {
                    SectionCard {
                        Text("Wallet balance", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(Money.format(me?.wallet?.availablePaise), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        if ((me?.wallet?.reservedPaise ?: 0) > 0) Text("${Money.format(me?.wallet?.reservedPaise)} held for bookings in progress", style = MaterialTheme.typography.labelSmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PrimaryButton("Recharge") { go("wallet?recharge=1") }
                            SecondaryButton("Passbook") { go("wallet") }
                        }
                    }
                }
                me?.onboarding?.message?.let { msg ->
                    item {
                        SectionCard {
                            Text(if (me.onboarding.step == "profile") "Complete your profile" else "KYC", style = MaterialTheme.typography.titleMedium)
                            Text(msg)
                            me.onboarding.reasons.forEach { Text("• $it", color = MaterialTheme.colorScheme.error) }
                            SecondaryButton(if (me.onboarding.step == "profile") "Complete profile" else "Open KYC") { go(if (me.onboarding.step == "profile") "web:/portal/onboarding/" else "kyc") }
                        }
                    }
                }
                item { Text("Recent shipments", style = MaterialTheme.typography.titleMedium) }
                if (h.recent.isEmpty()) item { EmptyState("No shipments yet", "Book your first shipment in a minute.", "Add Order" to { go("create") }) }
                items(h.recent, key = { it.id }) { OrderCard(it) { id -> go("order/$id") } }
                item { Spacer(Modifier.height(72.dp)) }
            }
        }
    }
}
