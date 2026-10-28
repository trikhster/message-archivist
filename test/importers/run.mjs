// Checks the app modules (extension/modules/) and the import framework
// (extension/import.js) on small made-up exports of each app, and that their
// chats fit the library: the right app, "Me" for your messages, media found
// or marked as left out, the "Imported" status, and nothing added twice when
// the same export comes in again. All names, numbers and texts here are invented.
// node test/importers/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = 'extension';
new Function(readFileSync(join(EXT, 'library.js'), 'utf8'))();
new Function(readFileSync(join(EXT, 'zip.js'), 'utf8'))();
new Function(readFileSync(join(EXT, 'import.js'), 'utf8'))();
for (const f of readdirSync(join(EXT, 'modules')).filter((f) => f.endsWith('.js')).sort()) new Function(readFileSync(join(EXT, 'modules', f), 'utf8'))();
const G = globalThis.GMLib;
const I = globalThis.GMImport;
const LRM = '\u200E';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };

// An in-memory set of files, as GMImport.fileSet makes from a zip or folder.
const set = (name, files) => ({ name, names: Object.keys(files), blob: async (p) => (p in files ? new Blob([files[p]]) : null), text: async (p) => (p in files ? String(files[p]) : null) });
// A real zip of `files`, as a picked File.
async function zipFile(name, files) {
  const z = new GMZip.ZipWriter();
  for (const [p, data] of Object.entries(files)) await z.add(p, data);
  return new File([z.finish()], name);
}
// A picked folder, as the browser hands it over (a directory handle).
function folder(name, files) {
  const dir = (prefix) => ({
    kind: 'directory', name: prefix ? prefix.slice(0, -1).split('/').pop() : name,
    async* entries() {
      const dirs = new Set();
      for (const [p, data] of Object.entries(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i < 0) yield [rest, { kind: 'file', name: rest, getFile: async () => (data instanceof File ? data : new File([data], rest)) }];
        else if (!dirs.has(rest.slice(0, i))) { dirs.add(rest.slice(0, i)); yield [rest.slice(0, i), dir(`${prefix}${rest.slice(0, i)}/`)]; }
      }
    },
  });
  return dir('');
}
// What opening a picked file says when it can't be read.
const whyNot = async (picked) => { try { await I.open(picked, ctx()); return ''; } catch (e) { return e.message; } };
const ctx = (me) => ({ locale: 'en-GB', whoAmI: async (service, names) => (names.includes(me) ? me : null) });
async function open(s, c) {
  const imp = await I.detect(s);
  if (!imp) return { imp: null, chats: [] };
  return { imp, chats: await imp.open(s, c) };
}
const mine = (d) => d.messages.filter((m) => m.direction === 'sent');

// ---------- WhatsApp ----------
{
  const ios = set('WhatsApp Chat - Sam Rivers.zip', {
    '_chat.txt': [
      `[03/02/2024, 09:15:02] Sam Rivers: ${LRM}Messages and calls are end-to-end encrypted.`,
      '[03/02/2024, 09:16:10] Sam Rivers: Morning! Coffee later?',
      '[03/02/2024, 09:17:45] Alex Doe: Sure, 3pm',
      'at the usual place',
      '[03/02/2024, 09:18:00] Sam Rivers: ‎<attached: 00000003-PHOTO-2024-02-03-09-18-00.jpg>',
      '[13/02/2024, 18:01:00] Alex Doe: ok <This message was edited>',
      '[13/02/2024, 18:01:30] Alex Doe: ok',
    ].join('\n'),
    '00000003-PHOTO-2024-02-03-09-18-00.jpg': 'jpeg-bytes',
  });
  const { imp, chats } = await open(ios, ctx('Alex Doe'));
  check('WhatsApp (iPhone): recognised', imp?.id === 'whatsapp');
  const d = chats[0]?.data;
  check('WhatsApp: one chat named from the file', chats.length === 1 && d.conversation === 'Sam Rivers', d?.conversation);
  check('WhatsApp: a two-line message stays one', d.messages.some((m) => m.text === 'Sure, 3pm\nat the usual place'));
  check('WhatsApp (iPhone): the encryption notice under the contact’s name is a notice', d.messages[0].kind === 'system' && d.messages[0].sender !== 'Sam Rivers' && !d.group);
  check('WhatsApp: you are "Me" (found from a one-to-one chat)', mine(d).length === 3 && mine(d).every((m) => m.sender === 'Me' && m.sender_name === 'Alex Doe'));
  check('WhatsApp: day-first dates read right', d.messages.at(-1).timestamp.startsWith('2024-02-13'), d.messages.at(-1).timestamp);
  const photo = d.messages.flatMap((m) => m.media)[0];
  check('WhatsApp: the photo is attached', photo?.file === 'media/00000003-PHOTO-2024-02-03-09-18-00.jpg' && chats[0].files.get(photo.file) === '00000003-PHOTO-2024-02-03-09-18-00.jpg');
  check('WhatsApp: "edited" noted and stripped', d.messages.some((m) => m.edited && m.text === 'ok'));
  const ids = d.messages.map((m) => m.id);
  check('WhatsApp: every message has its own ID (two "ok"s stay two)', new Set(ids).size === ids.length && d.messages.filter((m) => m.text === 'ok').length === 2);
  const again = (await open(ios, ctx('Alex Doe'))).chats[0].data;
  check('WhatsApp: the same export again adds nothing', G.unknownIn(d.messages, again.messages).length === 0);

  const android = set('WhatsApp Chat with Book Club.txt', {
    'WhatsApp Chat with Book Club.txt': [
      '1/31/24, 7:05 PM - Messages and calls are end-to-end encrypted.',
      '1/31/24, 7:05 PM - Pat Lee created group "Book Club"',
      '1/31/24, 7:06 PM - Pat Lee: Chapter 3 by Friday?',
      '1/31/24, 7:07 PM - Jo Kim: <Media omitted>',
      '2/14/24, 12:30 AM - Alex Doe: Done!',
    ].join('\n'),
  });
  const a = await open(android, ctx('Alex Doe'));
  const ad = a.chats[0].data;
  check('WhatsApp (Android): recognised, a group', a.imp?.id === 'whatsapp' && ad.group === true);
  check('WhatsApp: month-first dates and 12-hour times', ad.messages.at(-1).timestamp === '2024-02-14 00:30', ad.messages.at(-1).timestamp);
  check('WhatsApp: notices have no sender', ad.messages.filter((m) => m.kind === 'system').length === 2);
  check('WhatsApp: "<Media omitted>" is a photo left out of the export', ad.messages.some((m) => m.media[0]?.file === null && /left out/.test(m.media[0].skipped)));
  check('WhatsApp: asks who you are in a group', mine(ad).length === 1);

  // Android, one-to-one: its encryption notice has no sender, and isn't a group's.
  const solo = set('WhatsApp Chat with Sam Rivers.txt', {
    'WhatsApp Chat with Sam Rivers.txt': [
      '31/01/2024, 19:05 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.',
      '31/01/2024, 19:06 - Sam Rivers: Running late',
      '31/01/2024, 19:07 - Alex Doe: No problem',
      '31/01/2024, 19:08 - Sam Rivers: IMG-20240131-WA0007.jpg (Datei angehängt)',
      'Look at this',
      '31/01/2024, 19:09 - Alex Doe: notes.pdf (see the second page)',
    ].join('\n'),
  });
  const asked = [];
  const sd = (await open(solo, { locale: 'en-GB', whoAmI: async (service, names) => { asked.push(names); return null; } })).chats[0].data;
  check('WhatsApp (Android, one-to-one): not a group, its notice a notice', !sd.group && sd.messages[0].kind === 'system');
  check('WhatsApp: you found without asking', asked.length === 0 && mine(sd).length === 2);
  check('WhatsApp: the chat is with the person it’s named for', sd.contact.people.map((p) => p.name).join() === 'Sam Rivers');
  check('WhatsApp: an attachment in another language, its caption kept', sd.messages[3].media[0]?.original_name === 'IMG-20240131-WA0007.jpg' && sd.messages[3].text === 'Look at this');
  check('WhatsApp: "name.ext (words)" that isn’t an attachment stays text', sd.messages[4].text === 'notes.pdf (see the second page)' && !sd.messages[4].media.length);

  // iPhone group: notices under the group's own name, marked.
  const grp = set('WhatsApp Chat - Book Club.zip', {
    'WhatsApp Chat - Book Club/_chat.txt': [
      `[05/03/2024, 18:00:00] Book Club: ${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
      `[05/03/2024, 18:00:00] Book Club: ${LRM}Pat Lee created group “Book Club”`,
      `[05/03/2024, 18:00:01] Book Club: ${LRM}Pat Lee added you`,
      '[05/03/2024, 18:01:10] Pat Lee: Welcome all',
      `${LRM}[05/03/2024, 18:02:00] Jo Kim: ${LRM}imagen omitida`,
      `${LRM}[05/03/2024, 18:03:00] Jo Kim: ${LRM}Missed voice call`,
      '[05/03/2024, 18:04:00] Alex Doe: Hi!',
      `${LRM}[05/03/2024, 18:05:00] Pat Lee: ${LRM}<adjunto: 00000009-PHOTO-2024-03-05-18-05-00.jpg>`,
    ].join('\n'),
    'WhatsApp Chat - Book Club/00000009-PHOTO-2024-03-05-18-05-00.jpg': 'jpeg',
  });
  const gd = (await open(grp, ctx('Alex Doe'))).chats[0].data;
  const by = (t) => gd.messages.find((m) => m.timestamp_raw && m.text === t);
  check('WhatsApp (iPhone group): notices under the group’s name are notices', gd.group === true && gd.conversation === 'Book Club' && gd.messages.filter((m) => m.kind === 'system').length === 3);
  check('WhatsApp: the group’s own name isn’t a person in it', gd.contact.people.map((p) => p.name).sort().join() === 'Jo Kim,Pat Lee');
  const left = gd.messages.find((m) => m.sender === 'Jo Kim' && m.media.length);
  check('WhatsApp: media left out, said in the phone’s language', left?.media[0].file === null && left.media[0].kind === 'image' && left.text === '');
  check('WhatsApp: a call is a call, from who called', gd.messages.some((m) => m.kind === 'call' && m.sender === 'Jo Kim' && m.text === 'Missed voice call'));
  check('WhatsApp: an attachment in the phone’s language, found beside the chat', gd.messages.some((m) => m.sender === 'Pat Lee' && m.media[0]?.file === 'media/00000009-PHOTO-2024-03-05-18-05-00.jpg'));
  check('WhatsApp: you, in a group', by('Hi!')?.sender === 'Me');

  // Dates and times as other languages write them.
  const formats = [
    ['31.01.24, 14:05 - Lena: Hallo', 'en-GB', '2024-01-31 14:05'],
    ['2024. 1. 31. 오후 2:05 - Lena: hi', 'ko', '2024-01-31 14:05'],
    ['13.6.2018 klo 21.25.15 - Lena: moi', 'fi', '2018-06-13 21:25'],
    ['[2024/1/31 下午2:05:09] Lena: hi', 'zh', '2024-01-31 14:05'],
    ['3/6/2018 1:55\u00a0p.\u00a0m. - Lena: hola', 'es-ES', '2018-06-03 13:55'],
    ['\u200F[31/01/2024, 14:05:09] Lena: hi', 'ar', '2024-01-31 14:05'],
  ];
  for (const [line, locale, want] of formats) {
    const got = (await open(set('WhatsApp Chat with Lena.txt', { 'WhatsApp Chat with Lena.txt': line }), { locale })).chats[0]?.data.messages[0];
    check(`WhatsApp: "${line.replace(/[\u200E\u200F]/g, '')}" read as ${want}`, got?.timestamp === want && got.sender === 'Lena', got?.timestamp);
  }

  // Several chats at once: a folder of their text files, or of their zips.
  const many = set('WhatsApp chats', {
    'WhatsApp Chat with Sam Rivers.txt': '1/31/24, 7:06 PM - Sam Rivers: hi\n1/31/24, 7:07 PM - Alex Doe: hey',
    'WhatsApp Chat with Kim.txt': '2/1/24, 8:00 AM - Kim: yo\n2/1/24, 8:01 AM - Alex Doe: sup',
    'readme.txt': 'not a chat',
  });
  const mc = (await open(many, ctx('Alex Doe'))).chats;
  check('WhatsApp: a folder of chats brings in each', mc.length === 2 && mc.map((c) => c.data.conversation).sort().join() === 'Kim,Sam Rivers');
  const zips = folder('Chats', {
    'WhatsApp Chat - Sam Rivers.zip': await zipFile('WhatsApp Chat - Sam Rivers.zip', { '_chat.txt': '[31/01/2024, 19:06:00] Sam Rivers: hi\n[31/01/2024, 19:07:00] Alex Doe: hey' }),
    'WhatsApp Chat - Kim.zip': await zipFile('WhatsApp Chat - Kim.zip', { '_chat.txt': '[01/02/2024, 08:00:00] Kim: yo\n[01/02/2024, 08:01:00] Alex Doe: sup' }),
    'holiday/photos.zip': await zipFile('photos.zip', { 'a.jpg': 'jpeg' }),
  });
  const all = await I.openAll(zips, ctx('Alex Doe'));
  check('A folder of WhatsApp zips: each chat comes in', all.length === 2 && all.every((x) => x.importer.id === 'whatsapp')
    && all.map((x) => x.source.chat(x.source.chats[0]).data.conversation).sort().join() === 'Kim,Sam Rivers', all.map((x) => x.source.name).join());
}

// ---------- Telegram ----------
{
  const s = set('Telegram export', {
    'DataExport_2024/result.json': JSON.stringify({
      personal_information: { user_id: 111, first_name: 'Alex' },
      chats: { list: [{
        name: 'Robin Park', type: 'personal_chat', id: 222,
        messages: [
          { id: 1, type: 'message', date: '2024-03-01T10:00:00', date_unixtime: '1709287200', from: 'Robin Park', from_id: 'user222', text: 'Hi there' },
          { id: 2, type: 'message', date: '2024-03-01T10:01:00', date_unixtime: '1709287260', from: 'Alex', from_id: 'user111', text: ['See ', { type: 'link', text: 'example.com' }], reply_to_message_id: 1 },
          { id: 3, type: 'message', date: '2024-03-01T10:02:00', date_unixtime: '1709287320', from: 'Robin Park', from_id: 'user222', text: '', photo: 'chats/chat_001/photos/photo_1.jpg', width: 800, height: 600 },
          { id: 4, type: 'message', date: '2024-03-01T10:03:00', date_unixtime: '1709287380', from: 'Robin Park', from_id: 'user222', text: '', file: '(File not included. Change data exporting settings to download.)', media_type: 'video_file', reactions: [{ type: 'emoji', count: 2, emoji: '👍' }] },
          { id: 5, type: 'service', date: '2024-03-01T10:04:00', date_unixtime: '1709287440', actor: 'Alex', actor_id: 'user111', action: 'phone_call', text: '' },
        ],
      }] },
    }),
    'DataExport_2024/chats/chat_001/photos/photo_1.jpg': 'jpeg',
  });
  const { imp, chats } = await open(s, ctx('Alex'));
  const d = chats[0]?.data;
  check('Telegram: recognised', imp?.id === 'telegram');
  check('Telegram: you from the export’s own account', mine(d).length === 2 && d.messages[1].sender === 'Me');
  check('Telegram: text pieces joined, reply kept', d.messages[1].text === 'See example.com' && d.messages[1].reply_to?.text === 'Hi there');
  check('Telegram: photo found under its folder', d.messages[2].media[0]?.file === 'media/photo_1.jpg' && d.messages[2].media[0].width === 800);
  check('Telegram: a file the export left out is marked', d.messages[3].media[0]?.file === null && d.messages[3].media[0].kind === 'video');
  check('Telegram: reactions and calls', d.messages[3].reactions?.[0] === '👍 2' && d.messages[4].kind === 'call');
  check('Telegram: chat ID kept for later exports', d.conversation_id === 'telegram:222');
}

// ---------- Discord ----------
{
  const s = set('package.zip', {
    'package/account/user.json': JSON.stringify({ id: '900', username: 'alex.d', global_name: 'Alex' }),
    'package/messages/index.json': JSON.stringify({ 500: 'Direct Message with kitefan#0', 600: 'general in Hobby Club' }),
    'package/messages/c500/channel.json': JSON.stringify({ id: '500', type: 'DM', recipients: ['900', '901'] }),
    'package/messages/c500/messages.json': JSON.stringify([
      { ID: '1', Timestamp: '2024-04-01 12:00:00', Contents: 'hey', Attachments: '' },
      { ID: '2', Timestamp: '2024-04-01 12:05:00', Contents: '', Attachments: 'https://cdn.discordapp.com/attachments/1/2/pic.png' },
    ]),
    'package/messages/c600/channel.json': JSON.stringify({ id: '600', type: 'GUILD_TEXT', name: 'general', guild: { id: '7', name: 'Hobby Club' } }),
    'package/messages/c600/messages.csv': 'ID,Timestamp,Contents,Attachments\n3,2024-04-02 08:00:00+00:00,"hello, all\nsecond line",\n',
  });
  const { imp, chats } = await open(s, ctx());
  check('Discord: recognised, two channels', imp?.id === 'discord' && chats.length === 2);
  const dm = chats.find((c) => c.data.conversation === 'kitefan')?.data;
  check('Discord: DM named for the other person', !!dm && dm.group === undefined);
  check('Discord: every message is yours', chats.every((c) => c.data.messages.every((m) => m.direction === 'sent' && m.sender === 'Me')));
  check('Discord: attachments are links, not files', dm.messages[1].media[0]?.file === null && /cdn\.discordapp/.test(dm.messages[1].media[0].url));
  check('Discord: CSV with a quoted comma and newline', chats.some((c) => c.data.messages.some((m) => m.text === 'hello, all\nsecond line')));
  check('Discord: times are UTC', dm.messages[0].timestamp_raw === '2024-04-01T12:00:00.000Z');
  check('Discord: marked as only part of each chat', !!dm.partial);
}

// ---------- Instagram / Messenger ----------
{
  const latin1 = (s) => String.fromCharCode(...new TextEncoder().encode(s));
  const s = set('instagram-alexd-2024.zip', {
    'your_instagram_activity/messages/inbox/jamie_123/message_1.json': JSON.stringify({
      participants: [{ name: latin1('Jamié') }, { name: 'Alex D' }], title: latin1('Jamié'), thread_path: 'inbox/jamie_123',
      messages: [
        { sender_name: 'Alex D', timestamp_ms: 1712000060000, content: latin1('Ça va? 😀'), reactions: [{ reaction: latin1('❤️'), actor: latin1('Jamié') }] },
        { sender_name: latin1('Jamié'), timestamp_ms: 1712000000000, photos: [{ uri: 'your_instagram_activity/messages/inbox/jamie_123/photos/1.jpg' }] },
      ],
    }),
    'your_instagram_activity/messages/inbox/jamie_123/photos/1.jpg': 'jpeg',
    'your_instagram_activity/messages/inbox/sky_9/message_1.json': JSON.stringify({ participants: [{ name: 'Sky' }, { name: 'Alex D' }], title: 'Sky', thread_path: 'inbox/sky_9', messages: [{ sender_name: 'Sky', timestamp_ms: 1712000100000, content: 'yo' }] }),
  });
  const { imp, chats } = await open(s, ctx());
  const d = chats.find((c) => c.data.conversation === 'Jamié')?.data;
  check('Instagram: recognised as Instagram', imp?.id === 'meta' && chats.every((c) => c.data.service === 'instagram'));
  check('Instagram: accents and emoji put right', !!d && d.messages.some((m) => m.text === 'Ça va? 😀'), chats.map((c) => c.data.conversation).join('|'));
  check('Instagram: you found as the one in every chat', mine(d).length === 1 && d.messages[1].sender === 'Me');
  check('Instagram: oldest first, photo attached, reaction kept', d.messages[0].media[0]?.file === 'media/1.jpg' && d.messages[1].reactions?.[0] === '❤️ Jamié');

  // Messenger's own download of end-to-end encrypted chats: one JSON per chat, and their media.
  const e2ee = set('messages.zip', {
    'sam_rivers_1.json': JSON.stringify({ participants: ['Sam Rivers', 'Alex D'], threadName: 'Sam Rivers', messages: [
      { isUnsent: false, media: [], reactions: [], senderName: 'Sam Rivers', text: 'secure hi', timestamp: 1712000000000, type: 'text' },
      { isUnsent: false, media: [{ uri: './media/abc.jpg' }], reactions: [{ actor: 'Sam Rivers', reaction: '❤' }], senderName: 'Alex D', text: '', timestamp: 1712000060000 },
    ] }),
    'kim_2.json': JSON.stringify({ participants: ['Kim', 'Alex D'], threadName: 'Kim', messages: [{ senderName: 'Kim', text: 'yo', timestamp: 1712000100000 }] }),
    'media/abc.jpg': 'jpeg',
  });
  const m = await open(e2ee, ctx());
  const md = m.chats.find((c) => c.data.conversation === 'Sam Rivers')?.data;
  check('Messenger (encrypted chats’ download): every chat in it', m.imp?.id === 'meta' && m.chats.length === 2 && m.chats.every((c) => c.data.service === 'messenger'));
  check('Messenger: you found as the one in every chat', !!md && mine(md).length === 1 && md.messages[0].sender === 'Sam Rivers');
  check('Messenger: photo from the media folder, reaction kept', md?.messages[1].media[0]?.file === 'media/abc.jpg' && md.messages[1].reactions?.[0] === '❤ Sam Rivers');
  check('Messenger: the chat’s name stands in for its ID', md?.conversation_id === 'messenger:Sam Rivers');
  check('Facebook: the HTML download says to ask for JSON', /JSON/.test(await whyNot(await zipFile('facebook-alexd.zip', { 'your_facebook_activity/messages/inbox/sam_1/message_1.html': '<html></html>' }))));
  check('Facebook: a part with only photos says to unzip every part', /one part/.test(await whyNot(await zipFile('facebook-alexd-2.zip', { 'your_facebook_activity/messages/inbox/sam_1/photos/1.jpg': 'jpeg' }))));
}

// ---------- TikTok ----------
{
  const s = set('user_data_tiktok.json', {
    'user_data_tiktok.json': JSON.stringify({
      Profile: { 'Profile Info': { ProfileMap: { userName: 'alexd' } } },
      'Direct Message': { 'Direct Messages': { ChatHistory: { 'Chat History with dancer42:': [
        { Date: '2024-05-01 20:00:00', From: 'dancer42', Content: 'https://www.tiktok.com/@x/video/1' },
        { Date: '2024-05-01 20:01:00', From: 'alexd', Content: 'haha' },
      ] } } },
    }),
  });
  const { imp, chats } = await open(s, ctx());
  const d = chats[0]?.data;
  check('TikTok: recognised, chat named', imp?.id === 'tiktok' && d.conversation === 'dancer42');
  check('TikTok: you from the profile', mine(d).length === 1 && mine(d)[0].text === 'haha');
}

// ---------- Snapchat ----------
{
  const s = set('mydata~1700000000000.zip', {
    'json/account.json': JSON.stringify({ 'Basic Information': { Username: 'alex.d', Name: 'Alex D' } }),
    'json/friends.json': JSON.stringify({ Friends: [{ Username: 'sky.w', 'Display Name': 'Sky W' }, { Username: 'robin_p', 'Display Name': 'Robin' }], 'Deleted Friends': [] }),
    'json/chat_history.json': JSON.stringify({
      'sky.w': [
        { From: 'sky.w', 'Media Type': 'TEXT', Created: '2024-04-20 01:29:22 UTC', Content: 'hey you', 'Conversation Title': null, IsSender: false, 'Created(microseconds)': 1713576562686, IsSaved: true, 'Media IDs': '' },
        { From: 'alex.d', 'Media Type': 'MEDIA', Created: '2024-04-20 01:30:00 UTC', Content: '', 'Conversation Title': null, IsSender: true, 'Created(microseconds)': 1713576600000000, IsSaved: true, 'Media IDs': 'b~AAA | b~BBB' },
        { From: 'sky.w', 'Media Type': 'NOTE', Created: '2024-04-20 01:31:00 UTC', Content: '', 'Conversation Title': null, IsSender: false, 'Media IDs': 'b~CCC' },
        { From: 'sky.w', 'Media Type': 'STATUSCONVERSATIONCAPTURESCREENSHOT', Created: '2024-04-20 01:32:00 UTC', Content: '', 'Conversation Title': null, IsSender: false, 'Media IDs': '' },
        { From: 'sky.w', 'Media Type': 'TEXT', Created: '2024-04-20 01:33:00 UTC', Content: '', 'Conversation Title': null, IsSender: false, 'Media IDs': '' },
      ],
      'a1b2c3-group': [
        { From: 'robin_p', 'Media Type': 'TEXT', Created: '2024-04-21 10:00:00 UTC', Content: 'plans?', 'Conversation Title': 'Weekend Crew', isSender: false },
        { From: 'alex.d', 'Media Type': 'TEXT', Created: '2024-04-21 10:01:00 UTC', Content: 'beach', 'Conversation Title': 'Weekend Crew', isSender: true },
      ],
    }),
    'json/snap_history.json': JSON.stringify({ 'sky.w': [{ From: 'sky.w', 'Media Type': 'IMAGE', Created: '2024-04-20 01:00:00 UTC', IsSender: false }] }),
    'chat_media/2024-04-20_b~AAA.jpg': 'jpeg',
    'chat_media/2024-04-20_b~CCC.mp4': 'mp4',
  });
  const { imp, chats } = await open(s, ctx());
  const dm = chats.find((c) => c.data.conversation === 'Sky W')?.data;
  const grp = chats.find((c) => c.data.conversation === 'Weekend Crew')?.data;
  check('Snapchat: recognised, a chat and a named group', imp?.id === 'snapchat' && chats.length === 2 && !!dm && !dm.group && grp?.group === true, chats.map((c) => c.data.conversation).join('|'));
  check('Snapchat: you from IsSender, however it’s spelt', mine(dm).length === 1 && mine(grp).length === 1 && mine(grp)[0].text === 'beach' && mine(dm)[0].sender_name === 'alex.d');
  check('Snapchat: friends by display name, with their username', dm.messages[0].sender === 'Sky W' && dm.messages[0].sender_id === 'sky.w' && dm.contact.people[0].handle === 'sky.w');
  check('Snapchat: exact times, in microseconds or milliseconds', dm.messages[0].timestamp_raw === '2024-04-20T01:29:22.686Z' && dm.messages[1].timestamp_raw === '2024-04-20T01:30:00.000Z');
  check('Snapchat: photos by media ID, a missing one marked', dm.messages[1].media[0]?.file === 'media/2024-04-20_b~AAA.jpg' && dm.messages[1].media[1]?.file === null && chats[0].files.get('media/2024-04-20_b~AAA.jpg') === 'chat_media/2024-04-20_b~AAA.jpg');
  check('Snapchat: a voice note is audio', dm.messages[2].media[0]?.kind === 'audio' && !!dm.messages[2].media[0].file);
  check('Snapchat: a screenshot is a notice', dm.messages[3].kind === 'system' && dm.messages[3].text === 'Sky W took a screenshot of the chat');
  check('Snapchat: an empty message isn’t kept, snaps aren’t chats', dm.messages.length === 4 && !chats.some((c) => c.data.messages.some((x) => x.timestamp_raw === '2024-04-20T01:00:00.000Z')));
  check('Snapchat: whose download it is, chat IDs from its keys', dm.owner?.id === 'alex.d' && dm.conversation_id === 'snapchat:sky.w');
  const again = (await open(s, ctx())).chats.find((c) => c.data.conversation === 'Sky W').data;
  check('Snapchat: the same download again adds nothing', G.unknownIn(dm.messages, again.messages).length === 0);

  const old = set('chat_history.json', { 'chat_history.json': JSON.stringify({
    'Received Saved Chat History': [{ From: 'sky.w', 'Media Type': 'TEXT', Created: '2019-05-01 10:00:00 UTC', Text: 'old hi' }],
    'Sent Saved Chat History': [{ To: 'sky.w', 'Media Type': 'TEXT', Created: '2019-05-01 10:01:00 UTC', Text: 'old hey' }],
  }) });
  const o = await open(old, ctx());
  const od = o.chats[0]?.data;
  check('Snapchat (older download): sent and received in one chat', o.imp?.id === 'snapchat' && o.chats.length === 1 && od.conversation === 'sky.w' && mine(od).length === 1 && mine(od)[0].text === 'old hey');
  check('Snapchat: a download of web pages only says to ask for JSON', /JSON/.test(await whyNot(await zipFile('mydata~1.zip', { 'index.html': '', 'html/chat_history.html': '<html></html>' }))));
  check('Snapchat: a part with only photos says to unzip every part', /one part/.test(await whyNot(await zipFile('mydata~1-2.zip', { 'chat_media/2024-04-20_b~AAA.jpg': 'jpeg' }))));
  check('Snapchat: a source of its own, by username', G.SERVICES.snapchat?.ids === 'username' && G.chatFolder('snapchat', 'Sky W') === 'conversations/Snapchat/Sky W');
}

// ---------- exports shared to the Android app, in a phone backup ----------
{
  // A phone backup (.tar) as the Android app writes it: no chats of its own
  // here, and two WhatsApp chats shared to it, one as its .zip, one as a text
  // file and a photo.
  const tar = async (entries) => {
    const parts = [];
    for (const [name, data] of entries) {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(data);
      parts.push(G.tarHeader(name, bytes.length), bytes, G.tarPadding(bytes.length));
    }
    return new File([...parts, G.tarEnd()], 'messages-backup-2026-10-27.tar');
  };
  const zip = await zipFile('WhatsApp Chat - Sam Rivers.zip', { '_chat.txt': '[31/01/2024, 19:06:00] Sam Rivers: hi from the phone\n[31/01/2024, 19:07:00] Alex Doe: hey', '00000002-PHOTO-2024-01-31-19-06-30.jpg': 'jpeg' });
  const manifest = {
    format: 'gm-restore', version: 3, tool: 'Message Archivist', source: 'phone', threads: [],
    exports: [
      { id: 'a1', app: 'whatsapp', title: 'Sam Rivers', added_at: '2026-10-27T10:00:00Z', files: [{ entry: 'exports/1/1.zip', name: 'WhatsApp Chat - Sam Rivers.zip', bytes: zip.size }] },
      { id: 'b2', app: 'whatsapp', title: 'Kim', added_at: '2026-10-27T11:00:00Z', files: [
        { entry: 'exports/2/1.txt', name: 'WhatsApp Chat with Kim.txt', bytes: 0 }, { entry: 'exports/2/2.jpg', name: 'IMG-20240201-WA0003.jpg', bytes: 4 }] },
      { id: 'c3', app: 'other', title: 'notes', files: [{ entry: 'exports/3/1.txt', name: 'notes.txt', bytes: 5 }] },
    ],
  };
  const file = await tar([
    ['exports/1/1.zip', zip],
    ['exports/2/1.txt', '01/02/2024, 08:00 - Kim: yo\n01/02/2024, 08:01 - Alex Doe: look\n01/02/2024, 08:02 - Kim: IMG-20240201-WA0003.jpg (file attached)'],
    ['exports/2/2.jpg', 'jpeg'],
    ['exports/3/1.txt', 'hello'],
    ['manifest.json', JSON.stringify(manifest)],
  ]);
  const pkg = await G.readPackage(file);
  const found = await I.packageExports(pkg, file.name, ctx('Alex Doe'));
  const chats = found.map((x) => x.source.chat(x.source.chats[0]).data);
  check('Phone backup: every app export in it comes in, each by its module', found.length === 2 && found.every((x) => x.importer.id === 'whatsapp') && chats.map((d) => d.conversation).sort().join() === 'Kim,Sam Rivers', found.map((x) => x.source.name).join(' | '));
  check('Phone backup: named after the backup and the shared file', found.some((x) => x.source.name === 'messages-backup-2026-10-27.tar › WhatsApp Chat - Sam Rivers.zip'));
  const kim = chats.find((d) => d.conversation === 'Kim');
  check('Phone backup: a chat shared as a text and its photo keeps the photo', kim?.messages.some((m) => m.media[0]?.file === 'media/IMG-20240201-WA0003.jpg'));
  const kimSrc = found.find((x) => x.source.chat(x.source.chats[0]).data.conversation === 'Kim').source;
  check('Phone backup: the photo is read from the backup', (await (await kimSrc.read(`${kimSrc.chats[0]}/media/IMG-20240201-WA0003.jpg`))?.text()) === 'jpeg');
  check('Phone backup: one that isn’t an export is said, not imported', found.skipped.length === 1 && /notes/.test(found.skipped[0]));
}

// ---------- chats read on an app's web page (Snapchat for Web) ----------
{
  // What web/snapchat.js keeps for one chat (background `webcap:`): a group's
  // first message has its time; the next ones in the group carry its span.
  const t0 = Date.UTC(2024, 3, 20, 1, 29, 22);
  const t1 = Date.UTC(2024, 3, 20, 1, 40, 0);
  const capture = {
    chat: { id: '0f0e0d0c-0b0a-4909-8807-060504030201', title: 'Sky W', people: ['Sky W'], group: false },
    updated_at: Date.UTC(2024, 3, 20, 2, 0, 0),
    items: {
      a: { key: 'a', at: t0, from: t0, to: t1, me: false, sender: 'Sky W', text: 'hey you', media: [] },
      b: { key: 'b', at: t0 + 1, from: t0, to: t1, me: false, sender: 'Sky W', text: 'are you up', media: [] },
      c: { key: 'c', at: t1, from: t1, to: null, me: true, sender: '', text: 'yes', media: [{ kind: 'image' }], reply: { sender: 'Sky W', text: 'are you up' } },
      d: { key: 'd', at: t1 + 1, from: t1, to: null, me: true, sender: '', text: '', media: [{ kind: 'image', sticker: true }] },
    },
  };
  const src = I.webSource('snapchat', [capture]);
  const d = src.chat(src.chats[0]).data;
  check('Snapchat for Web: a capture becomes a Snapchat chat, joined by its name', src.web === true && src.importer === 'snapchat-web' && d.service === 'snapchat' && d.conversation === 'Sky W' && d.conversation_id === null && d.web_id === capture.chat.id);
  check('Snapchat for Web: you and them, in order', d.messages.map((m) => m.sender).join() === 'Sky W,Sky W,Me,Me' && d.messages[2].reply_to?.text === 'are you up');
  check('Snapchat for Web: photos and stickers noted, not saved', d.messages[2].media[0].file === null && /seen on Snapchat for Web/.test(d.messages[2].media[0].skipped) && /sticker/.test(d.messages[3].media[0].skipped));
  check('Snapchat for Web: each message keeps its span; the last group’s ends when it was read', d.messages[1].web_window[1] === t1 && d.messages[3].web_window[1] === capture.updated_at);
  const again = I.webSource('snapchat', [capture]).chat(src.chats[0]).data;
  check('Snapchat for Web: the same capture again adds nothing', G.unknownIn(d.messages, again.messages).length === 0);

  // Snapchat's own download has the same chat, with each message's own time:
  // the second message was sent six minutes after the first, though the page
  // only showed the group's time.
  const exported = [
    G.importedRecord({ id: 'sc-1', at: t0, sender: 'Sky W', text: 'hey you' }),
    G.importedRecord({ id: 'sc-2', at: t0 + 6 * 60e3, sender: 'Sky W', text: 'are you up' }),
    G.importedRecord({ id: 'sc-3', at: t0 + 7 * 60e3, sender: 'Sky W', text: 'only in the download' }),
  ];
  check('Snapchat for Web: the download’s messages are known by side and words within the span', G.unknownIn(exported, d.messages).map((m) => m.text).join('|') === 'yes|');
  check('…and the other way round, bringing in the download after', G.unknownIn(d.messages, exported).map((m) => m.text).join() === 'only in the download');
  check('…but not the same words from the other side', G.unknownIn([G.importedRecord({ id: 'x', at: t0, sender: 'Me', sent: true, text: 'hey you' })], d.messages.slice(0, 1)).length === 1);
  check('Messages without spans merge as before', G.unknownIn(exported, [G.importedRecord({ id: 'y', at: t0 + 6 * 60e3 + 120e3, sender: 'Sky W', text: 'are you up' })]).length === 1);
}

// ---------- the modules themselves ----------
{
  const ids = G.modules().map((m) => m.id);
  check('Modules: Google Messages is the core, first', G.modules()[0]?.id === 'sms' && G.module('sms').core === true);
  check('Modules: every app has a module', ['whatsapp', 'telegram', 'discord', 'instagram', 'messenger', 'tiktok', 'snapchat', 'imessage', 'signal'].every((s) => ids.includes(s)), ids.join());
  check('Modules: each says how to get its export, or why not yet', G.modules().filter((m) => !m.core).every((m) => (m.reader && m.steps?.length) || m.later));
  check('Modules: their looks are the library’s', G.serviceLabel('whatsapp') === 'WhatsApp' && G.SERVICES.snapchat.color === '#b89a00' && G.chatFolder('telegram', 'Sam') === 'conversations/Telegram/Sam');
  check('Modules: one reader for Instagram and Messenger', G.module('instagram').reader === G.module('messenger').reader && I.list().filter((r) => r.id === 'meta').length === 1);
  check('Modules: a text chat named like an app’s folder stays apart', G.chatFolder('sms', 'Snapchat') === 'conversations/Snapchat (chat)');
  check('Modules: names from the phone’s contacts', G.SERVICES.whatsapp.book === true && !G.SERVICES.instagram.book);
}

// ---------- in the library ----------
{
  check('Folders: text chats as before, other apps in their own folder', G.chatFolder('sms', 'Sam') === 'conversations/Sam' && G.chatFolder('whatsapp', 'Sam') === 'conversations/WhatsApp/Sam');
  check('Folders: a text chat named like an app’s folder stays apart', G.chatFolder('sms', 'WhatsApp') === 'conversations/WhatsApp (chat)');
  check('Older libraries read as text messages', G.serviceOf({}) === 'sms' && G.serviceOf({ service: 'telegram' }) === 'telegram');
  const msgs = [G.importedRecord({ id: 'a', at: Date.UTC(2024, 0, 1, 12), sender: 'Sam', text: 'hi' }), G.importedRecord({ id: 'b', at: Date.UTC(2024, 0, 1, 13), sender: 'Alex', sent: true, text: 'hey' })];
  const progress = { complete: false, history_complete: false, imported: { service: 'whatsapp', file: 'x.zip', at: '2024-01-02T00:00:00Z' } };
  const checks = G.checkChat(msgs, progress, null);
  check('An imported chat is "Imported"', checks.status === 'imported', `${checks.status}: ${checks.problems.join(', ')}`);
  const partial = G.checkChat(msgs, { ...progress, imported: { ...progress.imported, service: 'discord', partial: 'Only your own messages' } }, null);
  check('A partial import is still "Imported", with a warning', partial.status === 'imported' && partial.items.some((i) => i.id === 'start' && i.level === 'warn'));
  const row = G.summarize({ id: 'whatsapp:Sam', title: 'Sam', folder: 'conversations/WhatsApp/Sam', data: { service: 'whatsapp', conversation: 'Sam', messages: msgs }, progress: { ...progress, checks } });
  check('The index row carries its app', row.service === 'whatsapp' && row.status === 'imported');
  const v = G.verificationOf([row, { id: 'g1', title: 'Pat', folder: 'conversations/Pat', status: 'verified' }], { conversations: [{ id: 'g1', title: 'Pat' }] }, 'test').summary;
  check('Coverage counts only text chats; apps counted', v.coverage.in_messages === 1 && v.coverage.backed_up === 1 && v.services.whatsapp === 1 && v.services.sms === 1);
}

// ---------- accounts: which of your numbers or IDs within an app ----------
{
  check('Accounts: numbers compare however they’re written', G.sameAccount('+1 (555) 010-0000', '5550100000') && !G.sameAccount('+15550100000', '+15550199999'));
  check('Accounts: no account is the main one', G.sameAccount(null, '') && !G.sameAccount(null, '+15550100000'));
  check('Accounts: names compare without case', G.sameAccount('Alex.D', 'alex.d'));
  check('Accounts: a second account’s chats get their own folder', G.chatFolder('sms', 'Sam', { id: '+15550199999' }) === 'conversations/Google Messages - (555) 019-9999/Sam'
    && G.chatFolder('telegram', 'Sam', { id: 'user2', label: 'Work' }) === 'conversations/Telegram - Work/Sam' && G.chatFolder('sms', 'Sam') === 'conversations/Sam');
  const msgs = [G.importedRecord({ id: 'a', at: Date.UTC(2024, 0, 1), sender: 'Sam', text: 'hi' })];
  const row = G.summarize({ id: 'x', title: 'Sam', folder: 'f', data: { account: '+15550199999', account_label: '(555) 019-9999', conversation: 'Sam', messages: msgs }, progress: { history_complete: true, complete: true } });
  check('Accounts: the index row carries the account', row.account === '+15550199999' && row.account_label === '(555) 019-9999' && !('service' in row));
  const v = G.verificationOf([{ id: 'g1', title: 'Pat', folder: 'a', status: 'verified' }, { id: 'g1', title: 'Pat', folder: 'b', status: 'incomplete', account: '+15550199999' }], { conversations: [{ id: 'g1', title: 'Pat' }] }, 'test').summary;
  check('Accounts: Google Messages coverage counts the main account only', v.coverage.backed_up === 1);
  check('Google Messages is the label for text chats', G.serviceLabel('sms') === 'Google Messages' && G.appFolder('sms') === 'Google Messages' && G.appFolder('whatsapp') === 'WhatsApp');
  // Importers say whose export it is when the export does.
  const tg = set('Telegram export', { 'result.json': JSON.stringify({ personal_information: { user_id: 111, first_name: 'Alex', phone_number: '+1 555 010 0000' }, chats: { list: [{ name: 'Sam', type: 'personal_chat', id: 5, messages: [{ id: 1, type: 'message', date_unixtime: '1709287200', from: 'Sam', from_id: 'user5', text: 'hi' }] }] } }) });
  const tgs = (await I.open(Object.assign(new Blob([await tg.text('result.json')]), { name: 'result.json' }), ctx())).source;
  check('Accounts: Telegram’s export says whose (its phone number)', G.sameAccount(tgs.owner?.id, '+15550100000'));
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
