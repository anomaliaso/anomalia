/* eslint-disable @typescript-eslint/no-explicit-any */
export type RestoredDraft = {
  brandId: string | null;
  url: string;
  noWebsite: boolean;
  brandName: string;
  creatorNiche: string;
  profile: any;
  researchData: any;
  report: any;
  citations: { uri: string; title: string }[];
  buyerPersonas: any[];
  previewPosts: any[];
  editorialPlan: any;
  allowedCadences: string[];
  planVisualStyle: string | null;
  competitors: any[];
  competitorJobId: string | null;
  researchJobId: string | null;
  planPostsJobId: string | null;
  previewImagesJobId: string | null;
  researchSteps: { step: string; message: string; result?: any }[];
  selectedPlatforms: string[];
  handles: Record<string, string>;
  language: string;
  additionalContext: string;
  personName: string;
  personRole: string;
  personImages: { path: string; url: string }[];
  detectedPeople: {
    name: string;
    role: string;
    image?: string;
    images: string[];
    selected: boolean;
    path?: string;
    paths: string[];
    sourced: string[];
  }[];
};

export function restoreDraft(d: any): RestoredDraft | null {
  if (!d || typeof d !== 'object') return null;

  const ppl = d.people ?? {};
  const personImages: { path: string; url: string }[] = Array.isArray(ppl.personImages)
    ? ppl.personImages.map((i: any) => ({ path: i.path, url: '' }))
    : [];
  const detectedPeople = Array.isArray(ppl.detectedPeople)
    ? ppl.detectedPeople.map((p: any) => {
        const images = Array.isArray(p.images) && p.images.length ? p.images : p.image ? [p.image] : [];
        const paths = Array.isArray(p.paths) && p.paths.length ? p.paths : p.path ? [p.path] : [];
        return {
          name: p.name ?? '',
          role: p.role ?? '',
          image: p.image,
          images,
          selected: !!p.selected,
          path: p.path,
          paths,
          // Draft salvati prima che `sourced` esistesse: i primi N scatti sono gli importati.
          sourced: Array.isArray(p.sourced) ? p.sourced : images.slice(0, paths.length)
        };
      })
    : [];

  return {
    brandId: typeof d.brandId === 'string' ? d.brandId : null,
    url: typeof d.url === 'string' ? d.url : '',
    noWebsite: !!d.noWebsite,
    brandName: typeof d.brandName === 'string' ? d.brandName : '',
    creatorNiche: typeof d.creatorNiche === 'string' ? d.creatorNiche : '',
    profile: d.profile ?? null,
    researchData: d.researchData ?? null,
    report: d.report ?? null,
    citations: Array.isArray(d.citations) ? d.citations : [],
    buyerPersonas: Array.isArray(d.buyerPersonas) ? d.buyerPersonas : [],
    previewPosts: Array.isArray(d.previewPosts) ? d.previewPosts : [],
    editorialPlan: d.editorialPlan ?? null,
    allowedCadences: Array.isArray(d.allowedCadences) && d.allowedCadences.length ? d.allowedCadences : [],
    planVisualStyle: d.planVisualStyle ?? null,
    competitors: Array.isArray(d.competitors) ? d.competitors : [],
    competitorJobId: typeof d.competitorJobId === 'string' ? d.competitorJobId : null,
    researchJobId: typeof d.researchJobId === 'string' ? d.researchJobId : null,
    planPostsJobId: typeof d.planPostsJobId === 'string' ? d.planPostsJobId : null,
    previewImagesJobId: typeof d.previewImagesJobId === 'string' ? d.previewImagesJobId : null,
    researchSteps: Array.isArray(d.researchSteps) ? d.researchSteps : [],
    selectedPlatforms: Array.isArray(d.selectedPlatforms) ? d.selectedPlatforms : [],
    handles: d.handles && typeof d.handles === 'object' ? d.handles : {},
    language: d.language ?? '',
    additionalContext: d.additionalContext ?? '',
    personName: ppl.personName ?? '',
    personRole: ppl.personRole ?? '',
    personImages,
    detectedPeople
  };
}
