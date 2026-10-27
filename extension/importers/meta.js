// Instagram and Messenger: Meta's "Download your information" (Accounts
// Center → Your information and permissions → Download your information),
// format JSON, with Messages ticked. Pick the .zip (or the unzipped folder).
//
// Each chat is a folder, …/messages/inbox/<name_id>/, of message_1.json,
// message_2.json, … : { participants: [{ name }], title, thread_path,
// messages: [{ sender_name, timestamp_ms, content, photos, videos,
// audio_files, files, gifs, sticker, share, reactions, is_unsent,
// call_duration }] }, newest first, every string's UTF-8 written as Latin-1
// (fixed by GMImport.fixMeta). Media "uri"s are paths from the export's root.
// Messenger's own download (messenger.com) writes one JSON per chat with
// camelCase fields (participants, threadName, messages: [{ senderName,
// timestamp, text, media, reactions, isUnsent }]); both are read.
GMImport.register((() => {
  const threadOf = (n) => (n.match(/^(.*?(?:^|\/)messages\/(?:inbox|archived_threads|filtered_threads|message_requests|e2ee_cutover)\/[^/]+)\/message_\d+\.json$/i) || [])[1];
  const instagram = (set) => set.names.some((n) => /(^|\/)(your_instagram_activity|instagram)/i.test(n) || /(^|\/)personal_information\/personal_information\.json$/i.test(n) && /instagram/i.test(n));
  const fix = GMImport.fixMeta;

  async function whoMe(set, threads, service, ctx) {
    // The account's own name, where the export says it…
    for (const p of ['personal_information/personal_information.json', 'personal_information/profile_information/profile_information.json', 'profile_information/profile_information.json']) {
      const f = set.names.find((n) => n.endsWith(p));
      if (!f) continue;
      try {
        const j = JSON.parse(await set.text(f));
        const name = j.profile_user?.[0]?.string_map_data?.Name?.value || j.profile_v2?.name?.full_name || j.profile?.name?.full_name;
        if (name) return fix(name);
      } catch { /* look further */ }
    }
    // …else whoever is in every chat (in more than one, at least).
    const seen = new Map();
    for (const t of threads) for (const p of new Set(t.people)) seen.set(p, (seen.get(p) || 0) + 1);
    const top = [...seen].sort((a, b) => b[1] - a[1]);
    if (threads.length > 1 && top[0] && top[0][1] === threads.length && (!top[1] || top[1][1] < threads.length)) return top[0][0];
    return ctx.whoAmI?.(service, top.map(([n]) => n), { chat: threads[0]?.title }) || null;
  }

  return {
    id: 'meta', service: 'instagram', label: 'Instagram or Messenger',
    how: 'In Instagram or Facebook: Accounts Center → Your information and permissions → Download your information, choose Messages and the JSON format. Pick the .zip you download.',
    async detect(set) {
      if (set.names.some((n) => threadOf(n))) return true;
      const one = set.names.length === 1 && /\.json$/i.test(set.names[0]) ? set.names[0] : null;
      return !!one && /"threadName"|"participants"[\s\S]{0,400}"senderName"/.test((await set.text(one)).slice(0, 4000));
    },
    async open(set, ctx = {}) {
      const service = instagram(set) ? 'instagram' : 'messenger';
      const label = service === 'instagram' ? 'Instagram' : 'Messenger';
      const threads = [];
      const dirs = [...new Set(set.names.map(threadOf).filter(Boolean))];
      for (const dir of dirs) {
        const parts = set.names.filter((n) => n.startsWith(`${dir}/`) && /\/message_\d+\.json$/i.test(n)).sort((a, b) => +a.match(/(\d+)\.json$/)[1] - +b.match(/(\d+)\.json$/)[1]);
        const msgs = [];
        let head = null;
        for (const p of parts) { const j = JSON.parse(await set.text(p)); head = head || j; msgs.push(...(j.messages || [])); }
        threads.push({ id: head?.thread_path || dir.split('/').pop(), title: fix(head?.title || ''), people: (head?.participants || []).map((p) => fix(p.name || p)), msgs, camel: false });
      }
      if (!dirs.length) {
        const j = JSON.parse(await set.text(set.names[0]));
        threads.push({ id: j.threadName || set.names[0], title: fix(j.threadName || ''), people: (j.participants || []).map((p) => fix(p.name || p)), msgs: j.messages || [], camel: true });
      }
      const me = await whoMe(set, threads, service, ctx);
      return threads.filter((t) => t.msgs.length).map((t, i) => {
        const files = new Map();
        const repeat = GMImport.counter();
        const messages = t.msgs.map((m) => {
          const sender = fix(t.camel ? m.senderName : m.sender_name) || '';
          const at = t.camel ? m.timestamp : m.timestamp_ms;
          const media = [];
          const add = (uri, kind) => {
            if (!uri) return;
            if (/^https?:/.test(uri)) { media.push(GMImport.mediaMissing(kind || 'image', 'not in the export (a link)', { url: uri })); return; }
            const p = GMImport.locate(set, uri);
            media.push(p ? GMImport.attach(files, p, label, { kind }) : GMImport.mediaMissing(kind || GMImport.kindOf(uri), 'not in the export', { original_name: uri.split('/').pop() }));
          };
          for (const x of m.photos || []) add(x.uri, 'image');
          for (const x of m.gifs || []) add(x.uri, 'image');
          for (const x of m.videos || []) add(x.uri, 'video');
          for (const x of m.audio_files || []) add(x.uri, 'audio');
          for (const x of m.files || []) add(x.uri, null);
          if (m.sticker?.uri) add(m.sticker.uri, 'image');
          for (const x of m.media || []) add(x.uri, null);
          let text = fix(t.camel ? m.text : m.content) || '';
          if (m.share?.link && !text.includes(m.share.link)) text = [text, fix(m.share.share_text || ''), m.share.link].filter(Boolean).join('\n');
          if (m.is_unsent || m.isUnsent) text = text || '(unsent)';
          const call = m.call_duration != null;
          if (call && !text) text = `Call, ${Math.round(m.call_duration / 60)} min`;
          const reactions = (m.reactions || []).map((r) => `${fix(r.reaction)} ${fix(r.actor || '')}`.trim());
          const key = `${at}|${sender}|${text}`;
          return GMLib.importedRecord({ id: GMImport.stableId(service === 'instagram' ? 'ig' : 'fb', key, repeat(key)), at, sender, sent: !!me && sender === me, text, media, reactions, kind: call ? 'call' : 'message' });
        });
        const others = t.people.filter((p) => p !== me);
        const title = t.title || others.join(', ') || `${label} chat ${i + 1}`;
        return { key: `chat-${i + 1}`, files, data: GMImport.chatData({ service, id: t.id, title, people: others.map((n) => ({ name: n })), messages, group: others.length > 1 }) };
      });
    },
  };
})());
