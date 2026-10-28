package io.github.trikhster.messagearchivist

import androidx.annotation.StringRes

/**
 * The other apps whose chats the archive takes in (the extension's app
 * modules, extension/modules/), as far as a phone goes: an export can be
 * shared to this app (WhatsApp's "Export chat") or downloaded on the phone and
 * shared or added here (Meta's, Snapchat's, TikTok's and Discord's
 * downloads), and it goes into the phone backup (Exports), for the extension
 * to bring in with it. Telegram exports only from Telegram Desktop on a
 * computer, so it isn't here. Each app's name and colour are its module's
 * (AppsTest checks they're the same).
 */
object Apps {
    /** How an app's export reaches this app: shared from the app itself, or downloaded and then shared or added. */
    enum class Way { SHARE, DOWNLOAD }

    class App(val id: String, val label: String, val short: String, val color: Long, val way: Way, @param:StringRes val how: Int)

    val all = listOf(
        App("whatsapp", "WhatsApp", "WA", 0xFF25D366, Way.SHARE, R.string.app_whatsapp_how),
        App("messenger", "Messenger", "FB", 0xFF0084FF, Way.DOWNLOAD, R.string.app_messenger_how),
        App("instagram", "Instagram", "IG", 0xFFD62976, Way.DOWNLOAD, R.string.app_instagram_how),
        App("snapchat", "Snapchat", "SC", 0xFFB89A00, Way.DOWNLOAD, R.string.app_snapchat_how),
        App("tiktok", "TikTok", "TT", 0xFF444444, Way.DOWNLOAD, R.string.app_tiktok_how),
        App("discord", "Discord", "DC", 0xFF5865F2, Way.DOWNLOAD, R.string.app_discord_how),
    )

    fun of(id: String?) = all.firstOrNull { it.id == id }

    private val THREAD = Regex("""(^|/)messages/(inbox|archived_threads|filtered_threads|message_requests|e2ee_cutover)/""")
    private val CAMEL = Regex(""""threadName"|"participants"[\s\S]{0,400}"senderName"""")

    /**
     * Which app an export is from: by its files' names as shared, and for a
     * zip by the paths in it (and, for Messenger's download of its encrypted
     * chats, the start of a JSON file in it, `head`). Null if it isn't one this
     * knows. The extension reads it again on the computer with the app's
     * module: this is for showing it, and for the backup's list of exports.
     */
    fun detect(names: List<String>, inside: List<String> = emptyList(), head: (String) -> String? = { null }): String? {
        val files = names.map { it.substringAfterLast('/').lowercase() }
        val paths = (names + inside).map { it.lowercase() }
        fun has(re: Regex) = paths.any { re.containsMatchIn(it) }
        return when {
            has(Regex("""(^|/)_chat\.txt$""")) || files.any { "whatsapp" in it && (it.endsWith(".txt") || it.endsWith(".zip")) } -> "whatsapp"
            has(Regex("""(^|/)chat_history\.json$""")) || files.any { it.startsWith("mydata~") } -> "snapchat"
            has(THREAD) -> if (has(Regex("""(^|/)(your_instagram_activity|instagram)""")) || files.any { it.startsWith("instagram") }) "instagram" else "messenger"
            files.any { it.startsWith("instagram-") } -> "instagram"
            files.any { it.startsWith("facebook-") } -> "messenger"
            has(Regex("""(^|/)user_data(_tiktok)?\.json$""")) -> "tiktok"
            has(Regex("""(^|/)messages/index\.json$""")) || has(Regex("""(^|/)account/user\.json$""")) -> "discord"
            paths.filter { it.endsWith(".json") }.take(20).any { p -> head(p)?.let { CAMEL.containsMatchIn(it) } == true } -> "messenger"
            else -> null
        }
    }

    /** A WhatsApp chat's name, from its file's ("WhatsApp Chat with Sam.txt", "WhatsApp Chat - Sam.zip"); else null. */
    fun title(names: List<String>): String? = names.firstNotNullOfOrNull { n ->
        Regex("""WhatsApp(?:[\s-]+Chat)?\s*(?:with|con|avec|mit|com|met|ile|dengan|[-–])\s+(.+?)(?:\s\(\d{1,2}\))?\.(?:txt|zip)$""", RegexOption.IGNORE_CASE)
            .find(n.substringAfterLast('/'))?.groupValues?.get(1)?.trim()?.ifEmpty { null }
    }
}
