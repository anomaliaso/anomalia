/**
 * Minimal ZIP (store-only, no compression) for packaging already-compressed
 * media (JPEG/PNG/MP4). Uses Node's zlib.crc32 — no extra dependency.
 */
import { crc32 } from 'node:zlib';

export type ZipEntry = { name: string; data: Uint8Array };

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Sanitize a ZIP entry path: strip dirs, keep a safe basename. */
export function safeZipName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/[^\w.\-()+ ]+/g, '_')
    .slice(0, 180) || 'file';
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const raw of entries) {
    const name = safeZipName(raw.name);
    const nameBytes = new TextEncoder().encode(name);
    const data = raw.data;
    const crc = crc32(Buffer.from(data));
    const size = data.byteLength;

    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data
    ]);
    locals.push(local);

    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);

  return concat([...locals, centralDir, end]);
}
