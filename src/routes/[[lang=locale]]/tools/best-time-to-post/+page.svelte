<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  type Platform = 'instagram' | 'linkedin' | 'tiktok' | 'facebook' | 'twitter';
  type Region = 'europe' | 'us' | 'uk' | 'latam' | 'asia';
  type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

  let platform = $state<Platform>('instagram');
  let region = $state<Region>('europe');
  let timezone = $state('CET');

  const platforms: Platform[] = ['instagram', 'linkedin', 'tiktok', 'facebook', 'twitter'];

  const regions: { key: Region; tz: string }[] = [
    { key: 'europe', tz: 'CET' },
    { key: 'us', tz: 'EST' },
    { key: 'uk', tz: 'GMT' },
    { key: 'latam', tz: 'BRT' },
    { key: 'asia', tz: 'SGT' }
  ];

  const days: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Best times data (simplified heatmap: 0-10 scale)
  // Based on aggregated social media research data
  const bestTimes: Record<Platform, Record<Region, number[][]>> = {
    instagram: {
      europe: [
        [2,3,4,5,6,7,8,9,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2], // Mon
        [2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,10,9,8,7,6,5,4,3,2], // Tue
        [2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,10,9,8,7,6,5,4,3,2], // Wed
        [2,3,4,5,6,7,8,9,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2], // Thu
        [2,3,4,5,6,7,8,8,7,6,5,4,5,6,7,8,7,6,5,4,3,3,2,2], // Fri
        [3,3,3,4,5,6,7,8,8,9,9,8,7,6,5,5,4,4,5,6,7,6,5,4], // Sat
        [3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,5,5,5,6,7,7,6,5,4]  // Sun
      ],
      us: [
        [2,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,10,9,8,7,6,5,4,3],
        [2,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,10,9,8,7,6,5,4,3],
        [2,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,8,7,6,5,4,3,2,2],
        [3,3,3,4,5,6,7,8,8,9,9,8,7,6,5,5,4,4,5,6,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,5,5,5,6,7,7,6,5,4]
      ],
      uk: [
        [2,3,4,5,6,7,8,9,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,10,9,8,7,6,5,4,3,2],
        [2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,10,9,8,7,6,5,4,3,2],
        [2,3,4,5,6,7,8,9,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,3,4,5,6,7,8,8,7,6,5,4,5,6,7,8,7,6,5,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,8,9,9,8,7,6,5,5,4,4,5,6,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,5,5,5,6,7,7,6,5,4]
      ],
      latam: [
        [2,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,7,6,5,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,9,9,9,8,7,6,5,5,4,4,5,6,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,5,5,5,6,7,7,6,5,4]
      ],
      asia: [
        [3,3,4,5,6,7,8,7,6,5,4,4,5,6,7,8,9,9,8,7,6,5,4,3],
        [3,3,4,5,6,7,8,7,6,5,4,4,5,6,7,8,9,10,9,8,7,6,5,4],
        [3,3,4,5,6,7,8,7,6,5,4,4,5,6,7,8,9,10,9,8,7,6,5,4],
        [3,3,4,5,6,7,8,7,6,5,4,4,5,6,7,8,9,9,8,7,6,5,4,3],
        [3,3,4,5,6,7,8,7,6,5,4,4,5,6,7,8,8,7,6,5,4,3,3,2],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,7,6,5,5,4,3],
        [4,4,4,5,6,7,8,8,8,7,6,6,7,8,9,10,10,9,8,7,6,5,4,3]
      ]
    },
    linkedin: {
      europe: [
        [1,2,3,4,6,7,8,9,10,10,9,8,7,8,9,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,6,7,8,9,10,10,10,9,8,9,10,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,6,7,8,9,10,10,10,9,8,9,10,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,6,7,8,9,10,10,9,8,7,8,9,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,6,7,8,9,9,8,7,6,5,6,7,7,6,5,4,3,2,2,1,1],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2]
      ],
      us: [
        [1,1,2,3,5,6,7,8,9,10,10,9,8,8,9,10,9,8,6,5,4,3,2,1],
        [1,1,2,3,5,6,7,8,9,10,10,10,9,9,10,10,10,9,7,6,5,4,2,1],
        [1,1,2,3,5,6,7,8,9,10,10,10,9,9,10,10,10,9,7,6,5,4,2,1],
        [1,1,2,3,5,6,7,8,9,10,10,9,8,8,9,10,9,8,6,5,4,3,2,1],
        [1,1,2,3,5,6,7,8,9,8,7,6,5,5,6,7,6,5,4,3,2,2,1,1],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2]
      ],
      uk: [
        [1,2,3,4,6,7,8,9,10,10,9,8,7,8,9,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,6,7,8,9,10,10,10,9,8,9,10,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,6,7,8,9,10,10,10,9,8,9,10,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,6,7,8,9,10,10,9,8,7,8,9,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,6,7,8,9,9,8,7,6,5,6,7,7,6,5,4,3,2,2,1,1],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2]
      ],
      latam: [
        [1,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,5,6,7,8,9,10,9,8,7,8,9,10,9,8,6,5,4,3,2,1],
        [1,2,3,4,5,6,7,8,9,9,8,7,6,7,8,9,8,7,5,4,3,2,2,1],
        [1,2,3,4,5,6,7,8,8,7,6,5,5,6,7,7,6,5,4,3,2,2,1,1],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2],
        [1,1,1,2,3,4,5,5,5,4,3,3,3,3,3,3,3,3,4,5,5,4,3,2]
      ],
      asia: [
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,8,9,9,8,7,6,5,4,3],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,8,9,10,9,8,7,6,5,4],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,8,9,10,9,8,7,6,5,4],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,8,9,9,8,7,6,5,4,3],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,5,4,3,3,2],
        [1,1,2,3,4,5,5,5,5,4,3,3,4,5,6,7,7,6,5,4,3,2,2,1],
        [1,1,2,3,4,5,5,5,5,4,3,3,4,5,6,7,7,6,5,4,3,2,2,1]
      ]
    },
    tiktok: {
      europe: [
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,9,9,8,9,10,9,7,5],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6]
      ],
      us: [
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,9,9,8,9,10,9,7,5],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6]
      ],
      uk: [
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,9,9,8,9,10,9,7,5],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6]
      ],
      latam: [
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,9,7,5],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,8,7,7,8,9,8,6,4],
        [3,3,4,5,6,7,7,6,5,5,4,4,5,6,7,8,9,9,8,9,10,9,7,5],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6],
        [4,4,4,5,6,7,8,8,7,6,5,5,6,7,8,9,9,8,8,9,10,10,8,6]
      ],
      asia: [
        [4,4,4,5,6,7,8,7,6,5,5,5,6,7,8,9,9,8,7,7,8,7,6,5],
        [4,4,4,5,6,7,8,7,6,5,5,5,6,7,8,9,9,8,7,7,8,8,7,5],
        [4,4,4,5,6,7,8,7,6,5,5,5,6,7,8,9,9,8,7,7,8,8,7,5],
        [4,4,4,5,6,7,8,7,6,5,5,5,6,7,8,9,9,8,7,7,8,7,6,5],
        [4,4,4,5,6,7,8,7,6,5,5,5,6,7,8,9,10,9,8,8,9,8,7,5],
        [5,5,5,6,7,8,8,8,7,6,6,6,7,8,9,10,10,9,8,8,9,8,7,6],
        [5,5,5,6,7,8,8,8,7,6,6,6,7,8,9,10,10,9,8,8,9,8,7,6]
      ]
    },
    facebook: {
      europe: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,8,8,7,6,6,6,6,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,9,8,7,7,7,7,6,6,6,7,8,8,7,6,5]
      ],
      us: [
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,8,7,6,5,4,3,2,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,9,8,7,6,5,4,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,5,6,7,8,8,7,6,5,4,3,2,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,8,8,7,6,6,6,6,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,9,8,7,7,7,7,6,6,6,7,8,8,7,6,5]
      ],
      uk: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,8,8,7,6,6,6,6,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,9,8,7,7,7,7,6,6,6,7,8,8,7,6,5]
      ],
      latam: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,4,3,3,2,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,8,8,8,7,6,6,6,6,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,8,9,9,8,7,7,7,7,6,6,6,7,8,8,7,6,5]
      ],
      asia: [
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,6,5,4,3,3],
        [4,4,4,5,6,7,7,7,6,5,5,5,6,7,8,8,8,7,7,7,6,5,4,3],
        [4,4,4,5,6,7,7,7,6,5,5,5,6,7,8,8,8,7,7,7,6,5,4,3]
      ]
    },
    twitter: {
      europe: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4]
      ],
      us: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4]
      ],
      uk: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4]
      ],
      latam: [
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,9,8,7,6,7,8,9,9,8,7,6,5,4,3,3,2],
        [2,2,3,4,5,6,7,8,8,7,6,5,6,7,8,8,7,6,5,5,4,3,3,2],
        [2,2,3,4,5,6,7,7,6,5,4,4,5,6,7,7,6,5,4,4,3,3,2,2],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4],
        [3,3,3,4,5,6,7,7,7,6,5,5,5,5,5,5,5,5,6,7,7,6,5,4]
      ],
      asia: [
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,8,7,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,8,7,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,8,7,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,8,7,6,5,4,4,3],
        [3,3,3,4,5,6,7,7,6,5,4,4,5,6,7,8,8,7,6,5,4,3,3,2],
        [4,4,4,5,6,7,7,7,6,5,5,5,6,7,7,8,8,7,6,6,5,4,4,3],
        [4,4,4,5,6,7,7,7,6,5,5,5,6,7,7,8,8,7,6,6,5,4,4,3]
      ]
    }
  };

  function getHeatColor(val: number): string {
    if (val >= 9) return 'rgba(34,197,94,0.7)';
    if (val >= 7) return 'rgba(34,197,94,0.4)';
    if (val >= 5) return 'rgba(245,158,11,0.3)';
    if (val >= 3) return 'rgba(245,158,11,0.15)';
    return 'rgba(0,0,0,0.03)';
  }

  function formatHour(h: number): string {
    return `${h.toString().padStart(2, '0')}:00`;
  }

  let bestSlots = $derived(() => {
    const data = bestTimes[platform][region];
    const slots: { day: DayKey; hour: number; score: number }[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (data[d][h] >= 8) {
          slots.push({ day: days[d], hour: h, score: data[d][h] });
        }
      }
    }
    return slots.sort((a, b) => b.score - a.score).slice(0, 8);
  });

  function handleRegionChange(r: Region) {
    region = r;
    timezone = regions.find(reg => reg.key === r)?.tz || 'CET';
  }
</script>

<svelte:head>
  <title>{$_('tools.best-time-to-post.meta.title')}</title>
  <meta name="description" content={$_('tools.best-time-to-post.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.best-time-to-post.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.best-time-to-post.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.best-time-to-post.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.best-time-to-post.meta.twitterDescription')} />
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tool-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.best-time-to-post.hero.title')}</h1>
      <p class="subhead">{$_('tools.best-time-to-post.hero.subhead')}<br />{$_('tools.best-time-to-post.hero.subheadLine2')}</p>
    </div>
  </section>

  <section class="tool-body">
    <div class="wrap">
      <!-- Controls -->
      <div class="controls">
        <div class="control-group">
          <label>{$_('tools.best-time-to-post.controls.platform')}</label>
          <div class="tabs">
            {#each platforms as p}
              <button class:active={platform === p} onclick={() => platform = p}>{$_(`tools.best-time-to-post.platforms.${p}`)}</button>
            {/each}
          </div>
        </div>
        <div class="control-group">
          <label>{$_('tools.best-time-to-post.controls.region')}</label>
          <div class="tabs">
            {#each regions as r}
              <button class:active={region === r.key} onclick={() => handleRegionChange(r.key)}>{$_(`tools.best-time-to-post.regions.${r.key}`)}</button>
            {/each}
          </div>
        </div>
        <div class="tz-badge">{$_('tools.best-time-to-post.controls.timezone', { values: { tz: timezone } })}</div>
      </div>

      <!-- Heatmap -->
      <div class="heatmap-wrapper">
        <div class="heatmap">
          <div class="heatmap-header">
            <div class="heatmap-corner"></div>
            {#each hours as h}
              <div class="heatmap-hour" class:peak={h >= 9 && h <= 11 || h >= 18 && h <= 20}>{h}</div>
            {/each}
          </div>
          {#each days as day, di}
            <div class="heatmap-row">
              <div class="heatmap-day">{$_(`tools.best-time-to-post.days.${day}`)}</div>
              {#each hours as h}
                <div
                  class="heatmap-cell"
                  style="background: {getHeatColor(bestTimes[platform][region][di][h])}"
                  title={$_('tools.best-time-to-post.heatmap.cellTitle', {
                    values: {
                      day: $_(`tools.best-time-to-post.days.${day}`),
                      time: formatHour(h),
                      score: bestTimes[platform][region][di][h]
                    }
                  })}
                ></div>
              {/each}
            </div>
          {/each}
        </div>
        <div class="heatmap-legend">
          <span>{$_('tools.best-time-to-post.heatmap.low')}</span>
          <div class="legend-bar"></div>
          <span>{$_('tools.best-time-to-post.heatmap.high')}</span>
        </div>
      </div>

      <!-- Best slots -->
      <div class="best-slots">
        <h3>{$_('tools.best-time-to-post.slots.title', {
          values: {
            platform: $_(`tools.best-time-to-post.platforms.${platform}`),
            region: $_(`tools.best-time-to-post.regions.${region}`)
          }
        })}</h3>
        <div class="slots-grid">
          {#each bestSlots() as slot}
            <div class="slot-card">
              <span class="slot-day">{$_(`tools.best-time-to-post.days.${slot.day}`)}</span>
              <span class="slot-time">{formatHour(slot.hour)}</span>
              <span class="slot-score">{$_('tools.best-time-to-post.slots.score', { values: { score: slot.score } })}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="cta-section">
        <h3>{$_('tools.best-time-to-post.cta.title')}</h3>
        <p>{$_('tools.best-time-to-post.cta.body')}</p>
        <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
      </div>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .tool-hero {
    padding: 150px 0 80px;
    text-align: center;
    min-height: 40vh;
    display: flex;
    align-items: center;
  }
  .tool-hero h1 {
    font-size: clamp(2.4rem, 4.4vw, 3.5rem);
    font-weight: var(--heading-weight);
    line-height: 1.12;
    letter-spacing: var(--heading-tracking);
    margin: 0 auto;
    max-width: 20ch;
  }
  .tool-hero .subhead {
    font-size: clamp(1.05rem, 1.5vw, 1.25rem);
    color: var(--ink-soft);
    max-width: 44ch;
    margin: 24px auto 0;
    line-height: 1.45;
  }

  .tool-body { padding: 0 0 120px; }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 32px;
    max-width: 900px;
    margin-inline: auto;
  }
  .control-group label {
    display: block;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tabs button {
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .tabs button.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .tabs button:hover:not(.active) { background: var(--paper-2); }

  .tz-badge {
    font-size: 0.8rem;
    color: var(--ink-faint);
    font-weight: 500;
  }

  .heatmap-wrapper {
    max-width: 900px;
    margin: 0 auto 40px;
    overflow-x: auto;
  }
  .heatmap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 700px;
  }
  .heatmap-header {
    display: flex;
    gap: 2px;
    margin-bottom: 4px;
  }
  .heatmap-corner { width: 40px; flex-shrink: 0; }
  .heatmap-hour {
    flex: 1;
    text-align: center;
    font-size: 0.65rem;
    color: var(--ink-faint);
    font-weight: 500;
  }
  .heatmap-hour.peak { color: var(--accent); font-weight: 700; }

  .heatmap-row {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .heatmap-day {
    width: 40px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .heatmap-cell {
    flex: 1;
    height: 28px;
    border-radius: 4px;
    transition: transform 0.15s;
    cursor: default;
  }
  .heatmap-cell:hover {
    transform: scale(1.15);
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }

  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    margin-top: 12px;
    font-size: 0.72rem;
    color: var(--ink-faint);
  }
  .legend-bar {
    width: 120px;
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(0,0,0,0.03), rgba(245,158,11,0.3), rgba(34,197,94,0.7));
  }

  .best-slots {
    max-width: 900px;
    margin: 0 auto 48px;
  }
  .best-slots h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 16px;
    text-align: center;
  }
  .slots-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .slot-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .slot-day { font-size: 0.82rem; color: var(--ink-faint); font-weight: 500; }
  .slot-time { font-size: 1.3rem; font-weight: 700; color: var(--ink); }
  .slot-score { font-size: 0.75rem; color: var(--accent); font-weight: 600; }

  .cta-section {
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 48px 32px;
    max-width: 600px;
    margin: 0 auto;
  }
  .cta-section h3 { font-size: 1.3rem; color: var(--ink); margin: 0 0 12px; }
  .cta-section p { color: var(--ink-soft); font-size: 1rem; margin: 0 0 24px; line-height: 1.5; }

  @media (max-width: 820px) {
    .tool-hero { padding: 124px 0 60px; }
    .tool-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .slots-grid { grid-template-columns: repeat(2, 1fr); }
    .heatmap-wrapper { margin-left: -16px; margin-right: -16px; padding: 0 16px; }
  }
</style>
