package io.github.trikhster.messagearchivist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which chats a backup is of, from what's ticked and which types are hidden on Choose chats. */
class ChatChoiceTest {
    private fun chat(key: String, group: Boolean = false, kind: String? = null) = PhoneBackup.ChatInfo(key, key, 1, 0L, group, kind)
    private val all = listOf(chat("a"), chat("b"), chat("g1,g2", group = true), chat("72727", kind = Clutter.CODES), chat("SHOPCO", kind = Clutter.PROMOS))
    private val leave = setOf(Clutter.CODES, Clutter.PROMOS)
    private fun tickedBut(vararg off: String): (String) -> Boolean = { it !in off }

    @Test
    fun types() = assertEquals(
        listOf(ChatChoice.CONVERSATIONS, ChatChoice.CONVERSATIONS, ChatChoice.GROUPS, Clutter.CODES, Clutter.PROMOS), all.map(ChatChoice::typeOf))

    @Test
    fun asTheListStarts() {
        // Every chat ticked, the kinds Settings leaves out hidden: a backup like any other.
        assertNull(ChatChoice.chosen(all, tickedBut(), leave, leave))
        assertNull(ChatChoice.chosen(all, tickedBut(), emptySet(), emptySet()))
    }

    @Test
    fun untickingOne() = assertEquals(setOf("a", "g1,g2"), ChatChoice.chosen(all, tickedBut("b"), leave, leave))

    @Test
    fun hidingAType() = assertEquals(setOf("a", "b"), ChatChoice.chosen(all, tickedBut(), leave + ChatChoice.GROUPS, leave))

    @Test
    fun showingAKindSettingsLeavesOut() =
        assertEquals(setOf("a", "b", "g1,g2", "72727"), ChatChoice.chosen(all, tickedBut(), setOf(Clutter.PROMOS), leave))

    // Ticked or not, a chat of a hidden type isn't backed up.
    @Test
    fun hiddenIsNeverChosen() =
        assertEquals(setOf("a", "b", "g1,g2"), ChatChoice.chosen(all, tickedBut(), setOf(Clutter.CODES, Clutter.PROMOS), emptySet()))

    @Test
    fun nothingChosen() = assertEquals(emptySet<String>(), ChatChoice.chosen(all, { false }, leave, leave))
}
