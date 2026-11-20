package `in`.vishwaship.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Tokens from src/styles/brand.css. */
object Brand {
    val Navy = Color(0xFF051C46)
    val Navy2 = Color(0xFF0B2A5E)
    val Orange = Color(0xFFFE6519)          // logo orange: accents, icons, large text
    val OrangeAction = Color(0xFFC94A0B)    // action surfaces: white text passes 4.5:1
    val OrangeSoft = Color(0xFFFFF3EC)
    val Link = Color(0xFF0057B8)            // Order IDs and links
    val Line = Color(0xFFDBE3EE)
    val Surface2 = Color(0xFFF4F6FA)
    val Muted = Color(0xFF4A5A78)
    val Success = Color(0xFF1A7F37)
    val Danger = Color(0xFFB42318)
    val Warning = Color(0xFF9A6700)
}

private val Light = lightColorScheme(
    primary = Brand.OrangeAction, onPrimary = Color.White, primaryContainer = Brand.OrangeSoft, onPrimaryContainer = Brand.Navy,
    secondary = Brand.Navy, onSecondary = Color.White, secondaryContainer = Color(0xFFE6ECF6), onSecondaryContainer = Brand.Navy,
    tertiary = Brand.Link, background = Color.White, onBackground = Brand.Navy, surface = Color.White, onSurface = Brand.Navy,
    surfaceVariant = Brand.Surface2, onSurfaceVariant = Brand.Muted, outline = Brand.Line, outlineVariant = Color(0xFFE9EEF5), error = Brand.Danger,
)
private val Dark = darkColorScheme(
    primary = Color(0xFFFF8A4D), onPrimary = Color(0xFF2B0E00), primaryContainer = Color(0xFF5A2408), onPrimaryContainer = Color(0xFFFFDBCB),
    secondary = Color(0xFFB8C7E6), onSecondary = Brand.Navy, tertiary = Color(0xFF8AB4F8),
    background = Color(0xFF0A1428), onBackground = Color(0xFFE6ECF6), surface = Color(0xFF0E1A33), onSurface = Color(0xFFE6ECF6),
    surfaceVariant = Color(0xFF16233F), onSurfaceVariant = Color(0xFFB4C0D6), outline = Color(0xFF2A3B5E),
)

private val type = Typography(
    headlineSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
)

@Composable
fun VishwashipTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = type,
        shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp)),
        content = content,
    )
}
