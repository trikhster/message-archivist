// WhatsApp: a chat's "Export chat" file. In WhatsApp, open the chat, then
// ⋮ (Android) or the contact's name (iPhone) → Export chat, "Attach media"
// for the photos too. It's a .zip of the chat's text file and its media, or
// just the .txt without media. One chat per export: a folder of several (or
// of their .zips, see GMImport.openAll) brings them all in.
//
// The text is one line per message, its date and time written the way the
// phone's language writes them:
//   iPhone:   [31/01/2024, 14:05:09] Alice: Hello
//   Android:  31/01/2024, 14:05 - Alice: Hello
// (or 1/31/24, 2:05 PM; 31.01.24 14:05; 2024. 1. 31. 오후 2:05; 13.6.2018
// klo 21.25, and so on). A message's further lines follow on their own
// lines. Attachments are "<attached: 0001-PHOTO-….jpg>" (iPhone, the word in
// the phone's language) or "IMG-20240131-WA0001.jpg (file attached)"
// (Android); without media they read "<Media omitted>" or "image omitted".
// Notices are lines with no sender on Android ("Alice created group …"). An
// iPhone puts them under the chat's own name, a group's (or the contact's,
// in a one-to-one chat), their text starting with an invisible left-to-right
// mark (U+200E) as media's does, so a marked line is a notice when it's
// under a group's name or says what only WhatsApp says.
GMLib.addModule({
  id: 'whatsapp', label: 'WhatsApp', short: 'WA', folder: 'WhatsApp', color: '#25d366', ids: 'phone', book: true,
  steps: [
    'Open the chat in WhatsApp.',
    'On Android, tap ⋮ → More → Export chat; on an iPhone, tap the chat’s name → Export Chat.',
    'Choose “Attach media” to bring its photos and videos too.',
    'Bring in the .zip (or .txt). Several chats: put their .zips in one folder and bring in the folder.',
  ],
  phone: 'share',
  reader: (() => {
    const LABEL = 'WhatsApp';
    const STAMP = String.raw`(\d{1,4})[./-]\s?(\d{1,2})[./-]\s?(\d{1,4})\.?,?\s+(?:(上午|下午|午前|午後|오전|오후)\s?|\p{Ll}{1,3}\.?\s+)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]\.?)?`;
    const IOS = new RegExp(String.raw`^[\u200E\u200F]*\[${STAMP}\]\s(.+?):\s([\s\S]*)$`, 'u');
    const ANDROID = new RegExp(String.raw`^[\u200E\u200F]*${STAMP}\s[-–]\s(?:(.+?):\s)?([\s\S]*)$`, 'u');
    const MORNING = /上午|午前|오전/;
    const MARK = /^[\u200E\u200F]/;
    const ATTACHED_IOS = /[\u200E\u200F]*<[^<>:\n]{2,30}:\s*([^<>\n]+?\.\w{2,5})\s*>/;
    const ATTACHED_ANDROID = /^(.+?\.\w{2,5})\s\(([^()\n]{3,40})\)/;
    const ATTACH_WORDS = /attached|adjunto|joint|angehängt|anexado|allegato|bijgevoegd|ekli|прикреплен/i;
    const WA_NAME = /^(?:IMG|VID|AUD|PTT|STK|DOC)-\d{8}-WA\d+\./i;
    // Media an export was made without: "<Media omitted>" (Android, in the
    // phone's language) and "image omitted" (iPhone, marked, or in English).
    const OMITTED_ANDROID = /^<[\p{L}\s.'’-]*?(?:media|medien|médias|multimedia|mídia|medya|медиа|omit|omis|ausgeschlossen|ocult|weggelaten|disertakan)[\p{L}\s.'’-]*>$/iu;
    const OMITTED_IOS = /^([\p{L} ]{1,30}?)\s+(?:omitted|omitid[oa]|omis|omise|absente?|weggelassen|ausgelassen|ocultad[oa]|omess[oaie]|weggelaten)$/iu;
    const OMITTED_EN = /^(image|video|audio|sticker|GIF|document|photo|Contact card) omitted$/i;
    const EDITED = /\s*[\u200E\u200F]*<[^<>\n]*(?:edited|edit[óoa]|modifi[ée]|bearbeitet|modificat|bewerkt|düzenlendi)[^<>\n]*>$/i;
    const CALL = /^(?:missed |silenced |unanswered |declined )?(?:group )?(?:voice|video) call\b/i;
    // What only WhatsApp says, for an iPhone's marked lines; and what only a group's notices say.
    const NOTICE = /end-to-end|de extremo a extremo|de bout en bout|Ende-zu-Ende|de ponta a ponta|security code|is a contact\b|blocked this contact|unblocked this contact|disappearing messages|message timer|\bcreated (?:the )?group\b|\bcreated this group\b|\badded\b|\bremoved\b|\bleft$|\bjoined\b|changed (?:the|this group's|their|to)\b|\bnow an admin\b|no longer an admin|business account|pinned a message|deleted this group's|invite link/i;
    const GROUP_NOTICE = /\bcreated (?:the )?group\b|\bcreated this group\b|\badded\b|\bremoved\b|\bleft$|\bjoined using\b|changed (?:the subject|this group's|the group)|\bnow an admin\b|group description|invite link|creó (?:el )?grupo|a créé (?:le )?groupe|hat (?:die )?Gruppe|criou (?:o )?grupo|ha creato (?:il )?gruppo/i;

    const isText = (n) => /\.txt$/i.test(n);
    // The chats' text files: _chat.txt (iPhone) and "WhatsApp Chat with X.txt"
    // (Android), or a lone .txt picked by itself.
    function chatFiles(set) {
      const named = set.names.filter((n) => /(^|\/)_chat\.txt$/i.test(n) || (isText(n) && /whatsapp/i.test(n.split('/').pop())));
      if (named.length) return named;
      return set.names.length <= 400 ? set.names.filter(isText).slice(0, 1) : [];
    }
    const looksLikeChat = (text) => {
      const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 12);
      const hits = head.filter((l) => IOS.test(l) || ANDROID.test(l)).length;
      return hits > 0 && hits >= Math.min(2, head.filter(Boolean).length);
    };

    // Reads the lines into raw messages (date parts still unordered).
    function parse(text) {
      const out = [];
      for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const ios = line.match(IOS);
        const m = ios || line.match(ANDROID);
        if (m) {
          const [, a, b, c, asian, hh, mm, ss, ap, sender, body] = m;
          out.push({
            a: +a, b: +b, c: +c, hh: +hh, mm: +mm, ss: +(ss || 0), ap: ap ? ap.toLowerCase() : asian ? (MORNING.test(asian) ? 'a' : 'p') : undefined,
            sender: sender?.replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim() || null, text: body, ios: !!ios, raw: line.slice(0, 40),
          });
        } else if (out.length) {
          out[out.length - 1].text += `\n${line}`;
        }
      }
      return out;
    }

    // Which of the three date numbers is the day, month and year. Unambiguous
    // when a day passes 12 somewhere; otherwise the browser's language decides
    // (month first in the US).
    function dateOrder(rows, locale) {
      if (rows.some((r) => r.a > 31)) return 'ymd';
      if (rows.some((r) => r.a > 12)) return 'dmy';
      if (rows.some((r) => r.b > 12)) return 'mdy';
      return /^en-(US|PH)|^en$/i.test(locale || '') ? 'mdy' : 'dmy';
    }
    function when(r, order) {
      const [y, mo, d] = order === 'ymd' ? [r.a, r.b, r.c] : order === 'mdy' ? [r.c, r.a, r.b] : [r.c, r.b, r.a];
      let h = r.hh;
      if (r.ap === 'p' && h < 12) h += 12;
      if (r.ap === 'a' && h === 12) h = 0;
      return new Date(y < 100 ? 2000 + y : y, mo - 1, d, h, r.mm, r.ss).getTime();
    }

    // The chat's name, from the file's or its folder's: "WhatsApp Chat with
    // Alice.txt" (Android), "WhatsApp Chat - Alice.zip" (iPhone), or the same
    // in the phone's language ("Chat de WhatsApp con Alice.txt"). A second
    // download of a file gets " (1)" from the browser; that isn't its name.
    const titleFrom = (name) => (String(name || '').split('/').pop().replace(/\.(zip|txt)$/i, '').replace(/\s\(\d{1,2}\)$/, '')
      .match(/WhatsApp(?:[\s-]+Chat)?\s*(?:with|con|avec|mit|com|met|ile|dengan|[-–])\s+(.+)$/i) || [])[1]?.trim() || null;
    const omittedKind = (w) => (/^(?:video|vídeo|vidéo)/i.test(w) ? 'video' : /^(?:audio|áudio|voice|sprach)/i.test(w) ? 'audio' : /^(?:document|documento|dokument|contact|kontakt)/i.test(w) ? 'file' : 'image');

    async function readChat(set, f, ctx, single) {
      const rows = parse(await set.text(f));
      const order = dateOrder(rows, ctx.locale);
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
      const base = dir ? `${dir}/` : '';
      const title = titleFrom(f) || titleFrom(dir) || (single ? titleFrom(set.name) : null);
      const same = (a, b) => !!a && !!b && GMLib.nameKey(a) === GMLib.nameKey(b);
      const body = (r) => r.text.replace(/^[\u200E\u200F]+/, '');
      const marked = (r) => MARK.test(r.text);
      // The kind of media a message was exported without, or null.
      const omitted = (r, t) => { const o = (marked(r) && t.match(OMITTED_IOS)) || t.match(OMITTED_EN); return o ? omittedKind(o[1]) : OMITTED_ANDROID.test(t) ? 'image' : null; };
      const media = (r) => ATTACHED_IOS.test(body(r)) || !!omitted(r, body(r).trim()) || CALL.test(body(r));
      // On an iPhone, is the chat's name a group's (every line under it
      // marked, with others talking or a group's notice), not a person's?
      const titled = rows.filter((r) => r.ios && same(r.sender, title));
      const talkers = new Set(rows.filter((r) => r.sender && !same(r.sender, title)).map((r) => r.sender));
      const chatName = titled.length > 0 && titled.every(marked) && (talkers.size >= 2 || titled.some((r) => GROUP_NOTICE.test(body(r))));
      for (const r of rows) r.system = r.ios ? marked(r) && !media(r) && ((chatName && same(r.sender, title)) || NOTICE.test(body(r))) : !r.sender;

      const humans = [...new Set(rows.filter((r) => !r.system && r.sender).map((r) => r.sender))];
      const titleTalks = humans.some((s) => same(s, title));
      // A group: more than two people, a group's notice, or two people in a
      // chat named for neither. (Android's "end-to-end encrypted" notice, with
      // no sender, is in one-to-one chats too.)
      const group = humans.length > 2 || chatName || rows.some((r) => r.system && GROUP_NOTICE.test(body(r))) || (!!title && humans.length === 2 && !titleTalks);
      // Who "me" is: in a one-to-one chat, whoever isn't the chat's name (no
      // one, if only they wrote); else ask.
      let me = null;
      if (!group && titleTalks) me = humans.find((s) => !same(s, title)) || null;
      else if (humans.length) me = await ctx.whoAmI?.('whatsapp', humans, { chat: title || f }) || null;

      const files = new Map();
      const repeat = GMImport.counter();
      const messages = rows.map((r) => {
        const at = when(r, order);
        let text = body(r);
        const items = [];
        let edited = false;
        let kind = r.system ? 'system' : 'message';
        if (EDITED.test(text)) { edited = true; text = text.replace(EDITED, ''); }
        const ios = text.match(ATTACHED_IOS);
        const android = !ios && text.match(ATTACHED_ANDROID);
        // "name.ext (words)" is an attachment when the words say so, or the
        // name is WhatsApp's own or a file in the export.
        const name = ios ? ios[1].trim() : android && (ATTACH_WORDS.test(android[2]) || WA_NAME.test(android[1].trim()) || GMImport.locate(set, android[1].trim(), base)) ? android[1].trim() : '';
        if (name) {
          const found = GMImport.locate(set, name, base);
          items.push(found ? GMImport.attach(files, found, LABEL) : GMImport.mediaMissing(GMImport.kindOf(name), 'not in the export', { original_name: name }));
          text = (ios ? text.replace(ATTACHED_IOS, '') : text.slice(android[0].length)).trim();
        } else if (omitted(r, text.trim())) {
          items.push(GMImport.mediaMissing(omitted(r, text.trim()), 'left out of the export (exported without media)'));
          text = '';
        } else if (!r.system && r.ios && marked(r) && CALL.test(text)) kind = 'call';
        const key = `${r.raw}|${r.sender}|${text}`;
        return GMLib.importedRecord({
          id: GMImport.stableId('wa', key, repeat(key)), at, sender: r.system ? '' : r.sender, sent: !r.system && !!me && r.sender === me,
          text, media: items, edited, kind,
        });
      });
      // A one-to-one chat is with the person it's named for, even if only you wrote.
      let others = humans.filter((s) => s !== me);
      if (!group && title && !others.some((s) => same(s, title))) others = [title];
      const chat = title || others.join(', ') || 'WhatsApp chat';
      // WhatsApp's export has no chat ID: its name stands in, so a newer export
      // of the same chat joins it.
      return { files, data: GMImport.chatData({ service: 'whatsapp', id: chat, title: chat, people: others.map((n) => ({ name: n })), messages, group }) };
    }

    return {
      async detect(set) {
        for (const f of chatFiles(set).slice(0, 3)) if (looksLikeChat(await set.text(f))) return true;
        return false;
      },
      async open(set, ctx = {}) {
        const list = [];
        for (const f of chatFiles(set)) if (looksLikeChat(await set.text(f))) list.push(f);
        const chats = [];
        for (const f of list) chats.push({ key: `chat-${chats.length + 1}`, ...(await readChat(set, f, ctx, list.length === 1)) });
        return chats.filter((c) => c.data.messages.length);
      },
    };
  })(),
});
