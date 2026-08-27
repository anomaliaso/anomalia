#!/usr/bin/env node
/**
 * What provenance markings does this file actually carry?
 *
 * Written to answer a question nobody could answer from the code: do the video models we call
 * through kie (Seedance, Grok Imagine, Veo) embed any provenance signal of their own? The answer
 * differs per model, changes without notice, and cannot be guessed — it has to be looked at.
 *
 *   node scripts/inspect-provenance.mjs <file-or-url> [...more]
 *
 * Reports, per file: the IPTC DigitalSourceType we write, any XMP packet, a C2PA manifest if one
 * is present and readable, and the container metadata ffmpeg sees. Read-only — it never rewrites
 * the file.
 *
 * To answer the model question properly, capture the mp4 as the provider returns it, BEFORE our
 * own pipeline touches it: video-edit.ts re-encodes to trim silence and captions.ts burns
 * subtitles, and either pass destroys a fragile marking. A clip pulled from our storage bucket
 * tells you about our pipeline, not about the model.
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const IPTC_TERM = /digitalsourcetype\/([A-Za-z]+)/;

async function load(target) {
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(target);
}

function sniff(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { kind: 'png', mime: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { kind: 'jpeg', mime: 'image/jpeg' };
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return { kind: 'mp4', mime: 'video/mp4' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF') return { kind: 'webp', mime: 'image/webp' };
  return { kind: 'unknown', mime: 'application/octet-stream' };
}

/** Raw scan rather than a parser: it finds a packet wherever a producer chose to put it. */
function scanXmp(buf) {
  const text = buf.toString('latin1');
  const start = text.indexOf('<x:xmpmeta');
  if (start === -1) return null;
  const end = text.indexOf('</x:xmpmeta>', start);
  return end === -1 ? null : text.slice(start, end + 12);
}

async function readC2pa(buf, mimeType) {
  try {
    const { createC2pa } = require('c2pa-node');
    const result = await createC2pa().read({ buffer: buf, mimeType });
    if (!result?.active_manifest) return null;
    const m = result.active_manifest;
    return {
      generator: m.claim_generator ?? '(none)',
      signedBy: m.signature_info?.issuer ?? '(unknown issuer)',
      assertions: (m.assertions ?? []).map((a) => a.label),
      validation: result.validation_status?.length
        ? result.validation_status.map((v) => v.code)
        : ['no validation errors']
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // c2pa-node is optional and normally absent (38 MB of Vercel function bundle for a feature
    // that is off). Say so plainly instead of reporting a module error as if the file were bad.
    if (/Cannot find module 'c2pa-node'/.test(msg)) {
      return { error: 'c2pa-node not installed — run `npm i c2pa-node` to read C2PA manifests' };
    }
    return { error: msg };
  }
}

function ffprobeTags(path) {
  try {
    const ffmpeg = require('ffmpeg-static');
    try {
      execFileSync(ffmpeg, ['-hide_banner', '-i', path], { stdio: ['ignore', 'pipe', 'pipe'] });
      return '';
    } catch (e) {
      const report = String(e.stderr ?? '');
      const meta = report.slice(report.indexOf('Metadata:'));
      return meta.split('\n').slice(0, 14).join('\n');
    }
  } catch {
    return '(ffmpeg-static unavailable)';
  }
}

async function inspect(target) {
  console.log(`\n═══ ${target}`);
  let buf;
  try {
    buf = await load(target);
  } catch (e) {
    console.log(`  could not read: ${e.message}`);
    return;
  }
  const { kind, mime } = sniff(buf);
  console.log(`  format: ${kind}   size: ${(buf.length / 1024).toFixed(1)} KB`);

  const xmp = scanXmp(buf);
  const term = (xmp ?? buf.toString('latin1')).match(IPTC_TERM);
  console.log(`  IPTC DigitalSourceType: ${term ? term[1] : 'NONE'}`);
  console.log(`  XMP packet: ${xmp ? `${xmp.length} bytes` : 'NONE'}`);

  const c2pa = await readC2pa(buf, mime);
  if (!c2pa) console.log('  C2PA manifest: NONE');
  else if (c2pa.error) console.log(`  C2PA manifest: unreadable (${c2pa.error})`);
  else {
    console.log(`  C2PA manifest: signed by ${c2pa.signedBy}`);
    console.log(`    generator:  ${c2pa.generator}`);
    console.log(`    assertions: ${c2pa.assertions.join(', ') || '(none)'}`);
    console.log(`    validation: ${c2pa.validation.join(', ')}`);
  }

  if (kind === 'mp4' && !/^https?:/i.test(target)) {
    const tags = ffprobeTags(target);
    if (tags) console.log(`  container metadata:\n${tags.replace(/^/gm, '    ')}`);
  }
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: node scripts/inspect-provenance.mjs <file-or-url> [...]');
  process.exit(1);
}
for (const t of targets) await inspect(t);
console.log('');
