// Minimal zip writer (store only, no compression). Photos and videos are
// already compressed, so storing them keeps this small and dependency free.
// Also a reader, for importing earlier exports into the backup library.
globalThis.GMZip = globalThis.GMZip || (() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  const enc = new TextEncoder();

  class ZipWriter {
    constructor() {
      this.parts = [];
      this.central = [];
      this.offset = 0;
      this.count = 0;
      this.names = new Set();
    }

    async add(name, data) {
      // Avoid duplicate paths, which would make the zip ambiguous.
      let unique = name;
      for (let i = 2; this.names.has(unique); i++) unique = name.replace(/(\.[^./]*)?$/, ` (${i})$1`);
      this.names.add(unique);

      const bytes =
        typeof data === 'string' ? enc.encode(data)
        : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
        : data;
      const nameBytes = enc.encode(unique);
      const crc = crc32(bytes);
      const { time, date } = dosDateTime(new Date());

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 file names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      this.parts.push(local.buffer, nameBytes, bytes);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, bytes.length, true);
      cd.setUint32(24, bytes.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, this.offset, true);
      this.central.push(cd.buffer, nameBytes);

      this.offset += 30 + nameBytes.length + bytes.length;
      this.count++;
      return unique;
    }

    get size() {
      return this.offset;
    }

    finish() {
      if (this.count > 0xffff || this.offset > 0xffffffff) {
        throw new Error('Export is too large for a single zip (over 4 GB or 65,535 files). Export conversations in smaller batches.');
      }
      const cdSize = this.central.reduce((n, p) => n + p.byteLength, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, this.count, true);
      end.setUint16(10, this.count, true);
      end.setUint32(12, cdSize, true);
      end.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
    }
  }

  // Opens a zip (stored or deflated entries; not zip64) from a File without
  // reading all of it: only the directory at the end, then each file asked for.
  async function open(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let end = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error(`${file.name} isn’t a zip file.`);
    const count = tail.getUint16(end + 10, true);
    const cdSize = tail.getUint32(end + 12, true);
    const cdOffset = tail.getUint32(end + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error(`${file.name} is too large to read here (zip64). Unzip it and import the folder instead.`);
    const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = new Map();
    for (let p = 0, n = 0; n < count; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error(`${file.name} is damaged.`);
      const nameLen = cd.getUint16(p + 28, true);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
      if (!name.endsWith('/')) entries.set(name, { method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), offset: cd.getUint32(p + 42, true) });
      p += 46 + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
    }
    async function blob(name) {
      const e = entries.get(name);
      if (!e) return null;
      const local = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      const start = e.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const raw = file.slice(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      throw new Error(`${name} in ${file.name} uses a compression this can’t read.`);
    }
    return { names: [...entries.keys()], blob, text: async (name) => (await blob(name))?.text() ?? null };
  }

  return { ZipWriter, crc32, open };
})();
