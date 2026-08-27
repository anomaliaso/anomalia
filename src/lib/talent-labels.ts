/** Client-safe talent label helpers (no server imports). */

export type TalentGender = 'man' | 'woman' | 'trans_man' | 'trans_woman' | 'nonbinary';

export type TalentBodyType =
  | 'slim'
  | 'athletic'
  | 'athletic_slim'
  | 'average'
  | 'curvy'
  | 'plus'
  | 'muscular';

export type TalentHeightBand = 'short' | 'average' | 'tall';

export const TALENT_GENDER_ORDER: TalentGender[] = [
  'woman',
  'man',
  'nonbinary',
  'trans_woman',
  'trans_man'
];

export const TALENT_GENDER_LABELS: Record<TalentGender, string> = {
  man: 'Man',
  woman: 'Woman',
  trans_man: 'Trans man',
  trans_woman: 'Trans woman',
  nonbinary: 'Non-binary'
};

export const TALENT_GENDER_LABELS_IT: Record<TalentGender, string> = {
  man: 'Uomo',
  woman: 'Donna',
  trans_man: 'Uomo trans',
  trans_woman: 'Donna trans',
  nonbinary: 'Non binary'
};

export const TALENT_BODY_TYPE_LABELS: Record<TalentBodyType, string> = {
  slim: 'Slim',
  athletic: 'Athletic',
  athletic_slim: 'Athletic slim',
  average: 'Average',
  curvy: 'Curvy',
  plus: 'Plus',
  muscular: 'Muscular'
};

export const TALENT_HEIGHT_BAND_LABELS: Record<TalentHeightBand, string> = {
  short: 'Short',
  average: 'Average',
  tall: 'Tall'
};

export const TALENT_HEIGHT_BAND_LABELS_IT: Record<TalentHeightBand, string> = {
  short: 'Bassa',
  average: 'Media',
  tall: 'Alta'
};

export function talentGenderLabel(
  gender: string | null | undefined,
  lang: 'en' | 'it' = 'en'
): string {
  if (!gender) return '';
  const map = lang === 'it' ? TALENT_GENDER_LABELS_IT : TALENT_GENDER_LABELS;
  return map[gender as TalentGender] ?? gender.replace(/_/g, ' ');
}

export function talentBodyLabel(bodyType: string | null | undefined): string {
  if (!bodyType) return '';
  return TALENT_BODY_TYPE_LABELS[bodyType as TalentBodyType] ?? bodyType.replace(/_/g, ' ');
}

export function talentHeightLabel(
  band: string | null | undefined,
  lang: 'en' | 'it' = 'en'
): string {
  if (!band) return '';
  const map = lang === 'it' ? TALENT_HEIGHT_BAND_LABELS_IT : TALENT_HEIGHT_BAND_LABELS;
  return map[band as TalentHeightBand] ?? band.replace(/_/g, ' ');
}
