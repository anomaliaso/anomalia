import { describe, it, expect, vi } from 'vitest';

// $env/dynamic/private is resolved by the SvelteKit plugin; give the unit test a plain object
// whose keys the C2PA layer reads at call time.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
import {
  DIGITAL_SOURCE_TYPE,
  markImage,
  markImageSynthetic,
  markVideoSynthetic,
  signC2pa,
  syntheticXmp
} from './content-credentials';

// The point of these tests is that the marking is READ BACK by something that did not write it —
// sharp for images, ffmpeg for video. A test that only re-parsed our own buffer would pass just as
// happily on a file no other tool can open.

const sharpLib = async () => (await import('sharp')).default;

async function makePng(): Promise<Buffer> {
  const sharp = await sharpLib();
  return sharp({ create: { width: 32, height: 32, channels: 3, background: '#204080' } })
    .png()
    .toBuffer();
}

async function makeJpeg(): Promise<Buffer> {
  const sharp = await sharpLib();
  return sharp({ create: { width: 32, height: 32, channels: 3, background: '#a03050' } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe('syntheticXmp', () => {
  it('carries the IPTC DigitalSourceType term as a resolvable IRI', () => {
    const xmp = syntheticXmp(DIGITAL_SOURCE_TYPE.synthetic);
    expect(xmp).toContain(
      'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
    );
    expect(xmp).toContain('Iptc4xmpExt:DigitalSourceType');
    expect(xmp.startsWith('<?xpacket begin=')).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  it('distinguishes wholly generated media from composites', () => {
    expect(syntheticXmp(DIGITAL_SOURCE_TYPE.composite)).toContain(
      'compositeWithTrainedAlgorithmicMedia'
    );
  });

  it('carries no brand, user or prompt data', () => {
    const xmp = syntheticXmp(DIGITAL_SOURCE_TYPE.synthetic);
    expect(xmp).not.toMatch(/@|brand_id|user|prompt/i);
  });
});

describe('markImageSynthetic — PNG', () => {
  it('embeds XMP that sharp reads back', async () => {
    const sharp = await sharpLib();
    const marked = markImageSynthetic(await makePng(), DIGITAL_SOURCE_TYPE.composite);
    const meta = await sharp(marked).metadata();
    expect(meta.xmp?.toString()).toContain('compositeWithTrainedAlgorithmicMedia');
  });

  it('leaves every pixel untouched', async () => {
    const sharp = await sharpLib();
    const png = await makePng();
    const before = await sharp(png).raw().toBuffer();
    const after = await sharp(markImageSynthetic(png)).raw().toBuffer();
    expect(Buffer.compare(before, after)).toBe(0);
  });

  it('keeps the file a valid PNG with IEND still last', async () => {
    const marked = markImageSynthetic(await makePng());
    expect(marked.subarray(marked.length - 8, marked.length - 4).toString('latin1')).toBe('IEND');
    const meta = await (await sharpLib())(marked).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(32);
  });
});

describe('markImageSynthetic — JPEG', () => {
  it('embeds XMP that sharp reads back, without recompressing', async () => {
    const sharp = await sharpLib();
    const jpeg = await makeJpeg();
    const marked = markImageSynthetic(jpeg, DIGITAL_SOURCE_TYPE.synthetic);
    const meta = await sharp(marked).metadata();
    expect(meta.xmp?.toString()).toContain('trainedAlgorithmicMedia');
    expect(meta.format).toBe('jpeg');
    // Same entropy-coded data, just a segment longer: a recompress would not land on this number.
    expect(marked.length).toBe(jpeg.length + 4 + 29 + Buffer.byteLength(syntheticXmp(DIGITAL_SOURCE_TYPE.synthetic)));
  });

  it('leaves every pixel untouched', async () => {
    const sharp = await sharpLib();
    const jpeg = await makeJpeg();
    const before = await sharp(jpeg).raw().toBuffer();
    const after = await sharp(markImageSynthetic(jpeg)).raw().toBuffer();
    expect(Buffer.compare(before, after)).toBe(0);
  });
});

describe('markImageSynthetic — never breaks the caller', () => {
  it('returns unknown formats and junk unchanged', () => {
    const junk = Buffer.from('not an image at all');
    expect(markImageSynthetic(junk)).toBe(junk);
    const empty = Buffer.alloc(0);
    expect(markImageSynthetic(empty)).toBe(empty);
  });

  it('returns a truncated PNG unchanged rather than writing a broken one', () => {
    const truncated = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(20)
    ]);
    expect(markImageSynthetic(truncated)).toBe(truncated);
  });
});

describe('markVideoSynthetic', () => {
  it('tags an MP4 by stream copy, and ffmpeg reads the tag back', async () => {
    const { ensureFfmpegPath } = await import('./ffmpeg-bin');
    const ffmpeg = await ensureFfmpegPath();
    // No binary in this environment: the function is contractually a no-op, nothing to assert.
    if (!ffmpeg) return;

    const { execFileSync } = await import('node:child_process');
    const { mkdtemp, readFile, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-test-'));
    const src = path.join(dir, 'src.mp4');
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
      '-pix_fmt', 'yuv420p', src
    ]);
    const original = await readFile(src);

    const marked = await markVideoSynthetic(original, DIGITAL_SOURCE_TYPE.synthetic);
    expect(marked.length).toBeGreaterThan(original.length / 2);

    const out = path.join(dir, 'marked.mp4');
    await writeFile(out, marked);
    // `ffmpeg -i` with no output exits non-zero by design; the report we want is on stderr.
    let report = '';
    try {
      execFileSync(ffmpeg, ['-hide_banner', '-i', out], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      report = String((e as { stderr?: Buffer }).stderr ?? '');
    }
    expect(report).toContain('trainedAlgorithmicMedia');
    // Stream copy: the video stream must still be there and still be h264 at the same size.
    expect(report).toMatch(/Video: h264.*64x64/);
  });

  it('returns non-video bytes unchanged instead of throwing', async () => {
    const junk = Buffer.from('definitely not an mp4');
    await expect(markVideoSynthetic(junk)).resolves.toBe(junk);
  });
});

describe('signC2pa', () => {
  it('is a no-op until signing is configured', async () => {
    delete env.C2PA_SIGNING;
    delete env.C2PA_CERT;
    delete env.C2PA_KEY;
    const jpeg = await makeJpeg();
    await expect(signC2pa(jpeg, 'image/jpeg')).resolves.toBe(jpeg);
  });

  // c2pa-node is optional and normally NOT installed — it costs 38 MB of Vercel function bundle
  // for a feature that is off. Where someone has installed it to work on signing, this proves the
  // round trip; where they have not, it proves the far more important property: the absence is a
  // silent no-op, not a broken render.
  const c2paInstalled = async () => {
    try {
      await import(/* @vite-ignore */ 'c2pa-node');
      return true;
    } catch {
      return false;
    }
  };

  it('signs a readable manifest when the package is installed', async () => {
    if (!(await c2paInstalled())) return;
    env.C2PA_SIGNING = 'on';
    try {
      const jpeg = await makeJpeg();
      const signed = await signC2pa(jpeg, 'image/jpeg', DIGITAL_SOURCE_TYPE.synthetic);
      expect(signed.length).toBeGreaterThan(jpeg.length);

      const { createC2pa } = await import(/* @vite-ignore */ 'c2pa-node');
      const read = await createC2pa().read({ buffer: signed, mimeType: 'image/jpeg' });
      const actions = read?.active_manifest?.assertions?.find(
        (a: { label?: string }) => a.label === 'c2pa.actions'
      );
      expect(JSON.stringify(actions?.data)).toContain('trainedAlgorithmicMedia');
    } finally {
      delete env.C2PA_SIGNING;
    }
  });

  it('with signing on but the package absent, returns the bytes untouched', async () => {
    if (await c2paInstalled()) return;
    env.C2PA_SIGNING = 'on';
    try {
      const jpeg = await makeJpeg();
      await expect(signC2pa(jpeg, 'image/jpeg')).resolves.toBe(jpeg);
    } finally {
      delete env.C2PA_SIGNING;
    }
  });

  it('markImage tags whether or not signing is available', async () => {
    // The XMP marking is the part Art. 50(2) relies on, so it must not depend on an optional
    // package being present or an env var being set.
    const sharp = await sharpLib();
    for (const signing of [undefined, 'on']) {
      if (signing) env.C2PA_SIGNING = signing;
      else delete env.C2PA_SIGNING;
      const out = await markImage(await makeJpeg(), 'image/jpeg', DIGITAL_SOURCE_TYPE.composite);
      expect((await sharp(out).metadata()).xmp?.toString()).toContain(
        'compositeWithTrainedAlgorithmicMedia'
      );
    }
    delete env.C2PA_SIGNING;
  });
});
