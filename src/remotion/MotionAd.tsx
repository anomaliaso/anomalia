import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

export type MotionAdProps = {
  brand: string;
  headline: string;
  sub: string;
  /** Middle beat — short brand promise (may include a line break). */
  promise: string;
  cta: string;
  accent: string;
  bg: string;
  ink: string;
  muted: string;
  displayFont: string;
  bodyFont: string;
};

export const MOTION_AD_FPS = 30;
export const MOTION_AD_DURATION = MOTION_AD_FPS * 6; // 6s
export const MOTION_AD_SIZE = { width: 1080, height: 1080 } as const;

export const defaultMotionAdProps = (brand = 'Anomalia'): MotionAdProps => ({
  brand,
  headline: 'Your marketing team.\nOn autopilot.',
  sub: 'Create posts, UGC, and SEO content from one chat.',
  promise: 'Chat once.\nShip everywhere.',
  cta: 'Start free → anomalia.so',
  accent: '#c485fe',
  bg: '#050505',
  ink: '#f4f4f5',
  muted: 'rgba(244,244,245,0.55)',
  displayFont: 'Inter',
  bodyFont: 'Inter'
});

/**
 * Kinetic 1:1 Meta/IG-style motion ad.
 * Three beats: claim → support → brand CTA.
 */
export const MotionAd: React.FC<MotionAdProps> = ({
  brand,
  headline,
  sub,
  promise,
  cta,
  accent,
  bg,
  ink,
  muted,
  displayFont,
  bodyFont
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const claimIn = spring({ frame: frame - 2, fps, config: { damping: 18, stiffness: 140 } });
  const subIn = interpolate(frame, [28, 42], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic)
  });
  const claimOut = interpolate(frame, [70, 82], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic)
  });

  const midIn = interpolate(frame, [78, 92], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic)
  });
  const midOut = interpolate(frame, [118, 130], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic)
  });

  const endIn = spring({ frame: frame - 128, fps, config: { damping: 16, stiffness: 130 } });
  const ctaIn = interpolate(frame, [148, 162], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic)
  });

  const lines = headline.split('\n').filter(Boolean);
  const promiseLines = promise.split('\n').filter(Boolean);

  return (
    <AbsoluteFill style={{ backgroundColor: bg, overflow: 'hidden', fontFamily: bodyFont }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 40%, ${accent}33 0%, transparent 55%)`
        }}
      />

      {/* Beat 1 — claim */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 72,
          opacity: Math.max(0, Math.min(claimIn, 1 - claimOut)),
          transform: `translateY(${(1 - claimIn) * 28 + claimOut * -16}px)`
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 920 }}>
          {lines.map((line, i) => (
            <div
              key={`${line}-${i}`}
              style={{
                fontFamily: displayFont,
                fontSize: 72,
                fontWeight: 500,
                color: ink,
                letterSpacing: '-0.04em',
                lineHeight: 1.08,
                marginBottom: 6
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
              transform: `translateY(${(1 - subIn) * 12}px)`
            }}
          >
            {sub}
          </div>
        </div>
      </AbsoluteFill>

      {/* Beat 2 — brand promise */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 72,
          opacity: Math.max(0, Math.min(midIn, 1 - midOut)),
          transform: `translateY(${(1 - midIn) * 24 + midOut * -12}px)`
        }}
      >
        <div
          style={{
            textAlign: 'center',
            fontFamily: displayFont,
            fontSize: 64,
            fontWeight: 400,
            color: ink,
            letterSpacing: '-0.035em',
            lineHeight: 1.12,
            maxWidth: 900
          }}
        >
          {promiseLines.map((line, i) => (
            <React.Fragment key={`${line}-${i}`}>
              {i > 0 ? <br /> : null}
              <span style={i === promiseLines.length - 1 ? { color: accent } : undefined}>
                {line}
              </span>
            </React.Fragment>
          ))}
        </div>
      </AbsoluteFill>

      {/* Beat 3 — end card */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 64,
          opacity: Math.max(0, endIn),
          transform: `translateY(${(1 - Math.min(1, endIn)) * 20}px)`
        }}
      >
        <div style={{ textAlign: 'center' }}>
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
          <div
            style={{
              marginTop: 28,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '14px 28px',
              borderRadius: 999,
              background: accent,
              color: '#1a1024',
              fontFamily: bodyFont,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              opacity: ctaIn,
              transform: `translateY(${(1 - ctaIn) * 12}px) scale(${0.96 + ctaIn * 0.04})`
            }}
          >
            {cta}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
