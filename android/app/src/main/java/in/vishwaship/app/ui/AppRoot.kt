package `in`.vishwaship.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.ReportProblem
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import `in`.vishwaship.app.BuildConfig
import `in`.vishwaship.app.VishwashipApp
import `in`.vishwaship.app.core.FileActions
import `in`.vishwaship.app.data.AppConfig
import `in`.vishwaship.app.data.Me
import `in`.vishwaship.app.push.Push
import `in`.vishwaship.app.ui.auth.ForgotPasswordScreen
import `in`.vishwaship.app.ui.auth.LoginScreen
import `in`.vishwaship.app.ui.auth.SignupScreen
import `in`.vishwaship.app.ui.common.AppHeader
import `in`.vishwaship.app.ui.create.CreateOrderScreen
import `in`.vishwaship.app.ui.home.HomeScreen
import `in`.vishwaship.app.ui.more.AddressesScreen
import `in`.vishwaship.app.ui.more.AlertsScreen
import `in`.vishwaship.app.ui.more.KycScreen
import `in`.vishwaship.app.ui.more.MoreScreen
import `in`.vishwaship.app.ui.more.NewTicketScreen
import `in`.vishwaship.app.ui.more.NotifyScreen
import `in`.vishwaship.app.ui.more.ProfileScreen
import `in`.vishwaship.app.ui.more.TicketDetailScreen
import `in`.vishwaship.app.ui.more.TicketsScreen
import `in`.vishwaship.app.ui.orders.OrderDetailScreen
import `in`.vishwaship.app.ui.orders.OrdersScreen
import `in`.vishwaship.app.ui.theme.Brand
import `in`.vishwaship.app.ui.tools.ManifestScreen
import `in`.vishwaship.app.ui.tools.RatesScreen
import `in`.vishwaship.app.ui.tools.TrackScreen
import `in`.vishwaship.app.ui.wallet.WalletScreen
import kotlinx.coroutines.launch

private val TABS = listOf(Triple("home", "Home", Icons.Outlined.Home), Triple("orders", "Orders", Icons.Outlined.Inventory2), Triple("ndr", "NDR", Icons.Outlined.ReportProblem), Triple("more", "More", Icons.Outlined.Menu))
private val TITLES = mapOf("orders" to "Orders", "ndr" to "NDR", "more" to "More", "order" to "Order", "create" to "Add Order", "rates" to "Rate Calculator", "track" to "Track",
    "manifest" to "Manifest", "wallet" to "Wallet & Billing", "alerts" to "Notifications", "tickets" to "Support", "ticket" to "Ticket", "kyc" to "KYC", "addresses" to "Pickup addresses",
    "notify" to "Notifications & alerts", "profile" to "Profile")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot(app: VishwashipApp, deepLink: String?, onDeepLinkHandled: () -> Unit) {
    val repo = app.repo
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val nav = rememberNavController()
    val snack = remember { SnackbarHostState() }
    var signedIn by remember { mutableStateOf(repo.isSignedIn) }
    var me by remember { mutableStateOf<Me?>(null) }
    var config by remember { mutableStateOf<AppConfig?>(null) }
    var pendingLink by rememberSaveable { mutableStateOf<String?>(null) }
    val prefs = remember { ctx.getSharedPreferences("vs_prefs", Context.MODE_PRIVATE) }
    var pushOn by remember { mutableStateOf(prefs.getBoolean("push", false)) }

    fun refreshMe() = scope.launch { runCatching { repo.me() }.onSuccess { me = it } }
    fun openWeb(path: String) = CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(repo.api.url(path)))
    fun go(route: String) { if (route.startsWith("web:")) openWeb(route.removePrefix("web:")) else nav.navigate(route) { launchSingleTop = true } }
    fun signOutLocally(message: String?) {
        repo.forgetLocally(); FileActions.clearAccountFiles(ctx); me = null; signedIn = false
        message?.let { scope.launch { snack.showSnackbar(it) } }
    }

    LaunchedEffect(Unit) {
        runCatching { repo.config() }.onSuccess { config = it }
        repo.api.sessionExpired.collect { signOutLocally("Your session ended. Please sign in again.") }
    }
    LaunchedEffect(signedIn) {
        if (signedIn) { runCatching { repo.refreshIfDue() }; refreshMe(); if (pushOn) Push.syncToken(app, true) }
    }
    // Links (push, App Links) are only followed after sign-in, and only to known in-app routes.
    LaunchedEffect(deepLink) { deepLink?.let { pendingLink = it; onDeepLinkHandled() } }
    LaunchedEffect(signedIn, pendingLink) {
        val link = pendingLink ?: return@LaunchedEffect
        if (!signedIn) return@LaunchedEffect
        pendingLink = null
        when {
            link.startsWith("/orders/") -> go("order/${link.removePrefix("/orders/")}")
            link.startsWith("/support/") -> go("ticket/${link.removePrefix("/support/")}")
            link.startsWith("/recharge/") -> go("wallet?recharge=0")
            link == "/wallet" -> go("wallet?recharge=0"); link == "/kyc" -> go("kyc"); else -> go("alerts")
        }
    }

    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pushOn = granted; prefs.edit().putBoolean("push", granted).apply()
        scope.launch { Push.syncToken(app, granted); if (!granted) snack.showSnackbar("Notifications are off. Updates still appear in the bell inbox.") }
    }
    fun setPush(on: Boolean) {
        if (on && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else { pushOn = on; prefs.edit().putBoolean("push", on).apply(); scope.launch { Push.syncToken(app, on) } }
    }

    if ((config?.minSupportedVersionCode ?: 0) > BuildConfig.VERSION_CODE) {
        AlertDialog(onDismissRequest = {}, title = { Text("Update required") }, text = { Text("This version of Vishwaship is no longer supported. Please update from Google Play.") },
            confirmButton = { TextButton(onClick = { CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse("https://play.google.com/store/apps/details?id=${ctx.packageName}")) }) { Text("Update") } })
    }

    if (!signedIn) {
        NavHost(nav, startDestination = "login", modifier = Modifier.fillMaxSize()) {
            composable("login") { LoginScreen(repo, onSignedIn = { signedIn = true }, onSignup = { nav.navigate("signup") }, onForgot = { nav.navigate("forgot") }, openWeb = ::openWeb) }
            composable("signup") { SignupScreen(repo, onSignedIn = { signedIn = true }, onBack = { nav.popBackStack() }, openWeb = ::openWeb) }
            composable("forgot") { ForgotPasswordScreen(repo, onSignedIn = { signedIn = true }, onBack = { nav.popBackStack() }) }
        }
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.BottomCenter) { SnackbarHost(snack) }
        return
    }

    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route?.substringBefore('?')?.substringBefore('/') ?: "home"
    val isTab = TABS.any { it.first == route }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 600.dp
        Row(Modifier.fillMaxSize()) {
            if (wide && isTab) NavigationRail(Modifier.windowInsetsPadding(WindowInsets.safeDrawing)) {
                TABS.forEach { (r, label, icon) -> NavigationRailItem(selected = route == r, onClick = { nav.navigate(r) { popUpTo("home"); launchSingleTop = true } }, icon = { Icon(icon, null) }, label = { Text(label) }) }
            }
            Scaffold(
                modifier = Modifier.weight(1f),
                snackbarHost = { SnackbarHost(snack) },
                topBar = {
                    if (isTab) Column(Modifier.statusBarsPadding()) {
                        AppHeader(if (route == "home") null else TITLES[route], me?.wallet?.availablePaise, me?.unreadAlerts ?: 0, me?.openTickets ?: 0,
                            onWallet = { go("wallet?recharge=0") }, onBell = { go("alerts") }, onTickets = { go("tickets") })
                    } else TopAppBar(title = { Text(TITLES[route] ?: "") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } })
                },
                bottomBar = {
                    if (isTab && !wide) NavigationBar {
                        TABS.forEach { (r, label, icon) -> NavigationBarItem(selected = route == r, onClick = { nav.navigate(r) { popUpTo("home"); launchSingleTop = true } }, icon = { Icon(icon, null) }, label = { Text(label) }) }
                    }
                },
                floatingActionButton = { if (isTab) QuickActions(::go) },
            ) { pad ->
                AppNav(nav, app, me, pad, ::go, ::openWeb, { refreshMe() }, pushOn, ::setPush, config?.pushAvailable == true && Push.configured) {
                    scope.launch { repo.logout(); runCatching { Push.syncToken(app, false) }; signOutLocally(null) }
                }
            }
        }
    }
}

@Composable
private fun QuickActions(go: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        AnimatedVisibility(open) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(Triple("Add Order", Icons.Outlined.AddBox, "create"), Triple("Quick Order", Icons.Outlined.Bolt, "create?quick=1"),
                    Triple("Rate Calculator", Icons.Outlined.Calculate, "rates"), Triple("Track Shipment", Icons.Outlined.LocalShipping, "track")).forEach { (label, icon, r) ->
                    ExtendedFloatingActionButton(onClick = { open = false; go(r) }, icon = { Icon(icon, null) }, text = { Text(label) }, containerColor = MaterialTheme.colorScheme.surface, contentColor = Brand.Navy)
                }
            }
        }
        FloatingActionButton(onClick = { open = !open }, containerColor = Brand.OrangeAction, contentColor = Color.White) {
            Icon(if (open) Icons.Outlined.Close else Icons.Outlined.Add, if (open) "Close quick actions" else "Quick actions: add order, rates, track")
        }
    }
}

@Composable
private fun AppNav(
    nav: NavHostController, app: VishwashipApp, me: Me?, pad: androidx.compose.foundation.layout.PaddingValues, go: (String) -> Unit, openWeb: (String) -> Unit,
    refreshMe: () -> Unit, pushOn: Boolean, setPush: (Boolean) -> Unit, pushAvailable: Boolean, logout: () -> Unit,
) {
    val repo = app.repo
    NavHost(nav, startDestination = "home", modifier = Modifier.padding(pad)) {
        composable("home") { HomeScreen(repo, me, go) }
        composable("orders?tab={tab}", listOf(navArgument("tab") { defaultValue = "all" })) { OrdersScreen(repo, it.arguments?.getString("tab") ?: "all", false, { id -> go("order/$id") }, { go("create") }) }
        composable("ndr") { OrdersScreen(repo, "ndr", true, { id -> go("order/$id") }, { go("create") }) }
        composable("more") { MoreScreen(me, go) }
        composable("order/{id}") { OrderDetailScreen(repo, it.arguments?.getString("id")!!, { t -> go("ticket/$t") }, { ref -> go("ticket/new?ref=${Uri.encode(ref)}") }) }
        composable("create?quick={quick}", listOf(navArgument("quick") { defaultValue = "0" })) {
            CreateOrderScreen(repo, it.arguments?.getString("quick") == "1", me?.wallet?.availablePaise,
                onBooked = { id -> refreshMe(); nav.navigate("order/$id") { popUpTo("home") } }, openOrder = { id -> nav.navigate("order/$id") { popUpTo("home") } },
                openRecharge = { go("wallet?recharge=1") }, addAddress = { openWeb("/portal/addresses/") })
        }
        composable("rates") { RatesScreen(repo) { go("create") } }
        composable("track") { TrackScreen(repo) { id -> go("order/$id") } }
        composable("manifest") { ManifestScreen(repo) }
        composable("wallet?recharge={recharge}", listOf(navArgument("recharge") { defaultValue = "0" })) { WalletScreen(repo, it.arguments?.getString("recharge") == "1", { id -> go("order/$id") }, refreshMe) }
        composable("alerts") { AlertsScreen(repo, { link -> nav.navigate(when { link.startsWith("/orders/") -> "order/${link.removePrefix("/orders/")}"; link.startsWith("/support/") -> "ticket/${link.removePrefix("/support/")}"; link == "/wallet" -> "wallet?recharge=0"; link == "/kyc" -> "kyc"; else -> "alerts" }) }, refreshMe) }
        composable("tickets") { TicketsScreen(repo, { id -> go("ticket/$id") }, { go("ticket/new") }) }
        composable("ticket/new?ref={ref}", listOf(navArgument("ref") { nullable = true; type = NavType.StringType })) { NewTicketScreen(repo, it.arguments?.getString("ref")) { id -> refreshMe(); nav.navigate("ticket/$id") { popUpTo("tickets") } } }
        composable("ticket/{id}") { TicketDetailScreen(repo, it.arguments?.getString("id")!!) }
        composable("kyc") { KycScreen(repo) }
        composable("addresses") { AddressesScreen(repo, openWeb) }
        composable("notify") { NotifyScreen(repo, pushOn, setPush, pushAvailable, openWeb) }
        composable("profile") { ProfileScreen(repo, me, logout, openWeb) }
    }
}
