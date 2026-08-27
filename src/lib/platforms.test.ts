import { describe, expect, it } from 'vitest';
import { PLATFORM_IDS } from './platforms';
import { AUTOMATION_BLOCKED_PLATFORMS } from './platform-terms';
import { RADAR_PLATFORM_KEYS } from './plans';
import { CAROUSEL_PLATFORMS } from './server/content-preview';
import { VIDEO_PLATFORMS } from './server/market-trends';
import { DISCOVERY_PLATFORMS } from './server/market-discovery';

const VOCAB: readonly string[] = Object.values(PLATFORM_IDS);

describe('platform vocabulary', () => {
  it('declares each id exactly once', () => {
    expect(new Set(VOCAB).size).toBe(VOCAB.length);
  });
});

describe('frozen platform sets', () => {
  it('carousel-capable platforms keep their exact values', () => {
    expect([...CAROUSEL_PLATFORMS]).toEqual(['instagram', 'facebook', 'linkedin']);
  });

  it('video discovery platforms keep their exact values', () => {
    expect([...VIDEO_PLATFORMS]).toEqual(['instagram', 'tiktok']);
  });

  it('conversation discovery platforms keep their exact values', () => {
    expect([...DISCOVERY_PLATFORMS]).toEqual(['threads', 'linkedin', 'reddit']);
  });

  it('automation-blocked platforms keep ids, labels and order', () => {
    expect(
      AUTOMATION_BLOCKED_PLATFORMS.map((p) => [p.id, p.label] as const)
    ).toEqual([
      ['instagram', 'Instagram'],
      ['facebook', 'Facebook'],
      ['threads', 'Threads'],
      ['tiktok', 'TikTok'],
      ['linkedin', 'LinkedIn'],
      ['x', 'X / Twitter'],
      ['youtube', 'YouTube'],
      ['google', 'Google'],
      ['reddit', 'Reddit'],
      ['pinterest', 'Pinterest'],
      ['snapchat', 'Snapchat'],
      ['whatsapp', 'WhatsApp'],
      ['telegram', 'Telegram'],
      ['amazon', 'Amazon']
    ]);
  });

  it('radar platform keys keep their exact values and order', () => {
    expect([...RADAR_PLATFORM_KEYS]).toEqual(['gnews', 'reddit', 'threads', 'x', 'linkedin']);
  });
});

describe('every set draws its ids from the vocabulary', () => {
  it.each([
    ['carousel', [...CAROUSEL_PLATFORMS]],
    ['video', [...VIDEO_PLATFORMS]],
    ['discovery', [...DISCOVERY_PLATFORMS]],
    ['automation-blocked', AUTOMATION_BLOCKED_PLATFORMS.map((p) => p.id)],
    ['radar', [...RADAR_PLATFORM_KEYS]]
  ] as const)('%s ids are all declared in PLATFORM_IDS', (_name, members) => {
    for (const id of members) {
      expect(VOCAB).toContain(id);
    }
  });
});
