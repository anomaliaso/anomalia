import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

export type StyleReelProps = {
  aspect: '3:4' | '9:16';
  bg: string;
  ink: string;
  accent: string;
  muted: string;
  displayFont: string;
  bodyFont: string;
  headline: string;
  sub: string;
  handle: string;
  brand: string;
};

export const STYLE_REEL_FPS = 30;
export const STYLE_REEL_DURATION = STYLE_REEL_FPS * 4; // 4s

export function styleReelSize(aspect: '3:4' | '9:16') {
  return aspect === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1440 };
}

/**
 * Animated library reel — palette/voice of a style, not a frame-perfect satori clone.
 * Ground → accent shapes → title spring → hold + brand.
 */
export const StyleReel: React.FC<StyleReelProps> = ({
  bg,
  ink,
  accent,
  muted,
  displayFont,
  bodyFont,
  headline,
  sub,
  handle,
  brand
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const accentIn = spring({ frame: frame - 6, fps, config: { damping: 16, stiffness: 100 } });
  const titleIn = spring({ frame: frame - 12, fps, config: { damping: 20, stiffness: 110 } });
  const hold = interpolate(frame, [70, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const pad = Math.round(width * 0.07);
  const lines = headline.split('\n').filter(Boolean);

  return (
    <AbsoluteFill style={{ backgroundColor: bg, overflow: 'hidden', fontFamily: bodyFont }}>
      {/* Accent blob */}
      <div
        style={{
          position: 'absolute',
          right: -width * 0.15,
          top: height * 0.12,
          width: width * 0.55,
          height: width * 0.55,
          borderRadius: '50%',
          backgroundColor: accent,
          opacity: 0.9 * Math.max(0, accentIn),
          transform: `scale(${0.6 + 0.4 * Math.max(0, accentIn)})`
        }}
      />
      {/* Dot grid corner */}
      <div
        style={{
          position: 'absolute',
          left: pad,
          top: pad,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 12px)',
          gap: 10,
          opacity: Math.max(0, enter)
        }}
      >
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: accent }}
          />
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          top: height * 0.32,
          opacity: Math.max(0, titleIn),
          transform: `translateY(${(1 - Math.max(0, titleIn)) * 40}px)`
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: accent,
            marginBottom: 18,
            fontFamily: bodyFont
          }}
        >
          {brand}
        </div>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: displayFont,
              fontSize: Math.round(width * 0.09),
              fontWeight: 700,
              lineHeight: 0.95,
              letterSpacing: '-0.03em',
              color: ink,
              marginBottom: 4
            }}
          >
            {line}
          </div>
        ))}
        <div
          style={{
            marginTop: 22,
            fontSize: 28,
            lineHeight: 1.35,
            color: muted,
            maxWidth: '85%',
            fontFamily: bodyFont
          }}
        >
          {sub}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          bottom: pad,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: hold
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontSize: 36,
            fontWeight: 700,
            color: ink
          }}
        >
          {handle}
        </div>
        <div
          style={{
            backgroundColor: accent,
            color: bg,
            padding: '12px 22px',
            fontWeight: 700,
            fontSize: 22,
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}
        >
          →
        </div>
      </div>
    </AbsoluteFill>
  );
};
