package io.github.trikhster.messagearchivist

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Clutter's answers to the cases in test/filters/cases.json, which the
 * extension's GMLib is checked against too (test/filters/run.mjs), so a
 * phone backup leaves out what the archive would.
 */
class ClutterTest {
    // The repository's copy, found from wherever Gradle runs the test.
    private val cases: JSONObject = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "test/filters/cases.json") }.first { it.exists() }.readText().let(::JSONObject)

    private fun lines(a: JSONArray) = (0 until a.length()).map { i -> a.getJSONArray(i).let { (it.getString(0) == "me") to it.getString(1) } }

    private fun senderOf(c: JSONObject) =
        Clutter.senderOf(c.getString("name"), c.optString("number").ifEmpty { null }, c.optBoolean("group"), c.optBoolean("texts", true))

    @Test
    fun messages() {
        val a = cases.getJSONArray("messages")
        for (i in 0 until a.length()) {
            val m = a.getJSONObject(i)
            val t = Clutter.traits(listOf(false to m.getString("text")))
            for ((key, got) in listOf("code" to t.codes, "promo" to t.promos, "link" to t.links, "scam" to t.scams)) {
                if (m.has(key)) assertEquals("${m.getString("text")}: $key", m.getBoolean(key), got == 1)
            }
        }
    }

    @Test
    fun senders() {
        val a = cases.getJSONArray("senders")
        for (i in 0 until a.length()) a.getJSONObject(i).let { s -> assertEquals(s.getString("name"), s.getString("is"), senderOf(s)) }
    }

    @Test
    fun chats() {
        val a = cases.getJSONArray("chats")
        for (i in 0 until a.length()) a.getJSONObject(i).let { c ->
            val want = if (c.isNull("is")) null else c.getString("is")
            assertEquals(c.getString("about"), want, Clutter.kind(senderOf(c), Clutter.traits(lines(c.getJSONArray("messages")))))
        }
    }

    @Test
    fun yoursCountApart() {
        val t = Clutter.traits(listOf(true to "hi", false to "Your code is 123456", true to "thanks"))
        assertEquals(Clutter.Traits(sent = 2, received = 1, codes = 1), t)
    }
}
