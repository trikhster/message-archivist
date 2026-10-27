// WhatsApp: a chat's "Export chat" file. In WhatsApp, open the chat, then
// ⋮ (Android) or the contact's name (iPhone) → Export chat, "Attach media"
// for the photos too. It's a .zip of the chat's text file and its media, or
// just the .txt without media.
//
// The text is one line per message, its date and time written the way the
// phone's language writes them:
//   iPhone:   [31/01/2024, 14:05:09] Alice: Hello
//   Android:  31/01/2024, 14:05 - Alice: Hello
// (or 1/31/24, 2:05 PM, and so on). A message's further lines follow on
// their own lines. Attachments are "<attached: 0001-PHOTO-….jpg>" (iPhone) or
// "IMG-20240131-WA0001.jpg (file attached)" (Android); without media they
// read "<Media omitted>" or "image omitted". Lines with no sender (Android)
// are notices such as "Alice created group …".
GMImport.register((() => {
  const LABEL = 'WhatsApp';
  const STAMP = String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]\.?)?`;
  const IOS = new RegExp(String.raw`^‎?\[${STAMP}\]\s(.+?):\s([\s\S]*)$`);
  const ANDROID = new RegExp(String.raw`^‎?${STAMP}\s[-–]\s(?:(.+?):\s)?([\s\S]*)$`);
  const ATTACHED_IOS = /<attached:\s*([^>]+)>/i;
  const ATTACHED_ANDROID = /^‎?(.+?\.\w{2,5})\s\((?:file attached|archivo adjunto|fichier joint|Datei angehängt|arquivo anexado|file allegato)\)/i;
  const OMITTED = /^‎?(?:<Media omitted>|<Medien ausgeschlossen>|<Multimedia omitido>|<Médias omis>|(image|video|audio|sticker|GIF|document|photo) omitted)$/i;
  const EDITED = /\s*<This message was edited>$/;

  const isText = (n) => /\.txt$/i.test(n);
  const chatFile = (set) => set.names.find((n) => /(^|\/)_chat\.txt$/i.test(n)) || set.names.find((n) => isText(n) && /whatsapp/i.test(n)) || (set.names.length <= 400 ? set.names.find(isText) : null);

  // Reads the lines into raw messages (date parts still unordered).
  function parse(text) {
    const out = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      const m = line.match(IOS) || line.match(ANDROID);
      if (m) {
        const [, a, b, c, hh, mm, ss, ap, sender, body] = m;
        out.push({ a: +a, b: +b, c: +c, hh: +hh, mm: +mm, ss: +(ss || 0), ap: ap?.toLowerCase(), sender: sender?.trim().replace(/^‎/, '') || null, text: body, raw: line.slice(0, 40) });
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

  // The chat's name, from the file's: "WhatsApp Chat with Alice.txt" (Android)
  // or "WhatsApp Chat - Alice.zip" (iPhone).
  const titleFrom = (name) => (name.split('/').pop().replace(/\.(zip|txt)$/i, '').match(/^WhatsApp(?:\s+Chat)?(?:\s+with|\s*[-–])\s+(.+)$/i) || [])[1]?.trim() || null;

  return {
    id: 'whatsapp', service: 'whatsapp', label: LABEL,
    how: 'In WhatsApp, open the chat, then ⋮ → More → Export chat (Android) or tap the name → Export Chat (iPhone). Choose “Attach media” to bring the photos too, and save the .zip (or .txt).',
    async detect(set) {
      const f = chatFile(set);
      if (!f) return false;
      const head = (await set.text(f)).slice(0, 4000).split(/\r?\n/).slice(0, 12);
      return head.filter((l) => IOS.test(l) || ANDROID.test(l)).length >= Math.min(2, head.filter(Boolean).length);
    },
    async open(set, ctx = {}) {
      const f = chatFile(set);
      const rows = parse(await set.text(f));
      const order = dateOrder(rows, ctx.locale);
      const title = titleFrom(set.name) || titleFrom(f) || null;
      const senders = [...new Set(rows.map((r) => r.sender).filter(Boolean))];
      const group = senders.length > 2 || rows.some((r) => !r.sender);
      // Who "me" is: in a one-to-one chat, whoever isn't the chat's name; else ask.
      let me = !group && title && senders.length === 2 && senders.includes(title) ? senders.find((s) => s !== title) : null;
      if (!me && senders.length) me = await ctx.whoAmI?.('whatsapp', senders, { chat: title || f }) || null;
      const base = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
      const files = new Map();
      const repeat = GMImport.counter();
      const messages = rows.map((r) => {
        const at = when(r, order);
        let text = r.text.replace(/^‎/, '');
        const media = [];
        let edited = false;
        if (EDITED.test(text)) { edited = true; text = text.replace(EDITED, ''); }
        const ios = text.match(ATTACHED_IOS);
        const android = !ios && text.match(ATTACHED_ANDROID);
        const name = (ios?.[1] || android?.[1] || '').trim();
        if (name) {
          const at2 = GMImport.locate(set, name, base);
          media.push(at2 ? GMImport.attach(files, at2, LABEL) : GMImport.mediaMissing(GMImport.kindOf(name), 'not in the export', { original_name: name }));
          text = text.replace(ios ? ATTACHED_IOS : ATTACHED_ANDROID, '').trim();
        } else if (OMITTED.test(text.trim())) {
          const k = (text.match(OMITTED)[1] || '').toLowerCase();
          media.push(GMImport.mediaMissing(k === 'video' ? 'video' : k === 'audio' ? 'audio' : k === 'document' ? 'file' : 'image', 'left out of the export (exported without media)'));
          text = '';
        }
        const system = !r.sender;
        const key = `${r.raw}|${r.sender}|${text}`;
        return GMLib.importedRecord({
          id: GMImport.stableId('wa', key, repeat(key)), at, sender: system ? '' : r.sender, sent: !!me && r.sender === me,
          text, media, edited, kind: system ? 'system' : 'message',
        });
      });
      const others = senders.filter((s) => s !== me);
      const name = title || others.join(', ') || 'WhatsApp chat';
      // WhatsApp's export has no chat ID: its name stands in, so a newer export
      // of the same chat joins it.
      return [{ key: 'chat-1', files, data: GMImport.chatData({ service: 'whatsapp', id: name, title: name, people: others.map((n) => ({ name: n })), messages, group }) }];
    },
  };
})());
