// The archive as an Obsidian vault. Open the backup folder in Obsidian
// ("Open folder as vault") and every person, chat, month and topic is a note,
// linked together, with the messages in notes of their own and photos and
// videos shown where they were sent (embedded from the chat's own media
// folder, never copied). Written into Obsidian/ in the backup folder by
// Settings (Tools → Obsidian) and, once that's on, after every backup and
// import.
//
//   Obsidian/Message Archivist.md                     start here
//   Obsidian/People.md, People/<name>.md              everyone, and each person
//   Obsidian/People/<name>/<name> timeline.md         everything notable with them, year by year
//   Obsidian/People/<name>/<name> photos.md, … links.md  what you've shared
//   Obsidian/Calendar.md, Calendar/<YYYY>.md          every year, and each year
//   Obsidian/Calendar/<YYYY>/<YYYY-MM>.md             each month, day by day: who, photos, events
//   Obsidian/Events.md                                birthdays, milestones, trips, photo days, holidays
//   Obsidian/Photos.md, Photos/<YYYY> photos.md       every photo and video, by day
//   Obsidian/Photos/<YYYY>/<YYYY-MM> photos.md        a month of them, in a busy year
//   Obsidian/Topics.md, Topics/<topic>.md             words and phrases people talk about
//   Obsidian/Labels.md, Labels/<label>.md             your phone contacts' labels
//   Obsidian/Chats/<source>.md, <source>/<chat>.md    each source's chats, and each chat
//   Obsidian/Chats/<source>/<chat>/<chat> <YYYY>.md      a year of its messages
//   Obsidian/Chats/<source>/<chat>/<chat> <YYYY-MM>.md   a month, in a busy year
//   Obsidian/.message-archivist.json                  what was written (hidden in Obsidian)
//
// A short chat's messages are in its own note; a longer one has a note a
// year, and a busy year a note a month (`small`, `busyYear`), so a few texts
// a year don't make a pile of tiny notes. A note is only rewritten when what
// it says changes, and a chat's messages are only read again when the chat
// changed: what a chat says (its days, words and phrases, events, photos…)
// is worked out when it's read and kept in the manifest. Anything written
// below the "Your notes" line of a person, chat, topic, year or month note
// stays; the message notes are the messages only.
//
// A person's note is the place to start: who they are, what you talk about
// (words and phrases, shared with others who talk about them too), who they
// mention and who they're in groups with, when you talk, the moments and
// events of your chats (the first message, birthdays, meeting up, the longest
// silence…), each a link to that day in the messages. The calendar puts
// every day in one place. Everything is counted and matched in the
// extension, with no model and nothing sent anywhere. Only notes listed in
// .message-archivist.json are ever replaced or removed. Plain functions over
// an `io` ({ readText, write, remove? }), like GMLib, so Settings, a backup
// run and the tests share them.
globalThis.GMObsidian = globalThis.GMObsidian || (() => {
  const ROOT = 'Obsidian';
  const MANIFEST = `${ROOT}/.message-archivist.json`;
  const VERSION = 4;
  const MARK = '%% Your notes: anything below this line stays when Message Archivist updates this note. %%';
  const L = () => globalThis.GMLib;

  // A file name Obsidian can link to: no path or link characters.
  const noteName = (s) => String(s || '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80).trim().replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '$1_') || 'Untitled';
  const link = (path, text) => `[[${path.replace(/\.md$/, '')}|${noteName(text)}]]`;
  // A link to a heading in a note: a day, in the messages or the calendar.
  const linkTo = (path, heading, text) => `[[${path.replace(/\.md$/, '')}#${heading}|${noteName(text)}]]`;
  // In a table a link's | must be \|, or Obsidian starts a new column there.
  const cell = (s) => String(s).replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '[[$1\\|$2]]');
  const yaml = (v) => JSON.stringify(v);
  const nf = (n) => Number(n || 0).toLocaleString('en-US');

  // Message text, read literally: Obsidian would otherwise turn "#1" into a
  // tag, [[x]] into a link, $5 … $6 into maths and %% into a comment. Web
  // addresses are left alone so they stay links.
  const URLS = /\bhttps?:\/\/[^\s<>()]+/g;
  const escPart = (s) => s.replace(/[\\`*_[\]<>#$^|&]/g, '\\$&').replace(/([=~%])\1/g, '\\$1\\$1');
  function inline(text) {
    const s = String(text ?? '');
    let out = '';
    let at = 0;
    for (const m of s.matchAll(URLS)) { out += escPart(s.slice(at, m.index)) + m[0]; at = m.index + m[0].length; }
    return out + escPart(s.slice(at));
  }
  // Each line, so that none starts a list, a heading or a code block.
  const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => inline(l.replace(/^\s+/, '')).replace(/^([-+])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2'));

  // A small, fast hash: is a note what was written last time?
  function hash(s) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A period of messages: a year ("2024"), a month ("2024-03") or "undated".
  const periodName = (p) => (p === 'undated' ? 'Undated' : p.length === 4 ? p : `${MONTHS[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`);
  function periodsOf(msgs, busyYear) {
    const year = new Map();
    for (const m of msgs) { const y = m.timestamp ? m.timestamp.slice(0, 4) : 'undated'; year.set(y, (year.get(y) || 0) + 1); }
    const out = new Map();
    for (const m of msgs) {
      const y = m.timestamp ? m.timestamp.slice(0, 4) : 'undated';
      const p = y !== 'undated' && year.get(y) > busyYear ? m.timestamp.slice(0, 7) : y;
      if (!out.has(p)) out.set(p, []);
      out.get(p).push(m);
    }
    return new Map([...out].sort(([a], [b]) => (a === 'undated') - (b === 'undated') || a.localeCompare(b)));
  }
  const day = (t) => t?.slice(0, 10) || '';
  const dateText = (t) => (t ? `${+t.slice(8, 10)} ${MONTHS[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}` : '');
  const shortDate = (t) => `${+t.slice(8, 10)} ${MONTHS[+t.slice(5, 7) - 1].slice(0, 3)}`;
  const span = (first, last) => (first ? `${dateText(first)} to ${dateText(last)}` : 'no dates');
  const tagOf = (name) => String(name).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '');
  const EMBED = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|ogv|mp3|m4a|wav|ogg|oga|opus|flac|aac|3gp|amr|pdf)$/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Days as numbers (since 1 January 1970), as the manifest keeps them, and back.
  const dayNum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  // 1 January 1970 was a Thursday.
  const weekday = (d) => (((dayNum(d) % 7) + 11) % 7);
  // A day's heading, in the messages and in the calendar, which a link can point at.
  const HEADINGS = new Map();
  const dayHeading = (d) => {
    if (!d) return 'Undated';
    let h = HEADINGS.get(d);
    if (!h) { if (HEADINGS.size > 50000) HEADINGS.clear(); HEADINGS.set(d, (h = `${WEEKDAYS[weekday(d)]}, ${dateText(d)}`)); }
    return h;
  };
  const numDay = (n) => (n ? new Date(n * 864e5).toISOString().slice(0, 10) : '');

  // ---------- what a chat says ----------
  // Worked out once when a chat is read, kept in the manifest (`a` of the
  // chat), and added up for each person. Words never leave the backup folder.
  const STOP = new Set(('the and for you that this with have are was but not your just can what all get its out like got how she him her his they them then than there their when will would could should about from been were one did into our more some any too only also very really yeah yes okay lol haha hahaha lmao omg' +
    ' it\'s i\'m don\'t that\'s can\'t didn\'t i\'ll you\'re i\'ve isn\'t won\'t let\'s what\'s there\'s doesn\'t wasn\'t https http www com' +
    ' are has had who why where which while here now well still even back going gonna wanna gotta know think want need make see say said come came take thing things much many way time good great nice sure thanks thank please sorry ' +
    'saw seen yep yup nope hey hii hello bye today tomorrow tonight yesterday morning night day week let off over again after before because cause cuz though thats dont cant didnt wont youre ive isnt doesnt wasnt idk tbh btw lmk ill ' +
    'him himself herself myself yourself also ain\'t aren\'t couldn\'t shouldn\'t wouldn\'t haven\'t hasn\'t i\'d you\'ll you\'ve we\'re they\'re he\'s she\'s it\'ll message missed call photo video image sent attachment deleted ' +
    // Chat filler and greetings, which say nothing about what a chat is about.
    'happy merry congrats congratulations love miss later soon ready maybe probably actually literally pretty kinda sorta guess wait sounds fine cool awesome amazing ' +
    'lot lots bit little right first last next every something anything nothing everything someone anyone everyone another other same such own most few ' +
    'done doing getting trying looking feel feeling set put try tried keep give find tell told ask asked look call text texted send check help use used ' +
    'tho tmrw tmr tonite nite pls plz thx wow yay aww hmm umm ooh ahh ugh hehe lmfao rofl xoxo meet ' +
    // Greetings for days the events already find.
    'birthday bday christmas xmas thanksgiving easter halloween valentine valentines ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december').split(/\s+/));
  // First names that are also everyday words, which can't be told apart in text.
  const AMBIG = new Set(('will may june april august mark rose grace hope joy faith bill pat art sue bob jack frank max sky summer autumn dawn rich ' +
    'january february march july september october november december monday tuesday wednesday thursday friday saturday sunday').split(' '));
  const WORD = /[\p{L}][\p{L}\p{N}'’-]*/gu;
  const EMOJI = /\p{Extended_Pictographic}/gu;
  const GAP = 6 * 3600e3; // a pause this long starts a new conversation
  const REPLY = [1, 5, 15, 60, 180, 720, 1440]; // minutes: how fast a reply came
  const REPLY_TEXT = ['in under a minute', 'within 5 minutes', 'within 15 minutes', 'within an hour', 'within 3 hours', 'within 12 hours', 'within a day'];
  const top = (map, n) => Object.fromEntries([...map].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, n));
  const bump = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
  // A media item's kind, in short: photo, video, audio, other file.
  const KIND = { image: 'p', gif: 'p', sticker: 'p', photo: 'p', video: 'v', audio: 'a', voice: 'a' };
  const PHOTO_DAY = 5; // photos and videos in a chat in a day that make it a photo day

  // The words and phrases in a message: each word that says something (not
  // a stopword, a number or a web address), and phrases of two or three such
  // words ("dog park", "fantasy football league") or of two around a small
  // word ("game of thrones"). Never across punctuation.
  const JOIN = new Set(['of', 'the', 'and', 'in', 'on', 'for', 'to', 'a', 'at', 'with', 'n']);
  // Not laughter ("hahaha"), and not a word drawn out ("sooo"). Words come
  // again and again, so what each one is is kept.
  const MEANT = new Map();
  const meaningful = (k) => {
    let v = MEANT.get(k);
    if (v === undefined) {
      v = k.length >= 3 && k.length <= 24 && !STOP.has(k) && !/\d/.test(k) && !/^(?:h?[aeiou]h?){2,}h?$/.test(k) && !/(.)\1\1/.test(k);
      if (MEANT.size > 300000) MEANT.clear();
      MEANT.set(k, v);
    }
    return v;
  };
  function termsIn(text, each) {
    for (const part of String(text).replace(URLS, ' ').toLowerCase().split(/[.!?,;:()"“”\r\n]+/)) {
      const ts = (part.match(WORD) || []).map((w) => w.replace(/’/g, '\'').replace(/^['-]+|['-]+$/g, ''));
      for (let i = 0; i < ts.length; i++) {
        if (!meaningful(ts[i])) continue;
        each(ts[i]);
        const b = ts[i + 1];
        const c = ts[i + 2];
        if (b && meaningful(b) && b !== ts[i]) {
          each(`${ts[i]} ${b}`);
          if (c && meaningful(c) && c !== b) each(`${ts[i]} ${b} ${c}`);
        } else if (b && JOIN.has(b) && c && meaningful(c) && c !== ts[i]) each(`${ts[i]} ${b} ${c}`);
      }
    }
  }

  // ---------- events ----------
  // Found in what each side said on a day (the phrases are English, with a
  // few other languages' birthday and holiday wishes): birthday and
  // anniversary wishes, congratulations (and, from the day's words, perhaps
  // what for), holiday greetings, travel, and meeting up. Kept as
  // [day, kind, me, hint], `me` 1 when you said it. Nothing about illness or
  // loss is looked for: getting that wrong would hurt.
  const BIRTHDAY = /\b(?:happy|hapy|hppy)\s+(belated\s+)?(?:b-?day|birthday|bday|bdy)\b|\bhbd\b|\bmany happy returns\b|\bfeliz cumplea(?:ñ|n)os\b|\bjoyeux anniversaire\b|\balles gute zum geburtstag\b|\bbuon compleanno\b|\bfeliz anivers(?:á|a)rio\b/i;
  const FOR_NAME = /\b[Hh][Aa][Pp][Pp][Yy]\s+(?:[Bb]elated\s+)?(?:[Bb]-?[Dd]ay|[Bb]irthday|BIRTHDAY|[Bb]day)\s*,?\s*(?:to\s+)?(\p{Lu}\p{Ll}{2,})/u;
  const ANNIVERSARY = /\bhappy\s+(?:\d+\w*\s+)?anniversary\b/i;
  const CONGRATS = /\bcongrat(?:s|z|ulations?)?\b|\bmazel tov\b|\bso proud of (?:you|u)\b|\bfelicidades\b|\bf(?:é|e)licitations\b|\bherzlichen gl(?:ü|u)ckwunsch\b/i;
  const MILESTONES = [
    ['engagement', /\b(?:engaged|engagement|proposed|fianc(?:é|e)e?)\b/i],
    ['wedding', /\b(?:wedding|married|newlyweds?|honeymoon)\b/i],
    ['baby', /\b(?:baby|pregnan\w*|newborn|it'?s a (?:boy|girl)|gave birth)\b/i],
    ['graduation', /\b(?:graduat\w*|diploma|commencement)\b/i],
    ['new job', /\b(?:new job|promot(?:ed|ion)|hired|job offer|got the job|new role|offer letter)\b/i],
    ['new home', /\b(?:new (?:house|home|place|apartment|flat)|moved in|got the keys|bought a (?:house|home|place))\b/i],
    ['exams', /\b(?:passed (?:the |my |your |her |his )?(?:exam|test|bar|boards)|driving test|got accepted|accepted (?:to|into))\b/i],
    ['retirement', /\bretir(?:ed|ement|ing)\b/i],
  ];
  const HOLIDAYS = [
    ['Christmas', /\b(?:merry|happy)\s+(?:christmas|xmas|x-mas)\b|\bfeliz navidad\b|\bjoyeux no(?:ë|e)l\b|\bfrohe weihnachten\b/i],
    ['New Year', /\bhappy\s+new\s+year\b|\bfeliz a(?:ñ|n)o nuevo\b|\bbonne ann(?:é|e)e\b|\bfrohes neues jahr\b/i],
    ['Lunar New Year', /\bhappy\s+(?:lunar|chinese)\s+new\s+year\b/i],
    ['Thanksgiving', /\bhappy\s+thanksgiving\b/i],
    ['Easter', /\bhappy\s+easter\b/i],
    ['Diwali', /\bhappy\s+diwali\b/i],
    ['Eid', /\beid\s+mubarak\b/i],
    ['Hanukkah', /\bhappy\s+(?:hanukkah|chanukah|hanukah)\b/i],
    ["Mother's Day", /\bhappy\s+mother'?s\s+day\b/i],
    ["Father's Day", /\bhappy\s+father'?s\s+day\b/i],
    ["Valentine's Day", /\bhappy\s+valentine'?s?\b/i],
    ['Halloween', /\bhappy\s+halloween\b/i],
  ];
  const TRIP = /\b(?:just|we|i|we've|i've|have|has|finally|safely)\s+landed\b|\blanded\s+(?:in|at|safely)\b|\bboarding\s+(?:now|soon|pass|the plane|in)\b|\blayover\b|\bsafe\s+(?:travels|flight|trip)\b|\bbon voyage\b|\bwheels up\b|\bat the airport\b|\bmy flight\b|\bjet ?lag\b/i;
  const PLACE = /\b(?:landed in|arrived in|trip to|flying to|flight to|flew to|flying into|vacation in|holiday in|back from)\s+(\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){0,2})/u;
  const MEET = /\bon my way\b|\bomw\b|\bi'?m outside\b|\bpulling up\b|\bbe there in\b|\brunning (?:a (?:bit|little) )?late\b|\bleaving now\b|\bhere now\b/i;
  function dayEvents(dn, said, out) {
    const both = `${said[0]}\n${said[1]}`;
    if (!both.trim()) return;
    for (const me of [1, 0]) {
      const s = said[me];
      if (!s) continue;
      const b = s.match(BIRTHDAY);
      if (b) out.push([dn, 'bday', me, b[1] ? 'belated' : s.match(FOR_NAME)?.[1] || '']);
      if (ANNIVERSARY.test(s)) out.push([dn, 'anniv', me, '']);
    }
    for (const [name, re] of HOLIDAYS) if (re.test(both)) out.push([dn, 'holiday', re.test(said[1]) ? 1 : 0, name]);
    if (CONGRATS.test(both)) out.push([dn, 'congrats', CONGRATS.test(said[1]) ? 1 : 0, MILESTONES.find(([, re]) => re.test(both))?.[0] || '']);
    if (TRIP.test(both)) out.push([dn, 'trip', TRIP.test(said[1]) ? 1 : 0, both.match(PLACE)?.[1] || '']);
    if (MEET.test(both)) out.push([dn, 'meet', MEET.test(said[1]) ? 1 : 0, '']);
  }

  // `periods`: the chat's period notes ("2024", "2024-03"), or null when the
  // messages are in the chat's own note.
  function analyse(msgs, periods) {
    const a = { sent: 0, recv: 0, calls: 0, media: 0, kinds: {}, years: {}, hours: Array(24).fill(0), week: Array(7).fill(0),
      reply: [Array(REPLY.length).fill(0), Array(REPLY.length).fill(0)], starts: [0, 0], talks: 0, longest: null, first: null, last: null,
      days: {}, mdays: {}, terms: {}, yterms: {}, names: {}, emoji: [{}, {}], links: [], files: [], events: [], senders: [], periods };
    const counts = new Map();
    const names = new Map();
    const emoji = [new Map(), new Map()];
    const days = new Map();
    const mdays = new Map();
    const kinds = new Map();
    const senders = new Map();
    let prev = null; // { at, d, me }
    let talk = null; // { d, n }
    // The day being read, and what each side said on it, for its events.
    let today = null;
    const said = ['', ''];
    let todayNum = 0;
    const endDay = () => { if (today) dayEvents(todayNum, said, a.events); said[0] = said[1] = ''; };
    for (const m of msgs) {
      if (m.kind === 'call') { a.calls++; continue; }
      if (m.kind === 'system') continue;
      const me = m.direction === 'sent' ? 1 : 0;
      if (me) a.sent++; else a.recv++;
      const t = m.timestamp || '';
      const d = day(t);
      if (d !== today) { endDay(); today = d; todayNum = d ? dayNum(d) : 0; }
      const timed = t.length > 10 && m.timestamp_precision !== 'day';
      const at = timed ? Date.parse(`${d}T${t.slice(11, 16)}`) : null;
      if (d) {
        const y = d.slice(0, 4);
        (a.years[y] ||= [0, 0])[me]++;
        bump(days, d);
        a.week[((todayNum % 7) + 11) % 7]++;
        if (!a.first) a.first = { d, me };
        // A conversation: messages without a long pause (or, untimed, on one day).
        const fresh = !prev || (at != null && prev.at != null ? at - prev.at > GAP : d !== prev.d);
        if (fresh) {
          if (talk && (!a.longest || talk.n > a.longest.n)) a.longest = talk;
          talk = { d, n: 0 };
          a.starts[me]++;
          a.talks++;
        } else if (at != null && prev.at != null && prev.me !== me && at >= prev.at) {
          const mins = (at - prev.at) / 60e3;
          const b = REPLY.findIndex((x) => mins <= x);
          if (b >= 0) a.reply[me][b]++;
        }
        talk.n++;
        prev = { at, d, me };
      }
      if (timed) a.hours[+t.slice(11, 13)]++;
      // Who said it: in a group, by number when there is one, else by name.
      const who = me ? 'me' : m.sender_number ? `tel:${String(m.sender_number).replace(/\D/g, '').slice(-10)}` : `name:${L().nameKey(m.sender)}`;
      const s = senders.get(who);
      if (s) s.n++; else senders.set(who, { name: me ? 'Me' : L().formatNumber(m.sender || m.sender_number || '?'), n: 1 });
      const text = String(m.text || '');
      if (text) {
        for (const u of text.match(URLS) || []) a.links.push([u, d]);
        termsIn(text, (k) => bump(counts, k));
        // Capitalised words not starting a sentence: names, for mentions.
        for (const sentence of text.replace(URLS, ' ').split(/[.!?]+\s+|\n+/)) {
          const ws = sentence.match(WORD) || [];
          for (let i = 1; i < ws.length; i++) if (/^\p{Lu}\p{Ll}{2,}$/u.test(ws[i])) bump(names, ws[i].toLowerCase());
        }
        for (const e of text.match(EMOJI) || []) bump(emoji[me], e);
        if (d && said[me].length < 8000) said[me] += `\n${text}`;
      }
      for (const md of m.media || []) {
        a.media++;
        const k = KIND[md.kind] || 'f';
        bump(kinds, k);
        if (md.file) {
          a.files.push([md.file, todayNum, me, k]);
          if (d && (k === 'p' || k === 'v')) bump(mdays, d);
        }
      }
    }
    endDay();
    if (talk && (!a.longest || talk.n > a.longest.n)) a.longest = talk;
    a.last = prev?.d || null;
    a.days = Object.fromEntries(days);
    a.mdays = Object.fromEntries(mdays);
    a.kinds = Object.fromEntries(kinds);
    a.names = top(names, 60);
    a.emoji = emoji.map((e) => top(e, 8));
    a.senders = [...senders].sort((x, y) => y[1].n - x[1].n).slice(0, 25).map(([k, v]) => [k, v.name, v.n]);
    // The newest, enough for the notes.
    a.links = a.links.slice(-300);
    a.files = a.files.slice(-10000);
    a.events = a.events.slice(-800);

    // The chat's words and phrases, read again for the most used ones: how
    // often, the first and last day, the day most, and each year's.
    const best = (list, n, min) => list.filter(([, c]) => c >= min).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, n);
    const chosen = new Map([...best([...counts].filter(([k]) => !k.includes(' ')), 100, 2), ...best([...counts].filter(([k]) => k.includes(' ')), 40, 3)]
      .map(([k]) => [k, { n: 0, f: 0, l: 0, cd: 0, cn: 0, pd: 0, pn: 0, y: {} }]));
    if (chosen.size) {
      let last = null;
      let dn = 0;
      for (const m of msgs) {
        if (!m.text || m.kind === 'call' || m.kind === 'system') continue;
        const d = day(m.timestamp);
        if (d !== last) { last = d; dn = d ? dayNum(d) : 0; }
        termsIn(m.text, (k) => {
          const r = chosen.get(k);
          if (!r) return;
          r.n++;
          if (!dn) return;
          if (!r.f || dn < r.f) r.f = dn;
          if (dn > r.l) r.l = dn;
          if (r.cd === dn) r.cn++;
          else { if (r.cn > r.pn) { r.pd = r.cd; r.pn = r.cn; } r.cd = dn; r.cn = 1; }
          r.y[d.slice(0, 4)] = (r.y[d.slice(0, 4)] || 0) + 1;
        });
      }
      const years = {};
      for (const [k, r] of chosen) {
        if (r.cn > r.pn) { r.pd = r.cd; r.pn = r.cn; }
        a.terms[k] = [r.n, r.f, r.l, r.pd, r.pn];
        for (const [y, n] of Object.entries(r.y)) (years[y] ||= []).push([k, n]);
      }
      for (const [y, list] of Object.entries(years)) a.yterms[y] = best(list, 12, 2);
    }
    return a;
  }

  // A person's chats, added up.
  function merge(list) {
    const t = { sent: 0, recv: 0, calls: 0, media: 0, kinds: {}, years: {}, hours: Array(24).fill(0), week: Array(7).fill(0),
      reply: [Array(REPLY.length).fill(0), Array(REPLY.length).fill(0)], starts: [0, 0], talks: 0, days: {}, terms: {}, yterms: {}, emoji: [{}, {}] };
    const add = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; };
    for (const a of list) {
      for (const k of ['sent', 'recv', 'calls', 'media', 'talks']) t[k] += a[k] || 0;
      for (const [y, [s, r]] of Object.entries(a.years || {})) { const v = (t.years[y] ||= [0, 0]); v[0] += s; v[1] += r; }
      for (let i = 0; i < 24; i++) t.hours[i] += a.hours?.[i] || 0;
      for (let i = 0; i < 7; i++) t.week[i] += a.week?.[i] || 0;
      for (let s = 0; s < 2; s++) { t.starts[s] += a.starts?.[s] || 0; for (let i = 0; i < REPLY.length; i++) t.reply[s][i] += a.reply?.[s]?.[i] || 0; add(t.emoji[s], a.emoji?.[s]); }
      add(t.days, a.days);
      add(t.kinds, a.kinds);
      for (const [w, [n, f, l, pd, pn]] of Object.entries(a.terms || {})) {
        const x = t.terms[w];
        if (!x) t.terms[w] = [n, f, l, pd, pn];
        else { x[0] += n; if (f && (!x[1] || f < x[1])) x[1] = f; if (l > x[2]) x[2] = l; if (pn > x[4]) { x[3] = pd; x[4] = pn; } }
      }
      for (const [y, ws] of Object.entries(a.yterms || {})) { const m = (t.yterms[y] ||= {}); for (const [w, n] of ws) m[w] = (m[w] || 0) + n; }
    }
    return t;
  }
  // How fast someone usually replies, from a histogram.
  function usually(h) {
    const n = h.reduce((x, y) => x + y, 0);
    if (n < 5) return null;
    let c = 0;
    for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= n / 2) return REPLY_TEXT[i]; }
    return null;
  }
  const many = (n, one, more = `${one}s`) => `${nf(n)} ${n === 1 ? one : more}`;
  const pct = (x, n) => (n ? Math.round((100 * x) / n) : 0);
  const SPARK = '▁▂▃▄▅▆▇█';
  const spark = (v) => { const max = Math.max(...v); return v.map((x) => (x ? SPARK[Math.min(7, Math.floor((x / max) * 7.999))] : '·')).join(''); };
  const bar = (x, max) => (x ? '█'.repeat(Math.max(1, Math.round((x / max) * 20))) : '');
  function lasted(n) {
    if (n < 45) return `${n} day${n === 1 ? '' : 's'}`;
    const mo = Math.round(n / 30.44);
    if (mo < 12) return `${mo} months`;
    const y = Math.floor(mo / 12);
    const r = mo % 12;
    return `${y} year${y > 1 ? 's' : ''}${r ? ` and ${r} month${r > 1 ? 's' : ''}` : ''}`;
  }
  const partOfDay = (h) => {
    const parts = [['at night', 0, 6], ['in the morning', 6, 12], ['in the afternoon', 12, 18], ['in the evening', 18, 24]].map(([n, a, b]) => [n, h.slice(a, b).reduce((x, y) => x + y, 0)]);
    const best = parts.sort((x, y) => y[1] - x[1])[0];
    return best[1] ? best[0] : null;
  };
  // What a person's or chat's media were: "12 photos, 2 videos, 1 voice note".
  const mediaText = (k) => [[k.p, 'photo'], [k.v, 'video'], [k.a, 'voice note'], [k.f, 'file']].filter(([n]) => n).map(([n, one]) => many(n, one)).join(', ');

  // ---------- topics: words and phrases ----------
  // People's own names are connections, not topics.
  const hasName = (w, named) => w.split(' ').some((x) => named.has(x));
  // One of a word and a phrase holding it, on the same list, says nothing
  // more: a word or shorter phrase with hardly more uses than the longer one
  // ("fantasy" beside "fantasy football") goes, and so does a longer phrase
  // round a phrase used more ("fantasy football league" beside "fantasy
  // football"). Used about as much, the phrase more people share (`df`)
  // stays, since shared phrases are what link people.
  const inside = (a, b) => b.length > a.length && ` ${b} `.includes(` ${a} `);
  const dedupe = (list, df) => {
    const d = (x) => df?.get(x) || 0;
    return list.filter(([w, n]) => !list.some(([v, m]) => (inside(w, v) && n <= m * 1.25 && !(w.includes(' ') && d(w) > d(v)))
      || (inside(v, w) && v.includes(' ') && (m > n * 1.25 || (d(v) > d(w) && m * 1.25 >= n)))));
  };
  // What each person (and group chat) talks about that most others don't:
  // their words and phrases, weighed against how many others use them
  // (TF-IDF; a phrase counts half as much again, being rarer). One among the
  // topics of two of them or more becomes a note that links them.
  function standout(docs, named) {
    const df = new Map();
    for (const d of docs) for (const w of Object.keys(d.terms)) bump(df, w);
    const N = docs.length;
    const of = new Map();
    const nodes = new Map();
    for (const d of docs) {
      const scored = Object.entries(d.terms)
        .filter(([w, [n]]) => n >= 3 && !hasName(w, named) && (N < 6 || df.get(w) <= Math.max(2, N / 2)))
        .map(([w, [n]]) => [w, n, n * Math.log(1 + N / df.get(w)) * (w.includes(' ') ? 1.5 : 1)])
        .sort((x, y) => y[2] - x[2] || (x[0] < y[0] ? -1 : 1))
        .slice(0, 25);
      const list = dedupe(scored, df).slice(0, 12);
      of.set(d, list.map(([w, n]) => ({ w, n, t: d.terms[w] })));
      for (const [w, n] of list) { if (!nodes.has(w)) nodes.set(w, []); nodes.get(w).push({ d, n, t: d.terms[w] }); }
    }
    for (const [w, list] of nodes) if (list.length < 2) nodes.delete(w);
    return { of, nodes };
  }
  // What stood out each year (`years`: year -> Map(term -> uses)): a year's
  // words and phrases weighed against how many years use them.
  function byYear(years, named, keep, min) {
    const used = new Map();
    for (const m of years.values()) for (const [w, n] of m) if (n >= min) bump(used, w);
    const Y = years.size;
    const out = new Map();
    for (const [y, m] of years) {
      const list = [...m].filter(([w, n]) => n >= min && !hasName(w, named))
        .map(([w, n]) => [w, n, n * Math.log(1 + Y / (used.get(w) || 1)) * (w.includes(' ') ? 1.5 : 1)])
        .sort((x, z) => z[2] - x[2] || (x[0] < z[0] ? -1 : 1))
        .slice(0, keep * 3);
      out.set(y, dedupe(list).slice(0, keep).map(([w, n]) => ({ w, n })));
    }
    return out;
  }

  // Who's named in whose chats: a person's first name, when no one else has
  // it and it isn't also an everyday word, capitalised mid-sentence.
  function mentionsOf(P, cache) {
    const first = new Map();
    for (const p of P.list) {
      const f = /\p{L}/u.test(p.name) ? p.name.split(/\s+/)[0].toLowerCase().normalize('NFC') : '';
      if (f.length >= 3 && /^\p{L}+$/u.test(f) && !STOP.has(f) && !AMBIG.has(f)) { if (!first.has(f)) first.set(f, []); first.get(f).push(p); }
    }
    const out = new Map(P.list.map((p) => [p, []]));
    const into = new Map(P.list.map((p) => [p, []]));
    for (const p of P.list) {
      const said = new Map();
      for (const r of p.chats) for (const [w, n] of Object.entries(cache.get(r)?.names || {})) bump(said, w, n);
      for (const [f, qs] of first) {
        const n = said.get(f) || 0;
        if (qs.length !== 1 || qs[0] === p || n < 2) continue;
        out.get(p).push({ q: qs[0], n });
        into.get(qs[0]).push({ q: p, n });
      }
    }
    for (const m of [out, into]) for (const l of m.values()) l.sort((x, y) => y.n - x.n);
    return { out, into };
  }

  // Where each source's, person's and chat's notes go, unique by name; and
  // the calendar's, the photos' and the events'.
  function layout(rows, P) {
    const used = new Set();
    const take = (dir, name, alt) => {
      let p = `${dir}/${noteName(name)}.md`;
      if (used.has(p.toLowerCase()) && alt) p = `${dir}/${noteName(`${name} (${alt})`)}.md`;
      for (let n = 2; used.has(p.toLowerCase()); n++) p = `${dir}/${noteName(name)} (${n}).md`;
      used.add(p.toLowerCase());
      return p;
    };
    const source = (row) => { const parts = row.folder.split('/'); return parts.length > 2 ? parts[1] : L().serviceLabel('sms'); };
    const person = new Map();
    for (const p of [...P.list].sort((a, b) => b.count - a.count)) person.set(p, take(`${ROOT}/People`, p.name, L().serviceLabel(p.services[0])));
    const chat = new Map();
    for (const r of rows) chat.set(r, take(`${ROOT}/Chats/${noteName(source(r))}`, r.folder.split('/').pop()));
    const sources = new Map();
    for (const r of rows) { const s = source(r); if (!sources.has(s)) sources.set(s, { name: s, path: take(`${ROOT}/Chats`, s), rows: [] }); sources.get(s).rows.push(r); }
    return {
      person, chat, sources, source,
      period: (r, p) => `${chat.get(r).replace(/\.md$/, '')}/${noteName(`${r.folder.split('/').pop()} ${p}`)}.md`,
      calendar: `${ROOT}/Calendar.md`,
      year: (y) => `${ROOT}/Calendar/${y}.md`,
      month: (m) => `${ROOT}/Calendar/${m.slice(0, 4)}/${m}.md`,
      events: `${ROOT}/Events.md`,
      photos: `${ROOT}/Photos.md`,
      topics: `${ROOT}/Topics.md`,
      people: `${ROOT}/People.md`,
      labels: `${ROOT}/Labels.md`,
      home: `${ROOT}/Message Archivist.md`,
    };
  }

  // A photo, video or file, embedded from the chat's folder.
  function mediaMd(md, row, notePath) {
    if (!md.file) return `*(${md.kind || 'file'} not saved${md.skipped || md.error ? `: ${inline(md.skipped || md.error)}` : ''})*`;
    const path = `${row.folder}/${md.file}`;
    if (/[[\]#^|]/.test(path)) {
      // Wikilinks can't hold these: a Markdown link, relative to the note.
      const url = '../'.repeat(notePath.split('/').length - 1) + path.split('/').map(encodeURIComponent).join('/');
      return `${EMBED.test(path) ? '!' : ''}[${inline(md.file.split('/').pop())}](${url})`;
    }
    return EMBED.test(path) ? `![[${path}${IMAGE.test(path) ? '|320' : ''}]]` : `[[${path}|${noteName(path.split('/').pop())}]]`;
  }
  // In a gallery: photos small, side by side; videos and the rest as links.
  function galleryItem(file, k, row, notePath) {
    const path = `${row.folder}/${file}`;
    const show = k === 'p' && IMAGE.test(path);
    const mark = show ? '' : k === 'v' ? '🎬 ' : k === 'a' ? '🎤 ' : '📄 ';
    if (/[[\]#^|]/.test(path)) {
      const url = '../'.repeat(notePath.split('/').length - 1) + path.split('/').map(encodeURIComponent).join('/');
      return `${mark}${show ? '!' : ''}[${inline(file.split('/').pop())}](${url})`;
    }
    return show ? `![[${path}|200]]` : `${mark}[[${path}|${noteName(file.split('/').pop())}]]`;
  }

  // One message: who and when, what it replied to, the text, photos and
  // videos (embedded from the chat's folder), reactions and a flag's note.
  function messageMd(m, row, flag, notePath) {
    const t = m.timestamp || '';
    const time = t.length > 10 && m.timestamp_precision !== 'day' ? `${m.timestamp_precision === 'section' ? '≈' : ''}${t.slice(11, 16)}` : '';
    const out = [];
    if (m.kind === 'system' || m.kind === 'call') {
      out.push(`*${inline(m.text || (m.kind === 'call' ? 'Call' : ''))}*${time ? ` · ${time}` : ''}`);
      return out.join('\n');
    }
    out.push(`**${inline(L().formatNumber(m.sender || (m.direction === 'sent' ? 'Me' : '?')))}**${time ? ` · ${time}` : ''}${m.edited ? ' · *edited*' : ''}${flag ? ' · ★' : ''}`);
    if (m.reply_to) {
      const q = String(m.reply_to.text || '').replace(/\s+/g, ' ');
      out.push(`*↳ ${inline(L().formatNumber(m.reply_to.sender || ''))}: “${inline(q.length > 140 ? `${q.slice(0, 140)}…` : q)}”*`);
    }
    if (m.text) out.push(...lines(m.text));
    for (const md of m.media || []) out.push(mediaMd(md, row, notePath));
    const rx = (m.reactions || []).map((r) => (typeof r === 'string' ? r : r?.label || r?.emoji || '')).filter(Boolean);
    if (rx.length) out.push(`*${inline(rx.join(' · '))}*`);
    if (flag?.note) out.push(`★ *${inline(flag.note)}*`);
    return out.join('\n');
  }

  // Messages under a heading for each day.
  function transcript(msgs, row, flags, self, level) {
    const out = [];
    let today = null;
    for (const m of msgs) {
      const d = day(m.timestamp);
      if (d !== today) {
        today = d;
        out.push('', `${level} ${dayHeading(d)}`);
      }
      out.push('', messageMd(m, row, flags(m), self));
    }
    return out;
  }

  function periodMd({ row, p, msgs, periods, paths, who, flags }) {
    const self = paths.period(row, p);
    const title = L().formatNumber(row.title);
    const i = periods.indexOf(p);
    const nav = [
      i > 0 ? `← ${link(paths.period(row, periods[i - 1]), periodName(periods[i - 1]))}` : null,
      link(paths.chat.get(row), title),
      i < periods.length - 1 ? `${link(paths.period(row, periods[i + 1]), periodName(periods[i + 1]))} →` : null,
    ].filter(Boolean).join(' · ');
    const out = ['---', 'type: messages', `source: ${yaml(paths.source(row))}`, `chat: ${yaml(link(paths.chat.get(row), title))}`];
    if (who.length === 1) out.push(`person: ${yaml(link(paths.person.get(who[0]), who[0].name))}`);
    if (p !== 'undated') out.push(`${p.length === 4 ? 'year' : 'month'}: ${p}`);
    if (msgs[0]?.timestamp) out.push(`first: ${day(msgs[0].timestamp)}`, `last: ${day(msgs[msgs.length - 1].timestamp)}`);
    out.push(`messages: ${msgs.length}`, '---', `# ${inline(title)} · ${periodName(p)}`, '', nav, ...transcript(msgs, row, flags, self, '##'), '', nav, '');
    return out.join('\n');
  }

  // A link to one day's messages in a chat: its heading in the period note.
  function dayLink(paths, r, a, d, text = dateText(d)) {
    if (!d || !a) return text || 'undated';
    const note = !a.periods ? paths.chat.get(r) : paths.period(r, a.periods.includes(d.slice(0, 7)) ? d.slice(0, 7) : d.slice(0, 4));
    return linkTo(note, dayHeading(d), text);
  }

  const EVENT_EMOJI = { bday: '🎂', anniv: '💍', congrats: '🎉', holiday: '🎊', trip: '✈️', meet: '🤝', photos: '📷' };
  const emojiOf = (kind, hint) => (kind === 'holiday' ? { Christmas: '🎄', 'New Year': '🎆' }[hint] || '🎊' : EVENT_EMOJI[kind]);
  // A group chat's events, counted: "🎂 3 · 🤝 5 · 📷 2 photo days".
  function eventCounts(a) {
    const n = new Map();
    for (const [, kind, , hint] of a.events) bump(n, emojiOf(kind, hint));
    const photoDays = Object.values(a.mdays).filter((x) => x >= PHOTO_DAY).length;
    return [...[...n].map(([e, c]) => `${e} ${nf(c)}`), photoDays ? `📷 ${many(photoDays, 'photo day')}` : null].filter(Boolean).join(' · ');
  }

  // A chat: who it's with, and its messages (here, for a short chat, or a
  // link to each year's or month's). A group's starts with the gist: who
  // talks most, its busiest day and what happened in it.
  function chatMd({ row, periods, inline: own, paths, who, tags, flags, a, member }) {
    const title = L().formatNumber(row.title);
    const service = L().serviceOf(row);
    const out = ['---', 'type: chat', `source: ${yaml(paths.source(row))}`];
    if (row.account) out.push(`account: ${yaml(row.account_label || L().accountLabel(row.account))}`);
    const group = L().isGroupChat(row);
    if (!group && who.length === 1) out.push(`person: ${yaml(link(paths.person.get(who[0]), who[0].name))}`);
    else if (who.length) out.push(`people: ${yaml(who.map((p) => link(paths.person.get(p), p.name)))}`);
    out.push(`messages: ${row.count ?? 0}`);
    if (row.first) out.push(`first: ${day(row.first)}`, `last: ${day(row.last)}`);
    if (tags.length) out.push(`tags: ${yaml(tags)}`);
    out.push(`folder: ${yaml(row.folder)}`, '---', `# ${inline(title)}`, '');
    const people = who.map((p) => link(paths.person.get(p), p.name));
    const others = (row.contact?.people || []).filter((p) => (p.n ?? p.name) !== 'Me').length - who.length;
    const withWho = people.length ? ` with ${people.join(', ')}${group && others > 0 ? ` and ${others} more` : ''}` : '';
    out.push(`${L().serviceLabel(service)} ${group ? 'group' : 'chat'}${withWho}${row.account ? ` (${inline(row.account_label || L().accountLabel(row.account))})` : ''}. ${nf(row.count)} messages, ${span(row.first, row.last)}.`);
    const n = a ? a.sent + a.recv : 0;
    if (group && n) {
      const ds = Object.keys(a.days).sort();
      let busiest = ds.length > 1 ? ds.reduce((x, y) => (a.days[y] > a.days[x] ? y : x)) : null;
      if (busiest && a.days[busiest] < 5) busiest = null;
      const gist = [`You sent ${pct(a.sent, n)}% of the messages.`];
      if (busiest) gist.push(`Busiest day: ${dayLink(paths, row, a, busiest)} (${nf(a.days[busiest])}).`);
      if (a.media) gist.push(`${mediaText(a.kinds)}.`);
      out.push('', '> [!summary]', `> ${gist.join(' ')}`);
      const active = a.senders.slice(0, 8).map(([k, name, c]) => {
        const q = k === 'me' ? null : member(k);
        return `${k === 'me' ? 'You' : q ? link(paths.person.get(q), q.name) : inline(name)} ${pct(c, n)}%`;
      });
      out.push('>', `> **Most active**: ${active.join(' · ')}`);
      const ev = eventCounts(a);
      if (ev) out.push('>', `> **Events**: ${ev}`);
    }
    if (own) {
      // A short chat: its messages are here.
      out.push('', '## Messages', ...transcript(own, row, flags, paths.chat.get(row), '###'));
    } else if (periods.size) {
      // Newest first: a year's note, or a busy year's months.
      out.push('', '## Messages');
      const years = new Map();
      for (const p of periods.keys()) { const y = p === 'undated' ? 'Undated' : p.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(p); }
      for (const [y, ps] of [...years].reverse()) {
        if (ps.length === 1 && !/^\d{4}-\d\d$/.test(ps[0])) out.push(`- ${link(paths.period(row, ps[0]), periodName(ps[0]))} (${nf(periods.get(ps[0]).length)})`);
        else out.push(`- **${y}**: ${ps.slice().reverse().map((p) => `${link(paths.period(row, p), MONTHS[+p.slice(5, 7) - 1].slice(0, 3))} (${nf(periods.get(p).length)})`).join(', ')}`);
      }
    }
    out.push('', MARK, '');
    return out.join('\n');
  }

  // The chat of a person's that has the most messages on a day.
  const busiestOn = (p, cache, d) => p.chats.reduce((best, r) => ((cache.get(r)?.days?.[d] || 0) > (cache.get(best)?.days?.[d] || 0) ? r : best), p.chats[0]);

  // The moments of all of someone's chats, each a link to its day.
  function moments(p, cache, t, paths) {
    const at = (d, text) => { const r = busiestOn(p, cache, d); return dayLink(paths, r, cache.get(r), d, text); };
    const out = [];
    const chats = p.chats.map((r) => [r, cache.get(r)]).filter(([, a]) => a);
    const firsts = chats.filter(([, a]) => a.first).sort(([, x], [, y]) => (x.first.d < y.first.d ? -1 : 1));
    if (firsts.length) { const [r, a] = firsts[0]; out.push(`- **First message**: ${dayLink(paths, r, a, a.first.d)}, from ${a.first.me ? 'you' : 'them'}`); }
    const ds = Object.keys(t.days).sort();
    if (ds.length > 1) {
      const busiest = ds.reduce((x, y) => (t.days[y] > t.days[x] ? y : x));
      out.push(`- **Busiest day**: ${at(busiest)}, ${nf(t.days[busiest])} messages`);
    }
    const longest = chats.filter(([, a]) => a.longest).sort(([, x], [, y]) => y.longest.n - x.longest.n)[0];
    if (longest && longest[1].longest.n >= 10) out.push(`- **Longest conversation**: ${dayLink(paths, longest[0], longest[1], longest[1].longest.d)}, ${nf(longest[1].longest.n)} messages without a break of six hours`);
    let run = [ds[0], ds[0]];
    let best = run;
    let gap = null;
    for (let i = 1; i < ds.length; i++) {
      const g = dayNum(ds[i]) - dayNum(ds[i - 1]);
      if (g === 1) run = [run[0], ds[i]]; else run = [ds[i], ds[i]];
      if (dayNum(run[1]) - dayNum(run[0]) > dayNum(best[1]) - dayNum(best[0])) best = run;
      if (!gap || g > gap.g) gap = { g, d: ds[i] };
    }
    const streak = ds.length ? dayNum(best[1]) - dayNum(best[0]) + 1 : 0;
    if (streak >= 3) out.push(`- **Longest streak**: ${streak} days in a row, ${at(best[0])} to ${at(best[1])}`);
    if (gap && gap.g >= 30) out.push(`- **Longest silence**: ${lasted(gap.g)}, until ${at(gap.d)}`);
    if (ds.length > 1) out.push(`- **Most recent**: ${at(ds[ds.length - 1])}`);
    return out;
  }

  // What someone's chats know from their contact: the phone's contact
  // (`card`, from a phone backup: nickname, work, birthday, labels,
  // relations…), their photo, and whether they're starred. The busiest
  // chat's first.
  function contactOf(p) {
    // The address book's entry first (contacts.json), then the chats' cards.
    const { name: _n, starred: bookStar, ...card } = p.contact || {};
    let photo = null;
    let starred = !!bookStar;
    for (const r of p.chats) {
      const c = (r.contact?.people || []).find((x) => (x.n ?? x.name) !== 'Me');
      if (!c) continue;
      if (c.fav || c.favorite) starred = true;
      if (!photo && c.photo && !String(c.photo).startsWith('data:') && !/[[\]#^|]/.test(c.photo)) photo = c.photo;
      for (const [k, v] of Object.entries(c.card || {})) {
        if (Array.isArray(v)) card[k] = [...(card[k] || []), ...v];
        else if (card[k] == null) card[k] = v;
      }
    }
    for (const k of ['numbers', 'emails', 'labels']) if (card[k]) card[k] = [...new Set(card[k])];
    if (card.relations) card.relations = [...new Map(card.relations.map((x) => [`${x.type}|${x.name}`, x])).values()];
    return { card, photo, starred };
  }
  // "1990-05-04" or, without the year, "--05-04".
  function birthday(b) {
    const m = String(b || '').match(/^(?:(\d{4})|-)-(\d\d)-(\d\d)/);
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return { md: `${m[2]}-${m[3]}`, year: m[1] || null, text: `${+m[3]} ${MONTHS[+m[2] - 1]}${m[1] ? ` ${m[1]}` : ''}` };
  }
  const mdText = (md) => `${+md.slice(3, 5)} ${MONTHS[+md.slice(0, 2) - 1]}`;
  // The birthdays you were in touch on, out of those since you first were.
  function birthdays(p, cache, t, paths, b) {
    const ds = Object.keys(t.days).sort();
    if (!b || !ds.length) return null;
    const years = [];
    for (let y = +ds[0].slice(0, 4); y <= +ds[ds.length - 1].slice(0, 4); y++) if (`${y}-${b.md}` >= ds[0] && `${y}-${b.md}` <= ds[ds.length - 1]) years.push(y);
    const on = years.map((y) => `${y}-${b.md}`).filter((d) => t.days[d]);
    if (!years.length) return null;
    const d = on[on.length - 1];
    const r = d ? busiestOn(p, cache, d) : null;
    return `- **Birthdays**: you were in touch on ${nf(on.length)} of their ${many(years.length, 'birthday')} since you first were${d ? `, most recently ${dayLink(paths, r, cache.get(r), d)}` : ''}`;
  }

  const subPath = (paths, p, kind) => { const own = paths.person.get(p).replace(/\.md$/, ''); return `${own}/${own.split('/').pop()} ${kind}.md`; };
  const personLink = (paths, q) => link(paths.person.get(q), q.name);
  const chatName = (X, r) => { const p = X.P.byChat.get(L().chatKey(r)); return p ? p.name : L().formatNumber(r.title); };
  const chatLink = (X, r) => { const p = X.P.byChat.get(L().chatKey(r)); return p ? personLink(X.paths, p) : link(X.paths.chat.get(r), L().formatNumber(r.title)); };

  // What happened, in words: "You wished [[Sam]] happy birthday". `them`:
  // on that person's own notes, "them" instead of their name.
  function eventText(e, X, them = false) {
    const W = e.person ? (them ? 'them' : personLink(X.paths, e.person)) : null;
    const G = link(X.paths.chat.get(e.row), L().formatNumber(e.row.title));
    const withW = them ? '' : ` with ${W}`;
    if (e.all?.length > 1) {
      if (e.kind === 'bday') return `${names(e.all.map((x) => personLink(X.paths, x.person)))} wished you happy birthday`;
      if (e.kind === 'holiday') return `${e.hint} wishes with ${names(e.all.map((x) => chatLink(X, x.row)))}`;
    }
    switch (e.kind) {
      case 'bday':
        if (!W) {
          const whose = e.for ? (them ? 'them' : personLink(X.paths, e.for)) : e.hint && e.hint !== 'belated' ? inline(e.hint) : '';
          return `Birthday wishes${whose ? ` for ${whose}` : ''} in ${G}`;
        }
        return `${e.me ? `You wished ${W} happy birthday` : `${them ? 'They' : W} wished you happy birthday`}${e.hint === 'belated' ? ' (belated)' : ''}`;
      case 'anniv': return W ? `Happy anniversary${withW}` : `Anniversary wishes in ${G}`;
      case 'congrats': return `${W ? (e.me ? `You congratulated ${W}` : `${them ? 'They' : W} congratulated you`) : `Congratulations in ${G}`}${e.hint ? ` (${e.hint}?)` : ''}`;
      case 'holiday': return `${e.hint} wishes${W ? withW : ` in ${G}`}`;
      case 'trip': return `Travel talk${W ? withW : ` in ${G}`}${e.hint ? ` · ${inline(e.hint)}` : ''}`;
      case 'meet': return `Probably met up${W ? withW : ` with ${G}`}`;
      case 'photos': return `${many(e.n, 'photo or video', 'photos and videos')}${W ? withW : ` in ${G}`}`;
      default: return '';
    }
  }
  // "A, B and C", or "A, B, C and 4 more".
  const names = (list) => (list.length <= 6 ? list.slice(0, -1).join(', ') + (list.length > 1 ? ' and ' : '') + list[list.length - 1] : `${list.slice(0, 5).join(', ')} and ${nf(list.length - 5)} more`);
  // Events on one day that say the same thing, as one: three people wishing
  // you happy birthday, Christmas wishes in five chats.
  function gather(list) {
    const out = [];
    const at = new Map();
    for (const e of list) {
      const key = e.kind === 'bday' && e.person && !e.me ? `${e.d}|you` : e.kind === 'holiday' ? `${e.d}|${e.hint}` : null;
      const g = key && at.get(key);
      if (g) { g.all.push(e); continue; }
      const item = key ? { ...e, all: [e] } : e;
      if (key) at.set(key, item);
      out.push(item);
    }
    return out;
  }
  // An event as a line: its day (a link to it in the messages), and what.
  const eventLine = (e, X, { them = false, date = dateText } = {}) => `${dayLink(X.paths, e.row, X.cache.get(e.row), e.d, date(e.d))} · ${emojiOf(e.kind, e.hint)} ${eventText(e, X, them)}`;

  function personMd(p, t, X, subs) {
    const { P, paths, cache, T, M, C, R } = X;
    const oneWay = X.oneWay.has(p);
    const { card, photo, starred } = X.K.get(p);
    const bday = X.B.get(p) || null;
    const rel = (card.relations || []).map((x) => ({ ...x, q: R.get(L().nameKey(x.name)) })).map((x) => ({ ...x, q: x.q === p ? null : x.q }));
    const numbers = p.ids.filter((i) => i.startsWith('tel:')).map((i) => L().formatNumber(i.slice(4)));
    const emails = p.ids.filter((i) => i.startsWith('email:')).map((i) => i.slice(6));
    const handles = p.ids.filter((i) => !/^(tel|email|contact):/.test(i)).map((i) => `${L().serviceLabel(i.slice(0, i.indexOf(':')))} ${i.slice(i.indexOf(':') + 1)}`);
    const aliases = [...new Set([...p.names, ...(card.nickname ? [card.nickname] : []), ...numbers, ...emails])].filter((a) => a !== p.name);
    const n = t.sent + t.recv;
    const doc = X.docOf.get(p);
    const mine = (doc && T.of.get(doc)) || [];
    const topicLink = (x) => (T.nodes.has(x.w) ? link(X.topicNotes.get(x.w), x.w) : inline(x.w));
    const out = ['---', 'type: person'];
    if (aliases.length) out.push(`aliases: ${yaml(aliases)}`);
    if (numbers.length) out.push(`numbers: ${yaml(numbers)}`);
    if (emails.length) out.push(`emails: ${yaml(emails)}`);
    if (handles.length) out.push(`handles: ${yaml(handles)}`);
    out.push(`sources: ${yaml(p.services.map((s) => L().serviceLabel(s)))}`, `messages: ${p.count}`);
    if (starred) out.push('starred: true');
    if (card.nickname) out.push(`nickname: ${yaml(card.nickname)}`);
    if (card.organization) out.push(`organization: ${yaml(card.organization)}`);
    if (card.job_title) out.push(`job_title: ${yaml(card.job_title)}`);
    if (bday) out.push(`birthday: ${yaml(card.birthday || `--${bday.md}`)}`);
    if (card.labels?.length) out.push(`labels: ${yaml(card.labels.map((l) => link(X.labelNotes.get(l), l)))}`);
    if (oneWay) out.push('one_way: true');
    const tags = [...(oneWay ? ['one-way'] : []), ...(card.labels || []).map((l) => `label/${tagOf(l)}`).filter((x) => x !== 'label/')];
    if (tags.length) out.push(`tags: ${yaml(tags)}`);
    if (n) out.push(`sent: ${t.sent}`, `received: ${t.recv}`);
    if (t.talks) out.push(`conversations: ${t.talks}`, `they_start: ${pct(t.starts[0], t.talks)}`);
    if (p.first) out.push(`first: ${day(p.first)}`, `last: ${day(p.last)}`);
    const tlinks = mine.filter((x) => T.nodes.has(x.w)).map((x) => link(X.topicNotes.get(x.w), x.w));
    if (tlinks.length) out.push(`topics: ${yaml(tlinks)}`);
    const linked = [...new Set([...rel.filter((x) => x.q), ...(M.out.get(p) || []), ...(M.into.get(p) || []), ...(C.get(p) || [])].map((x) => x.q))];
    if (linked.length) out.push(`connections: ${yaml(linked.slice(0, 30).map((q) => personLink(paths, q)))}`);
    out.push('---', `# ${inline(p.name)}`, '');
    if (photo) out.push(`![[${photo}|120]]`, '');
    // Who they are, from your contacts.
    const who = [
      starred && '⭐ Starred',
      card.nickname && `“${inline(card.nickname)}”`,
      (card.job_title || card.organization) && [card.job_title && inline(card.job_title), card.organization && inline(card.organization)].filter(Boolean).join(' at '),
      bday && `Birthday ${bday.how === 'contacts' ? '' : `${bday.how} `}${bday.text}`,
      card.labels?.length && card.labels.map((l) => link(X.labelNotes.get(l), l)).join(', '),
    ].filter(Boolean);
    if (who.length) out.push(who.join(' · '), '');

    // The gist, in a callout.
    const gist = [`${nf(p.count)} messages, ${span(p.first, p.last)}.`];
    if (oneWay) gist.push('You\'ve never written to them: most likely codes, alerts, a business or spam.');
    else if (n) gist.push(`You sent ${pct(t.sent, n)}% of them.`);
    const mineR = usually(t.reply[1]);
    const theirsR = usually(t.reply[0]);
    if (mineR || theirsR) gist.push([mineR && `You usually reply ${mineR}`, theirsR && `${mineR ? 'they' : 'They usually'} reply ${theirsR}`].filter(Boolean).join('; ') + '.');
    if (t.talks >= 5) gist.push(`They start ${pct(t.starts[0], t.talks)}% of your ${nf(t.talks)} conversations.`);
    out.push('> [!summary]', `> ${gist.join(' ')}`);
    const words = mine.filter((x) => !x.w.includes(' '));
    const phrases = mine.filter((x) => x.w.includes(' '));
    if (words.length) out.push('>', `> **Talks about** ${words.map(topicLink).join(', ')}`);
    if (phrases.length) out.push('>', `> **Phrases** ${phrases.map(topicLink).join(', ')}`);
    out.push('', '## Chats');
    for (const r of p.chats) out.push(`- ${link(paths.chat.get(r), `${paths.source(r)}${p.chats.filter((x) => paths.source(x) === paths.source(r)).length > 1 ? `: ${L().formatNumber(r.title)}` : ''}`)}: ${nf(r.count)} messages, ${span(r.first, r.last)}`);

    const ms = moments(p, cache, t, paths);
    const bd = birthdays(p, cache, t, paths, bday);
    if (bd) ms.push(bd);
    if (subs.timeline) ms.push(`- **Everything, year by year**: ${link(subs.timeline, `${p.name} timeline`)}`);
    if (ms.length) out.push('', '## Moments', ...ms);

    // What happened between you, found in the messages.
    const evs = X.byPerson.get(p) || [];
    const kind = (k) => evs.filter((e) => e.kind === k);
    const ev = [];
    if (bday && bday.how !== 'contacts') ev.push(`- **Birthday**: ${bday.how} ${bday.text} (birthday wishes in ${bday.years.join(', ')})`);
    const met = kind('meet');
    const latest = met[met.length - 1];
    if (met.length) ev.push(`- **Met up**: about ${many(met.length, 'time')}, going by “on my way”, “I'm outside” and the like; most recently ${dayLink(paths, latest.row, cache.get(latest.row), latest.d)}`);
    const ml = [...kind('congrats'), ...kind('anniv')].sort((x, y) => (x.d < y.d ? 1 : -1)).slice(0, 6);
    if (ml.length) ev.push(`- **Milestones**: ${ml.map((e) => `${dayLink(paths, e.row, cache.get(e.row), e.d)} (${e.kind === 'anniv' ? 'anniversary' : e.hint || 'congratulations'})`).join(', ')}`);
    const trips = kind('trip').slice(-6).reverse();
    if (trips.length) ev.push(`- **Travel**: ${trips.map((e) => `${dayLink(paths, e.row, cache.get(e.row), e.d)}${e.hint ? ` (${inline(e.hint)})` : ''}`).join(', ')}`);
    const pd = kind('photos').sort((x, y) => y.n - x.n).slice(0, 6);
    if (pd.length) ev.push(`- **Photo days**: ${pd.map((e) => `${dayLink(paths, e.row, cache.get(e.row), e.d)} (${nf(e.n)})`).join(', ')}`);
    const hol = new Map();
    for (const e of kind('holiday')) { if (!hol.has(e.hint)) hol.set(e.hint, new Set()); hol.get(e.hint).add(e.d.slice(0, 4)); }
    if (hol.size) ev.push(`- **Holidays**: ${[...hol].map(([h, ys]) => `${h} (${[...ys].sort().join(', ')})`).join(', ')}`);
    if (ev.length) out.push('', '## Events', ...ev);

    const years = Object.keys(t.years).sort();
    if (years.length) {
      const max = Math.max(...years.map((y) => t.years[y][0] + t.years[y][1]));
      const about = byYear(new Map(Object.entries(t.yterms).map(([y, m]) => [y, new Map(Object.entries(m))])), X.named, 3, 2);
      out.push('', '## Over the years', '', '| Year | Messages | From you | Talked about | |', '| --- | ---: | ---: | --- | --- |');
      for (const y of years.slice().reverse()) {
        const [s, rcv] = t.years[y];
        // The busiest chat that year, at its first note of the year.
        const r = p.chats.reduce((b, x) => { const v = cache.get(x)?.years?.[y]; const w = cache.get(b)?.years?.[y]; return (v ? v[0] + v[1] : 0) > (w ? w[0] + w[1] : 0) ? x : b; }, p.chats[0]);
        const a = cache.get(r);
        const key = !a?.periods ? null : a.periods.includes(y) ? y : a.periods.find((k) => k.startsWith(`${y}-`));
        const where = !a ? y : !a.periods ? link(paths.chat.get(r), y) : key ? link(paths.period(r, key), y) : y;
        out.push(cell(`| ${where} | ${nf(s + rcv)} | ${pct(s, s + rcv)}% | ${(about.get(y) || []).map(topicLink).join(', ')} | ${bar(s + rcv, max)} |`));
      }
    }

    if (t.hours.some(Boolean) || t.week.some(Boolean)) {
      const when = [];
      const part = partOfDay(t.hours);
      if (part) when.push(`Mostly ${part}`);
      if (t.week.some(Boolean)) when.push(`busiest on ${WEEKDAYS[t.week.indexOf(Math.max(...t.week))]}s`);
      out.push('', '## When you talk', when.join(', ').replace(/^b/, 'B') + '.');
      if (t.hours.some(Boolean)) out.push('', `\`${spark(t.hours)}\` midnight to 11 pm`);
      if (t.week.some(Boolean)) out.push('', `\`${spark([...t.week.slice(1), t.week[0]])}\` Monday to Sunday`);
    }

    const said = M.out.get(p) || [];
    const by = M.into.get(p) || [];
    const groupsWith = C.get(p) || [];
    if (rel.length || said.length || by.length || groupsWith.length) {
      out.push('', '## Connections');
      if (rel.length) out.push(`- **In your contacts**: ${rel.map((x) => `${inline(x.type)}: ${x.q ? personLink(paths, x.q) : inline(x.name)}`).join(', ')}`);
      if (said.length) out.push(`- **Named in your chats**: ${said.slice(0, 12).map((x) => `${personLink(paths, x.q)} (${nf(x.n)})`).join(', ')}`);
      if (by.length) out.push(`- **Named in chats with**: ${by.slice(0, 12).map((x) => `${personLink(paths, x.q)} (${nf(x.n)})`).join(', ')}`);
      if (groupsWith.length) out.push(`- **In groups with**: ${groupsWith.slice(0, 15).map((x) => `${personLink(paths, x.q)} (${many(x.n, 'group')})`).join(', ')}`);
    }

    const em = t.emoji.map((e) => Object.entries(e).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k]) => k).join(' '));
    const shared = [];
    const media = mediaText(t.kinds) || many(t.media, 'file');
    if (subs.photos) shared.push(link(subs.photos, media));
    else if (t.media) shared.push(media);
    if (subs.links) shared.push(link(subs.links, many(subs.linkCount, 'link')));
    if (t.calls) shared.push(many(t.calls, 'call'));
    if (shared.length || em[0] || em[1]) {
      out.push('', '## Shared');
      if (shared.length) out.push(`- ${shared.join(' · ')}`);
      if (em[1]) out.push(`- **Your emoji**: ${em[1]}`);
      if (em[0]) out.push(`- **Their emoji**: ${em[0]}`);
    }

    const groups = P.groupsOf(p);
    if (groups.length) {
      out.push('', '## Groups');
      for (const g of groups) out.push(`- ${link(paths.chat.get(g), L().formatNumber(g.title))} (${inline(paths.source(g))}, ${nf(g.count)} messages)`);
    }
    out.push('', MARK, '');
    return out.join('\n');
  }

  // Everything notable with someone, for their timeline: the first message,
  // what happened (events, photo days), coming back after a long silence,
  // and each year's busiest day.
  function timelineItems(p, t, X) {
    const items = [];
    const chats = p.chats.map((r) => [r, X.cache.get(r)]).filter(([, a]) => a?.first).sort(([, x], [, y]) => (x.first.d < y.first.d ? -1 : 1));
    if (chats.length) { const [r, a] = chats[0]; items.push({ d: a.first.d, row: r, text: `👋 First message, from ${a.first.me ? 'you' : 'them'}` }); }
    for (const e of X.byPerson.get(p) || []) items.push({ d: e.d, row: e.row, text: `${emojiOf(e.kind, e.hint)} ${eventText(e, X, true)}` });
    const ds = Object.keys(t.days).sort();
    for (let i = 1; i < ds.length; i++) {
      const g = dayNum(ds[i]) - dayNum(ds[i - 1]);
      if (g >= 60) items.push({ d: ds[i], row: busiestOn(p, X.cache, ds[i]), text: `🔁 Back in touch after ${lasted(g)}` });
    }
    const peak = new Map();
    for (const d of ds) { const y = d.slice(0, 4); if (!peak.has(y) || t.days[d] > t.days[peak.get(y)]) peak.set(y, d); }
    for (const d of peak.values()) if (t.days[d] >= 20) items.push({ d, row: busiestOn(p, X.cache, d), text: `🔥 Busiest day of the year: ${nf(t.days[d])} messages` });
    return items.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  }
  function timelineMd(p, items, X) {
    const out = ['---', 'type: timeline', `person: ${yaml(personLink(X.paths, p))}`, '---', `# ${inline(p.name)} · timeline`, '',
      `Back to ${personLink(X.paths, p)}. Newest year first; each date is a link to that day in the messages.`];
    const years = new Map();
    for (const x of items) { const y = x.d.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(x); }
    for (const [y, list] of [...years].reverse()) {
      out.push('', `## ${link(X.paths.year(y), y)}`);
      for (const x of list) out.push(`- ${dayLink(X.paths, x.row, X.cache.get(x.row), x.d, shortDate(x.d))} · ${x.text}`);
    }
    out.push('');
    return out.join('\n');
  }

  // Everything sent in someone's chats that a note can show, newest first,
  // under the day it was sent.
  const SHOW = 400;
  function photosMd({ p, paths, cache, self }) {
    const all = p.chats.flatMap((r) => (cache.get(r)?.files || []).map(([file, dn]) => ({ r, file, d: numDay(dn) }))).sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : 0));
    const out = ['---', 'type: media', `person: ${yaml(personLink(paths, p))}`, `files: ${all.length}`, '---', `# ${inline(p.name)} · photos and videos`, '',
      `Back to ${personLink(paths, p)}. Newest first${all.length > SHOW ? `: the latest ${nf(SHOW)}; the rest are in the chats` : ''}.`];
    let today = null;
    for (const x of all.slice(0, SHOW)) {
      if (x.d !== today) { today = x.d; out.push('', `### ${dayLink(paths, x.r, cache.get(x.r), x.d, x.d ? dateText(x.d) : 'Undated')}`); }
      out.push(mediaMd({ file: x.file }, x.r, self));
    }
    out.push('');
    return out.join('\n');
  }
  function linksMd({ p, paths, cache }) {
    const all = p.chats.flatMap((r) => (cache.get(r)?.links || []).map(([u, d]) => ({ r, u, d })));
    const sites = new Map();
    for (const x of all) { let h = '?'; try { h = new URL(x.u).hostname.replace(/^www\./, ''); } catch { /* not a web address after all */ } if (!sites.has(h)) sites.set(h, []); sites.get(h).push(x); }
    const out = ['---', 'type: links', `person: ${yaml(personLink(paths, p))}`, `links: ${all.length}`, '---', `# ${inline(p.name)} · links`, '', `Back to ${personLink(paths, p)}. By site, the most shared first.`];
    let shown = 0;
    for (const [h, list] of [...sites].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))) {
      if (shown >= SHOW) break;
      out.push('', `## ${inline(h)} (${nf(list.length)})`);
      for (const x of list.sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, SHOW - shown)) { out.push(`- ${x.u} · ${dayLink(paths, x.r, cache.get(x.r), x.d)}`); shown++; }
    }
    out.push('');
    return out.join('\n');
  }

  function labelMd({ l, list, paths }) {
    return ['---', 'type: label', `people: ${yaml(list.map((q) => personLink(paths, q)))}`, '---', `# ${inline(l)}`, '',
      `A label in your phone's contacts: ${many(list.length, 'person', 'people')}. Back to ${link(paths.labels, 'Labels')}.`, '',
      ...list.map((q) => `- ${personLink(paths, q)}`), ''].join('\n');
  }

  // A topic: who talks about it (and in which groups), how often, when it
  // first and last came up and the day it came up most, and the topics the
  // same people share.
  function topicMd(w, list, X, related) {
    const total = list.reduce((s, x) => s + x.n, 0);
    const people = list.filter((x) => x.d.kind === 'person');
    const groups = list.filter((x) => x.d.kind === 'group');
    const firsts = list.map((x) => x.t[1]).filter(Boolean);
    const first = firsts.length ? numDay(Math.min(...firsts)) : '';
    const last = numDay(Math.max(...list.map((x) => x.t[2])));
    const who = (x) => (x.d.kind === 'person' ? personLink(X.paths, x.d.id) : `${link(X.paths.chat.get(x.d.id), L().formatNumber(x.d.id.title))} (group)`);
    const at = (x, dn, text) => {
      const d = numDay(dn);
      if (!d) return '';
      const r = x.d.kind === 'person' ? busiestOn(x.d.id, X.cache, d) : x.d.id;
      return dayLink(X.paths, r, X.cache.get(r), d, text);
    };
    const out = ['---', 'type: topic'];
    if (people.length) out.push(`people: ${yaml(people.map((x) => personLink(X.paths, x.d.id)))}`);
    if (groups.length) out.push(`chats: ${yaml(groups.map((x) => link(X.paths.chat.get(x.d.id), L().formatNumber(x.d.id.title))))}`);
    out.push(`mentions: ${total}`);
    if (first) out.push(`first: ${first}`, `last: ${last}`);
    out.push('---', `# ${inline(w)}`, '',
      `${w.includes(' ') ? 'A phrase' : 'A word'} that stands out in your chats with ${[people.length && many(people.length, 'person', 'people'), groups.length && many(groups.length, 'group')].filter(Boolean).join(' and ')}: ${many(total, 'time')}${first ? `, from ${dateText(first)} to ${dateText(last)}` : ''}. Back to ${link(X.paths.topics, 'Topics')}.`,
      '', '| | Times | First | Last | Most in a day |', '| --- | ---: | --- | --- | --- |',
      ...list.slice().sort((a, b) => b.n - a.n).map((x) => cell(`| ${who(x)} | ${nf(x.n)} | ${at(x, x.t[1], x.t[1] ? dateText(numDay(x.t[1])) : '')} | ${at(x, x.t[2], x.t[2] ? dateText(numDay(x.t[2])) : '')} | ${x.t[4] > 1 ? `${at(x, x.t[3], dateText(numDay(x.t[3])))} (${nf(x.t[4])})` : ''} |`)));
    if (related.length) out.push('', '## Related topics', related.map((v) => link(X.topicNotes.get(v), v)).join(' · '));
    out.push('', MARK, '');
    return out.join('\n');
  }

  // ---------- the calendar ----------
  // A note a year and a note a month, from every chat but one-way senders':
  // each day with who you talked to (a link to that day in each chat), its
  // photos and what happened.
  function calendarMds(X) {
    const { D, E, paths, cache } = X;
    const notes = new Map();
    const months = new Map();
    for (const d of [...D.keys()].sort()) { const m = d.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(d); }
    const years = new Map();
    for (const m of months.keys()) { const y = m.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(m); }
    const evMonth = new Map();
    for (const e of E) { const m = e.d.slice(0, 7); if (!evMonth.has(m)) evMonth.set(m, []); evMonth.get(m).push(e); }
    const evDay = new Map();
    for (const e of E) { if (!evDay.has(e.d)) evDay.set(e.d, []); evDay.get(e.d).push(e); }
    // Who and how much over some days: messages, people, groups, photos, and the chats most talked in.
    const sum = (ds) => {
      const by = new Map();
      let total = 0;
      let media = 0;
      for (const d of ds) { const x = D.get(d); total += x.total; media += x.media; for (const [r, n] of x.chats) bump(by, r, n); }
      const chats = [...by].sort((a, b) => b[1] - a[1]);
      const people = chats.filter(([r]) => X.P.byChat.has(L().chatKey(r))).map(([r]) => X.P.byChat.get(L().chatKey(r)));
      return { total, media, chats, people: new Set(people), groups: chats.filter(([r]) => L().isGroupChat(r)).length };
    };
    const whoText = (s) => [s.people.size && many(s.people.size, 'person', 'people'), s.groups && many(s.groups, 'group')].filter(Boolean).join(' and ');
    const allMonths = [...months.keys()];
    const allYears = [...years.keys()];
    const rows = [];
    for (const [y, ms] of years) {
      const ys = sum(ms.flatMap((m) => months.get(m)));
      rows.push([y, ys]);
      const i = allYears.indexOf(y);
      const nav = [i > 0 && `← ${link(paths.year(allYears[i - 1]), allYears[i - 1])}`, link(paths.calendar, 'Calendar'), i < allYears.length - 1 && `${link(paths.year(allYears[i + 1]), allYears[i + 1])} →`].filter(Boolean).join(' · ');
      const mrows = ms.map((m) => [m, sum(months.get(m))]);
      const maxM = Math.max(...mrows.map(([, s]) => s.total));
      const busiestM = mrows.reduce((b, x) => (x[1].total > b[1].total ? x : b));
      const out = ['---', 'type: year', `year: ${y}`, `messages: ${ys.total}`, `people: ${ys.people.size}`, `photos: ${ys.media}`, '---', `# ${y}`, '', nav, '',
        `${nf(ys.total)} messages with ${whoText(ys) || 'no one'}${ys.media ? `; ${many(ys.media, 'photo or video', 'photos and videos')}${X.photoYears.has(y) ? ` (${link(X.photoNoteOfYear(y), 'see them')})` : ''}` : ''}. Busiest month: ${link(paths.month(busiestM[0]), MONTHS[+busiestM[0].slice(5, 7) - 1])}.`,
        '', '## Months', '', '| Month | Messages | People | Photos | |', '| --- | ---: | ---: | ---: | --- |',
        ...mrows.map(([m, s]) => cell(`| ${link(paths.month(m), MONTHS[+m.slice(5, 7) - 1])} | ${nf(s.total)} | ${nf(s.people.size)} | ${nf(s.media)} | ${bar(s.total, maxM)} |`))];
      const ppl = [...ys.people].map((p) => [p, ys.chats.filter(([r]) => X.P.byChat.get(L().chatKey(r)) === p).reduce((t, [, n]) => t + n, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (ppl.length) out.push('', '## People of the year', ...ppl.map(([p, c]) => `- ${personLink(paths, p)}: ${nf(c)} (${pct(c, ys.total)}%)`));
      const fresh = [...ys.people].filter((p) => p.first && p.first.slice(0, 4) === y && p.count >= 20).sort((a, b) => (a.first < b.first ? -1 : 1));
      if (fresh.length) out.push('', '## New this year', ...fresh.map((p) => `- ${personLink(paths, p)}, from ${dateText(day(p.first))}`));
      const grs = ys.chats.filter(([r]) => L().isGroupChat(r)).slice(0, 6);
      if (grs.length) out.push('', '## Groups', ...grs.map(([r, c]) => `- ${link(paths.chat.get(r), L().formatNumber(r.title))}: ${nf(c)}`));
      const tops = X.yearTopics.get(y) || [];
      if (tops.length) out.push('', '## Talked about', tops.map((x) => (X.T.nodes.has(x.w) ? link(X.topicNotes.get(x.w), x.w) : inline(x.w))).join(', '));
      const yev = ms.flatMap((m) => evMonth.get(m) || []);
      const big = gather(yev.filter((e) => e.kind !== 'meet' && (e.kind !== 'photos' || e.n >= 10)));
      if (yev.length) {
        out.push('', '## Events');
        const met = yev.filter((e) => e.kind === 'meet');
        if (met.length) {
          const most = new Map();
          for (const e of met) bump(most, e.row);
          out.push(`- 🤝 Probably met up about ${many(met.length, 'time')}, most with ${[...most].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, c]) => `${chatLink(X, r)} (${nf(c)})`).join(', ')}`);
        }
        for (const e of big.slice(0, 80)) out.push(`- ${eventLine(e, X, { date: shortDate })}`);
        if (big.length > 80) out.push(`- …and ${nf(big.length - 80)} more in the months`);
      }
      const busy = ms.flatMap((m) => months.get(m)).sort((a, b) => D.get(b).total - D.get(a).total).slice(0, 5);
      if (busy.length) out.push('', '## Busiest days', ...busy.map((d) => `- ${linkTo(paths.month(d.slice(0, 7)), dayHeading(d), dateText(d))}: ${nf(D.get(d).total)} messages, most with ${chatLink(X, D.get(d).chats.slice().sort((a, b) => b[1] - a[1])[0][0])}`));
      out.push('', MARK, '');
      notes.set(paths.year(y), [out.join('\n'), true]);
    }
    for (const [m, ds] of months) {
      const s = sum(ds);
      const i = allMonths.indexOf(m);
      const nav = [i > 0 && `← ${link(paths.month(allMonths[i - 1]), periodName(allMonths[i - 1]))}`, link(paths.year(m.slice(0, 4)), m.slice(0, 4)), i < allMonths.length - 1 && `${link(paths.month(allMonths[i + 1]), periodName(allMonths[i + 1]))} →`].filter(Boolean).join(' · ');
      const out = ['---', 'type: month', `month: ${m}`, `messages: ${s.total}`, `photos: ${s.media}`];
      if (s.people.size) out.push(`people: ${yaml([...s.people].slice(0, 20).map((p) => personLink(paths, p)))}`);
      out.push('---', `# ${periodName(m)}`, '', nav, '',
        `${nf(s.total)} messages with ${whoText(s) || 'no one'}${s.media ? `; ${many(s.media, 'photo or video', 'photos and videos')}` : ''}. Most with ${s.chats.slice(0, 5).map(([r, c]) => `${chatLink(X, r)} (${nf(c)})`).join(', ')}.`);
      const evs = evMonth.get(m) || [];
      if (evs.length) out.push('', '## Events', ...gather(evs).map((e) => `- ${eventLine(e, X, { date: shortDate })}`));
      for (const d of ds) {
        const x = D.get(d);
        const chats = x.chats.slice().sort((a, b) => b[1] - a[1]);
        const parts = chats.slice(0, 10).map(([r, c]) => `${dayLink(paths, r, cache.get(r), d, chatName(X, r))} ${nf(c)}`);
        if (chats.length > 10) parts.push(`and ${many(chats.length - 10, 'more chat', 'more chats')}`);
        if (x.media && X.photoNote(d)) parts.push(`📷 ${linkTo(X.photoNote(d), dayHeading(d), nf(x.media))}`);
        const marks = [...new Set((evDay.get(d) || []).map((e) => emojiOf(e.kind, e.hint)))].join('');
        out.push('', `## ${dayHeading(d)}`, `${parts.join(' · ')}${marks ? ` · ${marks}` : ''}`);
      }
      out.push('', MARK, '');
      notes.set(paths.month(m), [out.join('\n'), true]);
    }
    if (rows.length) {
      const max = Math.max(...rows.map(([, s]) => s.total));
      notes.set(paths.calendar, [['---', 'type: calendar', '---', '# Calendar', '',
        `Every year of your messages (but not those of senders you've never written to). Each year has its months, people, topics and events; each month has every day, with a link to that day in each chat. Back to ${link(paths.home, 'Message Archivist')}.`, '',
        '| Year | Messages | People | Photos | |', '| --- | ---: | ---: | ---: | --- |',
        ...rows.slice().reverse().map(([y, s]) => cell(`| ${link(paths.year(y), y)} | ${nf(s.total)} | ${nf(s.people.size)} | ${nf(s.media)} | ${bar(s.total, max)} |`)), ''].join('\n'), false]);
    }
    return notes;
  }

  // ---------- events ----------
  // Every event in one note: your birthday and everyone's (a calendar of
  // them), milestones, travel, photo days, holidays and who you meet up with.
  function eventsMd(X) {
    const { E, B, paths, cache } = X;
    const out = ['---', 'type: events', '---', '# Events', '',
      `Found in your messages, so read them as likely rather than certain: birthday and anniversary wishes, congratulations (and, from the words that day, perhaps what for), holiday greetings, travel, meeting up and days of many photos. The phrases looked for are mostly English. Each date is a link to that day in the messages; the ${link(paths.calendar, 'Calendar')} has every day.`];
    if (X.mine) out.push('', '## Your birthday', `Probably ${mdText(X.mine.md)}, going by who wished you happy birthday on it: ${X.mine.years.map(([y, n], i) => `${i ? nf(n) : many(n, 'person', 'people')} in ${y}`).join(', ')}.`);
    if (B.size) {
      out.push('', '## Birthdays', 'From your contacts, or from the days someone was wished happy birthday (by you, or by name in a group): *probably* when it was the same day in two years or more, *maybe* when once.');
      const by = new Map();
      for (const [p, b] of B) { if (!by.has(b.md)) by.set(b.md, []); by.get(b.md).push([p, b]); }
      let month = null;
      for (const md of [...by.keys()].sort()) {
        if (md.slice(0, 2) !== month) { month = md.slice(0, 2); out.push('', `### ${MONTHS[+month - 1]}`); }
        out.push(`- **${mdText(md)}**: ${by.get(md).map(([p, b]) => `${personLink(paths, p)}${b.how === 'contacts' ? '' : ` *(${b.how})*`}`).join(', ')}`);
      }
    }
    const newest = (list, n) => list.slice().reverse().slice(0, n);
    const section = (title, list, n, note) => {
      if (!list.length) return;
      out.push('', `## ${title}`, ...(note ? [note] : []), ...newest(list, n).map((e) => `- ${eventLine(e, X)}`));
      if (list.length > n) out.push(`- …and ${nf(list.length - n)} more in the ${link(paths.calendar, 'calendar')}`);
    };
    section('Milestones', E.filter((e) => e.kind === 'congrats' || e.kind === 'anniv'), 150, 'Congratulations and anniversaries, newest first; what for is a guess from the words that day.');
    section('Travel', E.filter((e) => e.kind === 'trip'), 150, 'Days of “just landed”, “safe travels”, “boarding now” and the like, with a place when one was named.');
    const pdays = E.filter((e) => e.kind === 'photos' && e.n >= 10);
    if (pdays.length) {
      out.push('', '## Photo days', 'Days with ten photos or videos or more in a chat, newest first.');
      for (const e of newest(pdays, 100)) out.push(`- ${X.photoNote(e.d) ? linkTo(X.photoNote(e.d), dayHeading(e.d), dateText(e.d)) : dateText(e.d)} · 📷 ${eventText(e, X)} (${dayLink(paths, e.row, cache.get(e.row), e.d, 'the messages')})`);
    }
    const hol = new Map();
    for (const e of E.filter((x) => x.kind === 'holiday')) {
      if (!hol.has(e.hint)) hol.set(e.hint, new Map());
      const ys = hol.get(e.hint);
      const y = e.d.slice(0, 4);
      if (!ys.has(y)) ys.set(y, new Map());
      ys.get(y).set(e.row, e);
    }
    if (hol.size) {
      out.push('', '## Holidays', 'Who you exchanged greetings with, each year.');
      for (const h of HOLIDAYS.map(([name]) => name).filter((x) => hol.has(x))) {
        out.push('', `### ${emojiOf('holiday', h)} ${h}`);
        for (const [y, who] of [...hol.get(h)].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
          const list = [...who.values()];
          out.push(`- **${y}**: ${list.slice(0, 12).map((e) => dayLink(paths, e.row, cache.get(e.row), e.d, chatName(X, e.row))).join(', ')}${list.length > 12 ? ` and ${nf(list.length - 12)} more` : ''}`);
        }
      }
    }
    const met = new Map();
    for (const e of E.filter((x) => x.kind === 'meet' && x.person)) { if (!met.has(e.person)) met.set(e.person, []); met.get(e.person).push(e); }
    if (met.size) {
      out.push('', '## Meeting up', 'Who you most often message “on my way”, “I\'m outside”, “running late” and the like.', '', '| | Times | First | Latest |', '| --- | ---: | --- | --- |');
      for (const [p, list] of [...met].sort((a, b) => b[1].length - a[1].length).slice(0, 30)) {
        const [f, l] = [list[0], list[list.length - 1]];
        out.push(cell(`| ${personLink(paths, p)} | ${nf(list.length)} | ${dayLink(paths, f.row, cache.get(f.row), f.d)} | ${dayLink(paths, l.row, cache.get(l.row), l.d)} |`));
      }
    }
    out.push('');
    return out.join('\n');
  }

  // ---------- photos ----------
  // Every photo and video from every chat but one-way senders', by day: a
  // note a year, or a month in a year of more than PHOTO_YEAR.
  const PHOTO_YEAR = 300;
  function photoMds(X) {
    const { shots, paths, cache } = X;
    const notes = new Map();
    const byKey = new Map();
    for (const s of shots) { const k = X.photoKey(s.d); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(s); }
    const keys = [...byKey.keys()].sort();
    for (const [i, k] of keys.entries()) {
      const path = X.photoPath(k);
      const list = byKey.get(k).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      const nav = [i > 0 && `← ${link(X.photoPath(keys[i - 1]), periodName(keys[i - 1]))}`, link(paths.photos, 'Photos'), link(k.length === 4 ? paths.year(k) : paths.month(k), `${periodName(k)} in the calendar`), i < keys.length - 1 && `${link(X.photoPath(keys[i + 1]), periodName(keys[i + 1]))} →`].filter(Boolean).join(' · ');
      const out = ['---', 'type: photos', `${k.length === 4 ? 'year' : 'month'}: ${k}`, `files: ${list.length}`, '---', `# Photos and videos · ${periodName(k)}`, '', nav];
      let today = null;
      let chat = null;
      let row = [];
      const flush = () => { if (row.length) out.push(row.join(' ')); row = []; };
      for (const s of list) {
        if (s.d !== today) { flush(); today = s.d; chat = null; out.push('', `## ${dayHeading(s.d)}`); }
        if (s.r !== chat) { flush(); chat = s.r; out.push('', `**${chatLink(X, s.r)}** · ${dayLink(paths, s.r, cache.get(s.r), s.d, 'in the messages')}`); }
        row.push(galleryItem(s.file, s.k, s.r, path));
      }
      flush();
      out.push('', nav, '');
      notes.set(path, out.join('\n'));
    }
    if (keys.length) {
      const years = new Map();
      for (const k of keys) { const y = k.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(k); }
      notes.set(paths.photos, ['---', 'type: photos', '---', '# Photos', '',
        `Every photo and video saved in your chats (but not from senders you've never written to), ${nf(shots.length)} in all, by day: a note a year, or a month in a busy year. Back to ${link(paths.home, 'Message Archivist')}.`, '',
        ...[...years].reverse().map(([y, ks]) => (ks.length === 1 && ks[0].length === 4 ? `- ${link(X.photoPath(y), y)} (${nf(byKey.get(y).length)})` : `- **${y}**: ${ks.slice().reverse().map((k) => `${link(X.photoPath(k), MONTHS[+k.slice(5, 7) - 1].slice(0, 3))} (${nf(byKey.get(k).length)})`).join(', ')}`)), ''].join('\n'));
    }
    return notes;
  }

  function indexMds({ rows, P, paths, at, X }) {
    const { T, oneWay } = X;
    const two = P.list.filter((p) => !oneWay.has(p));
    const total = rows.reduce((t, r) => t + (r.count || 0), 0);
    const firsts = rows.map((r) => r.first).filter(Boolean).sort();
    const lasts = rows.map((r) => r.last).filter(Boolean).sort();
    const az = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    const notes = new Map();
    const byPeople = [...T.nodes].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1));
    // Dated by the archive's newest message, not today, so the notes only
    // change when the archive does.
    const now = lasts[lasts.length - 1];
    const months = [...new Set([...X.D.keys()].map((d) => d.slice(0, 7)))].sort();
    const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort();
    const start = [link(paths.people, 'People'), months.length && link(paths.calendar, 'Calendar'), X.E.length && link(paths.events, 'Events'),
      X.shots.length && link(paths.photos, 'Photos'), byPeople.length && link(paths.topics, 'Topics'), X.labelCount && link(paths.labels, 'Labels')].filter(Boolean);
    const home = [
      '---', 'type: home', `updated: ${at.slice(0, 10)}`, '---', '# Message Archivist', '',
      `${nf(rows.length)} chats and ${nf(total)} messages, ${span(firsts[0], lasts[lasts.length - 1])}, from ${[...paths.sources.keys()].join(', ')}. Written by Message Archivist; the backup folder's index.html has search and analysis.`,
      '', `**Start here**: ${start.join(' · ')}`,
    ];
    if (months.length) {
      const recent = months.slice(-3).reverse();
      home.push('', '## Lately', ...recent.map((m) => { const ds = [...X.D.keys()].filter((d) => d.startsWith(m)); return `- ${link(paths.month(m), periodName(m))}: ${nf(ds.reduce((t, d) => t + X.D.get(d).total, 0))} messages`; }));
      const late = gather(X.E.filter((e) => e.kind !== 'meet' && (e.kind !== 'photos' || e.n >= 10))).slice(-8).reverse();
      if (late.length) home.push(...late.map((e) => `- ${eventLine(e, X)}`));
      home.push('', '## Years', years.slice().reverse().map((y) => link(paths.year(y), y)).join(' · '));
    }
    home.push('', `## ${link(paths.people, 'People')}`,
      `${nf(P.list.length)} people${oneWay.size ? `, ${nf(oneWay.size)} of them one-way (you've never written to them)` : ''}.${P.suggestions.length ? ` ${nf(P.suggestions.length)} may be the same as someone else: see People in the viewer (index.html) to join them.` : ''} Most messages:`,
      ...two.slice().sort((a, b) => b.count - a.count).slice(0, 25).map((p) => `- ${link(paths.person.get(p), p.name)}: ${nf(p.count)}`));
    if (byPeople.length) home.push('', `## ${link(paths.topics, 'Topics')}`, `What more than one person talks about: ${byPeople.slice(0, 20).map(([w]) => link(X.topicNotes.get(w), w)).join(', ')}.`);
    home.push('', '## Sources', ...[...paths.sources.values()].map((s) => `- ${link(s.path, s.name)}: ${nf(s.rows.length)} chats, ${nf(s.rows.reduce((t, r) => t + (r.count || 0), 0))} messages`), '');
    notes.set(paths.home, home.join('\n'));
    const recent = two.filter((p) => p.last).sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 15);
    const lost = now ? two.filter((p) => p.last && p.count >= 50 && dayNum(day(now)) - dayNum(day(p.last)) > 365).sort((a, b) => b.count - a.count).slice(0, 15) : [];
    const entry = (p) => `- ${link(paths.person.get(p), p.name)}: ${nf(p.count)} messages (${p.services.map((s) => L().serviceLabel(s)).join(', ')})`;
    notes.set(paths.people, ['---', 'type: people', '---', '# People', '', `Everyone you have a one-to-one chat with, ${nf(P.list.length)} people.`,
      ...(recent.length ? ['', '## Most recently', ...recent.map((p) => `- ${link(paths.person.get(p), p.name)}: ${dateText(day(p.last))}`)] : []),
      ...(lost.length ? ['', '## Lost touch', 'Many messages, but none for more than a year.', ...lost.map((p) => `- ${link(paths.person.get(p), p.name)}: ${nf(p.count)} messages, last ${dateText(day(p.last))}`)] : []),
      '', '## A to Z',
      ...two.slice().sort((a, b) => az(a.name, b.name)).map(entry),
      ...(oneWay.size ? ['', '## One-way', `${nf(oneWay.size)} who wrote to you but you never wrote to: codes, alerts, businesses and spam, most likely. Their notes are tagged #one-way; to leave them out of the graph, filter it with \`-tag:#one-way\`.`, '',
        ...[...oneWay].sort((a, b) => az(a.name, b.name)).map(entry)] : []),
      ''].join('\n'));
    if (byPeople.length) {
      const who = (list) => list.map((x) => (x.d.kind === 'person' ? link(paths.person.get(x.d.id), x.d.id.name) : link(paths.chat.get(x.d.id), L().formatNumber(x.d.id.title)))).join(', ');
      const phrases = byPeople.filter(([w]) => w.includes(' '));
      const words = byPeople.filter(([w]) => !w.includes(' '));
      notes.set(paths.topics, ['---', 'type: topics', '---', '# Topics', '',
        `Words and phrases that stand out in your chats with more than one person or group (and not most of them), ${nf(byPeople.length)} in all, the most widely shared first. Each person's own are on their note; each year's in the ${link(paths.calendar, 'calendar')}.`,
        ...(phrases.length ? ['', '## Phrases', ...phrases.map(([w, list]) => `- ${link(X.topicNotes.get(w), w)}: ${who(list)}`)] : []),
        ...(words.length ? ['', '## Words', ...words.map(([w, list]) => `- ${link(X.topicNotes.get(w), w)}: ${who(list)}`)] : []), ''].join('\n'));
    }
    for (const s of paths.sources.values()) {
      notes.set(s.path, ['---', 'type: source', `source: ${yaml(s.name)}`, '---', `# ${inline(s.name)}`, '', `${nf(s.rows.length)} chats, A to Z.`, '',
        ...[...s.rows].sort((a, b) => az(String(a.title), String(b.title))).map((r) => `- ${link(paths.chat.get(r), L().formatNumber(r.title))}: ${nf(r.count)} messages${r.last ? `, last ${day(r.last)}` : ''}`), ''].join('\n'));
    }
    return notes;
  }

  // Writes (or brings up to date) the notes for every chat in `rows` (the
  // library's index). `saved` is people.json, `labels` labels.json, `book`
  // contacts.json. A chat of `small` messages or fewer keeps them in its own
  // note; a year of more than `busyYear` gets a note a month.
  // Returns what it did: { notes, written, same, removed, kept, people, oneWay, topics, labels, events, suggestions }.
  async function update(io, { rows, saved = null, labels = null, book = null, full = false, small = 100, busyYear = 400, onProgress = () => {}, log = () => {} } = {}) {
    let old = null;
    try { old = JSON.parse((await io.readText(MANIFEST)) || 'null'); } catch { /* start again */ }
    if (!old) old = { files: {}, chats: {} };
    // A manifest of another version: every chat is read and every note
    // written again, but what it lists is kept, so notes no longer made
    // still go (and the owner's stay).
    if (old.version !== VERSION) { old = { files: old.files || {}, chats: {} }; full = true; }
    const at = new Date().toISOString();
    const P = L().people(rows, saved, book);
    const paths = layout(rows, P);
    const lab = new Map((labels?.labels || []).map((l) => [l.id, l.name]));
    const out = { version: VERSION, updated_at: at, files: {}, chats: {} };
    const did = { written: 0, same: 0, removed: 0, kept: 0 };

    // A note, written when it says something new. In notes with MARK what's
    // below it is the owner's and stays; one whose MARK was taken out is
    // theirs now, and is left as it is.
    async function put(path, text, own = false) {
      const h = hash(text);
      out.files[path] = h;
      if (!full && old.files[path] === h) { did.same++; return; }
      let body = text;
      if (own) {
        const cur = await io.readText(path);
        if (cur != null) {
          const i = cur.indexOf(MARK);
          if (i >= 0) body = text.slice(0, text.indexOf(MARK)) + cur.slice(i);
          else { out.files[path] = old.files[path] || hash(cur); did.kept++; return; }
        }
      }
      await io.write(path, body);
      did.written++;
    }

    // Who's in each chat: the person of a one-to-one chat, those found in a group.
    const members = new Map();
    for (const p of P.list) {
      for (const r of p.chats) members.set(r, [p]);
      for (const g of P.groupsOf(p)) { if (!members.has(g)) members.set(g, []); members.get(g).push(p); }
    }
    // Who in a chat said something, by the key analyse gives them.
    const memberOf = (who) => {
      const byTel = new Map();
      const byName = new Map();
      for (const p of who) {
        for (const id of p.ids) if (id.startsWith('tel:')) byTel.set(id, p);
        for (const n of new Set([p.name, ...p.names].map(L().nameKey))) byName.set(n, byName.has(n) && byName.get(n) !== p ? null : p);
      }
      return (k) => (k.startsWith('tel:') ? byTel.get(k) : byName.get(k.slice(5))) || null;
    };

    const flagsAll = labels?.flags || {};
    const cache = new Map(); // chat -> what it says (analyse)
    for (const [n, row] of rows.entries()) {
      onProgress(n, rows.length, row);
      const who = members.get(row) || [];
      const tags = (labels?.chats?.[L().chatKey(row)] || []).map((id) => lab.get(id)).filter(Boolean).map(tagOf).filter(Boolean);
      const sig = [VERSION, small, busyYear, row.count, row.first, row.last, row.updated_at, row.title, paths.chat.get(row), ...who.map((p) => paths.person.get(p)), ...tags,
        Object.keys(flagsAll).filter((k) => k.startsWith(`${row.id}|`)).map((k) => `${k}:${flagsAll[k].note || ''}`).join(',')].join('|');
      const prev = old.chats[row.folder];
      if (!full && prev?.sig === sig && prev.a && prev.files.every((p) => old.files[p])) {
        out.chats[row.folder] = prev;
        cache.set(row, prev.a);
        for (const p of prev.files) out.files[p] = old.files[p];
        did.same += prev.files.length;
        continue;
      }
      let data = null;
      try { data = JSON.parse((await io.readText(`${row.folder}/messages.json`)) || 'null'); } catch { /* unreadable: no months */ }
      const msgs = data?.messages || [];
      const own = msgs.length <= small ? [...msgs.filter((m) => m.timestamp), ...msgs.filter((m) => !m.timestamp)] : null;
      const periods = own ? new Map() : periodsOf(msgs, busyYear);
      const flags = (m) => (row.id ? flagsAll[`${row.id}|${m.id || m.index}`] : null);
      const a = analyse(msgs, own ? null : [...periods.keys()]);
      cache.set(row, a);
      const files = [];
      for (const [p, list] of periods) {
        const path = paths.period(row, p);
        await put(path, periodMd({ row, p, msgs: list, periods: [...periods.keys()], paths, who, flags }));
        files.push(path);
      }
      const chatPath = paths.chat.get(row);
      await put(chatPath, chatMd({ row, periods, inline: own, paths, who, tags, flags, a, member: memberOf(who) }), true);
      files.push(chatPath);
      out.chats[row.folder] = { sig, files, a };
    }
    onProgress(rows.length, rows.length, null);

    // People: what their chats say added up.
    const A = new Map(P.list.map((p) => [p, merge(p.chats.map((r) => cache.get(r)).filter(Boolean))]));
    // Someone you've never written to is one-way: codes, alerts, businesses,
    // spam. They keep their notes, tagged, but stay out of topics, mentions,
    // the calendar, events, photos and the lists of who matters. Only in
    // apps where you've sent something somewhere: an export that can't tell
    // your messages apart says nothing.
    const writes = new Set([...cache].filter(([, a]) => a.sent).map(([r]) => L().serviceOf(r)));
    const oneWay = new Set(P.list.filter((p) => !A.get(p).sent && p.chats.every((r) => cache.get(r)) && p.chats.every((r) => writes.has(L().serviceOf(r)))));
    const two = { ...P, list: P.list.filter((p) => !oneWay.has(p)) };
    const inCal = (r) => { const p = P.byChat.get(L().chatKey(r)); return !p || !oneWay.has(p); };

    // Topics: each person's (and each group chat's) words and phrases that
    // stand out, a note for those two or more share, and each year's.
    const named = new Set(P.list.flatMap((p) => [p.name, ...p.names]).flatMap((x) => String(x).toLowerCase().match(WORD) || []));
    const docs = [];
    const docOf = new Map();
    for (const p of two.list) { const t = A.get(p); if (Object.keys(t.terms).length) { const d = { kind: 'person', id: p, terms: t.terms }; docs.push(d); docOf.set(p, d); } }
    for (const r of rows) {
      const a = cache.get(r);
      if (a && L().isGroupChat(r) && inCal(r) && a.sent + a.recv >= 20 && Object.keys(a.terms).length) { const d = { kind: 'group', id: r, terms: a.terms }; docs.push(d); docOf.set(r, d); }
    }
    const T = standout(docs, named);
    const topicNotes = new Map([...T.nodes.keys()].map((w) => [w, `${ROOT}/Topics/${noteName(w)}.md`]));
    const yearly = new Map();
    for (const d of docs) {
      const yt = d.kind === 'person' ? Object.entries(A.get(d.id).yterms).map(([y, m]) => [y, Object.entries(m)]) : Object.entries(cache.get(d.id).yterms);
      for (const [y, ws] of yt) { if (!yearly.has(y)) yearly.set(y, new Map()); for (const [w, n] of ws) bump(yearly.get(y), w, n); }
    }
    const yearTopics = byYear(yearly, named, 8, 4);
    const M = mentionsOf(two, cache);
    // From the phone's contacts: labels as notes, and relations by name.
    const K = new Map(P.list.map((p) => [p, contactOf(p)]));
    const byLabel = new Map();
    for (const p of P.list) for (const l of K.get(p).card.labels || []) { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(p); }
    const labelNotes = new Map([...byLabel.keys()].map((l) => [l, `${ROOT}/Labels/${noteName(l)}.md`]));
    const R = new Map();
    for (const p of P.list) for (const x of new Set([p.name, ...p.names].map(L().nameKey))) R.set(x, R.has(x) && R.get(x) !== p ? null : p);
    const C = new Map();
    for (const p of P.list) {
      const c = new Map();
      for (const g of P.groupsOf(p)) for (const q of members.get(g) || []) if (q !== p) bump(c, q);
      C.set(p, [...c].map(([q, k]) => ({ q, n: k })).sort((x, y) => y.n - x.n));
    }

    // Events, from every chat but one-way senders', in order.
    // A group's birthday wishes for someone by first name ("Happy birthday
    // Cleo!") are theirs too, when only one person has that first name.
    const firstNames = new Map();
    for (const p of two.list) { const f = /\p{L}/u.test(p.name) ? L().nameKey(p.name.split(/\s+/)[0]) : ''; if (f.length >= 3) firstNames.set(f, firstNames.has(f) ? null : p); }
    const E = [];
    const byPerson = new Map();
    const toPerson = (p, e) => { if (!byPerson.has(p)) byPerson.set(p, []); byPerson.get(p).push(e); };
    for (const r of rows) {
      const a = cache.get(r);
      if (!a || !inCal(r)) continue;
      const person = P.byChat.get(L().chatKey(r)) || null;
      const add = (e) => { E.push(e); if (person) toPerson(person, e); if (e.for) toPerson(e.for, e); };
      for (const [dn, kind, me, hint] of a.events) {
        const e = { d: numDay(dn), row: r, person, kind, me, hint };
        if (!person && kind === 'bday' && hint && hint !== 'belated') e.for = firstNames.get(L().nameKey(hint)) || null;
        add(e);
      }
      for (const [d, c] of Object.entries(a.mdays)) if (c >= PHOTO_DAY) add({ d, row: r, person, kind: 'photos', me: 0, hint: '', n: c });
    }
    const byDate = (x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
    E.sort(byDate);
    for (const l of byPerson.values()) l.sort(byDate);
    // Birthdays: from contacts, or the days you wished them happy birthday;
    // and yours, the day most people wish you happy birthday.
    const B = new Map();
    const wished = new Map();
    const yours = new Map(); // month-day -> Map(year -> Set(person))
    const add2 = (map, k1, k2, v) => { if (!map.has(k1)) map.set(k1, new Map()); const m = map.get(k1); if (!m.has(k2)) m.set(k2, new Set()); m.get(k2).add(v); };
    for (const e of E) {
      if (e.kind !== 'bday' || e.hint === 'belated') continue;
      const md = e.d.slice(5);
      const y = e.d.slice(0, 4);
      const them = e.for || (e.person && e.me ? e.person : null);
      if (them) add2(wished, them, md, y);
      else if (e.person) add2(yours, md, y, e.person);
    }
    for (const p of two.list) {
      const b = birthday(K.get(p).card.birthday);
      if (b) { B.set(p, { ...b, how: 'contacts' }); continue; }
      const m = wished.get(p);
      if (!m) continue;
      const [md, ys] = [...m].sort((x, y) => y[1].size - x[1].size || (x[0] < y[0] ? -1 : 1))[0];
      B.set(p, { md, year: null, text: mdText(md), how: ys.size >= 2 ? 'probably' : 'maybe', years: [...ys].sort() });
    }
    let mine = null;
    for (const [md, ys] of yours) {
      const total = [...ys.values()].reduce((t, s) => t + s.size, 0);
      if (total >= 3 && (!mine || total > mine.total)) mine = { md, total, years: [...ys].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([y, s]) => [y, s.size]) };
    }

    // The calendar's days, and the photos to show.
    const D = new Map();
    const shots = [];
    for (const r of rows) {
      const a = cache.get(r);
      if (!a || !inCal(r)) continue;
      for (const [d, c] of Object.entries(a.days)) { let x = D.get(d); if (!x) D.set(d, (x = { chats: [], total: 0, media: 0 })); x.chats.push([r, c]); x.total += c; }
      for (const [d, c] of Object.entries(a.mdays)) { const x = D.get(d); if (x) x.media += c; }
      for (const [file, dn, me, k] of a.files) if (dn && (k === 'p' || k === 'v')) shots.push({ r, file, d: numDay(dn), me, k });
    }
    const perYear = new Map();
    for (const s of shots) bump(perYear, s.d.slice(0, 4));
    const monthly = new Set([...perYear].filter(([, c]) => c > PHOTO_YEAR).map(([y]) => y));
    const photoKey = (d) => (monthly.has(d.slice(0, 4)) ? d.slice(0, 7) : d.slice(0, 4));
    const photoPath = (k) => (k.length === 4 ? `${ROOT}/Photos/${k} photos.md` : `${ROOT}/Photos/${k.slice(0, 4)}/${k} photos.md`);
    // A day's photos are linked only when the photo notes show that day (a
    // chat's oldest past its newest 10,000 files aren't kept).
    const shotDays = new Set(shots.map((s) => s.d));
    const photoNote = (d) => (shotDays.has(d) ? photoPath(photoKey(d)) : null);

    const X = { P, paths, cache, A, T, M, C, K, R, B, E, D, byPerson, docOf, oneWay, named, topicNotes, labelNotes, yearTopics, mine, shots,
      photoKey, photoPath, photoNote, photoYears: new Set([...perYear.keys()].filter((y) => !monthly.has(y))), photoNoteOfYear: (y) => photoPath(y), labelCount: byLabel.size };

    for (const p of P.list) {
      const subs = {};
      const t = A.get(p);
      if (p.chats.some((r) => cache.get(r)?.files.length)) {
        subs.photos = subPath(paths, p, 'photos');
        await put(subs.photos, photosMd({ p, paths, cache, self: subs.photos }));
      }
      subs.linkCount = p.chats.reduce((s, r) => s + (cache.get(r)?.links.length || 0), 0);
      if (subs.linkCount) {
        subs.links = subPath(paths, p, 'links');
        await put(subs.links, linksMd({ p, paths, cache }));
      }
      if (!oneWay.has(p)) {
        const items = timelineItems(p, t, X);
        if (items.length >= 2) {
          subs.timeline = subPath(paths, p, 'timeline');
          await put(subs.timeline, timelineMd(p, items, X));
        }
      }
      await put(paths.person.get(p), personMd(p, t, X, subs), true);
    }
    // Topics the same people talk about.
    const people = new Map([...T.nodes].map(([w, list]) => [w, new Set(list.map((x) => x.d))]));
    for (const [w, list] of T.nodes) {
      const mineSet = people.get(w);
      const related = [...people].filter(([v]) => v !== w).map(([v, s]) => [v, [...s].filter((x) => mineSet.has(x)).length, s.size])
        .filter(([, both]) => both >= 2).sort((a, b) => b[1] / (mineSet.size + b[2] - b[1]) - a[1] / (mineSet.size + a[2] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([v]) => v);
      await put(topicNotes.get(w), topicMd(w, list, X, related), true);
    }
    const az = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    for (const [l, list] of byLabel) await put(labelNotes.get(l), labelMd({ l, list: list.sort((a, b) => az(a.name, b.name)), paths }));
    if (byLabel.size) {
      await put(paths.labels, ['---', 'type: labels', '---', '# Labels', '', 'The labels in your phone\'s contacts (from a phone backup), and who has them.', '',
        ...[...byLabel].sort(([a], [b]) => az(a, b)).map(([l, list]) => `- ${link(labelNotes.get(l), l)}: ${many(list.length, 'person', 'people')}`), ''].join('\n'));
    }
    for (const [path, [text, own]] of calendarMds(X)) await put(path, text, own);
    if (E.length || B.size) await put(paths.events, eventsMd(X));
    for (const [path, text] of photoMds(X)) await put(path, text);
    for (const [path, text] of indexMds({ rows, P, paths, at, X })) await put(path, text);

    // Notes no longer made: for chats and people no longer in the archive, a
    // month with no messages left. One with notes of the owner's below MARK
    // is kept (and no longer looked after).
    for (const path of Object.keys(old.files)) {
      if (out.files[path] || !io.remove) continue;
      const cur = await io.readText(path);
      const i = cur?.indexOf(MARK) ?? -1;
      if (cur != null && ((i >= 0 && cur.slice(i + MARK.length).trim()) || (i < 0 && hash(cur) !== old.files[path]))) { did.kept++; log(`Kept ${path}: it has notes of yours`); continue; }
      if (cur != null) await io.remove(path);
      did.removed++;
    }
    await io.write(MANIFEST, JSON.stringify(out));
    return { notes: Object.keys(out.files).length, ...did, people: P.list.length, oneWay: oneWay.size, topics: T.nodes.size, labels: byLabel.size, events: E.length, suggestions: P.suggestions.length };
  }

  // Has the owner written below the "Your notes" line (or taken it out)?
  const hasYours = (text) => { const i = String(text ?? '').indexOf(MARK); return i < 0 || !!text.slice(i + MARK.length).trim(); };
  // The notes that could hold the owner's writing: people's, chats', topics',
  // and the calendar's years and months.
  const ownable = (path) => /^Obsidian\/(People\/[^/]+|Chats\/[^/]+\/[^/]+|Topics\/[^/]+|Calendar\/\d{4}(\/\d{4}-\d\d)?)\.md$/.test(path);

  // What's there now, for Settings: { updated_at, notes } or null.
  async function status(io) {
    try {
      const m = JSON.parse((await io.readText(MANIFEST)) || 'null');
      return m ? { updated_at: m.updated_at, notes: Object.keys(m.files || {}).length } : null;
    } catch { return null; }
  }

  return { ROOT, MANIFEST, MARK, VERSION, noteName, inline, lines, analyse, update, status, hasYours, ownable };
})();
