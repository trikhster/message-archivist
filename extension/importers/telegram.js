// Telegram: Telegram Desktop's Settings → Advanced → Export Telegram data
// (every chat), or a chat's ⋮ → Export chat history (one), in the
// "Machine-readable JSON" format. Pick the export's folder, a .zip of it, or
// just its result.json (then without photos).
//
// result.json is one chat ({ name, type, id, messages }) or, for a whole
// account, { personal_information: { user_id }, chats: { list: [chats] } }.
// Each message has id, type ("message" or "service"), date and
// date_unixtime, from and from_id ("user123"), text (a string or a list of
// pieces), and photo / file with a path relative to result.json's folder
// ("(File not included…)" when the export left it out), media_type,
// reply_to_message_id, edited and reactions.
GMImport.register((() => {
  const LABEL = 'Telegram';
  const resultFile = (set) => set.names.find((n) => /(^|\/)result\.json$/i.test(n)) || (set.names.length === 1 && /\.json$/i.test(set.names[0]) ? set.names[0] : null);
  const textOf = (t) => (Array.isArray(t) ? t.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : t || '');
  const KIND = { sticker: 'image', animation: 'video', video_file: 'video', video_message: 'video', voice_message: 'audio', audio_file: 'audio' };
  const ACTION = {
    create_group: 'created the group', invite_members: 'added people', remove_members: 'removed people', join_group_by_link: 'joined by link',
    pin_message: 'pinned a message', edit_group_title: 'changed the group name', edit_group_photo: 'changed the group photo', phone_call: 'call',
    group_call: 'group call', migrate_to_supergroup: 'turned the group into a supergroup', delete_group_photo: 'removed the group photo',
  };

  return {
    id: 'telegram', service: 'telegram', label: LABEL,
    how: 'In Telegram Desktop: Settings → Advanced → Export Telegram data (or a chat’s ⋮ → Export chat history), format “Machine-readable JSON”. Pick the export folder, a .zip of it, or its result.json.',
    async detect(set) {
      const f = resultFile(set);
      if (!f) return false;
      const head = (await set.text(f)).slice(0, 3000);
      return /"(chats|messages)"\s*:/.test(head) && /"(type|personal_information)"\s*:/.test(head) && (/"date_unixtime"|"from_id"|"personal_information"|"chats"/.test(head) || /"type"\s*:\s*"(personal_chat|private_group|private_supergroup|public_supergroup|saved_messages|bot_chat|public_channel|private_channel)"/.test(head));
    },
    async open(set, ctx = {}) {
      const f = resultFile(set);
      const json = JSON.parse(await set.text(f));
      const base = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
      const list = json.chats?.list || (json.messages ? [json] : []);
      let meId = json.personal_information?.user_id != null ? `user${json.personal_information.user_id}` : null;
      if (!meId) {
        // One chat exported on its own doesn't say who exported it.
        const names = [...new Set(list.flatMap((c) => c.messages.map((m) => m.from)).filter(Boolean))];
        const meName = await ctx.whoAmI?.('telegram', names, { chat: list[0]?.name });
        meId = meName ? list.flatMap((c) => c.messages).find((m) => m.from === meName)?.from_id || null : null;
      }
      return list.filter((c) => c.messages?.length).map((c, i) => {
        const files = new Map();
        const byId = new Map(c.messages.map((m) => [m.id, m]));
        const messages = c.messages.map((m) => {
          const media = [];
          for (const [field, fallback] of [['photo', 'image'], ['file', null]]) {
            const v = m[field];
            if (!v) continue;
            const kind = KIND[m.media_type] || fallback || GMImport.kindOf(v);
            if (/^\(File/.test(v)) { media.push(GMImport.mediaMissing(kind, 'not in the export (left out by its settings)')); continue; }
            const at = GMImport.locate(set, v, base);
            media.push(at ? GMImport.attach(files, at, LABEL, { kind, ...(m.width ? { width: m.width, height: m.height } : {}) }) : GMImport.mediaMissing(kind, 'not in the export', { original_name: v.split('/').pop() }));
          }
          const service = m.type === 'service';
          const reply = m.reply_to_message_id != null ? byId.get(m.reply_to_message_id) : null;
          const reactions = (m.reactions || []).map((r) => `${r.emoji || r.document_id || '★'}${r.count > 1 ? ` ${r.count}` : ''}`);
          const text = service ? [m.actor, ACTION[m.action] || (m.action || '').replace(/_/g, ' '), m.title || (m.members || []).join(', ')].filter(Boolean).join(' ') : textOf(m.text);
          const at = m.date_unixtime ? Number(m.date_unixtime) * 1000 : Date.parse(m.date);
          return GMLib.importedRecord({
            id: m.id, at, sender: service ? '' : m.from || m.actor || '', sender_id: m.from_id || m.actor_id, sent: !!meId && (m.from_id || m.actor_id) === meId,
            text, media, reactions, edited: !!m.edited, kind: service ? (m.action === 'phone_call' || m.action === 'group_call' ? 'call' : 'system') : 'message',
            reply_to: reply ? { sender: reply.from || '', text: textOf(reply.text).slice(0, 200) } : null,
          });
        });
        const people = [...new Map(c.messages.filter((m) => m.from_id && m.from_id !== meId).map((m) => [m.from_id, { name: m.from || m.from_id, handle: m.from_id }])).values()];
        const title = c.name || (c.type === 'saved_messages' ? 'Saved Messages' : people.map((p) => p.name).join(', ') || `Telegram chat ${i + 1}`);
        return { key: `chat-${i + 1}`, files, data: GMImport.chatData({ service: 'telegram', id: c.id ?? title, title, people, messages, group: !/personal_chat|saved_messages|bot_chat/.test(c.type || '') }) };
      });
    },
  };
})());
