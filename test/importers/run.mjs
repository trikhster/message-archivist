// Checks the importers (extension/importers/) on small made-up exports of
// each app, and that their chats fit the library: the right app, "Me" for
// your messages, media found or marked as left out, the "Imported" status,
// and nothing added twice when the same export comes in again.
// All names, numbers and texts here are invented.
// node test/importers/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = 'extension';
new Function(readFileSync(join(EXT, 'library.js'), 'utf8'))();
for (const f of ['importers.js', ...readdirSync(join(EXT, 'importers')).filter((f) => f !== 'importers.js' && f.endsWith('.js'))]) new Function(readFileSync(join(EXT, 'importers', f), 'utf8'))();
const G = globalThis.GMLib;
const I = globalThis.GMImport;

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };

// An in-memory set of files, as GMImport.fileSet makes from a zip or folder.
const set = (name, files) => ({ name, names: Object.keys(files), blob: async (p) => (p in files ? new Blob([files[p]]) : null), text: async (p) => (p in files ? String(files[p]) : null) });
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
      '[03/02/2024, 09:15:02] Sam Rivers: Messages and calls are end-to-end encrypted.',
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

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
