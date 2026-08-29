export type PlatformMixItem = {
  platform?: string | null;
  percent?: number;
  share?: string | null;
  role?: string | null;
};

export type PlatformMixRow = {
  key: string;
  role: string;
  share: string;
  percent: number | null;
};

const PERCENT = /(\d+(?:[.,]\d+)?)\s*%/;
const NUMBER = /(\d+(?:[.,]\d+)?)/;

function numberIn(value: string): number | null {
  const match = value.match(NUMBER);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function percentIn(item: PlatformMixItem, share: string): number | null {
  if (typeof item.percent === 'number' && Number.isFinite(item.percent)) return item.percent;
  const match = share.match(PERCENT);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function platformMixRows(mix: readonly PlatformMixItem[]): PlatformMixRow[] {
  const rows = mix
    .filter((item) => item?.platform)
    .map((item) => {
      const share = String(item.share ?? '');
      return {
        key: String(item.platform).toLowerCase().trim(),
        role: item.role ?? '',
        share,
        percent: percentIn(item, share)
      };
    });

  const numbers = rows.map((row) => numberIn(row.share));
  const canNormalize =
    rows.some((row) => row.percent == null) &&
    rows.every((row, index) => row.percent != null || numbers[index] != null);
  if (canNormalize) {
    const total = numbers.reduce<number>((sum, value) => sum + (value ?? 0), 0) || 1;
    rows.forEach((row, index) => {
      if (row.percent == null) row.percent = ((numbers[index] ?? 0) / total) * 100;
    });
  }

  return rows.map((row) => ({ ...row, percent: row.percent == null ? null : clamp(row.percent) }));
}
