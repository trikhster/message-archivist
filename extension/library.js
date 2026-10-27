// Shared by the content script on the Messages tab and the settings page:
// merging newly read messages into a saved chat, the files that make up the
// backup library's index, and the checks that say whether a chat's backup is
// complete. Plain functions only, with no page or extension APIs.
//
// The library is one folder. data.js lists every chat with a short summary;
// each chat keeps its messages in conversations/<chat>/messages.json, plus a
// chat.js the viewer reads and its own messages.csv. A backup only rewrites
// the files of the chats it changed.
globalThis.GMLib = globalThis.GMLib || (() => {
  const INDEX_VERSION = 4;

  // ---------- settings ----------
  // One definition for every part: the content script, the background worker,
  // the popup and Settings. The defaults are what a first-time user should get:
  // everything needed to put the texts back on a phone later (photos at full
  // size, contact cards with numbers), in a window that stays out of the way.
  const SETTINGS_VERSION = 5;
  const SETTINGS_DEFAULTS = {
    folderName: '',
    includeMedia: true,
    fullSize: true,
    fullSizeEarly: true,
    backupWindow: 'corner', // 'corner' (small, in a corner), 'window' (own window), 'tab' (left where it is)
    compactCorner: 'bottom-right',
    notify: true,
    patience: 25,
    verifyRead: false,
    rawMarkup: false,
    phoneMedia: true,
    downloadsSubfolder: 'Google Messages Exports',
    caseNote: '',
    schedules: [],
  };
  // Settings saved by 4.x: the three "full size" switches become one, the two
  // window switches become one choice, and the popup's remembered checkboxes
  // become the settings themselves. Old choices that differ from the defaults
  // only carry over where they were clearly made on purpose.
  function normalizeSettings(raw) {
    const s = { ...(raw || {}) };
    if ((s.settingsVersion || 0) < SETTINGS_VERSION) {
      const p = s.popup || {};
      if (!('includeMedia' in s) && p.includeMedia === false) s.includeMedia = false;
      if (!('fullSize' in s) && p.fullSize === false) s.fullSize = false;
      if (!('backupWindow' in s) && s.ownWindow === false) s.backupWindow = 'tab';
      for (const k of ['popup', 'ownWindow', 'compactWindow', 'totalFullSize', 'scheduleFullSize', 'saveMode']) delete s[k];
      if (Array.isArray(s.schedules)) s.schedules = s.schedules.map(({ action, ...j }) => j);
      s.settingsVersion = SETTINGS_VERSION;
    }
    return { ...SETTINGS_DEFAULTS, ...s, schedules: Array.isArray(s.schedules) ? s.schedules : [] };
  }

  // ---------- merging ----------

  // A message is identified by Google's message ID, or by time + sender + text.
  const sigOf = (m) => `${m.timestamp}|${m.sender}|${m.text}|${(m.media || []).length + (m.gif_previews_skipped || m.previews_skipped || 0) + (m.duplicates_removed || 0)}`;
  const keyOf = (m) => m.id || sigOf(m);

  function unknownIn(saved, scraped) {
    const ids = new Set(saved.map((m) => m.id).filter(Boolean));
    const sigs = new Set(saved.map(sigOf));
    return scraped.filter((m) => !(m.id && ids.has(m.id)) && !sigs.has(sigOf(m)));
  }

  // Merges new records into the saved ones by time. Equal times keep their
  // on-screen order; undated messages stay next to the message before them.
  function mergeChrono(saved, added, scraped = []) {
    const pos = new Map();
    scraped.forEach((m, i) => { if (m.id) pos.set(`id:${m.id}`, i); if (!pos.has(`sig:${sigOf(m)}`)) pos.set(`sig:${sigOf(m)}`, i); });
    const at = (r) => (r.id && pos.get(`id:${r.id}`)) ?? pos.get(`sig:${sigOf(r)}`);
    const items = [];
    for (const [src, list] of [[0, saved], [1, added]]) {
      let t = '';
      list.forEach((r, i) => { t = r.timestamp || t; items.push({ r, t, src, i, at: at(r) }); });
    }
    items.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1
      : a.src === b.src ? a.i - b.i
      : a.at != null && b.at != null ? a.at - b.at : a.src - b.src));
    return items.map((x, k) => ({ ...x.r, index: k + 1 }));
  }

  // ---------- the same picture twice ----------
  // A message can hold the same picture more than once: a GIF and its still
  // preview, or a small thumbnail next to the full-size photo. A tiny
  // fingerprint of what each picture looks like (a 64-point brightness
  // pattern, the same at any size) tells them apart from different photos.

  async function imageFingerprint(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      const c = new OffscreenCanvas(9, 8);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, 9, 8);
      bmp.close?.();
      const d = g.getImageData(0, 0, 9, 8).data;
      const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      let bits = '';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += lum((y * 9 + x) * 4) > lum((y * 9 + x + 1) * 4) ? '1' : '0';
      return { bits, w, h };
    } catch {
      return null; // a format the browser can't draw (HEIC, say)
    }
  }

  // Same picture: nearly the same pattern and the same shape.
  function sameImage(a, b) {
    if (!a || !b) return false;
    let diff = 0;
    for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) diff++;
    const shape = (a.w / a.h) / (b.w / b.h);
    return diff <= 6 && shape > 0.9 && shape < 1.11;
  }

  // Of two copies of a picture, the one to keep: an animated GIF over its
  // still frame, then the bigger picture, then the bigger file.
  function betterCopy(a, b) {
    if (a.gif !== b.gif) return a.gif ? a : b;
    const area = (x) => (x.w || 0) * (x.h || 0);
    if (area(a) !== area(b)) return area(a) > area(b) ? a : b;
    return (a.size || 0) >= (b.size || 0) ? a : b;
  }

  // ---------- every picture's status ----------
  // Each photo, GIF, video and voice note in a chat has one status, so a backup
  // can say exactly what it holds and what's left to do:
  //   full       saved from Messages' full-size viewer
  //   same       the chat's picture, which the viewer showed was already full size
  //   thumbnail  the chat's smaller picture; "Upgrade to full size" can replace it later
  //   original   saved as Messages has it (GIFs, videos, voice notes, link previews)
  //   waiting    not fetched yet (a speed run, or a backup that stopped)
  //   skipped    not saved by choice (a link preview's picture from another website)
  //   failed     couldn't be saved; "Retry failed photos" tries again
  //   left       left out as another copy of one that was saved (a GIF's still
  //              frame, or a thumbnail beside the full-size photo)
  const MEDIA_STATUS = {
    full: 'Full size', same: 'Full size (the chat picture was already full size)', thumbnail: 'Thumbnail',
    original: 'Saved as sent', waiting: 'Not fetched yet', skipped: 'Not saved (by choice)', failed: 'Couldn’t be saved', left: 'Left out (another copy kept)',
  };
  function mediaStatus(md) {
    const file = md.file ?? md.f;
    const source = md.source ?? md.src ?? '';
    const kind = md.kind ?? md.k;
    if (file) {
      if (source === 'full-size viewer') return 'full';
      if (/same size as the full-size viewer/.test(source)) return 'same';
      if (kind === 'image' && /chat thumbnail/.test(source)) return 'thumbnail';
      return 'original';
    }
    if (md.skipped || md.skip) return 'skipped';
    if (md.error || md.err) return 'failed';
    return 'waiting';
  }
  const LEFT_OUT_NOTE = { 'gif-preview': 'the still frame of a GIF that was saved', duplicate: 'a smaller copy of a picture that was saved' };

  // The chat's master list of media: every item, its status and file, and the
  // pictures left out as copies. Takes full records (messages.json).
  function mediaIndex(messages, folder) {
    const rows = [];
    for (const m of messages) {
      const base = { message_index: m.index, message_id: m.id || null, timestamp: m.timestamp || null, sender: m.sender };
      (m.media || []).forEach((md, i) => rows.push({
        ...base, item: i + 1, kind: md.kind, status: mediaStatus(md), file: md.file ? `${folder}/${md.file}` : null,
        width: md.width || null, height: md.height || null, bytes: md.bytes || null, sha256: md.sha256 || null, source: md.source || null,
        note: md.error || md.skipped || (md.upgraded_from ? `upgraded from a ${md.upgraded_from.width || '?'}×${md.upgraded_from.height || '?'} thumbnail on ${(md.upgraded_from.at || '').slice(0, 10)}` : null),
      }));
      const left = m.media_left_out || Array.from({ length: m.gif_previews_skipped || 0 }, () => ({ kind: 'image', reason: 'gif-preview' }));
      for (const lo of left) rows.push({ ...base, item: null, kind: lo.kind, status: 'left', file: null, width: lo.width || null, height: lo.height || null, bytes: null, sha256: null, source: null, note: LEFT_OUT_NOTE[lo.reason] || lo.reason || null });
    }
    return rows;
  }
  const mediaCounts = (statuses) => {
    const c = { full: 0, same: 0, thumbnail: 0, original: 0, waiting: 0, skipped: 0, failed: 0, left: 0 };
    for (const st of statuses) c[st] = (c[st] || 0) + 1;
    return c;
  };
  function mediaIndexCsv(title, rows) {
    const head = ['conversation', 'message_index', 'message_id', 'timestamp', 'sender', 'item', 'kind', 'status', 'status_text', 'file', 'width', 'height', 'bytes', 'sha256', 'source', 'note'];
    return BOM + [head.join(','), ...rows.map((r) => [title, r.message_index, r.message_id, r.timestamp, r.sender, r.item, r.kind, r.status, MEDIA_STATUS[r.status], r.file, r.width, r.height, r.bytes, r.sha256, r.source, r.note].map(csvCell).join(','))].join('\r\n') + '\r\n';
  }

  // ---------- per-chat files ----------

  // The viewer's compact form of a chat's messages, with media paths from the library root.
  function compactMessages(folder, messages) {
    return messages.map((m) => {
      const o = { i: m.index, d: m.direction === 'sent' ? 1 : 0, s: m.sender, t: m.timestamp, x: m.text };
      if (m.timestamp_precision && m.timestamp_precision !== 'message') o.p = m.timestamp_precision;
      if (m.timestamp_raw) o.tr = m.timestamp_raw;
      if (m.id) o.id = m.id;
      if (m.media?.length) {
        o.m = m.media.map((md) => ({
          k: md.kind,
          f: md.file ? `${folder}/${md.file}` : null,
          ...(md.width ? { w: md.width, h: md.height } : {}),
          ...(md.source ? { src: md.source } : {}),
          ...(md.sha256 ? { sha: md.sha256 } : {}),
          ...(md.skipped ? { err: md.skipped, skip: 1 } : md.error ? { err: md.error } : {}),
          st: mediaStatus(md),
        }));
      }
      if (m.media_left_out?.length) o.lo = m.media_left_out.map((x) => ({ k: x.kind, why: x.reason, ...(x.width ? { w: x.width, h: x.height } : {}) }));
      if (m.reply_to) o.r = { s: m.reply_to.sender, x: m.reply_to.text };
      if (m.reactions?.length) o.rc = m.reactions;
      return o;
    });
  }

  // Loaded by the viewer with a <script> tag, so it works straight from disk.
  const chatScript = (folder, compact) => `(window.GM_CHATS = window.GM_CHATS || {})[${JSON.stringify(folder)}] = ${JSON.stringify(compact)};\n`;

  function contactSummary(folder, contact) {
    if (!contact?.people) return null;
    return {
      e2ee: contact.end_to_end_encrypted ?? contact.e2ee ?? null,
      at: contact.captured_at || contact.at || null,
      people: contact.people.map((p) => p.n !== undefined ? p : ({ n: p.name, num: p.number, photo: p.photo ? (p.photo.startsWith('data:') ? p.photo : `${folder}/${p.photo}`) : null, ...(p.favorite ? { fav: 1 } : {}) })),
    };
  }

  const CSV_HEADER = ['conversation', 'index', 'message_id', 'timestamp', 'timestamp_precision', 'timestamp_raw', 'sender', 'direction', 'text', 'reply_to', 'media_files', 'media_sha256', 'status', 'reactions', 'edited', 'links'].join(',');
  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const BOM = '﻿'; // so Excel reads UTF-8 (emoji etc.)

  // One chat's messages.csv. Takes full records (messages.json) or the compact form.
  function chatCsv(title, folder, messages) {
    const lines = [CSV_HEADER];
    for (const raw of messages) {
      const m = raw.i !== undefined && raw.index === undefined
        ? { index: raw.i, id: raw.id, timestamp: raw.t, timestamp_precision: raw.p || 'message', timestamp_raw: raw.tr, sender: raw.s, direction: raw.d ? 'sent' : 'received', text: raw.x, reply_to: raw.r ? { sender: raw.r.s, text: raw.r.x } : null,
          media: (raw.m || []).map((x) => ({ kind: x.k, file: x.f ? x.f.slice(folder.length + 1) : null, sha256: x.sha })) }
        : raw;
      lines.push([title, m.index, m.id, m.timestamp, m.timestamp_precision, m.timestamp_raw, m.sender, m.direction, m.text,
        m.reply_to ? `${m.reply_to.sender}: ${m.reply_to.text}` : '',
        (m.media || []).map((md) => (md.file ? `${folder}/${md.file}` : `[${md.kind} missing]`)).join(' '),
        (m.media || []).map((md) => md.sha256 || '').filter(Boolean).join(' '),
        m.status || '', (m.reactions || []).join(' | '), m.edited ? 'yes' : '', (m.links || []).join(' ')].map(csvCell).join(','));
    }
    return BOM + lines.join('\r\n') + '\r\n';
  }

  // The whole library's messages.csv, joined from each chat's own file.
  function joinCsv(parts) {
    return BOM + CSV_HEADER + '\r\n' + parts.map((p) => p.replace(/^﻿?[^\r\n]*\r?\n/, '')).join('');
  }

  // ---------- completeness checks ----------
  // Run after every save of a chat and kept in its progress.json, so the
  // settings page and the viewer can say how sure we are that it's complete.

  // Works on full records and on the viewer's compact form alike.
  const norm = (m) => ({ id: m.id, t: m.timestamp !== undefined ? m.timestamp : m.t, left: (m.media_left_out || m.lo || []).length || m.gif_previews_skipped || 0,
    media: (m.media || m.m || []).map((md) => ({ file: md.file ?? md.f ?? null, skipped: !!(md.skipped || md.skip), error: md.error ?? md.err ?? null, status: md.st || mediaStatus(md) })) });

  function checkChat(messages, progress, contact) {
    const list = messages.map(norm);
    const items = [];
    const add = (id, level, label, detail) => items.push({ id, level, label, detail });
    const p = progress || {};
    const historyDone = !!(p.history_complete ?? p.complete);

    const s = p.start;
    if (historyDone) {
      add('start', 'ok', 'Reached the first message',
        s?.detail ? `${s.detail}${s.at ? ` (${s.at.slice(0, 10)})` : ''}` : s?.method === 'earlier run' ? 'Confirmed by an earlier backup' : 'Confirmed by an earlier backup');
    } else if (p.from_phone) {
      // From a phone backup (the Android app): every message the phone had.
      add('start', 'ok', 'Whole chat from the phone', `Every message the phone had${p.from_phone.at ? ` on ${p.from_phone.at.slice(0, 10)}` : ''} (${p.from_phone.file || 'a phone backup'}). A backup from Google Messages adds any it didn’t keep, and the contact card.`);
    } else if (p.imported_from) {
      add('start', 'bad', 'Not yet read from Messages', `Imported from “${p.imported_from}”. The next backup reads the whole chat again to make sure nothing older is missing.`);
    } else {
      add('start', 'bad', 'History not fully loaded', p.stopped_reason || 'The backup stopped before reaching the first message. Run it again to carry on.');
    }

    const nc = p.newest_check;
    if (!nc && p.from_phone && !historyDone) add('newest', 'ok', 'Newest messages saved', `Up to the phone backup${p.from_phone.at ? ` of ${p.from_phone.at.slice(0, 10)}` : ''}`);
    else if (nc) add('newest', nc.all_saved ? 'ok' : 'bad', 'Newest messages saved', nc.all_saved ? `The ${nc.on_screen} newest messages on screen are all in the backup (${(nc.at || '').slice(0, 16).replace('T', ' ')})` : 'Some of the newest messages on screen are missing from the backup');
    else add('newest', 'warn', 'Newest messages not checked', 'The next backup checks this.');

    const ids = list.map((m) => m.id).filter(Boolean);
    const dupes = ids.length - new Set(ids).size;
    add('ids', dupes ? 'bad' : 'ok', dupes ? 'Duplicate messages' : 'No duplicates', dupes ? `${dupes} message IDs appear more than once` : `${list.length.toLocaleString()} messages, ${ids.length.toLocaleString()} with Google message IDs`);

    let back = 0;
    let last = '';
    for (const m of list) { if (m.t) { if (m.t.slice(0, 16) < last.slice(0, 16)) back++; last = m.t; } }
    const undated = list.filter((m) => !m.t).length;
    add('order', back ? 'warn' : 'ok', 'In time order', back ? `${back} messages are earlier than the one before them` : `Oldest to newest${undated ? `, ${undated} without a date` : ''}`);

    const media = list.flatMap((m) => m.media);
    const c = mediaCounts(media.map((x) => x.status));
    const pending = c.waiting;
    const failed = c.failed;
    const savedMedia = c.full + c.same + c.thumbnail + c.original;
    const n = (x) => x.toLocaleString();
    // Every item accounted for: its status, in plain words.
    const breakdown = [c.full + c.same && `${n(c.full + c.same)} full size`, c.thumbnail && `${n(c.thumbnail)} thumbnail${c.thumbnail === 1 ? '' : 's'} (can be upgraded)`, c.original && `${n(c.original)} saved as sent`,
      c.waiting && `${n(c.waiting)} not fetched yet`, c.failed && `${n(c.failed)} failed`, c.skipped && `${n(c.skipped)} link-preview picture${c.skipped === 1 ? '' : 's'} from other websites not saved`,
      list.reduce((t, m) => t + m.left, 0) && `${n(list.reduce((t, m) => t + m.left, 0))} left out as copies`].filter(Boolean).join(', ');
    if (pending && p.speed_run) add('media', 'warn', 'Photos not fetched yet (speed run)', `${breakdown}. “Fetch photos” saves them later, going back in the chat only as far as it needs to.`);
    else if (pending) add('media', 'bad', 'Media still to fetch', breakdown);
    else if (failed) add('media', 'warn', 'Some media couldn’t be saved', `${breakdown}. “Retry failed photos” tries them again.`);
    else add('media', 'ok', 'All media accounted for', media.length ? breakdown : 'No media in this chat');

    add('contact', contact?.people?.length ? 'ok' : 'warn', 'Contact card', contact?.people?.length ? contact.people.map((x) => x.name || x.n).join(', ') : 'Not captured');

    const sr = p.second_read;
    if (sr) {
      add('second', sr.added ? 'warn' : 'ok', 'Second read',
        sr.added ? `Reading the chat again found ${sr.added} more messages; they’re saved now` : `Read again on ${(sr.at || '').slice(0, 10)}: all ${Number(sr.read).toLocaleString()} messages matched`);
    }

    const bad = items.filter((i) => i.level === 'bad');
    const warn = items.filter((i) => i.level === 'warn');
    // A speed run saves every message first and lists its photos to fetch later.
    // From the phone and not yet read from Messages: "From phone", unless something's wrong.
    const status = !historyDone ? (p.from_phone ? (bad.some((i) => i.id !== 'media') ? 'problem' : pending ? 'messages' : 'phone') : 'incomplete')
      : pending ? (p.speed_run ? 'messages' : 'incomplete') : bad.length ? 'problem' : warn.length ? 'complete' : 'verified';
    return { status, checked_at: new Date().toISOString(), problems: [...bad, ...warn].map((i) => i.label), items };
  }

  const STATUS_LABEL = { verified: 'Verified complete', complete: 'Complete', phone: 'From phone', messages: 'Messages saved, photos to fetch', incomplete: 'Unfinished', problem: 'Needs attention' };

  // Which chats are completely backed up, and (after "Back up everything")
  // which conversations in Messages aren't.
  function verificationOf(rows, state, version) {
    const count = (s) => rows.filter((r) => r.status === s).length;
    const summary = { checked_at: new Date().toISOString(), chats: rows.length, verified: count('verified'), complete: count('complete'), phone: count('phone'), messages: count('messages'), incomplete: count('incomplete'), problem: count('problem') };
    let coverage = null;
    if (state?.conversations?.length) {
      const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id, r]));
      // Chats you deleted from the backup and chose not to back up again don't count.
      const skip = new Set((state.excluded || []).map((e) => e.id));
      const convs = state.conversations.filter((c) => !skip.has(c.id));
      const missing = convs.filter((c) => !byId.has(c.id));
      const unfinished = convs.filter((c) => ['incomplete', 'problem'].includes(byId.get(c.id)?.status));
      coverage = { scanned_at: state.scanned_at, in_messages: convs.length, backed_up: convs.length - missing.length - unfinished.length, not_backed_up: missing, unfinished: unfinished.map(({ id, title }) => ({ id, title })), ...(skip.size ? { left_out: state.excluded } : {}) };
      summary.coverage = { scanned_at: coverage.scanned_at, in_messages: coverage.in_messages, backed_up: coverage.backed_up, not_backed_up: missing.length, unfinished: unfinished.length };
    }
    return {
      summary,
      full: {
        ...summary,
        tool: 'Message Archivist', version,
        statuses: STATUS_LABEL,
        coverage,
        chats: rows.map((r) => ({ title: r.title, id: r.id, folder: r.folder, status: r.status, problems: r.problems, messages: r.count, first: r.first, last: r.last,
          media_saved: r.media_saved, media_failed: r.media_failed, media_pending: r.media_pending, checked_at: r.checked_at, details: `${r.folder}/progress.json` })),
      },
    };
  }

  // ---------- the index (data.js) ----------

  // The summary row data.js keeps for a chat. `messages` may be full records or compact.
  function summarize({ id, title, folder, data, progress, compact }) {
    const msgs = data?.messages || compact?.messages || [];
    const list = msgs.map(norm);
    const dated = list.filter((m) => m.t);
    const media = list.flatMap((m) => m.media);
    const contact = data?.contact || compact?.contact || null;
    const checks = progress?.checks || checkChat(msgs, progress, contact);
    return {
      id: id || data?.conversation_id || compact?.id || null,
      title: title || data?.conversation || compact?.title,
      folder,
      file: `${folder}/chat.js`,
      participants: data?.participants || compact?.participants || [...new Set(msgs.map((m) => m.sender ?? m.s))],
      updated_at: data?.updated_at || data?.exported_at || compact?.updated_at || null,
      range: data?.range || compact?.range || null,
      ...(contact ? { contact: contactSummary(folder, contact) } : {}),
      ...(data?.conversation_details?.pinned || compact?.pinned ? { pinned: true } : {}),
      count: list.length,
      first: dated[0]?.t || null,
      last: dated[dated.length - 1]?.t || null,
      media_saved: media.filter((x) => x.file).length,
      media_failed: media.filter((x) => !x.file && !x.skipped && x.error).length,
      media_pending: media.filter((x) => !x.file && !x.skipped && !x.error).length,
      media_skipped: media.filter((x) => !x.file && x.skipped).length,
      media: { ...mediaCounts(media.map((x) => x.status)), left: list.reduce((t, m) => t + m.left, 0) },
      status: checks.status,
      problems: checks.problems,
      checked_at: checks.checked_at,
    };
  }

  const indexScript = (exp) => `window.GM_EXPORT = ${JSON.stringify({ ...exp, version: INDEX_VERSION })};\n`;
  const parseIndex = (text) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  // Reads data.js. An index from before version 4 kept every message in
  // data.js; each of its chats gets its own chat.js and messages.csv here, once.
  // `io` is { readText(path) -> string|null, write(path, data) }.
  async function readLibrary(io, log = () => {}) {
    const text = await io.readText('data.js');
    if (!text) return null;
    const exp = parseIndex(text);
    const rows = [];
    let converted = 0;
    for (const c of exp.conversations || []) {
      if (!c?.folder) continue;
      if (c.file && !c.messages) { rows.push(c); continue; }
      let progress = null;
      try { progress = JSON.parse((await io.readText(`${c.folder}/progress.json`)) || 'null'); } catch { /* none */ }
      await io.write(`${c.folder}/chat.js`, chatScript(c.folder, c.messages || []));
      await io.write(`${c.folder}/messages.csv`, chatCsv(c.title, c.folder, c.messages || []));
      rows.push(summarize({ id: c.id, title: c.title, folder: c.folder, progress, compact: c }));
      converted++;
    }
    if (converted) log(`Gave ${converted} chat${converted === 1 ? '' : 's'} their own index files (faster saves from now on)`);
    return { exp, rows, converted };
  }

  // ---------- the restore package ----------
  // What the Android app (android/ in this project) restores from: one .tar
  // file, written a piece at a time, so years of texts and photos never have
  // to fit in memory. Tar because each entry is just a 512-byte header and the
  // bytes, with no size or file-count limits that matter here (zip needs Zip64
  // past 4 GB or 65,535 files). Entries:
  //   media/<n>.<ext>          photos, videos and voice notes, as saved
  //   threads/<nnnn>.ndjson    one JSON object per line per message
  //   manifest.json            last: format, totals and every thread
  // See notes/Restore package.md.
  const RESTORE_FORMAT = 'gm-restore';
  const RESTORE_VERSION = 1;
  function tarHeader(name, size, mtimeMs = Date.now()) {
    const h = new Uint8Array(512);
    const put = (str, off, len) => { for (let i = 0; i < Math.min(str.length, len); i++) h[off + i] = str.charCodeAt(i) & 0xff; };
    const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
    if (name.length > 100) throw new Error(`Name too long for the package: ${name}`);
    put(name, 0, 100);
    put('0000644\0', 100, 8);
    put('0000000\0', 108, 8);
    put('0000000\0', 116, 8);
    put(oct(size, 12), 124, 12);
    put(oct(Math.floor(mtimeMs / 1000), 12), 136, 12);
    put('        ', 148, 8); // checksum is summed with these as spaces
    h[156] = 0x30; // '0': a regular file
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  }
  const tarPadding = (size) => new Uint8Array((512 - (size % 512)) % 512);
  const tarEnd = () => new Uint8Array(1024);

  // The newest package format this reads: 2 lets a chat be in several pieces
  // (the Android app's daily backups). The extension itself writes 1.
  const RESTORE_READS = 2;

  // ---------- phone numbers ----------

  const phoneDigits = (n) => (n || '').replace(/[^\d+]/g, '');

  // Who a chat's messages go to on the phone: the numbers on its contact card,
  // or, for a chat named by its number or a short code (texts from businesses),
  // that number.
  const NUMBER_TITLE = /^\+?[\d\s().-]{3,}$/;
  function restoreAddrs(people, title) {
    const nums = (people || []).map((p) => phoneDigits(p.number ?? p.num)).filter((n) => n.replace('+', '').length >= 3);
    if (nums.length) return nums;
    const t = phoneDigits(title);
    return NUMBER_TITLE.test(title || '') && t.replace('+', '').length >= 3 ? [t] : [];
  }

  // A phone number as Google Messages shows it: "(555) 020-0001" in North
  // America, "+44 770 090 0123" elsewhere. Short codes, names, and anything
  // too long to be one number stay as they are; a list is each of its numbers.
  function formatNumber(s) {
    const one = (t) => {
      const raw = t.trim();
      if (!NUMBER_TITLE.test(raw)) return raw;
      const d = raw.replace(/\D/g, '');
      if (d.length === 10 || (d.length === 11 && d[0] === '1')) { const x = d.slice(-10); return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`; }
      if (raw.startsWith('+') && d.length > 10 && d.length <= 15) { const x = d.slice(-10); return `+${d.slice(0, -10)} ${x.slice(0, 3)} ${x.slice(3, 6)} ${x.slice(6)}`; }
      return raw;
    };
    return String(s ?? '').split(/,\s*/).map(one).join(', ');
  }
  // Named only by its number (or numbers).
  const isNumberName = (s) => String(s || '').split(/,\s*/).every((t) => NUMBER_TITLE.test(t.trim()));

  // Chats in every list: favourites first (pinned in Messages, a starred
  // contact on the phone, or labelled Favorites), then chats with names A–Z,
  // then those known only by a number. `fav(row)` says which are favourites.
  const chatOrder = (fav = () => false) => (a, b) => (fav(b) - fav(a)) || (isNumberName(a.title) - isNumberName(b.title))
    || String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base', numeric: true });
  const isFavourite = (row) => !!(row.pinned || row.contact?.people?.some((p) => p.fav));

  // ---------- phone backups ----------
  // The Android app backs a phone up into the same package format (see
  // notes/Restore package.md), with exact times and the phone's own contact
  // names. These turn one into library chats; options.js imports them.

  // A phone number in a form that compares across formats: the last ten
  // digits ("+1 (555) 020-0000" and "5550200000" match), a short code's
  // digits, or a business's name ("AMAZON") in lower case.
  function phoneKey(a) {
    const d = String(a || '').replace(/\D/g, '');
    return d ? d.slice(-10) : String(a || '').trim().toLowerCase();
  }

  // Opens a package from its headers alone, read a window at a time so that
  // many small photos cost few reads. Entries come back as slices of the file.
  async function readPackage(blob) {
    const entries = new Map(); // name -> [offset, size]
    const WIN = 1 << 20;
    const dec = new TextDecoder();
    let win = null;
    let winAt = 0;
    for (let pos = 0; pos + 512 <= blob.size;) {
      if (!win || pos + 512 > winAt + win.length) { winAt = pos; win = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + WIN)).arrayBuffer()); }
      const h = win.subarray(pos - winAt, pos - winAt + 512);
      if (h.every((b) => b === 0)) break;
      const str = (o, l) => { let e = o; while (e < o + l && h[e]) e++; return dec.decode(h.subarray(o, e)); };
      const prefix = str(345, 155);
      const size = parseInt(str(124, 12).trim() || '0', 8);
      entries.set((prefix ? `${prefix}/` : '') + str(0, 100), [pos + 512, size]);
      pos += 512 + Math.ceil(size / 512) * 512;
    }
    const entry = (name) => { const e = entries.get(name); return e ? blob.slice(e[0], e[0] + e[1]) : null; };
    const m = entry('manifest.json');
    if (!m) throw new Error('That isn’t a phone backup from the Message Archivist app (it has no manifest).');
    const manifest = JSON.parse(await m.text());
    if (manifest.format !== RESTORE_FORMAT) throw new Error('That isn’t a phone backup from the Message Archivist app.');
    if (manifest.version > RESTORE_READS) throw new Error('That backup is from a newer version of the Message Archivist app. Update the extension first.');
    const lines = async (name) => ((await entry(name)?.text()) || '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    // A chat kept up to date by daily phone backups is in several pieces (`files`, version 2), oldest first.
    const threadLines = async (t) => (await Promise.all((t.files || [t.file]).map(lines))).flat();
    return { manifest, entry, lines, threadLines, size: (name) => entries.get(name)?.[1] ?? 0 };
  }

  const pad2 = (x) => String(x).padStart(2, '0');
  // Milliseconds as the library writes times: "YYYY-MM-DD HH:MM", local time.
  const localMinute = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

  // One phone chat as library records. Sent messages are "Me", as in a
  // backup from Google Messages for Web; received ones are under the phone's
  // name for the sender (options.js swaps in the library's own names when the
  // chat is already there), with the number kept beside it. Each photo gets
  // the library's usual name, and `files` maps those names to the package.
  function phoneChat(thread, lines, sizeOf = () => null, at = null) {
    const names = thread.names || {};
    const group = thread.addresses.length > 1;
    const files = new Map();
    const messages = lines.map((l) => {
      const sent = l.box === 2;
      const number = sent ? null : l.from || (group ? null : thread.addresses[0]) || null;
      const sender = sent ? 'Me' : (number && names[number]) || (group ? number : thread.title) || number || 'Unknown';
      const timestamp = localMinute(l.date);
      const m = {
        direction: sent ? 'sent' : 'received', sender, ...(number ? { sender_number: number } : {}), text: l.text || '',
        timestamp, timestamp_precision: 'message', timestamp_raw: new Date(l.date).toISOString(), phone_id: l.src_id || null,
        ...(l.subject ? { subject: l.subject } : {}), media: [],
      };
      for (const p of l.parts || []) {
        const ct = p.ct || '';
        const kind = ct === 'image/gif' ? 'gif' : ct.startsWith('image/') ? 'image' : ct.startsWith('video/') ? 'video' : ct.startsWith('audio/') ? 'audio' : 'file';
        // Backed up without photos: the photo is known to be there, not saved yet.
        if (!p.file) { m.media.push({ kind, file: null, source: 'phone backup', content_type: ct || null, ...(p.name ? { original_name: p.name } : {}), ...(p.id ? { phone_part: p.id } : {}) }); continue; }
        const ext = (p.file.match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
        const base = `media/${timestamp.replace(':', '.')} - ${safeName(sender)}`;
        let name = `${base}${ext}`;
        for (let n = 2; files.has(name); n++) name = `${base} (${n})${ext}`;
        files.set(name, p.file);
        m.media.push({
          kind,
          file: name, bytes: sizeOf(p.file), source: 'phone backup', content_type: ct || null, ...(p.name ? { original_name: p.name } : {}), ...(p.id ? { phone_part: p.id } : {}),
        });
      }
      return m;
    });
    // Who's in the chat, as the phone's contacts have them: starred ones are
    // favourites, and their photo (a small one, in the package) comes along.
    const info = new Map((thread.people || []).map((p) => [p.address, p]));
    const people = thread.addresses.map((a) => {
      const p = info.get(a) || {};
      const name = names[a] || a;
      let photo = null;
      if (p.photo) { photo = `contact/${safeName(name)}${(p.photo.match(/\.[a-z0-9]{1,5}$/i) || ['.jpg'])[0]}`; files.set(photo, p.photo); }
      return { name, number: a, ...(p.starred ? { favorite: true } : {}), ...(photo ? { photo } : {}) };
    });
    return {
      data: { conversation: thread.title || thread.addresses.join(', '), conversation_id: null, participants: [...new Set(messages.map((m) => m.sender))], messages,
        contact: { captured_at: at, source: 'phone backup', people } },
      files,
    };
  }

  // The library chat a phone chat belongs to: the one with the same phone
  // numbers (on its contact card, or as its name), else one with the same
  // name and no numbers to go by.
  function phoneRowFor(rows, thread) {
    const want = new Set(thread.addresses.map(phoneKey));
    const keys = (r) => new Set(restoreAddrs(r.contact?.people, r.title).map(phoneKey));
    return rows.find((r) => { const k = keys(r); return k.size === want.size && [...k].every((x) => want.has(x)); })
      || rows.find((r) => !keys(r).size && r.title.toLowerCase() === (thread.title || '').toLowerCase()) || null;
  }

  // Received phone messages under the names the library already uses for
  // those people (from its contact card; in a one-to-one chat, its name).
  function useLibraryNames(incoming, row) {
    const people = row.contact?.people || [];
    const byNumber = new Map(people.filter((p) => p.num ?? p.number).map((p) => [phoneKey(p.num ?? p.number), p.n ?? p.name]));
    const oneToOne = restoreAddrs(people, row.title).length <= 1;
    for (const m of incoming) {
      if (m.direction === 'received') m.sender = byNumber.get(phoneKey(m.sender_number)) || (oneToOne ? row.title : m.sender);
    }
  }

  // Phone messages have no Google message ID, and Google Messages for Web can
  // show a photo and its caption as two messages, so matching is looser than
  // keyOf: two messages are the same when they're from the same side, in the
  // same minute (or the one before or after), with the same text, or for a
  // photo with no text, a photo. Each message stands in for one other only,
  // so two "ok"s need two "ok"s. Used both ways: a phone backup coming into
  // the library (unknownPhone), and a backup from the web meeting messages
  // that came from a phone (content.js claims them).
  const normText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  function phoneSlots(messages) {
    const slots = new Map(); // "minute|direction" -> messages
    for (const m of messages) {
      if (!m.timestamp) continue;
      const k = `${m.timestamp}|${m.direction}`;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k).push(m);
    }
    return slots;
  }
  // Takes the message in `slots` that `p` matches out of them, and returns it (or null).
  function claimPhone(slots, p) {
    if (!p.timestamp) return null;
    const text = normText(p.text);
    const pics = (p.media || []).length > 0;
    const t = new Date(p.timestamp.replace(' ', 'T')).getTime();
    for (const ts of [p.timestamp, localMinute(t - 60e3), localMinute(t + 60e3)]) {
      const list = slots.get(`${ts}|${p.direction}`);
      const i = list ? list.findIndex((m) => (text ? normText(m.text) === text : pics && (m.media || []).length > 0)) : -1;
      if (i >= 0) return list.splice(i, 1)[0];
    }
    return null;
  }
  // A backup from the web meeting messages that came from a phone: each
  // message on the page claims the phone message it matches, which takes the
  // page's ID. A phone message with a photo and a caption can be two messages
  // on the page; the second half then claims it too (kept in `also_ids`), but
  // only if it brings the other half (just the photo, or just the text), so
  // two real "ok"s stay two.
  function phoneClaims(saved) {
    const left = phoneSlots(saved.filter((r) => r.phone_id && !r.id));
    const halves = new Map();
    const half = (m) => (m.text ? ((m.media || []).length ? '' : 'text') : 'media');
    return {
      claim(m) {
        if (!m.id) return null;
        const r = left.size ? claimPhone(left, m) : null;
        if (r) {
          r.id = m.id;
          if (r.text && r.media?.length && half(m)) {
            const rest = half(m) === 'text' ? { text: '', media: r.media } : { text: r.text, media: [] };
            const k = `${r.timestamp}|${r.direction}`;
            halves.set(k, [...(halves.get(k) || []), { timestamp: r.timestamp, direction: r.direction, ...rest, rec: r }]);
          }
          return r;
        }
        const h = halves.size ? claimPhone(halves, m) : null;
        if (!h) return null;
        h.rec.also_ids = [...(h.rec.also_ids || []), m.id];
        return h.rec;
      },
    };
  }

  function unknownPhone(saved, incoming) {
    const slots = phoneSlots(saved);
    return incoming.filter((p) => !claimPhone(slots, p));
  }

  // ---------- checksums ----------

  function parseSums(text) {
    const sums = new Map();
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
      if (m) sums.set(m[2], m[1]);
    }
    return sums;
  }
  const formatSums = (sums) => [...sums].filter(([p]) => p !== 'SHA256SUMS.txt').sort((a, b) => a[0].localeCompare(b[0])).map(([p, h]) => `${h}  ${p}`).join('\n') + '\n';

  async function sha256(data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const safeName = (s) => (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 60) || 'Conversation';

  const README = `Google Messages backup

index.html                          Open this in your browser: every chat, search,
                                    drill-downs, media and stats, all offline.
viewer.js, theme.*, data.js         What index.html runs on. Keep them next to it.
messages.csv                        Every message of every chat in one spreadsheet.
verification.json                   How complete each chat's backup is, and why:
                                    first message reached, newest saved, media,
                                    duplicates, and which conversations aren't backed up.
export-info.json                    Who/what/when: tool version, browser, timezone,
                                    and a record of every backup, update and import.
logs/                               The full step-by-step log of each run.
SHA256SUMS.txt                      SHA-256 checksum of every file. To check nothing
                                    has changed since:  shasum -a 256 -c SHA256SUMS.txt
labels.json, labels.js              Your labels, flags and notes (not in the checksums).
conversations/<contact>/
  messages.json                     The chat, machine readable, including Google's
                                    message IDs and the exact on-screen labels.
  progress.json                     How far the backup has got, the evidence that it
                                    reached the first message, and its checks.
  media-index.json, .csv            Every photo and video in the chat with its status:
                                    full size, thumbnail, not fetched yet, failed...
  journal/                          Messages saved during a backup, before they're
                                    added to messages.json. Gone when it finishes.
  chat.js, messages.csv             This chat for the viewer, and as a spreadsheet.
  contact.json, contact/            Names, numbers and contact photos.
  media/                            Photos, GIFs, videos and audio, named
                                    "<date> <time> - <sender>.<ext>".

To add new messages later, open messages.google.com and use the extension:
"Back up this chat", the backup list, or "Back up everything" in its Settings.

Timestamps
  timestamp            Normalised to your local time, "YYYY-MM-DD HH:MM".
  timestamp_precision  "message": the time shown for that exact message.
                       "section": the time of the date heading above it.
                       "day":     only the date was known.
  timestamp_raw        Exactly what the page showed, so you can double-check.

Media is saved byte-for-byte as Google Messages for Web had it. "source" in
messages.json says whether a photo came from the full-size viewer or the chat
thumbnail. RCS photos are full size; SMS/MMS photos are compressed by the carrier.
`;

  return {
    SETTINGS_VERSION, SETTINGS_DEFAULTS, normalizeSettings,
    RESTORE_FORMAT, RESTORE_VERSION, tarHeader, tarPadding, tarEnd,
    phoneDigits, restoreAddrs, formatNumber, isNumberName, chatOrder, isFavourite, phoneKey, readPackage, phoneChat, phoneRowFor, useLibraryNames, phoneSlots, claimPhone, phoneClaims, unknownPhone,
    INDEX_VERSION, sigOf, keyOf, unknownIn, mergeChrono, imageFingerprint, sameImage, betterCopy,
    MEDIA_STATUS, mediaStatus, mediaIndex, mediaCounts, mediaIndexCsv,
    compactMessages, chatScript, contactSummary, chatCsv, joinCsv,
    checkChat, STATUS_LABEL, verificationOf, summarize, indexScript, parseIndex, readLibrary,
    parseSums, formatSums, sha256, safeName, README,
  };
})();
