package io.github.trikhster.messagearchivist

/**
 * Choosing chats for a phone backup (Back up this phone → Chats), kept apart
 * from the screen so it can be tested (ChatChoiceTest): the types the list is
 * filtered by, and which chats a backup is then of.
 */
object ChatChoice {
    const val CONVERSATIONS = "conversations"
    const val GROUPS = "groups"

    /** The filters, in the order shown: conversations, groups, then the kinds Clutter tells apart. */
    val TYPES = listOf(CONVERSATIONS, GROUPS) + Clutter.KINDS

    fun typeOf(c: PhoneBackup.ChatInfo): String = when {
        c.group -> GROUPS
        c.kind != null -> c.kind
        else -> CONVERSATIONS
    }

    /**
     * The keys of the chats a backup is of: those ticked, of a type not hidden.
     * Null when that's every chat but the kinds Settings leaves out (`leaveOut`),
     * which is how the list starts: a backup like any other, which leaves those out.
     */
    fun chosen(all: List<PhoneBackup.ChatInfo>, ticked: (String) -> Boolean, hidden: Set<String>, leaveOut: Set<String>): Set<String>? {
        val on = all.filter { typeOf(it) !in hidden && ticked(it.key) }.map { it.key }.toSet()
        val usual = all.filter { it.kind == null || it.kind !in leaveOut }.map { it.key }.toSet()
        return if (on == usual) null else on
    }
}
