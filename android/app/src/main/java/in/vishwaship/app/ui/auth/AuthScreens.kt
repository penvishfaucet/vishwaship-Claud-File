package `in`.vishwaship.app.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import `in`.vishwaship.app.R
import `in`.vishwaship.app.core.Validators
import `in`.vishwaship.app.data.ApiException
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.ui.common.Field
import `in`.vishwaship.app.ui.common.LinkText
import `in`.vishwaship.app.ui.common.PrimaryButton
import `in`.vishwaship.app.ui.theme.Brand
import kotlinx.coroutines.launch

@Composable
private fun AuthFrame(title: String, subtitle: String?, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Spacer(Modifier.height(24.dp))
            Image(painterResource(R.drawable.vs_logo), contentDescription = "Vishwaship", modifier = Modifier.height(52.dp).align(Alignment.CenterHorizontally))
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall)
            subtitle?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            content()
        }
    }
}

@Composable
private fun PasswordField(label: String, value: String, onChange: (String) -> Unit, error: String? = null, supporting: String? = null) {
    var show by rememberSaveable { mutableStateOf(false) }
    Field(label, value, onChange, error = error, supporting = supporting, keyboard = KeyboardType.Password,
        visual = if (show) VisualTransformation.None else PasswordVisualTransformation(),
        trailing = { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (show) "Hide password" else "Show password") } })
}

@Composable
private fun Message(error: String?, ok: String? = null) {
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    ok?.let { Text(it, color = Brand.Success) }
}

@Composable
fun LoginScreen(repo: Repository, onSignedIn: () -> Unit, onSignup: () -> Unit, onForgot: () -> Unit, openWeb: (String) -> Unit) {
    var id by rememberSaveable { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AuthFrame("Sign in", "Use the same email or mobile number and password as on vishwaship.in") {
        Field("Email or mobile number", id, { id = it }, keyboard = KeyboardType.Email)
        PasswordField("Password", pw, { pw = it })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { LinkText("Forgot password?", onForgot) }
        Message(err)
        PrimaryButton("Sign in", Modifier.fillMaxWidth(), enabled = id.isNotBlank() && pw.isNotEmpty(), busy = busy) {
            busy = true; err = null
            scope.launch {
                try { repo.login(id.trim(), pw); pw = ""; onSignedIn() } catch (e: ApiException) { err = e.message } finally { busy = false }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) { Text("New to Vishwaship?"); TextButton(onClick = onSignup) { Text("Create Account") } }
        LegalLinks(openWeb)
    }
}

@Composable
fun LegalLinks(openWeb: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        LinkText("Terms", { openWeb("/terms/") })
        LinkText("Privacy", { openWeb("/privacy/") })
        LinkText("Refund policy", { openWeb("/refund-policy/") })
    }
}

/** Create Account: email code first (same as the website), then the account is created on the server. */
@Composable
fun SignupScreen(repo: Repository, onSignedIn: () -> Unit, onBack: () -> Unit, openWeb: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var otp by rememberSaveable { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var terms by rememberSaveable { mutableStateOf(false) }
    var codeSent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AuthFrame("Create Account", "One account for the Vishwaship website and app") {
        Field("Full name", name, { name = it })
        Field("Email", email, { email = it; codeSent = false }, keyboard = KeyboardType.Email, error = if (email.isNotBlank() && !Validators.email(email)) "Enter a valid email address" else null)
        if (!codeSent) {
            Message(err, ok)
            PrimaryButton("Send verification code", Modifier.fillMaxWidth(), enabled = name.trim().length >= 2 && Validators.email(email), busy = busy) {
                busy = true; err = null
                scope.launch {
                    try { repo.requestEmailCode(email.trim(), "signup"); codeSent = true; ok = "We emailed a 6-digit code to ${email.trim()}." } catch (e: ApiException) { err = e.message } finally { busy = false }
                }
            }
        } else {
            Field("6-digit code", otp, { otp = it.filter(Char::isDigit).take(6) }, keyboard = KeyboardType.NumberPassword)
            PasswordField("Create password", pw, { pw = it }, supporting = "At least 8 characters", error = if (pw.isNotEmpty() && pw.length < 8) "At least 8 characters" else null)
            PasswordField("Confirm password", confirm, { confirm = it }, error = if (confirm.isNotEmpty() && confirm != pw) "Passwords do not match" else null)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = terms, onCheckedChange = { terms = it })
                Text("I accept the ")
                LinkText("Terms & shipping policy", { openWeb("/terms/") })
            }
            Message(err, ok)
            PrimaryButton("Create Account", Modifier.fillMaxWidth(), enabled = otp.length == 6 && pw.length >= 8 && pw == confirm && terms, busy = busy) {
                busy = true; err = null
                scope.launch {
                    try { repo.signup(name.trim(), email.trim(), otp, pw); pw = ""; confirm = ""; onSignedIn() } catch (e: ApiException) { err = e.message } finally { busy = false }
                }
            }
            TextButton(onClick = { codeSent = false; otp = "" }) { Text("Resend code") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) { Text("Already have an account?"); TextButton(onClick = onBack) { Text("Sign in") } }
    }
}

@Composable
fun ForgotPasswordScreen(repo: Repository, onSignedIn: () -> Unit, onBack: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var otp by rememberSaveable { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var codeSent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AuthFrame("Forgot password", "We'll email you a code. Your new password works on the website and the app, and signs out your other devices.") {
        Field("Registered email", email, { email = it; codeSent = false }, keyboard = KeyboardType.Email)
        if (!codeSent) {
            Message(err, ok)
            PrimaryButton("Email me a code", Modifier.fillMaxWidth(), enabled = Validators.email(email), busy = busy) {
                busy = true; err = null
                scope.launch { try { repo.requestEmailCode(email.trim(), "reset"); codeSent = true; ok = "Code sent. It is valid for a few minutes." } catch (e: ApiException) { err = e.message } finally { busy = false } }
            }
        } else {
            Field("6-digit code", otp, { otp = it.filter(Char::isDigit).take(6) }, keyboard = KeyboardType.NumberPassword)
            PasswordField("New password", pw, { pw = it }, supporting = "At least 8 characters")
            PasswordField("Confirm password", confirm, { confirm = it }, error = if (confirm.isNotEmpty() && confirm != pw) "Passwords do not match" else null)
            Message(err, ok)
            PrimaryButton("Set new password", Modifier.fillMaxWidth(), enabled = otp.length == 6 && pw.length >= 8 && pw == confirm, busy = busy) {
                busy = true; err = null
                scope.launch { try { repo.resetPassword(email.trim(), otp, pw); pw = ""; confirm = ""; onSignedIn() } catch (e: ApiException) { err = e.message } finally { busy = false } }
            }
        }
        TextButton(onClick = onBack) { Text("Back to sign in") }
    }
}

