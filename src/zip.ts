/**
 * A small streaming ZIP writer (no compression: photos are already JPEG, and text is small).
 * Each file is written with a data descriptor, so its CRC is only needed after its bytes have gone out. Files are pulled one at a
 * time, so memory stays small even for a job with many photos. Names are UTF-8 (flag bit 11).
 */

const T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = T[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const enc = new TextEncoder();
const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const bytes = (a: number[]) => Uint8Array.from(a);

/** DOS date and time for a JS date. */
function dos(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = (Math.max(0, d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

export interface ZipSource {
  /** Path inside the zip, with / separators. Unsafe characters are cleaned. */
  name: string;
  /** Produces the file's bytes: small files as one array, large ones in pieces. Return null to skip a file that cannot be read. */
  read: () => Promise<Uint8Array | AsyncIterable<Uint8Array> | null>;
}

export const safeZipName = (n: string) => n.replace(/\\/g, "/").split("/").map((p) => p.replace(/[\u0000-\u001f<>:"|?*]+/g, "_").replace(/^\.+$/, "_").trim()).filter(Boolean).join("/").slice(0, 200) || "file";

/** Makes names unique inside the zip by adding (2), (3) before the extension. */
export function uniqueName(name: string, used: Set<string>): string {
  let n = name;
  let i = 2;
  const dot = name.lastIndexOf(".");
  while (used.has(n.toLowerCase())) n = dot > 0 ? `${name.slice(0, dot)} (${i++})${name.slice(dot)}` : `${name} (${i++})`;
  used.add(n.toLowerCase());
  return n;
}

export function zipStream(files: ZipSource[], when = new Date()): ReadableStream<Uint8Array> {
  const { time, date } = dos(when);
  const central: Uint8Array[] = [];
  let offset = 0;
  let idx = 0;
  const used = new Set<string>();
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (done) return;
      while (idx < files.length) {
        const f = files[idx++];
        const data = await f.read().catch(() => null);
        if (data === null) continue;
        const name = enc.encode(uniqueName(safeZipName(f.name), used));
        const start = offset;
        const head = bytes([...u32(0x04034b50), ...u16(20), ...u16(0x0808), ...u16(0), ...u16(time), ...u16(date), ...u32(0), ...u32(0), ...u32(0), ...u16(name.length), ...u16(0)]);
        ctl.enqueue(head);
        ctl.enqueue(name);
        offset += head.length + name.length;
        let crc = 0;
        let size = 0;
        const put = (chunk: Uint8Array) => {
          crc = crc32(chunk, crc);
          size += chunk.length;
          offset += chunk.length;
          ctl.enqueue(chunk);
        };
        if (data instanceof Uint8Array) put(data);
        else for await (const c of data) put(c);
        const desc = bytes([...u32(0x08074b50), ...u32(crc), ...u32(size), ...u32(size)]);
        ctl.enqueue(desc);
        offset += desc.length;
        central.push(bytes([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0808), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(start)]), name);
        return; // one file per pull keeps memory small
      }
      const cdStart = offset;
      let cdSize = 0;
      for (const c of central) {
        ctl.enqueue(c);
        cdSize += c.length;
      }
      ctl.enqueue(bytes([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length / 2), ...u16(central.length / 2), ...u32(cdSize), ...u32(cdStart), ...u16(0)]));
      done = true;
      ctl.close();
    },
  });
}
