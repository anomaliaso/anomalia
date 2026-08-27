export const LANGUAGES = [
  'English', 'Italian', 'Spanish', 'French', 'German', 'Portuguese', 'Dutch',
  'Polish', 'Swedish', 'Turkish', 'Arabic', 'Japanese', 'Korean', 'Chinese'
];

export const matchLanguage = (l: string | undefined | null) => {
  if (!l) return '';
  const hit = LANGUAGES.find((x) => x.toLowerCase() === String(l).trim().toLowerCase());
  return hit ?? '';
};
