import { MOTION_EXPO_IN_OUT, MOTION_OVERSHOOT_OUT } from './easing';

/** Max TSX source size stored / accepted from the agent or editor. */
export const MOTION_SOURCE_MAX_CHARS = 120_000;

/** Canvases the Motion video prompt picker allows — no 4:5. */
export const MOTION_ASPECTS = ['1:1', '9:16', '16:9'] as const;
export type MotionAspectRatio = (typeof MOTION_ASPECTS)[number];

const MOTION_ASPECT_SIZE: Record<MotionAspectRatio, { width: number; height: number }> = {
	'1:1': { width: 1080, height: 1080 },
	'9:16': { width: 1080, height: 1920 },
	'16:9': { width: 1920, height: 1080 }
};

export function isMotionAspectRatio(value: unknown): value is MotionAspectRatio {
	return MOTION_ASPECTS.includes(value as MotionAspectRatio);
}

export function parseMotionAspectRatio(
	value: unknown,
	fallback: MotionAspectRatio = '1:1'
): MotionAspectRatio {
	return isMotionAspectRatio(value) ? value : fallback;
}

export function motionSizeForAspect(aspect: MotionAspectRatio): { width: number; height: number } {
	return MOTION_ASPECT_SIZE[aspect];
}

/** Nearest allowed Motion canvas for a stored width/height (edit mode). */
export function motionAspectFromSize(
	width: number,
	height: number,
	fallback: MotionAspectRatio = '1:1'
): MotionAspectRatio {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	const ratio = w / h;
	let best: MotionAspectRatio = fallback;
	let bestDist = Infinity;
	for (const aspect of MOTION_ASPECTS) {
		const size = MOTION_ASPECT_SIZE[aspect];
		const dist = Math.abs(ratio - size.width / size.height);
		if (dist < bestDist) {
			best = aspect;
			bestDist = dist;
		}
	}
	return best;
}

/** Aspects to offer as “remake in …” when a tile is already this ratio. */
export function otherMotionAspects(current: MotionAspectRatio): MotionAspectRatio[] {
	return MOTION_ASPECTS.filter((a) => a !== current);
}

export function motionRemakeTitle(title: string, aspect: MotionAspectRatio): string {
	const base = title.replace(/\s·\s(?:1:1|9:16|16:9)\s*$/, '').trim() || title.trim() || 'Motion video';
	return `${base} · ${aspect}`.slice(0, 120);
}

/** Seed / agent fps. Duration presets are seconds at this rate. */
export const MOTION_FPS = 30;
export const MOTION_DURATION_PRESETS = ['auto', '6', '8', '10', '15', '30', '60', '90'] as const;
export type MotionDurationPreset = (typeof MOTION_DURATION_PRESETS)[number];
/** Auto (default): the model picks a length that fits the brief, typically ~6s. */
export const MOTION_DURATION_DEFAULT_SECONDS = 6;

export function isMotionDurationPreset(value: unknown): value is MotionDurationPreset {
	return MOTION_DURATION_PRESETS.includes(value as MotionDurationPreset);
}

export function parseMotionDuration(
	value: unknown,
	fallback: MotionDurationPreset = 'auto'
): MotionDurationPreset {
	if (typeof value === 'number' && Number.isFinite(value)) {
		const asStr = String(Math.round(value));
		if (isMotionDurationPreset(asStr)) return asStr;
	}
	return isMotionDurationPreset(value) ? value : fallback;
}

/** Seconds for an explicit preset; `null` when Auto. */
export function motionDurationSeconds(preset: MotionDurationPreset): number | null {
	if (preset === 'auto') return null;
	return Number(preset);
}

export function motionFramesForDuration(
	preset: MotionDurationPreset,
	fps: number = MOTION_FPS
): number {
	const seconds = motionDurationSeconds(preset) ?? MOTION_DURATION_DEFAULT_SECONDS;
	return Math.max(1, Math.round(seconds * fps));
}

/** Compact picker label: 6s, 30s, 1m, 1m:30. Auto is handled in i18n. */
export function formatMotionDurationPreset(preset: MotionDurationPreset): string {
	if (preset === 'auto') return 'Auto';
	const sec = Number(preset);
	if (!Number.isFinite(sec) || sec < 60) return `${preset}s`;
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return s === 0 ? `${m}m` : `${m}m:${String(s).padStart(2, '0')}`;
}

/** Human length from stored Remotion meta (6s, 1m, 1m:30). */
export function formatMotionLength(durationInFrames: number, fps: number = MOTION_FPS): string {
	const rate = Math.max(1, fps);
	const sec = Math.max(0, durationInFrames) / rate;
	if (sec < 60) {
		const rounded = Math.round(sec * 10) / 10;
		return `${rounded}s`;
	}
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	if (s === 60) return `${m + 1}m`;
	return s === 0 ? `${m}m` : `${m}m:${String(s).padStart(2, '0')}`;
}

export type MotionVideoMeta = {
	fps: number;
	durationInFrames: number;
	width: number;
	height: number;
};

export type MotionVideoRow = {
	id: string;
	brand_id: string;
	user_id: string | null;
	title: string;
	source: string;
	preview_url: string | null;
	fps: number;
	duration_in_frames: number;
	width: number;
	height: number;
	created_at: string;
	updated_at: string;
};

export type MotionVideoListItem = Pick<
	MotionVideoRow,
	| 'id'
	| 'title'
	| 'preview_url'
	| 'fps'
	| 'duration_in_frames'
	| 'width'
	| 'height'
	| 'updated_at'
	| 'created_at'
>;

/** Escape a string for embedding inside a single-quoted JS string. */
function esc(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Default Remotion composition source for a brand.
 * Contract: import React + remotion; export default component + fps/duration/size.
 */
export function defaultMotionSource(opts: {
	brandName: string;
	accent?: string | null;
	displayFont?: string | null;
	bodyFont?: string | null;
	logoUrl?: string | null;
	colors?: string[] | null;
	aspectRatio?: MotionAspectRatio;
	duration?: MotionDurationPreset;
	/** Override della CTA di chiusura; i chiamanti server passano qui MOTION_AD_CTA. */
	ctaText?: string | null;
}): string {
	const brand = opts.brandName.trim() || 'Brand';
	const colors = (opts.colors ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 6);
	const accent = (opts.accent?.trim() || colors[0] || '#c485fe').replace(/'/g, '');
	const displayFont = (opts.displayFont?.trim() || 'Inter').replace(/'/g, '');
	const bodyFont = (opts.bodyFont?.trim() || displayFont).replace(/'/g, '');
	const logoUrl = (opts.logoUrl?.trim() || '').replace(/'/g, '');
	const aspect = parseMotionAspectRatio(opts.aspectRatio);
	const { width, height } = motionSizeForAspect(aspect);
	const duration = parseMotionDuration(opts.duration);
	const fps = MOTION_FPS;
	const durationInFrames = motionFramesForDuration(duration, fps);
	const durationLabel =
		duration === 'auto' ? `${MOTION_DURATION_DEFAULT_SECONDS}s` : formatMotionDurationPreset(duration);

	// LE BATTUTE, in secondi ricavati dalla durata — mai un terzo fisso, o un video da 90s
	// uscirebbe con tre scene da mezzo minuto. L'ultima chiude l'aritmetica, così la somma cade
	// ESATTAMENTE su durationInFrames e non resta un fotogramma nero in coda.
	const totalSeconds = durationInFrames / fps;
	const beat1Seconds = Math.round(totalSeconds * 0.34 * 10) / 10;
	const beat2Seconds = Math.round(totalSeconds * 0.36 * 10) / 10;
	const ctaText = opts.ctaText?.trim() || 'Start free → anomalia.so';

	return `import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

/** Composition meta — keep these in sync with the animation timing below. */
export const fps = ${fps};
export const durationInFrames = ${durationInFrames}; // ${durationLabel}
export const width = ${width};
export const height = ${height};

const brand = '${esc(brand)}';
const headline = 'Your marketing team.\\nOn autopilot.';
const sub = 'Create posts, UGC, and SEO content from one chat.';
const promise = 'Chat once.\\nShip everywhere.';
const cta = '${esc(ctaText)}';
const accent = '${accent}';
const palette = ${JSON.stringify(colors.length ? colors : [accent])};
const bg = '#050505';
const ink = '#f4f4f5';
const muted = 'rgba(244,244,245,0.55)';
const displayFont = '${esc(displayFont)}';
const bodyFont = '${esc(bodyFont)}';
const logoUrl = '${esc(logoUrl)}';

// Expo in-out: quasi piatta alle estremità, ripidissima in mezzo. È la curva di TUTTI i
// movimenti. Mai lineare — e in Remotion un interpolate senza \`easing\` È lineare.
const ease = ${MOTION_EXPO_IN_OUT};
// L'assestamento è un altro mestiere: sfonda di poco e rientra. Solo sull'ultima posa.
const settle = ${MOTION_OVERSHOOT_OUT};
// interpolate NON clampa di default: fuori dal range continua ad andare.
const CLAMP = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

/**
 * LE BATTUTE — una <Series.Sequence> ciascuna, e non è una preferenza di stile.
 *
 * Dentro una Sequence \`useCurrentFrame()\` RIPARTE DA ZERO. Ogni battuta si scrive quindi come
 * se fosse l'unica cosa del video: non deve sapere quando comincia, e spostarla, allungarla o
 * estrarla in un componente a sé è sicuro.
 *
 * L'alternativa — un solo componente che accende e spegne le scene con \`frame >= A && frame < B\`
 * — funziona finché resta un componente solo, e si rompe in silenzio appena qualcuno la fattorizza:
 * il componente estratto continua a ricevere il fotogramma ASSOLUTO mentre chi lo scrive pensa in
 * locale, e l'intera entrata risulta già finita quando la scena appare. Non è un errore raro: è il
 * riordino che chiunque farebbe, su una forma che non lo regge.
 *
 * L'\`offset\` negativo è la SOVRAPPOSIZIONE, ed è la transizione: la scena uscente è ancora in
 * movimento mentre la successiva entra. Senza, il taglio è secco.
 */
const OVERLAP = Math.round(0.4 * fps);
const BEAT_1 = Math.round(${beat1Seconds} * fps);
const BEAT_2 = Math.round(${beat2Seconds} * fps);
const BEAT_3 = durationInFrames + 2 * OVERLAP - BEAT_1 - BEAT_2;

const ClaimBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps: videoFps, width: W } = useVideoConfig();
  const lines = headline.split('\\n').filter(Boolean);

  const claimIn = spring({
    frame: frame - 2,
    fps: videoFps,
    config: { damping: 9, stiffness: 160, mass: 0.55 }
  });
  const subIn = interpolate(frame, [0.6 * fps, 1.3 * fps], [0, 1], { easing: ease, ...CLAMP });
  // L'USCITA sta DENTRO la battuta e corre fino al suo ultimo fotogramma: è ciò che tiene il
  // movimento vivo attraverso il taglio, invece di posarsi sull'ultima posa e aspettare.
  const exitX = interpolate(frame, [BEAT_1 - OVERLAP, BEAT_1], [0, -W * 0.55], { easing: ease, ...CLAMP });
  // Una deriva lenta copre TUTTA la battuta: nessuna scena è mai ferma, mai.
  const drift = interpolate(frame, [0, BEAT_1], [16, -20], { easing: ease, ...CLAMP });

  return (
    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 72 }}>
      <AbsoluteFill
        style={{ background: 'radial-gradient(ellipse at 50% 40%, ' + accent + '33 0%, transparent 55%)' }}
      />
      <div
        style={{
          textAlign: 'center',
          maxWidth: 920,
          transform: 'translateX(' + exitX + 'px) translateY(' + (drift + (1 - Math.min(1, claimIn)) * 48) + 'px)'
        }}
      >
        {lines.map((line, i) => (
          <div
            key={line + i}
            style={{
              fontFamily: displayFont,
              fontSize: 72,
              fontWeight: 500,
              color: ink,
              letterSpacing: '-0.04em',
              lineHeight: 1.08,
              marginBottom: 6,
              opacity: Math.min(1, claimIn)
            }}
          >
            {line}
          </div>
        ))}
        <div
          style={{
            marginTop: 20,
            fontSize: 28,
            fontWeight: 400,
            color: muted,
            letterSpacing: '-0.02em',
            opacity: subIn,
            transform: 'translateY(' + (1 - subIn) * 18 + 'px)'
          }}
        >
          {sub}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProductBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps: videoFps, width: W } = useVideoConfig();
  const promiseLines = promise.split('\\n').filter(Boolean);

  // La battuta entra da destra e si posa: percorrenza con expo, atterraggio con la molla.
  const enterX = interpolate(frame, [0, OVERLAP], [W * 0.55, 0], { easing: ease, ...CLAMP });
  const exitX = interpolate(frame, [BEAT_2 - OVERLAP, BEAT_2], [0, -W * 0.4], { easing: ease, ...CLAMP });
  // Il mockup respira per tutta la battuta — la scena non si ferma nemmeno mentre esce.
  const breathe = interpolate(frame, [0, BEAT_2], [1.02, 1.06], { easing: ease, ...CLAMP });
  const iconPop = spring({
    frame: frame - 8,
    fps: videoFps,
    config: { damping: 7, stiffness: 220, mass: 0.4 }
  });
  // Le barre NON entrano insieme: ognuna parte dopo la precedente (STAGGER).
  const barStep = Math.round(0.18 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 64 }}>
      <div style={{ width: 760, maxWidth: '100%', transform: 'translateX(' + (enterX + exitX) + 'px)' }}>
        <div
          style={{
            textAlign: 'center',
            fontFamily: displayFont,
            fontSize: 48,
            fontWeight: 500,
            color: ink,
            letterSpacing: '-0.035em',
            lineHeight: 1.12,
            marginBottom: 36
          }}
        >
          {promiseLines.map((line, i) => (
            <React.Fragment key={line + i}>
              {i > 0 ? <br /> : null}
              <span style={i === promiseLines.length - 1 ? { color: accent } : undefined}>{line}</span>
            </React.Fragment>
          ))}
        </div>
        <div
          style={{
            background: 'rgba(244,244,245,0.06)',
            border: '1px solid rgba(244,244,245,0.12)',
            borderRadius: 28,
            padding: 28,
            transform: 'scale(' + breathe + ')'
          }}
        >
          <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
            {['Post', 'Graph', 'Prompt'].map((label, i) => (
              <div
                key={label}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: i === 1 ? accent : 'rgba(244,244,245,0.12)',
                  color: i === 1 ? '#1a1024' : ink,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  transform: 'scale(' + (0.7 + Math.min(1, iconPop) * 0.3) + ')'
                }}
              >
                {label[0]}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 120 }}>
            {[0, 1, 2].map((i) => {
              const delay = i * barStep;
              const grow = interpolate(frame - delay, [0, 0.9 * fps], [0, 1], { easing: ease, ...CLAMP });
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 18 + grow * (70 + i * 10) + '%',
                    borderRadius: 10,
                    background: i === 1 ? accent : 'rgba(244,244,245,0.22)'
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CtaBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps: videoFps } = useVideoConfig();

  // L'iris: un cerchio che cresce e diventa la maschera che rivela la scena.
  const iris = interpolate(frame, [0, 1.1 * fps], [0, 155], { easing: ease, ...CLAMP });
  const endIn = spring({
    frame: frame - 6,
    fps: videoFps,
    config: { damping: 8, stiffness: 150, mass: 0.5 }
  });
  // L'entrata del CTA è l'ULTIMA posa: qui va l'assestamento, non la percorrenza.
  const ctaIn = interpolate(frame, [0.7 * fps, 1.4 * fps], [0, 1], { easing: settle, ...CLAMP });
  // E anche l'ultima battuta si muove fino in fondo: una CTA che si posa e aspetta è la
  // scena ferma che la QC boccia — è il difetto più frequente proprio sull'ultima scena.
  const drift = interpolate(frame, [0, BEAT_3], [0, -18], { easing: ease, ...CLAMP });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 64,
        clipPath: 'circle(' + iris + '% at 50% 50%)'
      }}
    >
      <AbsoluteFill
        style={{ background: 'radial-gradient(ellipse at 50% 55%, ' + accent + '2e 0%, transparent 60%)' }}
      />
      <div
        style={{
          textAlign: 'center',
          transform: 'translateY(' + (drift + (1 - Math.min(1, endIn)) * 24) + 'px)'
        }}
      >
        {logoUrl ? (
          <Img
            src={logoUrl}
            style={{ width: 200, height: 'auto', margin: '0 auto 28px', objectFit: 'contain' }}
          />
        ) : (
          <div
            style={{
              fontFamily: displayFont,
              fontSize: 84,
              fontWeight: 500,
              color: ink,
              letterSpacing: '-0.04em'
            }}
          >
            {brand}
          </div>
        )}
        <div
          style={{
            marginTop: 28,
            display: 'inline-flex',
            alignItems: 'center',
            padding: '14px 28px',
            // A fixed radius, not 999: the seed is the first thing the model reads, and a full
            // pill on a 50px-tall CTA is the lozenge it kept reproducing. See craft.ts.
            borderRadius: 14,
            background: accent,
            color: '#1a1024',
            fontFamily: bodyFont,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            opacity: ctaIn,
            transform: 'translateY(' + (1 - ctaIn) * 12 + 'px) scale(' + (0.96 + ctaIn * 0.04) + ')'
          }}
        >
          {cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * Kinetic ${aspect} Meta/IG-style motion ad.
 * Edit this file freely — chat and the code panel both write this source.
 */
export default function MotionVideo() {
  return (
    <AbsoluteFill style={{ backgroundColor: bg, overflow: 'hidden', fontFamily: bodyFont }}>
      <Series>
        <Series.Sequence durationInFrames={BEAT_1}>
          <ClaimBeat />
        </Series.Sequence>
        <Series.Sequence durationInFrames={BEAT_2} offset={-OVERLAP}>
          <ProductBeat />
        </Series.Sequence>
        <Series.Sequence durationInFrames={BEAT_3} offset={-OVERLAP}>
          <CtaBeat />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
}
`;
}
