package `in`.vishwaship.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import `in`.vishwaship.app.R
import `in`.vishwaship.app.core.Money
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.ui.theme.Brand

/** Loading / loaded / failed state for a screen's data, with reload. Data is re-fetched after process death. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val data: T) : Load<T>
    data class Failed(val message: String, val network: Boolean) : Load<Nothing>
}
class Loader<T>(val state: Load<T>, val reload: () -> Unit)

@Composable
fun <T> rememberLoad(vararg keys: Any?, fetch: suspend () -> T): Loader<T> {
    var state by remember(*keys) { mutableStateOf<Load<T>>(Load.Loading) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick, *keys) {
        if (state !is Load.Ok) state = Load.Loading
        state = try { Load.Ok(fetch()) } catch (e: ApiException) { Load.Failed(e.message, e.isNetwork) } catch (e: Exception) { Load.Failed("Something went wrong. Please try again.", false) }
    }
    return Loader(state) { tick++ }
}

@Composable
fun <T> LoadView(l: Loader<T>, content: @Composable (T) -> Unit) {
    when (val s = l.state) {
        is Load.Loading -> Skeleton()
        is Load.Failed -> ErrorState(s.message, l.reload)
        is Load.Ok -> content(s.data)
    }
}

@Composable
fun Skeleton() {
    Column(Modifier.fillMaxWidth().padding(16.dp).semantics { contentDescription = "Loading" }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(4) { Box(Modifier.fillMaxWidth().height(72.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))) }
    }
}

@Composable
fun ErrorState(message: String, retry: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(8.dp))
        Text(message, style = MaterialTheme.typography.bodyLarge)
        if (retry != null) { Spacer(Modifier.height(12.dp)); OutlinedButton(onClick = retry) { Text("Try again") } }
    }
}

@Composable
fun EmptyState(title: String, body: String? = null, action: Pair<String, () -> Unit>? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.Inbox, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
        body?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        action?.let { (label, go) -> Spacer(Modifier.height(12.dp)); PrimaryButton(label, onClick = go) }
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !busy, modifier = modifier.heightIn(min = 48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Brand.OrangeAction, contentColor = Color.White)) {
        if (busy) { CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
        Text(text)
    }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Text(text) }
}

/** Blue, underlined, clearly tappable Order ID / link. */
@Composable
fun LinkText(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Text(text, color = Brand.Link, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline,
        modifier = modifier.heightIn(min = 32.dp).clickable(role = Role.Button, onClickLabel = "Open $text", onClick = onClick).padding(vertical = 6.dp))
}

@Composable
fun SectionCard(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable () -> Unit) {
    Card(modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(0.dp)) {
        Column(Modifier.padding(padding), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
fun StatusChip(status: String) {
    val (bg, fg) = when (status.lowercase()) {
        "delivered", "credited", "approved", "confirmed", "resolved", "remitted" -> Color(0xFFE7F5EC) to Brand.Success
        "ndr", "rto_initiated", "rto_in_transit", "rto_delivered", "failed", "rejected", "cancelled", "lost", "booking_failed" -> Color(0xFFFDECEA) to Brand.Danger
        "in_transit", "out_for_delivery", "picked_up", "open" -> Color(0xFFE8F0FB) to Brand.Link
        else -> Color(0xFFFFF4E0) to Brand.Warning
    }
    Surface(color = bg, shape = RoundedCornerShape(50)) {
        Text(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, color = fg, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
fun KeyValue(key: String, value: String?, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(key, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value ?: "—", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1.3f), maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun Field(
    label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, error: String? = null,
    keyboard: KeyboardType = KeyboardType.Text, supporting: String? = null, singleLine: Boolean = true,
    visual: VisualTransformation = VisualTransformation.None, enabled: Boolean = true, trailing: @Composable (() -> Unit)? = null,
) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, modifier = modifier.fillMaxWidth(), isError = error != null,
        supportingText = (error ?: supporting)?.let { { Text(it) } }, keyboardOptions = KeyboardOptions(keyboardType = keyboard), singleLine = singleLine,
        visualTransformation = visual, enabled = enabled, trailingIcon = trailing)
}

/** Header: logo or title on the left; coin-style wallet, bell and support-ticket controls on the right. */
@Composable
fun AppHeader(title: String?, walletPaise: Long?, unread: Int, openTickets: Int, onWallet: () -> Unit, onBell: () -> Unit, onTickets: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (title == null) Image(painterResource(R.drawable.vs_logo), contentDescription = "Vishwaship", modifier = Modifier.height(30.dp))
            else Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.weight(1f))
            Row(Modifier.clip(RoundedCornerShape(50)).border(1.dp, Brand.Orange, RoundedCornerShape(50)).clickable(role = Role.Button, onClickLabel = "Open wallet", onClick = onWallet)
                .heightIn(min = 40.dp).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(24.dp).background(Brand.OrangeSoft, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.AccountBalanceWallet, contentDescription = null, tint = Brand.OrangeAction, modifier = Modifier.size(16.dp))
                }
                Spacer(Modifier.width(6.dp))
                Text(walletPaise?.let { Money.format(it) } ?: "Wallet", style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { contentDescription = "Wallet balance ${walletPaise?.let { Money.format(it) } ?: ""}" })
            }
            CoinIcon(Icons.Outlined.Notifications, "Notifications, $unread unread", unread, onBell)
            CoinIcon(Icons.Outlined.ConfirmationNumber, "Support tickets, $openTickets open", openTickets, onTickets)
        }
    }
}

@Composable
private fun CoinIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, count: Int, onClick: () -> Unit) {
    Box(Modifier.padding(start = 6.dp).size(44.dp).clip(CircleShape).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)
        .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        BadgedBox(badge = { if (count > 0) Badge(containerColor = Brand.OrangeAction, contentColor = Color.White) { Text(if (count > 99) "99+" else "$count") } }) {
            Icon(icon, contentDescription = null, tint = Brand.Navy)
        }
    }
}


@Composable
fun MoneyText(paise: Long?, modifier: Modifier = Modifier, bold: Boolean = false) =
    Text(Money.format(paise), modifier = modifier, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)

@Composable
fun ConfirmTextButton(text: String, onClick: () -> Unit) = TextButton(onClick = onClick, modifier = Modifier.heightIn(min = 48.dp)) { Text(text) }
