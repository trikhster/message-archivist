// Snapchat: Profile → ⚙ Settings → My Data (or accounts.snapchat.com → My
// Data), with the chats and, for their photos and videos, Chat Media.
// Snapchat emails when it's ready; pick the .zip, or the unzipped folder (a
// big download comes in parts: unzip them all into one folder).
//
// json/chat_history.json is { "<chat>": [message] }, a chat under its own key
// (the friend's username for a one-to-one chat, an ID for a group), each
// message { From (a username), "Media Type" (TEXT, MEDIA, NOTE, STICKER,
// SHARE, LOCATION, STATUS… notices), Created ("2024-04-20 01:29:22 UTC"),
// "Created(microseconds)", Content, "Conversation Title" (a group's name),
// IsSender, IsSaved, "Media IDs" ("b~… | b~…") }, the keys' case varying by
// version. Older downloads list "Received Saved Chat History" (From) and
// "Sent Saved Chat History" (To) instead, with Text. A chat's photos and
// videos are chat_media/<date>_<media ID>.<ext>, the date the UTC day it was
// sent. json/account.json says whose download it is ("Basic Information":
// Username), json/friends.json each friend's display name. Only what Snapchat
// still keeps is there: saved messages, and recent ones that haven't
// disappeared yet; snap_history.json lists snaps without them, so it's left out.
GMLib.addModule({
  // Snapchat's own yellow is too pale under the badges' white text.
  id: 'snapchat', label: 'Snapchat', short: 'SC', folder: 'Snapchat', color: '#b89a00', ids: 'username',
  partial: 'Only what Snapchat still keeps: saved messages, and recent ones that haven’t disappeared yet. Snaps aren’t included.',
  steps: [
    'In Snapchat: Profile → ⚙ Settings → My Data (or accounts.snapchat.com → My Data).',
    'Choose your chats and Chat Media (and JSON, if it asks), all dates, then Submit.',
    'When the email comes, download the .zip and bring it in. A download in several parts: unzip them all into one folder and bring in the folder.',
  ],
  phone: 'download',
  // Its download has only saved messages, so the chats you open on Snapchat
  // for Web are read there too, as you read them (web/snapchat.js; Settings →
  // Apps turns it on): read-only, never a Snap or a screenshot.
  web: { label: 'Snapchat for Web', url: 'https://www.snapchat.com/web', matches: ['https://www.snapchat.com/web*'], origins: ['https://www.snapchat.com/*'], script: 'web/snapchat.js' },
  reader: (() => {
    const LABEL = 'Snapchat';
    const PARTIAL = 'Only what Snapchat still keeps: saved messages, and recent ones that haven’t disappeared yet. Snaps aren’t included.';
    const historyFile = (set) => set.names.find((n) => /(^|\/)chat_history\.json$/i.test(n)) || (set.names.length === 1 && /\.json$/i.test(set.names[0]) && !/snap_history/i.test(set.names[0]) ? set.names[0] : null);
    const jsonFile = (set, name) => set.names.find((n) => new RegExp(`(^|/)${name}\\.json$`, 'i').test(n));
    // A field however a version spells it ("IsSender", "isSender").
    const norm = (k) => k.toLowerCase().replace(/[^a-z]/g, '');
    function get(o, ...keys) {
      for (const k of keys) if (o[k] != null) return o[k];
      const want = new Set(keys.map(norm));
      for (const [k, v] of Object.entries(o)) if (v != null && want.has(norm(k))) return v;
      return undefined;
    }
    const utc = (t) => { const s = String(t ?? '').trim().replace(/\s*UTC$/i, 'Z').replace(' ', 'T'); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`); };
    // "Created(microseconds)" is microseconds in some downloads and
    // milliseconds in others; either beats Created's whole seconds.
    function when(m) {
      const at = utc(get(m, 'Created', 'Date'));
      const n = Number(get(m, 'Created(microseconds)'));
      const exact = n > 1e14 ? n / 1000 : n > 1e11 ? n : NaN;
      return Number.isFinite(exact) && (!Number.isFinite(at) || Math.abs(exact - at) < 864e5) ? Math.floor(exact) : at;
    }
    const yes = (v) => v === true || /^true$/i.test(String(v ?? ''));
    const MEDIA_KIND = { MEDIA: 'image', IMAGE: 'image', PHOTO: 'image', STICKER: 'image', VIDEO: 'video', NOTE: 'audio', AUDIO: 'audio' };
    const LEFT_OUT = 'left out of the export (ask for Chat Media too)';
    // Notices ("STATUS…"), said with who did it.
    const NOTICE = {
      ERASEDMESSAGE: '{who} deleted a message', SAVETOCAMERAROLL: '{who} saved something to their camera roll',
      CONVERSATIONCAPTURESCREENSHOT: '{who} took a screenshot of the chat', CONVERSATIONCAPTURERECORD: '{who} recorded the chat',
      CONVERSATIONCAPTURESCREENRECORD: '{who} recorded the chat', PARTICIPANTREMOVED: 'Someone was removed from the group',
    };

    // Each friend's display name, by username.
    async function friendNames(set) {
      const names = new Map();
      const f = jsonFile(set, 'friends');
      if (!f) return names;
      try {
        for (const list of Object.values(JSON.parse(await set.text(f)))) {
          if (Array.isArray(list)) for (const p of list) { const u = p && get(p, 'Username'); const d = p && get(p, 'Display Name'); if (u && d && !names.has(u)) names.set(u, String(d)); }
        }
      } catch { /* names stay usernames */ }
      return names;
    }
    // chat_media/<date>_<media ID>.<ext>, by media ID.
    function mediaIndex(set) {
      const by = new Map();
      for (const n of set.names) {
        const m = n.match(/(?:^|\/)chat_media\/(\d{4}-\d{2}-\d{2})_([^/]+?)\.[^./]+$/i);
        if (m) { if (!by.has(m[2])) by.set(m[2], []); by.get(m[2]).push({ day: m[1], path: n }); }
      }
      return by;
    }

    return {
      async detect(set) {
        const f = historyFile(set);
        if (!f) return false;
        const head = (await set.text(f)).slice(0, 4000);
        return /"(Received|Sent) (Saved |Unsaved )?Chat History"\s*:/i.test(head) || (/"Media Type"\s*:/.test(head) && /"(Content|Text|Media IDs)"\s*:/i.test(head));
      },
      // A download this can't read, and what to do instead.
      explain(set) {
        if (set.names.some((n) => /(^|\/)chat_history\.html$/i.test(n))) return 'That’s Snapchat’s download as web pages only. Ask for My Data again with JSON files included, and bring in that one.';
        if (set.names.some((n) => /(^|\/)chat_media\//i.test(n))) return 'That’s one part of a Snapchat download (its photos and videos), without the chats themselves. Unzip every part into one folder and bring in that folder.';
        return null;
      },
      async open(set, ctx = {}) {
        const json = JSON.parse(await set.text(historyFile(set)));
        const names = await friendNames(set);
        const display = (u) => names.get(u) || u;
        let me = null;
        const acc = jsonFile(set, 'account');
        if (acc) try { const a = JSON.parse(await set.text(acc)); me = get(get(a, 'Basic Information') || a, 'Username') || null; } catch { /* found below */ }

        // Every message once, { key, m, sent, from }: in its chat's list, or in
        // an older download's sent and received lists, with the friend it was
        // from or to as its chat.
        const all = [];
        for (const [k, list] of Object.entries(json)) {
          if (!Array.isArray(list)) continue;
          const category = /chat history$/i.test(k.trim());
          const sentList = category && /^sent\b/i.test(k.trim());
          for (const m of list) {
            if (!m || typeof m !== 'object') continue;
            const flag = get(m, 'IsSender');
            const from = get(m, 'From');
            const sent = flag != null ? yes(flag) : sentList || (!!me && from === me);
            const friend = category ? (sentList ? get(m, 'To') ?? from : from ?? get(m, 'To')) : k;
            // In an older download's sent list, From can be the friend.
            all.push({ key: String(friend ?? 'Unknown'), m, sent, from: sent && category ? null : from ?? null });
          }
        }
        // Whose download: account.json, else whoever sent your messages, else ask.
        let ownerKnown = !!me;
        if (!me) { me = all.find((x) => x.sent && x.from)?.from || null; ownerKnown = !!me; }
        if (!me && !all.some((x) => x.sent)) {
          const senders = [...new Set(all.map((x) => x.from).filter(Boolean))];
          const pick = await ctx.whoAmI?.('snapchat', senders.map(display), { chat: LABEL });
          me = senders.find((u) => display(u) === pick) || null;
          for (const x of all) if (me && x.from === me) x.sent = true;
        }
        for (const x of all) if (x.sent) x.from = x.from || me;
        const owner = ownerKnown ? { id: me, label: me } : null;
        const media = mediaIndex(set);
        const why = media.size ? 'not in the export' : LEFT_OUT;
        const chats = new Map();
        for (const x of all) { if (!chats.has(x.key)) chats.set(x.key, []); chats.get(x.key).push(x); }

        const out = [];
        for (const [key, list] of chats) {
          const files = new Map();
          const repeat = GMImport.counter();
          let groupTitle = null;
          const messages = [];
          for (const { m, sent, from } of list) {
            const type = String(get(m, 'Media Type') || 'TEXT').toUpperCase().replace(/[^A-Z]/g, '');
            const at = when(m);
            groupTitle = groupTitle || get(m, 'Conversation Title') || null;
            let text = String(get(m, 'Content', 'Text') ?? '').trim();
            const ids = String(get(m, 'Media IDs') ?? '').split('|').map((s) => s.trim()).filter(Boolean);
            const day = Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : '';
            const items = ids.map((id) => {
              const found = media.get(id) || [];
              const hit = found.find((f) => f.day === day) || (found.length === 1 ? found[0] : null);
              // A voice note is audio, whatever its file says.
              return hit ? GMImport.attach(files, hit.path, LABEL, type === 'NOTE' ? { kind: 'audio' } : {}) : GMImport.mediaMissing(MEDIA_KIND[type] || 'image', why, { original_name: id });
            });
            if (!ids.length && MEDIA_KIND[type]) items.push(GMImport.mediaMissing(MEDIA_KIND[type], why));
            let kind = 'message';
            if (/CALL/.test(type)) { kind = 'call'; text = text || (/MISSED/.test(type) ? 'Missed call' : 'Call'); }
            else if (type.startsWith('STATUS')) {
              const what = type.slice(6);
              kind = 'system';
              text = (NOTICE[what] || `{who}: ${what.toLowerCase()}`).replace('{who}', sent ? 'You' : display(from || key));
            } else if (!text && !items.length) {
              if (type === 'TEXT') continue; // nothing of it was kept
              text = type === 'LOCATION' ? '(shared a location)' : '(shared)';
            }
            const k = `${get(m, 'Created') ?? at}|${from || ''}|${text}|${ids.join(',')}`;
            const system = kind === 'system';
            messages.push(GMLib.importedRecord({
              id: GMImport.stableId('sc', k, repeat(k)), at, sender: system ? '' : display(from || (sent ? '' : key)), sender_id: system ? null : from, sent: !system && sent,
              text, media: items, kind,
            }));
          }
          if (!messages.length) continue;
          const others = [...new Set(list.filter((x) => !x.sent && x.from && x.from !== me).map((x) => x.from))];
          const group = !!groupTitle || others.length > 1;
          // A one-to-one chat's key is the friend's username, even when only you wrote.
          if (!group && !others.length && key !== 'Unknown') others.push(key);
          const people = others.map((u) => ({ name: display(u), handle: u }));
          const title = String(groupTitle || (group ? people.map((p) => p.name).join(', ') : display(others[0] || key)));
          out.push({ key: `chat-${out.length + 1}`, files, data: GMImport.chatData({ service: 'snapchat', id: key, title, people, messages, group, owner }) });
        }
        return out;
      },
    };
  })(),
});
