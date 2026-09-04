export type PlanBlob = Record<string, unknown>;

export type WeekRow = {
  index: number;
  label: string;
  theme: string;
  focus: string;
  brief: string;
  mix: string;
  status: string;
  current: boolean;
};

export type WeekState = {
  label: string;
  tone: 'default' | 'secondary' | 'outline';
};

export type Pair = { label: string; value: string };

export type PlatformRow = { platform: string; share: string; role: string };

const WEEK_STATES: Record<string, WeekState> = {
  upcoming: { label: 'Upcoming', tone: 'outline' },
  planned: { label: 'Planned', tone: 'default' },
  done: { label: 'Done', tone: 'secondary' }
};

const VOICE_LABELS: Pair[] = [
  { label: 'Mood', value: 'mood' },
  { label: 'Tone', value: 'tone' },
  { label: 'Goal', value: 'goal' },
  { label: 'Personality', value: 'personality' }
];

function rows(value: unknown): PlanBlob[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as PlanBlob[]) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stateOf(status: unknown): WeekState {
  const key = text(status) || 'upcoming';
  return WEEK_STATES[key] ?? { label: key, tone: 'outline' };
}

export function mixOf(week: PlanBlob): string {
  return rows(week.content_mix)
    .map((entry) => {
      const type = text(entry.type);
      return type ? `${entry.count ?? 0} ${type}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function weeksOf(plan: PlanBlob | null, currentWeek: number | null): WeekRow[] {
  if (!plan) {
    return [];
  }

  return rows(plan.weeks).map((week, index) => ({
    index,
    label: `Week ${index + 1}`,
    theme: text(week.theme) || text(week.title) || `Week ${index + 1}`,
    focus: text(week.focus),
    brief: text(week.brief),
    mix: mixOf(week),
    status: text(week.status) || 'upcoming',
    current: index === currentWeek
  }));
}

export function pairsOf(plan: PlanBlob): Pair[] {
  const voice = plan.voice;
  if (!voice || typeof voice !== 'object' || Array.isArray(voice)) {
    return [];
  }

  const spoken = voice as PlanBlob;

  return VOICE_LABELS.map(({ label, value }) => ({ label, value: text(spoken[value]) })).filter(
    (pair) => pair.value !== ''
  );
}

export function platformsOf(plan: PlanBlob): PlatformRow[] {
  return rows(plan.platform_mix)
    .map((entry) => ({
      platform: text(entry.platform),
      share: text(entry.share),
      role: text(entry.role)
    }))
    .filter((entry) => entry.platform !== '');
}

export function textOf(blob: PlanBlob | null, key: string): string {
  return blob ? text(blob[key]) : '';
}

export function listOf(blob: PlanBlob | null, key: string): string[] {
  const value = blob?.[key];
  return Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : [];
}
