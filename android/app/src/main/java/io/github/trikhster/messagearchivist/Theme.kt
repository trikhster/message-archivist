package io.github.trikhster.messagearchivist

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Google's Material 3 blue, as Google Messages and the extension's theme.css use
// it. On Android 12 and later the phone's own (wallpaper) colours are used instead,
// like Google's apps.
private val Light = lightColorScheme(
    primary = Color(0xFF0B57D0), onPrimary = Color.White,
    primaryContainer = Color(0xFFD3E3FD), onPrimaryContainer = Color(0xFF041E49),
    secondary = Color(0xFF00639B), onSecondary = Color.White,
    secondaryContainer = Color(0xFFC2E7FF), onSecondaryContainer = Color(0xFF001D35),
    tertiary = Color(0xFF146C2E), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFC4EED0), onTertiaryContainer = Color(0xFF072711),
    error = Color(0xFFB3261E), errorContainer = Color(0xFFF9DEDC), onErrorContainer = Color(0xFF410E0B),
    background = Color(0xFFF8FAFD), surface = Color(0xFFF8FAFD), onSurface = Color(0xFF1F1F1F),
    surfaceVariant = Color(0xFFE1E3E1), onSurfaceVariant = Color(0xFF444746),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF8FAFD),
    surfaceContainer = Color(0xFFF0F4F9), surfaceContainerHigh = Color(0xFFE9EEF6), surfaceContainerHighest = Color(0xFFDDE3EA),
    outline = Color(0xFF747775), outlineVariant = Color(0xFFC4C7C5),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFA8C7FA), onPrimary = Color(0xFF062E6F),
    primaryContainer = Color(0xFF0842A0), onPrimaryContainer = Color(0xFFD3E3FD),
    secondary = Color(0xFF7FCFFF), onSecondary = Color(0xFF003355),
    secondaryContainer = Color(0xFF004A77), onSecondaryContainer = Color(0xFFC2E7FF),
    tertiary = Color(0xFF6DD58C), onTertiary = Color(0xFF0A3818),
    tertiaryContainer = Color(0xFF0F5223), onTertiaryContainer = Color(0xFFC4EED0),
    error = Color(0xFFF2B8B5), errorContainer = Color(0xFF8C1D18), onErrorContainer = Color(0xFFF9DEDC),
    background = Color(0xFF131314), surface = Color(0xFF131314), onSurface = Color(0xFFE3E3E3),
    surfaceVariant = Color(0xFF444746), onSurfaceVariant = Color(0xFFC4C7C5),
    surfaceContainerLowest = Color(0xFF0E0E0E), surfaceContainerLow = Color(0xFF1B1B1B),
    surfaceContainer = Color(0xFF1E1F20), surfaceContainerHigh = Color(0xFF282A2C), surfaceContainerHighest = Color(0xFF333537),
    outline = Color(0xFF8E918F), outlineVariant = Color(0xFF444746),
)

@Composable
fun RestoreTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = colors, content = content)
}

/** Avatar colours like Google Messages': one per person, picked from their name. */
val AvatarColors = listOf(
    Color(0xFF1A73E8), Color(0xFFE8710A), Color(0xFF188038), Color(0xFFD93025),
    Color(0xFF9334E6), Color(0xFFE52592), Color(0xFF12A4AF), Color(0xFFB06000),
)
fun avatarColor(name: String): Color = AvatarColors[Math.floorMod(name.hashCode(), AvatarColors.size)]
