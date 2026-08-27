import { describe, expect, it } from 'vitest';
import {
  analysable,
  hashtagsOf,
  notAudio,
  parseWatchDist,
  dedupeVideos,
  parseInstagramReels,
  parseTikTokVideos,
  type TrendingVideo
} from './market-trends';

describe('parseTikTokVideos', () => {
  const payload = {
    aweme_list: [
      {
        aweme_id: '7412',
        author: { unique_id: 'chefmarco', nickname: 'Chef Marco' },
        desc: 'Hai 3 tavoli vuoti il martedì?',
        create_time: 1787000000,
        statistics: { digg_count: 1840, comment_count: 96, share_count: 41, play_count: 210_000 },
        video: {
          play_addr: { url_list: ['https://cdn.tiktok/v.mp4'] },
          cover: { url_list: ['https://cdn.tiktok/c.jpg'] }
        }
      }
    ]
  };

  it('prefers unique_id over nickname — only the handle can be fed to the profile endpoint', () => {
    expect(parseTikTokVideos(payload, 'trending')[0].accountHandle).toBe('chefmarco');
  });

  it('falls back to nickname when there is no unique_id', () => {
    const [v] = parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { nickname: 'Solo Nome' }, desc: 'x' }] },
      't'
    );
    expect(v.accountHandle).toBe('Solo Nome');
  });

  it('never turns a nested author shape into the handle "[object Object]"', () => {
    // Seen in production: one payload nested the id, `String(obj)` yielded "[object Object]",
    // and because that string is non-empty it beat both the nickname fallback and the null.
    // Every post of that phantom account was then grouped under it and queued for a profile
    // fetch that can never resolve.
    const [v] = parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { unique_id: { id: 'x' }, nickname: 'Nome Vero' }, desc: 'x' }] },
      't'
    );
    expect(v.accountHandle).toBe('Nome Vero');
  });

  it('drops the video entirely when every handle candidate is an object', () => {
    // A video with no resolvable account can never be labelled against that account's median,
    // which is the only follower-free label we have. Dropping it is the existing contract for a
    // missing handle; the point here is that an object no longer counts as one.
    expect(
      parseTikTokVideos(
        { aweme_list: [{ aweme_id: '1', author: { unique_id: {}, nickname: {} }, desc: 'x' }] },
        't'
      )
    ).toEqual([]);
  });

  it('captures the rival explanations, not just the score', () => {
    // A mega-viral is exactly where "was it the hook?" is most tempting and least answerable. These
    // are the fields that let the hook be tested against the alternatives instead of credited by
    // default — and they were all in the payload already, thrown away by `trim=true`.
    const [v] = parseTikTokVideos(
      {
        aweme_list: [
          {
            aweme_id: '1',
            author: { unique_id: 'x', region: 'IT' },
            desc: 'ciao',
            desc_language: 'it',
            region: 'IT',
            is_ad: false,
            is_paid_partnership: true,
            music: { id: '77123', title: 'Suono Virale' },
            statistics: { digg_count: 1, collect_count: 940 }
          }
        ]
      },
      't'
    );
    expect(v.region).toBe('IT');
    expect(v.soundId).toBe('77123');
    expect(v.soundName).toBe('Suono Virale');
    expect(v.isPaidPartnership).toBe(true);
    expect(v.isAd).toBe(false);
    expect(v.saves).toBe(940);
    expect(v.captionLanguage).toBe('it');
  });

  it('keeps false apart from unknown for the paid flags', () => {
    // "not sponsored" and "we were not told" are different facts. Collapsing them to false would
    // quietly move every unknown post into the clean cohort.
    const [v] = parseTikTokVideos({ aweme_list: [{ aweme_id: '1', author: { unique_id: 'x' }, desc: 'x' }] }, 't');
    expect(v.isAd).toBeNull();
    expect(v.isPaidPartnership).toBeNull();
    expect(v.saves).toBeNull();
  });

  it("treats TikTok's 'un' language as unknown rather than a language called un", () => {
    const [v] = parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { unique_id: 'x' }, desc: 'x', desc_language: 'un' }] },
      't'
    );
    expect(v.captionLanguage).toBeNull();
  });

  it('falls back to the author region when the video carries none', () => {
    const [v] = parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { unique_id: 'x', region: 'es' }, desc: 'x' }] },
      't'
    );
    expect(v.region).toBe('ES');
  });

  it('picks up the auto-caption url, which is a transcript we already paid for', () => {
    const [v] = parseTikTokVideos(
      {
        aweme_list: [
          {
            aweme_id: '1',
            author: { unique_id: 'x' },
            desc: 'x',
            video: {
              cla_info: {
                caption_infos: [{ url: 'https://cdn/sub.vtt', language_code: 'IT' }]
              }
            }
          }
        ]
      },
      't'
    );
    expect(v.captionsUrl).toBe('https://cdn/sub.vtt');
    expect(v.captionsLang).toBe('it');
  });

  it('leaves it null when TikTok generated no captions — most videos', () => {
    // no_caption_reason 3 on 17 of 20 measured. The absence has to be readable as absence.
    const [v] = parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { unique_id: 'x' }, desc: 'x', video: { cla_info: { caption_infos: null } } }] },
      't'
    );
    expect(v.captionsUrl).toBeNull();
  });

  it('extracts the video url the judge will need', () => {
    expect(parseTikTokVideos(payload, 'trending')[0].videoUrl).toBe('https://cdn.tiktok/v.mp4');
  });

  it('keeps views separate from interactions', () => {
    // Engagement stays likes+comments+shares; views are stored but not comparable across platforms.
    expect(parseTikTokVideos(payload, 'trending')[0].metrics).toEqual({
      likes: 1840,
      comments: 96,
      shares: 41,
      views: 210_000
    });
  });

  it('builds a url when share_url is absent', () => {
    expect(parseTikTokVideos(payload, 'trending')[0].url).toBe(
      'https://www.tiktok.com/@chefmarco/video/7412'
    );
  });

  it('drops entries with no id or no author', () => {
    expect(parseTikTokVideos({ aweme_list: [{ desc: 'orfano' }] }, 't')).toEqual([]);
    expect(parseTikTokVideos({ aweme_list: [{ aweme_id: '1', desc: 'x' }] }, 't')).toEqual([]);
  });

  it('never throws on a malformed payload', () => {
    expect(parseTikTokVideos(null, 't')).toEqual([]);
    expect(parseTikTokVideos({ aweme_list: 'nope' }, 't')).toEqual([]);
    expect(parseTikTokVideos({ aweme_list: [null, 7] }, 't')).toEqual([]);
  });
});

describe('parseInstagramReels', () => {
  const payload = {
    items: [
      {
        shortcode: 'DYt13O8gLoE',
        user: { username: 'trattoria_x' },
        caption: 'Il 68% dei clienti non torna.',
        taken_at: '2026-08-19T09:00:00Z',
        video_url: 'https://cdn.ig/r.mp4',
        image_url: 'https://cdn.ig/t.jpg',
        like_count: 910,
        comment_count: 44,
        play_count: 120_000
      }
    ]
  };

  it('reads the reel, its owner and its video', () => {
    const [v] = parseInstagramReels(payload, 'trending');
    expect(v.accountHandle).toBe('trattoria_x');
    expect(v.videoUrl).toBe('https://cdn.ig/r.mp4');
    expect(v.url).toBe('https://www.instagram.com/reel/DYt13O8gLoE/');
  });

  it('accepts a caption as a bare string or as { text }', () => {
    const nested = parseInstagramReels(
      { items: [{ shortcode: 'a', user: { username: 'u' }, caption: { text: 'annidata' } }] },
      't'
    );
    expect(nested[0].caption).toBe('annidata');
    expect(parseInstagramReels(payload, 't')[0].caption).toBe('Il 68% dei clienti non torna.');
  });

  it('unwraps a post nested under media or node', () => {
    const wrapped = parseInstagramReels(
      { items: [{ node: { shortcode: 'b', user: { username: 'u' }, caption: 'x' } }] },
      't'
    );
    expect(wrapped).toHaveLength(1);
  });

  it('accepts a bare array as well as the wrapped shapes', () => {
    expect(parseInstagramReels([{ shortcode: 'c', user: { username: 'u' } }], 't')).toHaveLength(1);
  });

  it('drops entries with no shortcode or no owner', () => {
    expect(parseInstagramReels({ items: [{ user: { username: 'u' } }] }, 't')).toEqual([]);
    expect(parseInstagramReels({ items: [{ shortcode: 'x' }] }, 't')).toEqual([]);
  });
});

describe('dedupeVideos and analysable', () => {
  const v = (over: Partial<TrendingVideo> = {}): TrendingVideo => ({
    platform: 'tiktok',
    externalId: 'tiktok:1',
    url: 'u',
    accountHandle: 'a',
    caption: 'c',
    region: null,
    soundId: null,
    soundName: null,
    isAd: null,
    isPaidPartnership: null,
    saves: null,
    captionLanguage: null,
    captionsUrl: null,
    captionsLang: null,
    durationMs: null,
    hashtags: [],
    soundFrom: null,
    soundIsOriginal: null,
    createdByAi: null,
    videoRatio: null,
    videoWidth: null,
    videoHeight: null,
    shootMode: null,
    videoUrlClean: null,
    watchThresholdMs: null,
    watchProb: null,
    watchAvgMs: null,
    videoUrl: 'https://cdn/v.mp4',
    thumbnailUrl: null,
    publishedAt: null,
    metrics: { likes: 0, comments: 0, shares: 0, views: 0 },
    source: 'trending',
    ...over
  });

  it('keeps one row per video across sources', () => {
    const list = [v(), v({ source: '#food' }), v({ externalId: 'tiktok:2' })];
    expect(dedupeVideos(list)).toHaveLength(2);
  });

  it('keeps only clips the judge can actually fetch and the baseline can anchor', () => {
    const list = [v(), v({ externalId: 'x', videoUrl: null }), v({ externalId: 'y', accountHandle: null })];
    expect(analysable(list)).toHaveLength(1);
  });
});

describe('hashtagsOf', () => {
  it('reads the hashtags the post itself carries', () => {
    // `query` records what WE searched for; this records what actually worked. The difference is
    // the whole point — one is a fact about us, the other a fact about the content.
    expect(
      hashtagsOf([
        { hashtag_name: 'rimini' },
        { hashtag_name: '#Ristorante' },
        { hashtag_name: 'rimini' },
        { not_a_tag: true }
      ])
    ).toEqual(['rimini', 'ristorante']);
  });

  it('returns an empty list, never undefined, when there are none', () => {
    expect(hashtagsOf(null)).toEqual([]);
    expect(hashtagsOf('nope')).toEqual([]);
  });
});

describe('parseWatchDist', () => {
  it('reads the three raw numbers as three raw numbers', () => {
    // Deliberately NOT named retention: nothing documents this field, and a name that asserts a
    // meaning would let downstream code depend on a guess.
    expect(parseWatchDist('[800,0.7566,2241.3802]')).toEqual({
      thresholdMs: 800,
      prob: 0.7566,
      avgMs: 2241.3802
    });
  });

  it('gives up cleanly on anything that is not that shape', () => {
    for (const bad of ['', 'banana', '[800]', '{}', null, 42]) {
      expect(parseWatchDist(bad)).toEqual({ thresholdMs: null, prob: null, avgMs: null });
    }
  });

  it('rejects non-numeric entries instead of coercing them', () => {
    expect(parseWatchDist('["800","x","y"]')).toEqual({ thresholdMs: null, prob: null, avgMs: null });
  });
});

describe('parseTikTokVideos — formato e distribuzione', () => {
  const one = (over: Record<string, unknown> = {}) =>
    parseTikTokVideos(
      { aweme_list: [{ aweme_id: '1', author: { unique_id: 'x' }, desc: 'x', ...over }] },
      't'
    )[0];

  it('records the duration, which is the format question we could not ask', () => {
    expect(one({ video: { duration: 16183 } }).durationMs).toBe(16183);
  });

  it('separates a borrowed sound from the creator own', () => {
    // A viral on a recommended sound rode a current. Crediting its hook would teach a lie.
    expect(one({ music_selected_from: 'original' }).soundIsOriginal).toBe(true);
    expect(one({ music_selected_from: 'edit_page_recommend' }).soundIsOriginal).toBe(false);
  });

  it('keeps unknown apart from false for the sound origin and the AI label', () => {
    expect(one().soundIsOriginal).toBeNull();
    expect(one().createdByAi).toBeNull();
    expect(one({ aigc_info: { created_by_ai: false } }).createdByAi).toBe(false);
  });

  it('digs the watch triple out of the JSON-inside-JSON TikTok wraps it in', () => {
    const v = one({ solaria_profile: { profile: JSON.stringify({ play_time_prob_dist: '[800,0.84,1984.07]' }) } });
    expect(v.watchProb).toBe(0.84);
    expect(v.watchAvgMs).toBe(1984.07);
  });

  it('keeps the watermark-free copy beside the normal one, not instead of it', () => {
    // Swapping the judge download source while 2 extractions in 3 already fail would make it
    // impossible to tell which of the two changes broke it.
    const v = one({
      video: {
        play_addr: { url_list: ['https://cdn/wm.mp4'] },
        download_no_watermark_addr: { url_list: ['https://cdn/clean.mp4'] }
      }
    });
    expect(v.videoUrl).toBe('https://cdn/wm.mp4');
    expect(v.videoUrlClean).toBe('https://cdn/clean.mp4');
  });
});

describe('notAudio', () => {
  it('rejects a track url, which is what twelve rows in the bank were pointing the judge at', () => {
    expect(notAudio('https://sf16-ies-music-sg.tiktokcdn.com/obj/tiktok-obj/7383021724864318225.mp3')).toBeNull();
    expect(notAudio('https://cdn/x.m4a?a=1')).toBeNull();
  });

  it('keeps a real clip url, extension or not', () => {
    // TikTok CDN urls routinely carry no extension at all — 107 of 200 measured.
    expect(notAudio('https://v45.tiktokcdn-eu.com/abc/video/tos/no1a/xyz/?a=1233')).toBe(
      'https://v45.tiktokcdn-eu.com/abc/video/tos/no1a/xyz/?a=1233'
    );
    expect(notAudio('https://cdn/v.mp4')).toBe('https://cdn/v.mp4');
  });

  it('passes null through', () => {
    expect(notAudio(null)).toBeNull();
  });
});
