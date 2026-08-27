export const MAX_PERSON_PHOTOS = 6;

export type DetectedPerson = {
  name: string;
  role: string;
  image?: string;
  images?: string[];
  selected: boolean;
  path?: string;
  url?: string;
  paths?: string[];
  urls?: string[];
  sourced?: string[];
};

export const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

const nameTokens = (name: string) =>
  personKey(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

export const namesMatch = (a: string, b: string) => {
  const ka = personKey(a);
  const kb = personKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.replace(/\s/g, '') === kb.replace(/\s/g, '')) return true;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.every((t) => tb.includes(t)) || tb.every((t) => ta.includes(t))) return true;
  if (ta.length >= 2 && tb.length >= 2 && ta[ta.length - 1] === tb[tb.length - 1] && ta[ta.length - 1].length >= 4) {
    return true;
  }
  return false;
};

export const findPersonIndex = (list: { name: string }[], name: string) => {
  const exact = list.findIndex((p) => personKey(p.name) === personKey(name));
  if (exact >= 0) return exact;
  return list.findIndex((p) => namesMatch(p.name, name));
};

export const personShots = (p: { image?: string; images?: string[] }) =>
  p.images?.length ? p.images : p.image ? [p.image] : [];

export const personPaths = (p: { path?: string; paths?: string[] }) =>
  p.paths?.length ? p.paths : p.path ? [p.path] : [];

export const personUrls = (p: { url?: string; urls?: string[] }) =>
  p.urls?.length ? p.urls : p.url ? [p.url] : [];

export const displayShots = (p: DetectedPerson) => {
  const signed = personUrls(p);
  const pending = personShots(p).filter((s) => !(p.sourced ?? []).includes(s));
  return [...new Set([...signed, ...pending])].slice(0, MAX_PERSON_PHOTOS);
};

export const missingShots = (p: { image?: string; images?: string[]; sourced?: string[] }) => {
  const done = new Set(p.sourced ?? []);
  return personShots(p).filter((s) => !done.has(s));
};

export type GenPerson = { name: string; role: string; images: string[] };

export const toGenPeople = (
  readyDetected: DetectedPerson[],
  manual: { name: string; role: string; images: { url: string }[] }
): GenPerson[] => [
  ...readyDetected.map((p) => ({ name: p.name.trim(), role: p.role.trim(), images: personUrls(p) })),
  ...(manual.name.trim() && manual.images.length
    ? [{ name: manual.name.trim(), role: manual.role.trim(), images: manual.images.map((i) => i.url) }]
    : [])
];

export const toSavePeople = (
  readyDetected: DetectedPerson[],
  manual: { name: string; role: string; images: { path: string }[] }
) => [
  ...readyDetected.map((p) => ({
    name: p.name.trim(),
    role: p.role.trim(),
    consent: false,
    consent_source: 'import_unattested',
    images: personPaths(p).map((path) => ({ path }))
  })),
  ...(manual.name.trim() && manual.images.length
    ? [
        {
          name: manual.name.trim(),
          role: manual.role.trim(),
          consent: true,
          consent_source: 'owner_attested',
          images: manual.images.map((i) => ({ path: i.path }))
        }
      ]
    : [])
];

export const collectPersonPaths = (
  personImages: { path: string }[],
  detectedPeople: DetectedPerson[]
): string[] =>
  [...personImages.map((i) => i.path), ...detectedPeople.flatMap((p) => personPaths(p))].filter(
    (p): p is string => !!p
  );

// Gli URL firmati scadono: dopo una ripresa vanno ribattuti dai path salvati.
export const applySignedUrls = (
  personImages: { path: string; url: string }[],
  detectedPeople: DetectedPerson[],
  urls: Record<string, string>
) => ({
  personImages: personImages.map((i) => ({ ...i, url: urls[i.path] ?? i.url })),
  detectedPeople: detectedPeople.map((p) => {
    const signed = personPaths(p)
      .map((path) => urls[path])
      .filter(Boolean);
    return signed.length ? { ...p, urls: signed, url: signed[0] } : p;
  })
});

export const snapshotDetected = (p: DetectedPerson) => ({
  name: p.name,
  role: p.role,
  image: p.image,
  images: personShots(p),
  selected: p.selected,
  path: p.path,
  paths: personPaths(p),
  sourced: p.sourced ?? personShots(p).slice(0, personPaths(p).length)
});
