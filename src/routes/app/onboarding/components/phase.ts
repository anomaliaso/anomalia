export type Phase =
  | 'input'
  | 'analyzing'
  | 'intro'
  | 'pick'
  | 'people'
  | 'competitors'
  | 'strategy'
  | 'plan'
  | 'preview';

// 'analyzing' shares the website step so the indicator doesn't jump mid-analysis.
export const TIMELINE_STEPS = [
  'onboarding.timeline.website',
  'onboarding.timeline.people',
  'onboarding.timeline.competitors',
  'onboarding.timeline.strategy',
  'onboarding.timeline.plan',
  'onboarding.timeline.preview'
];

export const PROGRESS_TOTAL = TIMELINE_STEPS.length;

export const PHASE_STEP: Record<Phase, number> = {
  input: 1,
  analyzing: 1,
  intro: 1,
  pick: 1,
  people: 2,
  competitors: 3,
  strategy: 4,
  plan: 5,
  preview: 6
};

export const PUBLISH_STEPS = ['lockingIn', 'preparing', 'connecting', 'almostLive'];

export const backTargets = (isContinueMode: boolean): Partial<Record<Phase, Phase>> => ({
  ...(isContinueMode ? {} : { people: 'input' as Phase }),
  competitors: 'people',
  strategy: 'competitors',
  plan: 'strategy',
  preview: 'plan'
});
