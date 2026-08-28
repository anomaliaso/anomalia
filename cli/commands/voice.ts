import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, info } from '../lib/display.ts';

export async function cmdVoice(slug: string) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const data = await api.getVoice(session.access_token, slug);

  section('Voice');

  console.log(`  Modalità: ${data.voiceMode === 'auto' ? c.green('● Auto (da Studio)') : c.yellow('○ Manuale')}`);
  console.log();

  section('Framework vocale');
  const fw = data.voiceFramework;
  const fields: [string, string][] = [
    ['Purpose', String(fw.purpose ?? '—')],
    ['Audience', String(fw.audience ?? '—')],
    ['Tone', String(fw.tone ?? '—')],
    ['Register', fw.register != null ? `${fw.register}/100` : '—'],
    ['Emotion', String(fw.emotion ?? '—')],
    ['Character', String(fw.character ?? '—')],
    ['Syntax', String(fw.syntax ?? '—')],
    ['Terminology', String(fw.terminology ?? '—')],
  ];
  for (const [label, value] of fields) {
    console.log(`  ${label.padEnd(14)}${c.dim(value)}`);
  }
  console.log();

  if (data.platforms.length && Object.keys(data.platformRules).length) {
    section('Regole per platform');
    console.log(`  ${'Platform'.padEnd(14)}${'Tone'.padEnd(14)}${'Lunghezza'.padEnd(14)}${'Emoji'.padEnd(10)}Hashtags`);
    for (const plat of data.platforms) {
      const rules = data.platformRules[plat] ?? {};
      console.log(`  ${plat.padEnd(14)}${c.dim(String(rules.tone ?? '—').padEnd(14))}${c.dim(String(rules.length ?? '—').padEnd(14))}${c.dim(String(rules.emoji ?? '—').padEnd(10))}${c.dim(String(rules.hashtags ?? '—'))}`);
    }
    console.log();
  }

  if (data.avoid.length) {
    section('Parole vietate');
    console.log(`  ${c.red(data.avoid.join(', '))}`);
    console.log();
  }

  if (Object.keys(data.platformInstructions).length) {
    section('Istruzioni per platform');
    for (const [plat, instr] of Object.entries(data.platformInstructions)) {
      if (instr) console.log(`  ${c.bold(plat)}: ${c.dim(instr.slice(0, 100))}${instr.length > 100 ? '…' : ''}`);
    }
    console.log();
  }
}
