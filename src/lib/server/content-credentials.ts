import { swallow } from '$lib/server/swallow';
import { crc32 } from 'node:zlib';

/**
 * Machine-readable "this is synthetic" marking on every media file we produce.
 *
 * Art. 50(2) AI Act puts this on the PROVIDER of the system — us — and asks for a marking that is
 * machine-readable, interoperable and robust "as far as technically feasible", judged against the
 * state of the art. It does not ask for SynthID, and could not: SynthID is Google's, applied by
 * Google's models to their own output, and not something a third party can embed. What is open and
 * standard is the IPTC `DigitalSourceType` term carried in an XMP packet — the same signal the
 * large platforms read to auto-apply their own "AI info" labels. That is what we write.
 *
 * Two deliberate constraints:
 *
 *  • NO PIXEL IS TOUCHED. The packet is inserted into the container (a PNG iTXt chunk, a JPEG APP1
 *    segment, an MP4 metadata atom with `-c copy`), never by re-encoding. Re-encoding to attach
 *    metadata would trade image quality for a tag, and on JPEG it would do so every time.
 *  • MARKING NEVER FAILS A RENDER. Every function here returns the input unchanged if anything is
 *    off — wrong magic bytes, a truncated file, a missing binary. A compliance tag is not worth
 *    losing a user's video over; a missing tag is recoverable, a lost render is not.
 *
 * Metadata does get stripped by some platforms on upload. That does not make this pointless: the
 * obligation is on the output we produce, the platforms that auto-label read the tag at upload time
 * before stripping it, and the customer keeps a marked original. It is a floor, not the whole
 * disclosure — the rest is the caption-level disclosure the Terms put on the deployer.
 */

/** IPTC DigitalSourceType terms (cv.iptc.org/newscodes/digitalsourcetype/). */
export const DIGITAL_SOURCE_TYPE = {
  /** Created wholly by a generative model — an AI photo, an AI video. */
  synthetic: 'trainedAlgorithmicMedia',
  /** Real material algorithmically composed with generated material — our typographic graphics,
   *  motion videos, and anything that lays type or AI elements over a user's own photo. */
  composite: 'compositeWithTrainedAlgorithmicMedia'
} as const;

export type DigitalSourceType = (typeof DIGITAL_SOURCE_TYPE)[keyof typeof DIGITAL_SOURCE_TYPE];

const XMP_NS = 'http://ns.adobe.com/xap/1.0/';
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp';

/** The XMP packet. Kept minimal on purpose: one claim, no personal data, no brand identifiers. */
export function syntheticXmp(sourceType: DigitalSourceType, tool = 'Anomalia'): string {
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about=""` +
    ` xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"` +
    ` xmlns:xmp="http://ns.adobe.com/xap/1.0/">` +
    `<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/${sourceType}</Iptc4xmpExt:DigitalSourceType>` +
    `<xmp:CreatorTool>${tool}</xmp:CreatorTool>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** A PNG iTXt chunk: len | 'iTXt' | keyword \0 flag method lang \0 translated \0 text | crc. */
function pngITXtChunk(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0]), // null terminator, compression flag 0, compression method 0
    Buffer.from([0]), // empty language tag
    Buffer.from([0]), // empty translated keyword
    Buffer.from(text, 'utf8')
  ]);
  const type = Buffer.from('iTXt', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0);
  return Buffer.concat([len, type, data, crc]);
}

/**
 * Insert the chunk before the first IDAT. Placement matters and is not cosmetic: readers stop
 * scanning for metadata at the image data, so an XMP chunk appended before IEND — the obvious
 * place — is simply never seen. libvips, ExifTool and the platform scanners all behave this way.
 */
function pngWithXmp(buf: Buffer, xmp: string): Buffer {
  let off = 8; // past the 8-byte signature
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') {
      return Buffer.concat([
        buf.subarray(0, off),
        pngITXtChunk(PNG_XMP_KEYWORD, xmp),
        buf.subarray(off)
      ]);
    }
    const next = off + 12 + len;
    if (next <= off || next > buf.length) return buf; // truncated or malformed — leave it alone
    off = next;
  }
  return buf; // no IDAT: not a PNG we can safely edit
}

/** Insert an APP1 XMP segment straight after SOI. Segment length is 2 bytes and counts itself. */
function jpegWithXmp(buf: Buffer, xmp: string): Buffer {
  const payload = Buffer.concat([Buffer.from(`${XMP_NS}\0`, 'latin1'), Buffer.from(xmp, 'utf8')]);
  // 0xFFFF minus the two length bytes is all a single APP1 can carry; ExtendedXMP would be the
  // answer for a bigger packet, and ours is ~600 bytes, so refuse rather than write a broken file.
  if (payload.length + 2 > 0xffff) return buf;
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([buf.subarray(0, 2), header, payload, buf.subarray(2)]);
}

/**
 * Mark encoded image bytes as synthetic. PNG and JPEG are edited in place in the container; any
 * other format is returned untouched (we only ever hand out PNG and JPEG from our own renders).
 */
export function markImageSynthetic(
  bytes: Buffer,
  sourceType: DigitalSourceType = DIGITAL_SOURCE_TYPE.synthetic
): Buffer {
  try {
    const xmp = syntheticXmp(sourceType);
    if (isPng(bytes)) return pngWithXmp(bytes, xmp);
    if (isJpeg(bytes)) return jpegWithXmp(bytes, xmp);
    return bytes;
  } catch (e) {
    console.error('[content-credentials] image marking skipped:', e instanceof Error ? e.message : e);
    return bytes;
  }
}

/**
 * The full image treatment: the XMP tag always, the signed C2PA manifest when signing is
 * configured. One call so a render path cannot end up with one and not the other.
 */
export async function markImage(
  bytes: Buffer,
  mimeType: string,
  sourceType: DigitalSourceType = DIGITAL_SOURCE_TYPE.synthetic
): Promise<Buffer> {
  return signC2pa(markImageSynthetic(bytes, sourceType), mimeType, sourceType);
}

/**
 * Mark an MP4 as synthetic, by stream copy — no re-encode, so no quality cost and no re-render.
 * Returns the original bytes if ffmpeg is unavailable or the remux produces nothing usable.
 */
export async function markVideoSynthetic(
  mp4: Buffer,
  sourceType: DigitalSourceType = DIGITAL_SOURCE_TYPE.synthetic
): Promise<Buffer> {
  const { ensureFfmpegPath } = await import('$lib/server/ffmpeg-bin');
  const [{ mkdtemp, readFile, writeFile }, os, path, { execFileSync }] = await Promise.all([
    import('node:fs/promises'),
    import('node:os'),
    import('node:path'),
    import('node:child_process')
  ]);

  let dir: string | undefined;
  try {
    const ffmpeg = await ensureFfmpegPath();
    if (!ffmpeg) return mp4;
    dir = await mkdtemp(path.join(os.tmpdir(), 'cc-'));
    const src = path.join(dir, 'in.mp4');
    const out = path.join(dir, 'out.mp4');
    await writeFile(src, mp4);
    execFileSync(
      ffmpeg,
      [
        '-y', '-loglevel', 'error',
        '-i', src,
        '-c', 'copy',
        '-movflags', 'use_metadata_tags+faststart',
        '-metadata', `DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/${sourceType}`,
        '-metadata', 'comment=AI-generated with Anomalia',
        out
      ],
      { stdio: 'pipe', timeout: 60_000 }
    );
    const marked = await readFile(out);
    // A remux that came back empty or absurdly small dropped the streams — keep the original.
    return marked.length > mp4.length / 2 ? marked : mp4;
  } catch (e) {
    console.error('[content-credentials] video marking skipped:', e instanceof Error ? e.message : e);
    return mp4;
  } finally {
    if (dir) await rmQuiet(dir);
  }
}

/**
 * C2PA Content Credentials — a cryptographically signed manifest, the tier above the XMP packet.
 *
 * The XMP tag says "this is synthetic"; anyone can rewrite it. A C2PA manifest says the same thing
 * signed, so a reader can tell an untampered claim from an edited one. Art. 50(2) asks for a
 * marking judged against the state of the art, and this is where the state of the art is heading.
 *
 * OFF BY DEFAULT, and THE DEPENDENCY IS NOT INSTALLED. `c2pa-node` ships a 38 MB native binary,
 * which took this app's Vercel function from ~235 MB to 273 MB — past the 250 MB uncompressed
 * limit — to carry a feature that is disabled until someone configures a certificate. Paying the
 * bundle for code that does nothing is the wrong trade, so the package was removed and this
 * function degrades to a no-op: the dynamic import fails, the catch returns the bytes, and the XMP
 * marking (which is what Art. 50(2) actually asks for) stands on its own.
 *
 * TO TURN SIGNING ON: `npm i c2pa-node`, then either C2PA_SIGNING=on for the self-signed test
 * signer, or C2PA_CERT + C2PA_KEY (PEM) for a certificate that verifies. Re-adding the package
 * puts the deploy back over the limit, so it needs VERCEL_SUPPORT_LARGE_FUNCTIONS=1 or a bundle
 * diet in the same change. No code here changes either way.
 *
 * Like everything else in this file, a failure returns the input unchanged.
 */
export async function signC2pa(
  bytes: Buffer,
  mimeType: string,
  sourceType: DigitalSourceType = DIGITAL_SOURCE_TYPE.synthetic
): Promise<Buffer> {
  const { env } = await import('$env/dynamic/private');
  const cert = env.C2PA_CERT?.trim();
  const key = env.C2PA_KEY?.trim();
  if (env.C2PA_SIGNING !== 'on' && !(cert && key)) return bytes;

  try {
    // Not a static import: the package is optional and normally absent, and this must not be a
    // build-time dependency of every route that renders an image.
    const { createC2pa, createTestSigner, ManifestBuilder, SigningAlgorithm } = await import(
      /* @vite-ignore */ 'c2pa-node'
    );
    const signer =
      cert && key
        ? {
            type: 'local' as const,
            certificate: Buffer.from(cert),
            privateKey: Buffer.from(key),
            algorithm: SigningAlgorithm.ES256
          }
        : await createTestSigner();
    const c2pa = createC2pa({ signer });
    const manifest = new ManifestBuilder({
      claim_generator: 'anomalia',
      format: mimeType,
      assertions: [
        {
          label: 'c2pa.actions',
          data: {
            actions: [
              {
                action: 'c2pa.created',
                digitalSourceType: `http://cv.iptc.org/newscodes/digitalsourcetype/${sourceType}`
              }
            ]
          }
        }
      ]
    });
    const signed = await c2pa.sign({ asset: { buffer: bytes, mimeType }, manifest });
    const out = signed.signedAsset?.buffer;
    return out && out.length > bytes.length / 2 ? Buffer.from(out) : bytes;
  } catch (e) {
    console.error('[content-credentials] c2pa signing skipped:', e instanceof Error ? e.message : e);
    return bytes;
  }
}

async function rmQuiet(dir: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  } catch (error) { swallow('remove temp dir', error); }
}
