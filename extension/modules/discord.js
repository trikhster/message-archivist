// Discord: the data package from User Settings → Data & Privacy → Request
// all of my data (a "package.zip" emailed a few days later). Pick the .zip or
// its unzipped folder.
//
// It holds only the messages you sent, never other people's: Discord's
// package is your own data. messages/index.json names each channel;
// messages/c<id>/channel.json says what it is (a DM's recipients, a server
// channel's guild), and messages/c<id>/messages.json (or messages.csv in
// older packages) lists your messages: ID, Timestamp (UTC), Contents and
// Attachments (links to Discord's servers, which the package doesn't include).
GMLib.addModule({
  id: 'discord', label: 'Discord', short: 'DC', folder: 'Discord', color: '#5865f2', ids: 'username',
  partial: 'Only your own messages: Discord’s data package doesn’t include what other people wrote.',
  steps: [
    'In Discord: User Settings → Data & Privacy → Request all of my data.',
    'When the email comes (it can take a few days), download package.zip.',
    'Bring in package.zip. It has only the messages you sent.',
  ],
  phone: 'download',
  reader: (() => {
    const LABEL = 'Discord';
    const PARTIAL = 'Only your own messages: Discord’s data package doesn’t include what other people wrote.';
    const channelDir = (n) => (n.match(/^(.*?(?:^|\/)messages\/c?\d+)\/(?:messages\.(?:json|csv)|channel\.json)$/i) || [])[1];

    // A CSV with quoted fields that may hold commas, quotes and newlines.
    function csvRows(text) {
      const rows = [];
      let row = [], cell = '', q = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
        else if (ch === '"') q = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows;
    }
    const utc = (t) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t.replace(' ', 'T') : `${t.replace(' ', 'T')}Z`);

    return {
      async detect(set) {
        return set.names.some((n) => channelDir(n)) && set.names.some((n) => /(^|\/)messages\/index\.json$/i.test(n) || /(^|\/)account\/user\.json$/i.test(n));
      },
      async open(set, ctx = {}) {
        const indexFile = set.names.find((n) => /(^|\/)messages\/index\.json$/i.test(n));
        const index = indexFile ? JSON.parse(await set.text(indexFile)) : {};
        const userFile = set.names.find((n) => /(^|\/)account\/user\.json$/i.test(n));
        const user = userFile ? JSON.parse(await set.text(userFile)) : {};
        const me = user.global_name || user.username || (await ctx.whoAmI?.('discord', [], { chat: 'Discord' })) || 'Me';
        const owner = user.username || user.id ? { id: user.username || user.id, label: user.global_name || user.username || null } : null;
        const dirs = [...new Set(set.names.map(channelDir).filter(Boolean))];
        const chats = [];
        for (const dir of dirs) {
          const id = dir.split('/').pop().replace(/^c/, '');
          const channel = set.names.includes(`${dir}/channel.json`) ? JSON.parse(await set.text(`${dir}/channel.json`)) : {};
          let list = [];
          if (set.names.includes(`${dir}/messages.json`)) {
            list = JSON.parse(await set.text(`${dir}/messages.json`)).map((m) => ({ id: m.ID ?? m.id, at: m.Timestamp ?? m.timestamp, text: m.Contents ?? m.content ?? '', attachments: m.Attachments ?? m.attachments ?? '' }));
          } else if (set.names.includes(`${dir}/messages.csv`)) {
            const [head, ...rows] = csvRows(await set.text(`${dir}/messages.csv`));
            const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
            const [ci, ct, cc, ca] = ['id', 'timestamp', 'contents', 'attachments'].map(col);
            list = rows.filter((r) => r.length > 1).map((r) => ({ id: r[ci], at: r[ct], text: r[cc] || '', attachments: r[ca] || '' }));
          }
          if (!list.length) continue;
          const messages = list.map((m) => {
            const urls = (Array.isArray(m.attachments) ? m.attachments : String(m.attachments).split(/\s+/)).filter((u) => /^https?:/.test(u));
            const media = urls.map((u) => GMImport.mediaMissing(GMImport.kindOf(new URL(u).pathname), 'not in the export (a link to Discord’s servers)', { url: u, original_name: decodeURIComponent(new URL(u).pathname.split('/').pop()) }));
            return GMLib.importedRecord({ id: m.id, at: utc(String(m.at)), sender: me, sent: true, text: m.text, media });
          });
          const name = index[id] || channel.name || null;
          const dm = channel.type === 'DM' || channel.type === 1 || /^Direct Message with /i.test(name || '');
          const title = (name || '').replace(/^Direct Message with /i, '').replace(/#0$/, '') || (channel.guild?.name ? `${channel.guild.name} › ${channel.name || id}` : `Discord channel ${id}`);
          const people = dm ? [{ name: title, handle: (channel.recipients || []).find((r) => r !== user.id) || undefined }] : [];
          chats.push({ key: `chat-${chats.length + 1}`, files: new Map(), data: { ...GMImport.chatData({ service: 'discord', id, title: channel.guild?.name && !dm && name ? `${name}` : title, people, messages, group: !dm, owner }), partial: PARTIAL } });
        }
        return chats;
      },
    };
  })(),
});
