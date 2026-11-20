package `in`.vishwaship.app.ui.more

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.core.Dates
import `in`.vishwaship.app.core.FileActions
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.Me
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.ui.common.EmptyState
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
import kotlinx.coroutines.launch
import java.io.File

/** More: items follow the portal sidebar and its module switches (Admin turns modules on/off; no app release needed). */
@Composable
fun MoreScreen(me: Me?, go: (String) -> Unit) {
    val m = me?.modules ?: emptyMap()
    fun on(key: String) = m[key] ?: true
    val rows = buildList {
        add(Triple(Icons.Outlined.Calculate, "Rate Calculator", "rates"))
        add(Triple(Icons.Outlined.LocalShipping, "Track shipment", "track"))
        add(Triple(Icons.AutoMirrored.Outlined.ReceiptLong, "Daily manifest", "manifest"))
        add(Triple(Icons.Outlined.Place, "Pickup addresses", "addresses"))
        add(Triple(Icons.Outlined.AccountBalanceWallet, "Wallet & Billing", "wallet"))
        add(Triple(Icons.Outlined.NotificationsActive, "Notifications & alerts", "notify"))
        if (on("store_channels") || on("api_integration")) add(Triple(Icons.Outlined.Extension, "Integrations (website)", "web:/portal/integrations/"))
        if (on("reports")) add(Triple(Icons.Outlined.Assessment, "Reports (website)", "web:/portal/reports/"))
        add(Triple(Icons.Outlined.Badge, "KYC", "kyc"))
        add(Triple(Icons.Outlined.ConfirmationNumber, "Support tickets", "tickets"))
        add(Triple(Icons.Outlined.Person, "Profile & account", "profile"))
        add(Triple(Icons.Outlined.Settings, "Settings (website)", "web:/portal/settings/"))
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        me?.let { item { Column(Modifier.padding(16.dp)) { Text(it.org.businessName, style = MaterialTheme.typography.titleLarge); Text(it.user.email ?: it.user.mobile ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant); it.plan?.let { p -> Text("Plan: ${p.name}", style = MaterialTheme.typography.labelSmall) } } } }
        items(rows) { (icon, label, route) -> MoreRow(icon, label) { go(route) } }
        item { Spacer(Modifier.height(80.dp)) }
    }
}

@Composable
private fun MoreRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Brand.Navy); Spacer(Modifier.width(16.dp)); Text(label, style = MaterialTheme.typography.bodyLarge)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun AlertsScreen(repo: Repository, open: (String) -> Unit, onChanged: () -> Unit) {
    val l = rememberLoad { repo.alerts() }
    val scope = rememberCoroutineScope()
    PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
        LoadView(l) { a ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Row(verticalAlignment = Alignment.CenterVertically) { Text("${a.unread} unread", modifier = Modifier.weight(1f)); TextButton(onClick = { scope.launch { runCatching { repo.markAlertsRead(null) }; l.reload(); onChanged() } }) { Text("Mark all read") } } }
                if (a.alerts.isEmpty()) item { EmptyState("No notifications yet") }
                items(a.alerts, key = { it.id }) { n ->
                    SectionCard(Modifier.clickable(role = Role.Button) { scope.launch { runCatching { repo.markAlertsRead(listOf(n.id)) }; onChanged() }; open(n.link) }) {
                        Text(n.title, fontWeight = if (n.read) FontWeight.Normal else FontWeight.Bold)
                        Text(Dates.dateTime(n.createdAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
fun TicketsScreen(repo: Repository, open: (String) -> Unit, create: () -> Unit) {
    val l = rememberLoad { repo.tickets() }
    PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
        LoadView(l) { list ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { PrimaryButton("Raise a ticket", Modifier.fillMaxWidth(), onClick = create) }
                if (list.isEmpty()) item { EmptyState("No tickets", "Raise a ticket for any shipment, pickup, billing or tech issue.") }
                items(list, key = { it.id }) { t ->
                    SectionCard(Modifier.clickable(role = Role.Button) { open(t.id) }) {
                        Row { LinkText(t.number, { open(t.id) }, Modifier.weight(1f)); StatusChip(t.status) }
                        Text(t.subject); t.orderNumber?.let { Text("Order $it", style = MaterialTheme.typography.labelSmall) }
                        Text(Dates.dateTime(t.updatedAt ?: t.createdAt), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/** Same categories as the website (src/lib/support.ts). */
val TICKET_CATEGORIES = listOf("shipment" to "Shipment Related Issue", "pickup" to "Pickup Related Issue", "tech" to "Tech Related Issue", "billing" to "Billing & Remittance",
    "reattempt" to "Reattempt shipment", "return" to "Return shipment", "edit_order" to "Edit Order Information", "pod" to "Proof of Delivery")
private val NEEDS_REF = setOf("shipment", "pickup", "reattempt", "return", "edit_order", "pod")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewTicketScreen(repo: Repository, prefillRef: String?, done: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var cat by rememberSaveable { mutableStateOf(if (prefillRef != null) "shipment" else "tech") }
    var ref by rememberSaveable { mutableStateOf(prefillRef ?: "") }
    var comment by rememberSaveable { mutableStateOf("") }
    val idem = rememberSaveable { Repository.newKey() }
    var file by remember { mutableStateOf<Pair<File, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? -> uri?.let { file = FileActions.importPicked(ctx, it) ?: run { err = "Attachments can be up to 10 MB."; null } } }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Raise a ticket", style = MaterialTheme.typography.headlineSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { TICKET_CATEGORIES.forEach { (k, v) -> FilterChip(cat == k, { cat = k }, { Text(v) }) } }
        Field(if (cat in NEEDS_REF) "Order ID / AWB" else "Order ID / AWB / wallet reference (optional)", ref, { ref = it.trim() })
        Field("Describe the issue", comment, { comment = it }, singleLine = false)
        SecondaryButton(file?.let { "Attached: ${it.first.name.substringAfter('-')}" } ?: "Attach photo or PDF") { pick.launch(arrayOf("image/*", "application/pdf")) }
        err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        PrimaryButton("Submit ticket", Modifier.fillMaxWidth(), busy = busy, enabled = comment.trim().length >= 5 && (cat !in NEEDS_REF || ref.isNotBlank())) {
            busy = true; err = null
            scope.launch { try { done(repo.createTicket(cat, ref, comment.trim(), idem, file?.first, file?.second).id) } catch (e: ApiException) { err = e.message } finally { busy = false } }
        }
    }
}

@Composable
fun TicketDetailScreen(repo: Repository, id: String) {
    val l = rememberLoad(id) { repo.ticket(id) }
    val scope = rememberCoroutineScope()
    var reply by rememberSaveable { mutableStateOf("") }
    var cid by rememberSaveable { mutableStateOf(Repository.newKey()) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LoadView(l) { t ->
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Row { Text(t.ticket.number, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f)); StatusChip(t.ticket.status) }; Text(t.ticket.subject) }
            items(t.messages, key = { it.id }) { m ->
                SectionCard {
                    Text(if (m.fromSupport) "Vishwaship Support" else "You", fontWeight = FontWeight.SemiBold, color = if (m.fromSupport) Brand.OrangeAction else Brand.Navy)
                    Text(m.body); Text(Dates.dateTime(m.createdAt), style = MaterialTheme.typography.labelSmall)
                }
            }
            if (t.ticket.status != "closed") item {
                Field("Reply", reply, { reply = it }, singleLine = false)
                err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                PrimaryButton("Send", busy = busy, enabled = reply.isNotBlank()) {
                    busy = true
                    scope.launch { try { repo.replyTicket(id, reply.trim(), cid, null, null); reply = ""; cid = Repository.newKey(); l.reload() } catch (e: ApiException) { err = e.message } finally { busy = false } }
                }
            }
        }
    }
}

@Composable
fun KycScreen(repo: Repository) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val l = rememberLoad { repo.kyc() }
    var uploading by remember { mutableStateOf<String?>(null) }
    var number by rememberSaveable { mutableStateOf("") }
    var ifsc by rememberSaveable { mutableStateOf("") }
    var file by remember { mutableStateOf<Pair<File, String>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? -> uri?.let { file = FileActions.importPicked(ctx, it) ?: run { err = "Files can be up to 5 MB (PDF, JPG or PNG)."; null } } }
    LoadView(l) { k ->
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Row(verticalAlignment = Alignment.CenterVertically) { Text("KYC status", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f)); StatusChip(k.status) } }
            items(k.documents, key = { it.type }) { d ->
                SectionCard {
                    Row { Text(d.label + if (d.required) "" else " (if applicable)", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); d.latest?.let { StatusChip(it.status) } }
                    d.latest?.let { KeyValue(d.numberLabel, it.maskedNumber); KeyValue("Uploaded", Dates.dateTime(it.uploadedAt)); it.reason?.let { r -> Text("Reason: $r", color = MaterialTheme.colorScheme.error) } }
                    if (d.latest == null || d.latest.status in setOf("rejected", "changes_requested")) {
                        if (uploading == d.type) {
                            Field(d.numberLabel, number, { number = it.uppercase().filter(Char::isLetterOrDigit).take(18) }, keyboard = if (d.type == "pan" || d.type == "gst_certificate") KeyboardType.Text else KeyboardType.Number)
                            if (d.type == "cancelled_cheque") Field("IFSC", ifsc, { ifsc = it.uppercase().take(11) })
                            SecondaryButton(file?.let { "Selected: ${it.first.name.substringAfter('-')}" } ?: "Choose PDF / photo") { pick.launch(arrayOf("application/pdf", "image/jpeg", "image/png")) }
                            err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            PrimaryButton("Upload", busy = busy, enabled = number.isNotBlank() && file != null) {
                                busy = true; err = null
                                scope.launch { try { repo.uploadKyc(d.type, number, ifsc.ifBlank { null }, file!!.first, file!!.second); uploading = null; number = ""; file = null; l.reload() } catch (e: ApiException) { err = e.message } finally { busy = false } }
                            }
                        } else SecondaryButton(if (d.latest == null) "Upload" else "Resubmit") { uploading = d.type; number = ""; file = null; err = null }
                    }
                }
            }
            item { Text("Documents are uploaded privately and reviewed by Vishwaship staff. Approval unlocks the best rates.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
fun AddressesScreen(repo: Repository, openWeb: (String) -> Unit) {
    val l = rememberLoad { repo.warehouses() }
    PullToRefreshBox(isRefreshing = false, onRefresh = l.reload) {
        LoadView(l) { ws ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { SecondaryButton("Add or edit addresses (website)") { openWeb("/portal/addresses/") } }
                if (ws.isEmpty()) item { EmptyState("No pickup addresses yet") }
                items(ws, key = { it.id }) { w ->
                    SectionCard {
                        Row { Text(w.label, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); if (w.isDefault) StatusChip("default") }
                        Text("${w.line1}${w.line2?.let { ", $it" } ?: ""}, ${w.city}, ${w.state} ${w.pincode}")
                        Text("${w.contactName} · ${w.mobile}${if (w.mobileVerified) " · verified" else " · not verified"}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/** Notification preferences: the same per-account switches as the website (PUT /api/portal/notifications). */
@Composable
fun NotifyScreen(repo: Repository, pushOn: Boolean, setPush: (Boolean) -> Unit, pushAvailable: Boolean, openWeb: (String) -> Unit) {
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("Phone notifications", fontWeight = FontWeight.SemiBold); Text(if (pushAvailable) "Shipment, wallet, ticket and KYC updates on this phone. Details stay hidden on the lock screen." else "Not available in this build yet. Updates still appear in the bell inbox.", style = MaterialTheme.typography.bodyMedium) }
                Switch(checked = pushOn && pushAvailable, onCheckedChange = setPush, enabled = pushAvailable)
            }
        }
        SectionCard {
            Text("Email, SMS, WhatsApp & webhooks", fontWeight = FontWeight.SemiBold)
            Text("Channel and event settings, COD confirmation on WhatsApp, templates, credit balance and delivery logs are shared with the website.")
            SecondaryButton("Open notification settings") { openWeb("/portal/notifications/") }
            SecondaryButton("WhatsApp COD confirmation") { openWeb("/portal/notifications/cod/") }
        }
    }
}

@Composable
fun ProfileScreen(repo: Repository, me: Me?, onLogout: () -> Unit, openWeb: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var askDelete by remember { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }
    var msg by remember { mutableStateOf<String?>(null) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        me?.let {
            SectionCard {
                KeyValue("Name", it.user.name); KeyValue("Email", it.user.email); KeyValue("Mobile", it.user.mobile)
                KeyValue("Business", it.org.businessName); KeyValue("GSTIN", it.org.gstin); KeyValue("KYC", it.org.kycStatus.replace('_', ' '))
                SecondaryButton("Edit profile (website)") { openWeb("/portal/profile/") }
            }
        }
        SecondaryButton("Terms") { openWeb("/terms/") }
        SecondaryButton("Privacy policy") { openWeb("/privacy/") }
        PrimaryButton("Sign out", Modifier.fillMaxWidth(), onClick = onLogout)
        SectionCard {
            Text("Delete account", fontWeight = FontWeight.SemiBold, color = Brand.Danger)
            Text("Your account is shared by the website and the app; deletion closes it on both. Pending shipments, COD and wallet balance are settled first; invoices and ledger records are kept as long as the law requires.", style = MaterialTheme.typography.bodyMedium)
            msg?.let { Text(it, color = Brand.Success) }
            SecondaryButton("Request account deletion") { askDelete = true }
        }
        Spacer(Modifier.height(48.dp))
    }
    if (askDelete) AlertDialog(onDismissRequest = { askDelete = false }, title = { Text("Request account deletion?") },
        text = { Column { Text("Our team will confirm by email before closing the account."); Field("Reason (optional)", reason, { reason = it }) } },
        confirmButton = { TextButton(onClick = { askDelete = false; scope.launch { msg = try { "Request ${repo.requestAccountDeletion(reason).id} received. We'll email you." } catch (e: ApiException) { e.message } } }) { Text("Request deletion") } },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text("Cancel") } })
}
