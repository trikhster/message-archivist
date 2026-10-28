package io.github.trikhster.messagearchivist

import android.content.Context

/**
 * Verification codes, promotions and spam, and other automated texts: the
 * chats Settings can leave out of phone backups. The same rules as the
 * extension's (GMLib.chatTraits, senderOf and chatKind in extension/library.js;
 * notes/Sources.md → Kept apart), so a phone backup leaves out what the
 * archive would; both are checked against the same cases
 * (test/filters/cases.json, ClutterTest). A chat is judged by who it's with
 * and what came in, never a group, a starred contact or a chat you've talked in.
 */
object Clutter {
    const val CODES = "codes"
    const val PROMOS = "promos"
    const val AUTOMATED = "automated"
    val KINDS = listOf(CODES, PROMOS, AUTOMATED)

    // What came in: how many messages, and of those how many are codes,
    // promotions, links and links with scam-like words; and how many you sent.
    data class Traits(val sent: Int = 0, val received: Int = 0, val codes: Int = 0, val promos: Int = 0, val links: Int = 0, val scams: Int = 0)

    private val CODE_WORD = Regex("""\b(?:codes?|otp|one[- ]?time|pass ?code|pin|2fa|two[- ](?:factor|step)|verif(?:y|ying|ication)|authenticat\w*|log ?in|sign ?in|c[oó]digo|codice|kode?|bestätigungscode)\b|do(?:n['’]?t| not) share|never share""", RegexOption.IGNORE_CASE)
    private val CODE_DIGITS = Regex("""(?:^|[^\w])(?:[A-Z]{1,3}-)?(?:\d{4,8}|\d{3}[- ]\d{3})(?!\w)""")
    // The lines marketing texts carry, in any capitals ("Reply STOP", "STOP=end", "STOP2END", "HELP4help",
    // "Msg&data rates may apply", "4 msgs/mo"); PROMO_CAPS: "Reply END" and the like only in capitals.
    private val PROMO = Regex("""\b(?:reply|rply|text|txt|send|respond)\s+(?:back\s+|with\s+)?["“'(\[]?(?:st[o0]p\w*|unsub\w*|opt[- ]?out)\b|\bst[o0]p\s*(?:=|:|-+>?|→|>|2|to|4)\s*(?:end|quit|stop|cancel|opt[- ]?out|unsub\w*)\b|\b(?:end|quit|cancel|opt[- ]?out|unsub\w*)\s*=\s*st[o0]p\b|\bstop\s+receiving\b|\bopt[- ]?out\b|\bunsub(?:scribe)?\b|\bhelp\s*(?:=|:|4|for)\s*(?:help|info)\b|\breply\s+["“']?help\b|\b(?:msg|message)s?\s*(?:&|and|\+)\s*data\b|\brates\s+may\s+apply\b|\b(?:msg|message)\s*freq|\b\d+\s*(?:msgs?|messages)\s*(?:/|per\s+)(?:mo|mth|month|wk|week|day)\b""", RegexOption.IGNORE_CASE)
    private val PROMO_CAPS = Regex("""\b(?:[Rr]e?ply|REPLY|RPLY|[Tt]e?xt|TE?XT|[Ss]end|SEND|[Rr]espond|RESPOND)\s+["“'(\[]?(?:END|QUIT|CANCEL|UNSUBSCRIBE|OPTOUT)\b""")
    private val LINK = Regex("""\bhttps?://|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|co|ly|me|io|info|link|xyz|top|click|app|us|biz|site|online|shop)/\S""", RegexOption.IGNORE_CASE)
    private val SCAM = Regex("""\b(?:congrat\w*|winner|you(?:['’]ve| have)? won|prize|claim|gift ?card|reward|free|urgent|suspend\w*|locked|unusual activity|verify your|update your|package|parcel|deliver\w*|shipment|usps|fedex|dhl|toll|unpaid|overdue|refund|crypto|bitcoin|invest\w*|loan|pre-?approved|limited time|act now|click|sale|deals?|discount\w*|coupons?|promo\w*|offers?|shop now|order now|buy now|exclusive|bonus|cash ?back|earn\w*|hiring|part[- ]time|apply now|survey|donat\w*|chip in|\d{1,2}% off)\b""", RegexOption.IGNORE_CASE)
    private val NUMBER = Regex("""^\+?[\d\s().-]{3,}$""")
    private val EMAIL = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")
    private val SENDER_ID = Regex("""^(?=.*[A-Z]{3})[A-Z0-9][A-Z0-9-]{2,}$""")

    /** Each message as (sent by you, its text). */
    fun traits(messages: Iterable<Pair<Boolean, String>>): Traits {
        var sent = 0; var received = 0; var codes = 0; var promos = 0; var links = 0; var scams = 0
        for ((mine, x) in messages) {
            if (mine) { sent++; continue }
            received++
            if (x.isEmpty()) continue
            if (x.length <= 400 && CODE_WORD.containsMatchIn(x) && CODE_DIGITS.containsMatchIn(x)) codes++
            if (PROMO.containsMatchIn(x) || PROMO_CAPS.containsMatchIn(x)) promos++
            if (LINK.containsMatchIn(x)) { links++; if (SCAM.containsMatchIn(x)) scams++ }
        }
        return Traits(sent, received, codes, promos, links, scams)
    }

    /**
     * Who a chat is with: "group"; "contact" (a name of yours); "short" (a short
     * code, 3 to 6 digits); "business" (a sender ID such as "AMAZON" instead of
     * a number); or "number" (a number or address with no name saved).
     * `name` is the contact's name, or the address when there's none; `texts`
     * is a text chat (sender IDs only exist there).
     */
    fun senderOf(name: String?, number: String?, group: Boolean, texts: Boolean = true): String {
        if (group) return "group"
        val n = (name ?: "").trim()
        val num = (number ?: "").trim()
        if (num.any { it in 'a'..'z' || it in 'A'..'Z' } && !EMAIL.matches(num)) return "business"
        if (n.isEmpty() || NUMBER.matches(n) || EMAIL.matches(n)) {
            val digits = num.ifEmpty { n }.count { it in '0'..'9' }
            return if (digits in 3..6) "short" else "number"
        }
        // A text from "AMAZON" or "VM-HDFCBK" with no number behind it is a sender ID.
        if (num.isEmpty() && texts && SENDER_ID.matches(n)) return "business"
        return "contact"
    }

    /** Which of KINDS a chat is, if any. A contact needs more to go on; three messages of yours make any chat a conversation. */
    fun kind(sender: String, t: Traits): String? {
        if (t.received == 0 || sender == "group") return null
        val contact = sender == "contact"
        if (t.sent >= 3 || (contact && t.sent > 0)) return null
        fun share(n: Int) = n.toDouble() / t.received
        if (share(t.codes) >= (if (contact) 0.8 else 0.5) && (!contact || t.received >= 2)) return CODES
        if (share(t.promos) >= (if (contact) 0.5 else 0.2)) return PROMOS
        if (sender == "number" && t.scams > 0 && share(t.links) >= 0.5 && t.received <= 20) return PROMOS
        if (sender == "short" || sender == "business") return AUTOMATED
        return null
    }

    // ---------- the setting ----------
    private const val PREFS = "leave_out"

    /** The kinds Settings leaves out of phone backups (none at first). */
    fun chosen(ctx: Context): Set<String> = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).let { p -> KINDS.filter { p.getBoolean(it, false) }.toSet() }

    fun choose(ctx: Context, kind: String, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(kind, on).apply()
    }
}
