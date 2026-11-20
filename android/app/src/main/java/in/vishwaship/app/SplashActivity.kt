package `in`.vishwaship.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.androidbrowserhelper.trusted.LauncherActivity
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay

/**
 * Opening animation: the Vishwaship box icon pops in, the "vishwaship.com" wordmark sweeps open beside it and an
 * orange line runs underneath. Then the website opens full screen (Trusted Web Activity), with Chrome showing the
 * same logo on white until the first page is ready, so the hand-over looks seamless.
 */
class SplashActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(AndroidColor.WHITE, AndroidColor.WHITE),
            navigationBarStyle = SystemBarStyle.light(AndroidColor.WHITE, AndroidColor.WHITE),
        )
        setContent { OpeningAnimation(onDone = ::openWebsite) }
    }

    private var opened = false
    private fun openWebsite() {
        if (opened || isFinishing) return
        opened = true
        startActivity(Intent(this, LauncherActivity::class.java).apply { data = intent?.data })
        if (Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(Activity.OVERRIDE_TRANSITION_OPEN, android.R.anim.fade_in, android.R.anim.fade_out)
        } else {
            @Suppress("DEPRECATION") overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
        finish()
    }
}

private val Navy = Color(0xFF051C46)
private val Orange = Color(0xFFFE6519)

@Composable
private fun OpeningAnimation(onDone: () -> Unit) {
    val iconScale = remember { Animatable(0.2f) }
    val iconTurn = remember { Animatable(-28f) }
    val iconAlpha = remember { Animatable(0f) }
    val reveal = remember { Animatable(0f) }      // wordmark sweep, 0..1
    val line = remember { Animatable(0f) }        // orange underline, 0..1
    val tagAlpha = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        // 1. Box icon pops in with a little bounce and turn.
        listOf(
            async { iconAlpha.animateTo(1f, tween(220)) },
            async { iconScale.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow)) },
            async { iconTurn.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessLow)) },
        ).awaitAll()
        // 2. Full logo sweeps open from the icon, the orange line follows.
        listOf(
            async { reveal.animateTo(1f, tween(520, easing = FastOutSlowInEasing)) },
            async { delay(180); line.animateTo(1f, tween(520, easing = FastOutSlowInEasing)) },
            async { delay(380); tagAlpha.animateTo(1f, tween(360)) },
        ).awaitAll()
        delay(350)
        onDone()
    }

    Box(Modifier.fillMaxSize().background(Color.White), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.width(300.dp).height(100.dp), contentAlignment = Alignment.CenterStart) {
                // Full logo, uncovered left-to-right as `reveal` grows (the icon part is always under the popping icon).
                Image(
                    painter = painterResource(R.drawable.vs_logo),
                    contentDescription = "Vishwaship",
                    modifier = Modifier.fillMaxSize().drawWithContent {
                        val iconEdge = size.width * 0.23f
                        val w = iconEdge + (size.width - iconEdge) * reveal.value
                        if (reveal.value > 0f) {
                            drawContext.canvas.save()
                            drawContext.canvas.clipRect(0f, 0f, w, size.height)
                            this@drawWithContent.drawContent()
                            drawContext.canvas.restore()
                        }
                    },
                )
                // The box icon on its own, sitting exactly where it is in the full logo, fading out once the logo is open.
                Image(
                    painter = painterResource(R.drawable.vs_logo_icon),
                    contentDescription = null,
                    modifier = Modifier
                        .padding(start = 11.dp)
                        .size(55.dp)
                        .graphicsLayer {
                            scaleX = iconScale.value; scaleY = iconScale.value
                            rotationZ = iconTurn.value
                            alpha = iconAlpha.value * (1f - reveal.value)
                        },
                )
            }
            Box(
                Modifier.padding(top = 6.dp).width(220.dp).height(4.dp).clip(RoundedCornerShape(2.dp)),
            ) {
                Box(
                    Modifier.fillMaxWidth(line.value).height(4.dp)
                        .background(Brush.horizontalGradient(listOf(Orange, Color(0xFFFF8A4C)))),
                )
            }
            Text(
                "Courier Aggregator",
                color = Navy.copy(alpha = 0.75f * tagAlpha.value),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.5.sp,
                modifier = Modifier.padding(top = 14.dp),
            )
        }
    }
}
