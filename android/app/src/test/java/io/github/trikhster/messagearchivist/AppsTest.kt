package io.github.trikhster.messagearchivist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * Which app an export shared to the phone is from (Apps.detect), what a
 * WhatsApp chat is called (Apps.title), and that each app's name and colour
 * are its module's in the extension (extension/modules/), so the phone and
 * the archive show it the same. All names here are invented.
 */
class AppsTest {
    // The repository's app modules, found from wherever Gradle runs the test.
    private val modules: String = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "extension/modules") }.first { it.isDirectory }
        .listFiles { f -> f.name.endsWith(".js") }!!.joinToString("\n") { it.readText() }

    @Test
    fun namesAndColoursAreTheModules() {
        for (app in Apps.all) {
            val m = Regex("""id: '${app.id}', label: '([^']+)', short: '([^']+)'[^\n]*color: '(#[0-9a-fA-F]{6})'""").find(modules)
                ?: throw AssertionError("no module for ${app.id}")
            assertEquals(app.id, m.groupValues[1], app.label)
            assertEquals(app.id, m.groupValues[2], app.short)
            assertEquals(app.id, m.groupValues[3].lowercase(), "#%06x".format(app.color and 0xFFFFFF))
        }
    }

    @Test
    fun detect() {
        assertEquals("whatsapp", Apps.detect(listOf("WhatsApp Chat with Sam Rivers.txt")))
        assertEquals("whatsapp", Apps.detect(listOf("WhatsApp Chat with Kim.txt", "IMG-20240201-WA0003.jpg")))
        assertEquals("whatsapp", Apps.detect(listOf("export.zip"), listOf("_chat.txt", "00000002-PHOTO.jpg")))
        assertEquals("snapchat", Apps.detect(listOf("mydata~1700000000000.zip"), listOf("json/chat_history.json", "chat_media/2024-04-20_b~AAA.jpg")))
        assertEquals("messenger", Apps.detect(listOf("facebook-alexd-2024.zip"), listOf("your_facebook_activity/messages/inbox/sam_1/message_1.json")))
        assertEquals("instagram", Apps.detect(listOf("instagram-alexd-2024.zip"), listOf("your_instagram_activity/messages/inbox/sky_9/message_1.json")))
        assertEquals("tiktok", Apps.detect(listOf("TikTok_Data.zip"), listOf("user_data_tiktok.json")))
        assertEquals("discord", Apps.detect(listOf("package.zip"), listOf("package/messages/index.json", "package/account/user.json")))
        // Messenger's own download of its encrypted chats: JSON files shaped like its chats.
        assertEquals("messenger", Apps.detect(listOf("messages.zip"), listOf("sam_rivers_1.json")) { """{"participants":["Sam Rivers","Alex D"],"threadName":"Sam Rivers"""" })
        assertNull(Apps.detect(listOf("holiday.zip"), listOf("a.jpg", "b.jpg")))
        assertNull(Apps.detect(listOf("notes.txt")))
    }

    @Test
    fun title() {
        assertEquals("Sam Rivers", Apps.title(listOf("WhatsApp Chat with Sam Rivers.txt")))
        assertEquals("Book Club", Apps.title(listOf("WhatsApp Chat - Book Club.zip")))
        assertEquals("Kim", Apps.title(listOf("IMG-20240201-WA0003.jpg", "WhatsApp Chat with Kim (1).txt")))
        assertEquals("Ana", Apps.title(listOf("Chat de WhatsApp con Ana.txt")))
        assertNull(Apps.title(listOf("mydata~1700000000000.zip")))
    }
}
