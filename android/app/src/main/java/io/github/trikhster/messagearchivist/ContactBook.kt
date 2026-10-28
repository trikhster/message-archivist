package io.github.trikhster.messagearchivist

import android.content.ContentResolver
import android.content.Context
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Event
import android.provider.ContactsContract.CommonDataKinds.GroupMembership
import android.provider.ContactsContract.CommonDataKinds.Nickname
import android.provider.ContactsContract.CommonDataKinds.Organization
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.Relation
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.Groups
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the phone's contacts know about people, for the archive: who each
 * contact is (`key`, Android's lookup key), their name, numbers and email
 * addresses, whether they're starred, nickname, work, birthday, the owner's
 * labels and relations. Never postal addresses or a contact's notes.
 *
 * A phone backup puts one contact's on each person in a chat (`contact`), and,
 * with "Save all my contacts" on (off at first), every contact as
 * `address-book.json.gz`, so the archive can tie chats from every app to them
 * (see notes/Restore package.md).
 */
object ContactBook {
    const val ENTRY = "address-book.json.gz"
    const val FORMAT = "gm-address-book"
    private const val PREFS = "contact_book"

    /** Whether phone backups save every contact (Settings). */
    fun on(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("all", false)
    fun set(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("all", on).apply()

    private val RELATIONS = mapOf(
        Relation.TYPE_ASSISTANT to "assistant", Relation.TYPE_BROTHER to "brother", Relation.TYPE_CHILD to "child",
        Relation.TYPE_DOMESTIC_PARTNER to "domestic partner", Relation.TYPE_FATHER to "father", Relation.TYPE_FRIEND to "friend",
        Relation.TYPE_MANAGER to "manager", Relation.TYPE_MOTHER to "mother", Relation.TYPE_PARENT to "parent",
        Relation.TYPE_PARTNER to "partner", Relation.TYPE_REFERRED_BY to "referred by", Relation.TYPE_RELATIVE to "relative",
        Relation.TYPE_SISTER to "sister", Relation.TYPE_SPOUSE to "spouse",
    )
    private val SYSTEM_LABELS = setOf("My Contacts", "Starred in Android")

    /** The owner's contact labels by row ("Family", "Book club"), not the ones the system adds everyone to. */
    fun labels(cr: ContentResolver): Map<Long, String> {
        val out = HashMap<Long, String>()
        try {
            cr.query(Groups.CONTENT_URI, arrayOf(Groups._ID, Groups.TITLE, Groups.AUTO_ADD, Groups.DELETED), null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val title = c.getString(1)?.trim()?.ifEmpty { null } ?: continue
                    if (c.getInt(2) == 1 || c.getInt(3) == 1 || title in SYSTEM_LABELS) continue
                    out[c.getLong(0)] = title
                }
            }
        } catch (_: Exception) { /* no labels */ }
        return out
    }

    private class Card(val key: String?, val name: String?, val starred: Boolean) {
        val numbers = LinkedHashSet<String>()
        val emails = LinkedHashSet<String>()
        val labels = LinkedHashSet<String>()
        val relations = JSONArray()
        val more = JSONObject()
    }

    /**
     * Contacts by their ID, as `{ key, name, starred?, numbers?, emails?,
     * nickname?, organization?, job_title?, birthday?, labels?, relations? }`:
     * one contact (`id`), or every contact, in one pass over their data.
     */
    fun read(cr: ContentResolver, labelNames: Map<Long, String>, id: Long? = null): Map<Long, JSONObject> {
        val cards = LinkedHashMap<Long, Card>()
        try {
            cr.query(Data.CONTENT_URI,
                arrayOf(Data.CONTACT_ID, Data.LOOKUP_KEY, Data.DISPLAY_NAME, Data.STARRED, Data.MIMETYPE, Data.DATA1, Data.DATA2, Data.DATA3, Data.DATA4),
                id?.let { "${Data.CONTACT_ID} = ?" }, id?.let { arrayOf(it.toString()) }, Data.CONTACT_ID)?.use { c ->
                while (c.moveToNext()) {
                    val card = cards.getOrPut(c.getLong(0)) { Card(c.getString(1), c.getString(2)?.trim()?.ifEmpty { null }, c.getInt(3) == 1) }
                    val v = c.getString(5)?.trim()?.ifEmpty { null } ?: continue
                    when (c.getString(4)) {
                        Phone.CONTENT_ITEM_TYPE -> card.numbers.add(PhoneBackup.addr(v))
                        Email.CONTENT_ITEM_TYPE -> card.emails.add(v.lowercase())
                        Nickname.CONTENT_ITEM_TYPE -> card.more.put("nickname", v)
                        Organization.CONTENT_ITEM_TYPE -> {
                            card.more.put("organization", v)
                            c.getString(8)?.trim()?.ifEmpty { null }?.let { card.more.put("job_title", it) }
                        }
                        // "1990-05-04", or "--05-04" without the year.
                        Event.CONTENT_ITEM_TYPE -> if (c.getInt(6) == Event.TYPE_BIRTHDAY) card.more.put("birthday", v)
                        GroupMembership.CONTENT_ITEM_TYPE -> v.toLongOrNull()?.let { labelNames[it] }?.let { card.labels.add(it) }
                        Relation.CONTENT_ITEM_TYPE -> card.relations.put(JSONObject().put("name", v).put("type",
                            RELATIONS[c.getInt(6)] ?: c.getString(7)?.trim()?.ifEmpty { null } ?: "relation"))
                    }
                }
            }
        } catch (_: Exception) { /* what was read so far */ }
        return cards.mapValues { (_, k) ->
            JSONObject(k.more.toString()).apply {
                k.key?.let { put("key", it) }
                k.name?.let { put("name", it) }
                if (k.starred) put("starred", true)
                if (k.numbers.isNotEmpty()) put("numbers", JSONArray(k.numbers.toList()))
                if (k.emails.isNotEmpty()) put("emails", JSONArray(k.emails.toList()))
                if (k.labels.isNotEmpty()) put("labels", JSONArray(k.labels.toList()))
                if (k.relations.length() > 0) put("relations", k.relations)
            }
        }
    }

    /** Every contact, for `address-book.json.gz`: only those with a number or email address, which is what ties them to chats. */
    fun all(cr: ContentResolver): JSONArray =
        JSONArray(read(cr, labels(cr)).values.filter { it.has("numbers") || it.has("emails") })
}
