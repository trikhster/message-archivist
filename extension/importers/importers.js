// Importers: other apps' own exports, turned into library chats. Each app's
// importer (the other files in this folder) registers itself here with
//   { id, service, label, how, detect(set) -> bool, open(set, ctx) -> chats }
// where `set` is the picked file, zip or folder as one set of files (fileSet)
// and each chat is { key, data, files }: `data` is the chat in the library's
// own messages.json shape (records from GMLib.importedRecord), and `files`
// maps each media path in it ("media/<name>") to the file in the set.
// Settings turns the chats into an import source (sourceOf) and merges them
// like any other export: only messages the library doesn't have are added.
//
// `ctx` is what an importer may ask of Settings: whoAmI(service, names, hint)
// for which sender is the person whose archive this is, when the export
// doesn't say, and `locale` for dates an export writes ambiguously.
// Plain functions only (GMLib, GMZip), so they run in tests too.
globalThis.GMImport = globalThis.GMImport || (() => {
  const importers = [];

  // The picked thing as one set of files: `names` are paths inside it with
  // "/", read with blob(path) or text(path). A zip is read in place; a folder
  // is walked (dot files skipped); any other file is a set of one.
  async function fileSet(picked) {
    if (picked.kind === 'directory') {
      const handles = new Map();
      const walk = async (dir, prefix, depth) => {
        for await (const [name, h] of dir.entries()) {
          if (name.startsWith('.')) continue;
          if (h.kind === 'directory') { if (depth < 10) await walk(h, `${prefix}${name}/`, depth + 1); } else handles.set(`${prefix}${name}`, h);
        }
      };
      await walk(picked, '', 0);
      const blob = async (p) => { const h = handles.get(p); return h ? h.getFile() : null; };
      return { name: picked.name, names: [...handles.keys()], blob, text: async (p) => (await blob(p))?.text() ?? null };
    }
    if (/\.zip$/i.test(picked.name)) {
      const zip = await GMZip.open(picked);
      return { name: picked.name, names: zip.names.filter((n) => !n.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(n)), blob: zip.blob, text: zip.text };
    }
    return { name: picked.name, names: [picked.name], blob: async (p) => (p === picked.name ? picked : null), text: async (p) => (p === picked.name ? picked.text() : null) };
  }

  // The file in `set` a path from an export points at: the same path, or the
  // one ending with it (exports name files from their own root, which is
  // often a folder or two down in what was picked).
  function locate(set, path, base = '') {
    if (!path) return null;
    const want = path.replace(/^\.?\//, '');
    if (set.names.includes(base + want)) return base + want;
    const tail = `/${want}`;
    return set.names.find((n) => n.endsWith(tail)) || (set.names.includes(want) ? want : null);
  }

  const EXT = {
    image: /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif|tiff?)$/i,
    video: /\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i,
    audio: /\.(opus|ogg|mp3|m4a|aac|amr|wav|caf|flac)$/i,
  };
  const kindOf = (name, hint) => hint || (EXT.image.test(name) ? 'image' : EXT.video.test(name) ? 'video' : EXT.audio.test(name) ? 'audio' : 'file');

  // A media item for a file the export has (`setPath`, its path in the set),
  // recorded in the chat's `files` under a media/<name> of its own; and one
  // the export left out.
  function attach(files, setPath, label, extra = {}) {
    const base = setPath.split('/').pop();
    const dot = base.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
    let file = `media/${base}`;
    for (let n = 2; files.has(file) && files.get(file) !== setPath; n++) file = `media/${stem} (${n})${ext}`;
    files.set(file, setPath);
    const { kind, ...rest } = extra;
    return { kind: kindOf(base, kind), file, source: `${label} export`, original_name: base, ...rest };
  }
  const mediaMissing = (kind, why = 'not in the export', extra = {}) => ({ kind, file: null, skipped: why, ...extra });

  // A short, stable ID for a message the export gives none: the same message
  // in a later export gets the same one, so bringing it in again adds nothing.
  function stableId(prefix, ...parts) {
    const s = parts.join('\u0001');
    let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return `${prefix}-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
  }
  // Numbers the repeats of an otherwise identical message (same time, sender
  // and text), so two "ok"s in a minute stay two messages.
  function counter() {
    const seen = new Map();
    return (key) => { const n = (seen.get(key) || 0) + 1; seen.set(key, n); return n; };
  }

  // Meta's exports (Instagram, Messenger) write UTF-8 bytes as if each were a
  // Latin-1 character ("Ã©" for "é"); this puts them back.
  function fixMeta(s) {
    if (typeof s !== 'string' || !/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0))); } catch { return s; }
  }

  // A chat in the library's messages.json shape. `people` are the other
  // people in it ({ name, number?, handle? }); messages are put in time order.
  function chatData({ service, id, title, people = [], messages, group = false }) {
    const msgs = messages.slice().sort((x, y) => (x.timestamp_raw || '').localeCompare(y.timestamp_raw || ''));
    msgs.forEach((m, i) => { m.index = i + 1; });
    const now = new Date().toISOString();
    return {
      service, conversation: title, conversation_id: id ? `${service}:${id}` : null, exported_at: now, updated_at: now,
      participants: [...new Set(msgs.map((m) => m.sender))], message_count: msgs.length,
      media_count: msgs.reduce((n, m) => n + m.media.filter((x) => x.file).length, 0), media_failed: 0,
      ...(group ? { group: true } : {}),
      ...(people.length ? { contact: { captured_at: now, source: `${GMLib.serviceLabel(service)} export`, people: people.map((p) => ({ name: p.name, ...(p.number ? { number: p.number } : {}), ...(p.handle ? { handle: p.handle } : {}) })) } } : {}),
      messages: msgs,
    };
  }

  // The import source Settings merges from: the same shape as an earlier
  // export's (chats, read(path)), from what an importer opened.
  function sourceOf(set, importer, chats, extra = {}) {
    const byKey = new Map(chats.map((c) => [c.key, c]));
    return {
      name: set.name, service: importer.service, importer: importer.id, chats: chats.map((c) => c.key), ...extra,
      chat: (key) => byKey.get(key),
      async read(path) {
        const i = path.indexOf('/');
        const c = byKey.get(path.slice(0, i));
        if (!c) return null;
        const rest = path.slice(i + 1);
        if (rest === 'messages.json') return new Blob([JSON.stringify(c.data)], { type: 'application/json' });
        const at = c.files.get(rest);
        return at ? set.blob(at) : null;
      },
    };
  }

  // Which importer reads this set, if any.
  async function detect(set) {
    for (const imp of importers) { try { if (await imp.detect(set)) return imp; } catch { /* not this one */ } }
    return null;
  }

  // Opens a picked file or folder: { importer, source } or throws with what's wrong.
  async function open(picked, ctx) {
    const set = await fileSet(picked);
    const imp = await detect(set);
    if (!imp) throw new Error(`“${set.name}” isn’t an export this can read. ${importers.map((i) => i.label).join(', ')} are supported; see “How to export” for each.`);
    const chats = await imp.open(set, ctx);
    return { importer: imp, source: sourceOf(set, imp, chats, { partial: imp.partial || null }) };
  }

  return {
    register: (imp) => { if (!importers.some((i) => i.id === imp.id)) importers.push(imp); },
    list: () => importers.slice(),
    fileSet, locate, kindOf, attach, mediaMissing, stableId, counter, fixMeta, chatData, sourceOf, detect, open,
  };
})();
