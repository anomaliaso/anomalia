/**
 * THE FIDELITY LADDER — match production cost to the evidence behind the angle.
 *
 * WHY THIS IS A COST LEVER AND NOT A DOCTRINE. Ideas are cheap to have and expensive to produce.
 * A Seedance clip costs roughly 25x an image (the number `content-preview.ts` already caps videos
 * on), plus the review credits, plus the render queue. Every one of those spent on an argument
 * nobody has validated is a bet placed at the worst possible odds — and the way accounts end up
 * with one beautiful video of an unproven claim.
 *
 *   Rung 1 — statics and uglies. A brand-new angle ships as a still or text-on-image. Spend nothing
 *            on polish; we are buying a READING, not an asset.
 *   Rung 2 — cheap motion. Angles that survived rung 1 get a UGC read or a rough cut.
 *   Rung 3 — production. Only a validated angle earns a real render.
 *
 * Skipping rungs is the expensive mistake. What this module changes concretely: when a batch is
 * over its video cap, `clampVideos` used to keep whichever videos came FIRST. Now it keeps the ones
 * whose angle has actually earned the spend, and downgrades the unproven ones to statics — same
 * cap, same cost, better allocation.
 *
 * COLD START IS NOT RUNG 1. A brand with no history has no proven angles and no unproven ones
 * either: forcing it to statics would starve exactly the feed that most needs motion to find an
 * audience. With no evidence at all every angle sits at rung 2 — we are not ranking, so we do not
 * pretend to.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`hooks.md` fidelity
 * ladder, MIT) — see `docs/35-marketing-doctrine.md`.
 */
import type { HookTacticId } from '$lib/server/hook-tactics';

export type LadderRung = 1 | 2 | 3;

export type LadderVerdict = {
  rung: LadderRung;
  /** Why this rung — printed into logs and briefs so an allocation decision is never silent. */
  reason: string;
  /** Whether the angle has earned a real video render. */
  earnsVideo: boolean;
};

export type LadderContext = {
  /** Tactics that have beaten this brand's own average. Empty when the sample cannot support it. */
  proven: HookTacticId[];
  /** Tactics with any history at all, proven or not. */
  tried: HookTacticId[];
  /** True when the brand has no usable history yet — see COLD START above. */
  coldStart: boolean;
};

export function ladderFor(tactic: HookTacticId | null, ctx: LadderContext): LadderVerdict {
  if (ctx.coldStart) {
    return {
      rung: 2,
      earnsVideo: true,
      reason:
        'Nessuno storico utilizzabile: non stiamo classificando gli angoli, quindi non fingiamo di farlo. Tutto a costo medio finché non c’è qualcosa da leggere.'
    };
  }

  if (tactic && ctx.proven.includes(tactic)) {
    return {
      rung: 3,
      earnsVideo: true,
      reason: `L’angolo "${tactic}" ha già battuto la media di questo brand: la produzione vera è una scommessa su un argomento validato.`
    };
  }

  if (tactic && ctx.tried.includes(tactic)) {
    return {
      rung: 2,
      earnsVideo: true,
      reason: `L’angolo "${tactic}" è stato usato ma non ha ancora vinto: merita un girato leggero, non una produzione.`
    };
  }

  return {
    rung: 1,
    earnsVideo: false,
    reason: tactic
      ? `L’angolo "${tactic}" non è mai stato provato qui: prima si compra una lettura con una statica, poi si spende sul movimento.`
      : 'Apertura non classificabile: senza sapere che argomento è, la produzione vera è una scommessa al buio. Statica.'
  };
}

/**
 * Rank items so the ones that earned the spend survive a cap first.
 *
 * Stable within a rung: the planner's own ordering carries editorial intent (day, sequence), and
 * reshuffling it to break ties would trade one arbitrary order for another.
 */
export function byLadderPriority<T>(items: T[], rungOf: (item: T) => LadderRung): T[] {
  return items
    .map((item, index) => ({ item, index, rung: rungOf(item) }))
    .sort((a, b) => b.rung - a.rung || a.index - b.index)
    .map((x) => x.item);
}

/** One line for the planner brief, so the ladder is a visible constraint rather than a silent clamp. */
export function ladderBrief(ctx: LadderContext): string {
  if (ctx.coldStart) {
    return 'SCALA DI FEDELTÀ: nessuno storico ancora, quindi nessun angolo è "validato" — produci normalmente e usa questo batch per comprare le prime letture.';
  }
  const proven = ctx.proven.length ? ctx.proven.join(', ') : 'nessuno ancora';
  return [
    'SCALA DI FEDELTÀ — il costo di produzione segue l’evidenza dell’angolo, non l’entusiasmo:',
    `- Angoli già validati su questo brand (${proven}): meritano il video vero.`,
    '- Angoli usati ma non ancora vincenti: girato leggero.',
    '- Angoli mai provati: prima una statica che compra la lettura. Un angolo nuovo in un video costoso è una scommessa alle peggiori quote possibili.',
    'Saltare i pioli è il modo in cui un account finisce con un solo video bellissimo di un argomento che nessuno ha mai verificato.'
  ].join('\n');
}
