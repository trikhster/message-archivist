// TikTok: Settings and privacy → Account → Download your data, file format
// JSON. Pick the .zip or the user_data_tiktok.json (user_data.json) in it.
//
// Direct messages are under "Direct Message" → "Direct Messages" →
// "ChatHistory": { "Chat History with <name>:": [{ Date, From, Content }] }
// (the keys' exact spelling and case vary between versions, so they're
// matched loosely). Dates are UTC. The account's own name is under "Profile"
// → "Profile Info" → "ProfileMap" → "userName". No media is included: shared
// videos are links in the message text.
GMLib.addModule({
  id: 'tiktok', label: 'TikTok', short: 'TT', folder: 'TikTok', color: '#444444', ids: 'username',
  steps: [
    'In TikTok: Profile → ☰ → Settings and privacy → Account → Download your data.',
    'Choose JSON and request it; when it’s ready, download the .zip.',
    'Bring in the .zip, or the user_data_tiktok.json in it. Shared videos come in as links.',
  ],
  phone: 'download',
  reader: (() => {
    const dataFile = (set) => set.names.find((n) => /(^|\/)user_data(_tiktok)?\.json$/i.test(n)) || (set.names.length === 1 && /\.json$/i.test(set.names[0]) ? set.names[0] : null);
    // The first value under a key matching `re`, however deep.
    function find(o, re, depth = 0) {
      if (!o || typeof o !== 'object' || depth > 6) return undefined;
      for (const [k, v] of Object.entries(o)) if (re.test(k)) return v;
      for (const v of Object.values(o)) { const r = find(v, re, depth + 1); if (r !== undefined) return r; }
      return undefined;
    }
    const utc = (t) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t.replace(' ', 'T') : `${String(t).replace(' ', 'T')}Z`);

    return {
      async detect(set) {
        const f = dataFile(set);
        if (!f) return false;
        const head = (await set.text(f)).slice(0, 200000);
        return /"Direct Messages?"|"ChatHistory"|"Chat History with /i.test(head) && /"Profile"|"Activity"|"Video"|"Direct Message"/i.test(head);
      },
      async open(set, ctx = {}) {
        const json = JSON.parse(await set.text(dataFile(set)));
        const history = find(json, /^chat\s*history$/i) || {};
        let me = find(find(json, /^profile\s*map$/i) || {}, /^username$/i) || null;
        const chats = Object.entries(history).filter(([, v]) => Array.isArray(v) && v.length);
        if (!me) {
          const names = [...new Set(chats.flatMap(([, v]) => v.map((m) => m.From)).filter(Boolean))];
          me = await ctx.whoAmI?.('tiktok', names, { chat: 'TikTok' }) || null;
        }
        return chats.map(([key, list], i) => {
          const title = key.replace(/^chat history with\s*/i, '').replace(/:\s*$/, '').trim() || `TikTok chat ${i + 1}`;
          const repeat = GMImport.counter();
          const messages = list.map((m) => {
            const text = m.Content ?? m.content ?? '';
            const sender = m.From ?? m.from ?? '';
            const k = `${m.Date}|${sender}|${text}`;
            return GMLib.importedRecord({ id: GMImport.stableId('tt', k, repeat(k)), at: utc(String(m.Date ?? m.date)), sender, sent: !!me && sender === me, text });
          });
          return { key: `chat-${i + 1}`, files: new Map(), data: GMImport.chatData({ service: 'tiktok', id: title, title, people: [{ name: title, handle: title }], messages, owner: me ? { id: me, label: `@${me}` } : null }) };
        });
      },
    };
  })(),
});
