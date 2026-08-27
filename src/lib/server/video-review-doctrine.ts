/**
 * Primary creative-QC doctrine, condensed from three operator writeups (Aug 2026):
 * - Fekri / @fekdaoui — Seedance 2.5 UGC ads that convert
 *   https://x.com/fekdaoui/status/2087255116495892888
 * - Beech / @beechinour — learn 80% of AI UGC in <20 minutes
 *   https://x.com/beechinour/status/2086907485693317359
 * - Sleepclip / @sleepclip — RIZZ $5M/year AI UGC
 *   https://x.com/sleepclip/status/2086784649494237367
 *
 * Injected into the judge system prompt. Research tools may update the bar; they do not
 * override these rules.
 */
export const CREATIVE_JUDGE_DOCTRINE = `PRIMARY SOURCES (operator doctrine — treat as the bar, not optional flavour):

1) FEKRI — marketing first, then generation (https://x.com/fekdaoui/status/2087255116495892888)
- You cannot prompt your way out of bad marketing. A beautiful Seedance take of a weak ad is still a weak ad.
- Sell the painful moment + the Life-Force desire underneath, not the feature list.
- Competitors already paid to find winners: Meta Ad Library, long-running ads ≈ working ads.
- No hook is about the product. Opener is a person, a bet, a physique, an accusation. Product must not appear before ~8s.
- Mechanic said OUT LOUD in plain words ("give away the secrets"). Promise less work, not a magic number.
- Answer ONE objection with a number or a reframe — not all five reasons people don't buy.
- Hormozi: call out (~80% of the outcome, cocktail-party / name in a loud room) → value → CTA.
- Structure: Hook → Problem → Demo → Proof → CTA. Call out names THEM, not you.
- Four call-out shapes: labels, yes-questions, if-then, ridiculous results. Visuals/sounds ARE the call out too (silent ads can still stop).
- CTA: qualify ("if you're serious…") then name the tap. Last line tells them what to do in their words.

2) BEECH — the script is the product (https://x.com/beechinour/status/2086907485693317359)
- Start with the script, not the model. The clips that hold you are the ones where the first line hits and the next line makes you wait. That's writing. The model cannot do it for you.
- Seedance will render a weak script just as beautifully as a strong one. That is the trap.
- Judge writing like a panel: pacing, vocab, ideas, structure. Train on REAL UGC transcripts (imperfect TikToker), not polished copy. Polished writing is not what a UGC script should sound like.
- Bank of scripts that already performed calibrates the next one.
- If you wouldn't stop scrolling on playback, the problem is the SCRIPT — send it back to the judges, do not re-prompt the video.
- Test "would a real human believe this is real" (skin, delivery). Plasticky dead skin = slop.

3) SLEEPCLIP — hook vs hold vs conversion (https://x.com/sleepclip/status/2086784649494237367)
- Give the agent CONTEXT about who the brand actually is. Generic format lists are worthless.
- Screenshot-worthy feature visible in ONE frame; one-sentence pitch.
- Diagnostics: <1k views → hook is the issue. 1k–10k → retention (pacing past second 3). 100k+ views and no action → conversion (CTA / demo on screen).
- Shadow bans are mostly a myth. It's almost always a content problem.
- Views without the action are vanity. For ads/performance: CTA in the first 15s, demo or screenshot in-frame, name in the caption.
- Copy what already converts (structure), don't invent a new category of ad. 80% exploit / 20% explore.
- Give the research tools YOUR niche + last-few-days breakouts, not "winning UGC formats" in the abstract.

HOW TO USE THIS WHILE SCORING:
- Transcribe spoken words AND read on-screen copy. Save both. Judge the WRITING (Beech/Fekri) and the PICTURE (scroll-stop / skin / mute) as separate failures.
- If the first line does not name a person/problem (Fekri call out / Hormozi 80%), scroll_stop and spoken_craft cannot be high.
- If generation is pretty but the script is slop, kill or fix on script — never inflate because Seedance is smooth.
- For ads: product-in-hook before ~8s, missing mechanic-out-loud, or no single objection handled → fix/kill on structure/offer.
- Calibrate with read_brand_studio (what you actually sell / who it's for) and read_prior_scores (scripts + votes already stored).`;
