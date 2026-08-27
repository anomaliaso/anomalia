import { track } from '$lib/analytics';
import type { SubmitFunction } from '@sveltejs/kit';

const STEP_INTERVAL_MS = 850;
const EARLY_STEP_INTERVAL_MS = 700;

export function createPublishFlow(opts: {
  getPostCount: () => number;
  getPlatformCount: () => number;
  isContinueMode: () => boolean;
}) {
  let publishing = $state(false);
  let earlyCreating = $state(false);
  let step = $state(0);
  const STEPS = ['lockingIn', 'preparing', 'connecting', 'almostLive'];
  let timer: ReturnType<typeof setInterval> | undefined;

  function start(early: boolean) {
    earlyCreating = early;
    publishing = true;
    step = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      step = Math.min(step + 1, STEPS.length - 1);
    }, early ? EARLY_STEP_INTERVAL_MS : STEP_INTERVAL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    earlyCreating = false;
    publishing = false;
  }

  const enhance: SubmitFunction = () => {
    track('onboarding_completed', {
      posts: opts.getPostCount(),
      platforms: opts.getPlatformCount(),
      continue: opts.isContinueMode()
    });
    publishing = true;
    step = 0;
    timer = setInterval(() => {
      step = Math.min(step + 1, STEPS.length - 1);
    }, STEP_INTERVAL_MS);
    return async ({ result, update }) => {
      await new Promise((r) => setTimeout(r, 2600));
      if (timer) clearInterval(timer);
      if (result.type !== 'redirect') publishing = false;
      await update();
    };
  };

  return {
    get publishing() {
      return publishing;
    },
    get earlyCreating() {
      return earlyCreating;
    },
    get index() {
      return step;
    },
    get total() {
      return STEPS.length;
    },
    get label() {
      return STEPS[step];
    },
    start,
    stop,
    enhance
  };
}
