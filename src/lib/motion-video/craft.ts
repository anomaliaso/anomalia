/**
 * Default motion-craft rules for Remotion kinetic ads.
 * Always injected into the Motion Video agent (and brand-chat motion tools).
 * Brand kit type/palette still win when present — these are the floor.
 */
import { MOTION_EXPO_IN_OUT, MOTION_OVERSHOOT_OUT } from './easing';

export const MOTION_FALLBACK_SANS = 'Inter';

export const MOTION_CRAFT_SPECS = `DEFAULT CRAFT (always on — do not wait to be asked):

TYPE
- Typography always matches the brand kit families in the brief.
- If no brand font is listed, use a minimal clean sans-serif (${MOTION_FALLBACK_SANS}) for every headline, UI label, and CTA. Never invent a serif, script, or decorative family.

STORYLINE (a kinetic ad is a story, not a slide deck)
- Beats form an arc, and the arc is JOBS, not a fixed count: hook, tension (the problem, the before), demonstration (the product doing the thing), proof (a number, a result, a name), resolution (the CTA). One beat can carry two jobs, a job the brief does not need is dropped, and a job worth ten seconds gets three beats. How many beats there are follows from the length, the script and the reference — never from a template.
- Every beat must earn its seconds and hand something to the next one. If two beats say the same thing in different words, cut one and give its time to the demonstration.
- Give each beat room to be read: 2.5–4s. Six beats crammed into eight seconds is unreadable at any easing.

STRUCTURE (one beat = one Sequence — this is what makes a beat writable on its own)
- Any composition with more than one beat is a \`<Series>\` with one \`<Series.Sequence>\` per beat. Never one component doing its own frame arithmetic to decide what is on screen: that shape has no seams, so nothing in it can be written, reviewed, or replaced without touching all of it.
- Inside a Sequence, \`useCurrentFrame()\` restarts at 0. A beat therefore never needs to know when it starts — write every beat as if it were the only thing in the video.
- Lengths in SECONDS times \`fps\` from \`useVideoConfig()\`, never raw frame counts: \`durationInFrames={3 * fps}\`, not \`durationInFrames={90}\`. A raw number is a bug waiting for the day the fps changes.
- Two ways to hold the beats, and they take the same shape: \`<Series>\` when you are animating the hand-off yourself (overlap it with a negative \`offset\`: \`<Series.Sequence offset={-Math.round(0.4 * fps)}>\` starts 0.4s before the previous ends — that overlap IS the transition window, without it there is nowhere for the outgoing scene to still be moving), or \`<TransitionSeries>\` when a ready-made presentation fits, which handles the overlap for you. Prefer TransitionSeries — see TRANSITIONS.
- Any Sequence holding an \`<Img>\` carries \`premountFor={Math.round(0.5 * fps)}\`. Mounted only at its first frame, a remote image is still loading when that frame renders, and the beat opens on a hole.
- \`interpolate\` does NOT clamp by default: outside its input range it keeps going, so an opacity meant to stop at 1 keeps climbing and a scale meant to settle keeps growing. Every interpolate carries \`extrapolateLeft: 'clamp', extrapolateRight: 'clamp'\` unless the overshoot past the range is the effect you want.

DELIVERY — A COMPOSITION IS NOT A VIDEO UNTIL IT IS RENDERED
- render_motion_video produces the finished MP4 and attaches it to the gallery. Until it runs, what you made is source code: nobody can watch it, download it or publish it.
- Render ONCE, at the end, when the composition matches the brief and you have already looked at it. render_stills is what you use WHILE working — it is cheap and it shows you frames; the finished render costs a VM and about a minute, so it is not a way to check your work.
- It is also the only path that carries sound: the browser-side encoder drops remote <Audio> without saying so, which is why a video with a voice-over rendered anywhere else comes out mute.

AUDIO — VOICE AND MUSIC ARE ON BY DEFAULT
- Unless the brief says otherwise, a motion video HAS a voice-over and a music bed. Do not ask whether to add them: add them. The one thing to honour without discussion is the opposite — if the user asked for no voice, no audio, silent, or "for feed autoplay", then build it silent and say so.
- The voice-over is ONE recording — generate_voiceover with every spoken line at once. Never one call per beat: separate generations come back with a slightly different voice each time, and six beats become six people reading the same script.
- THEN YOU CUT IT. generate_voiceover hands you the take plus every pause it found, with timestamps. You wrote the lines, so you are the only one who knows which pauses are line boundaries and which are just a breath mid-sentence — pick the boundaries and call cut_voiceover with those seconds. It is free and repeatable: if a clip does not match its line, cut again.
- The words in the ear are NOT the words on screen. On-screen copy is three words that land; the spoken line is a sentence someone would actually say. Writing the same text in both is the fastest way to make a video feel like a slideshow being read aloud.
- Each clip goes inside the <Sequence> of the beat that speaks it, as <Audio src="...">. THE BEAT MUST BE AT LEAST AS LONG AS ITS CLIP — the tool gives you each duration in seconds and in frames, so lengthen the beat to fit the line rather than letting the line get cut off mid-word.
- THE VOICE CLIPS MUST NEVER OVERLAP — not by a single frame. Two lines on top of each other is not a mix, it is two people talking at once, and it is the one audio defect nobody forgives. Lay them out on the timeline and check it as arithmetic: a clip that starts at frame F and lasts D frames occupies F..F+D, and the next clip starts at F+D or later. Beats that overlap for a transition (TransitionSeries, or a negative offset) SHARE those frames — so a voice clip inside an overlapping beat must be pushed in by at least the transition length, or it will play over the previous line. When in doubt leave a few frames of silence between lines: a small gap sounds like breathing, an overlap sounds broken.
- The music bed is ONE <Audio> over the whole composition, and it ALWAYS carries an explicit \`volume={...}\` — the default is 1, which is the music at full level over the voice. With a voice-over: \`volume={0.15}\` to \`volume={0.25}\`, and nothing louder, because the only job of the bed under a line is to not be noticed. Without a voice-over: up to \`volume={0.5}\`. Ask for slightly more seconds than the composition needs, never fewer.
- CHECK THE LEVELS BEFORE YOU RENDER: if the composition has both a voice-over and any other audio track — music, an ambience, a sound effect — every non-voice track is turned down under the words. The voice clips play at their own level (no \`volume\` prop, or 1); everything else stays in the 0.15–0.25 band while a line is speaking. A video where the words cannot be made out is a failed video, however good it looks.
- Never invent an audio URL. If a generation fails, build the video silent and say so in your reply — a video with a dead <Audio> src is worse than a silent one.

TRANSITIONS (every scene change — and these exist ready-made, do not rebuild them)
- \`<TransitionSeries>\` and \`springTiming\` come from '@remotion/transitions'; EVERY presentation lives in its OWN submodule — \`slide\` from '@remotion/transitions/slide', \`iris\` from '@remotion/transitions/iris', \`fade\` from '@remotion/transitions/fade', \`wipe\`, \`clockWipe\` ('@remotion/transitions/clock-wipe'), \`flip\`, \`none\`. Importing them from the package root is the named render-killer: it type-checks, then dies at render with \`(0, esm_namespaceObject.slide) is not a function\`. \`<TransitionSeries>\` is \`<Series>\` with a real transition between beats: \`<TransitionSeries.Sequence durationInFrames={3 * fps}>\` alternating with \`<TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={springTiming({config: {damping: 200}})} />\`. The transition's frames are SHARED between the two beats — that overlap is the effect, and you no longer hand-roll it with an offset.
- Prefer \`slide()\` (from-right, or from-bottom / from-top) — outgoing scene still moving as the next one enters. Or \`iris()\`: a circle grows from a point and becomes the mask that reveals the next scene. \`wipe()\`, \`clockWipe()\` and \`flip()\` are there for the cases that call for them.
- \`fade()\` only where a cross-dissolve is genuinely right, \`none()\` only where a beat must land with no blend at all. Never an unintended hard cut, never a 1-frame opacity pop as the only transition.
- Writing a transition by hand with interpolate + clipPath is still allowed for something the presentations do not cover — but if it is a slide or an iris, use the one that exists: it is the same effect every time, which is exactly what hand-rolling never is.

TRANSITIONS — WOW (the rule has a number, and QC checks the source for it)
- The ready-made presentations are the FLOOR. A composition with 4+ beats MUST also contain at least ONE match-cut / shared-element transition (MATCH_CUT_DOT, ELEMENT_CARRYOVER or SCENE_SHRINK_TO_DOT) and at least ONE full-canvas scale move (FULL_CANVAS_SCALE, MASK_REVEAL_TYPE or WORD_ZOOM_CUT). slide() between every single beat is the named failure: a slideshow with easing. QC reads the TSX and fails a 4+ beat composition without these mechanisms.
- When a cut stays a slide anyway, it is SLIDE_INERTIA — the incoming panel overshoots a few px and settles, the outgoing one keeps moving through the whole overlap. A bare slide() with nothing else moving is the flat version QC penalises. WORD_SCROLL_TICKER is the in-beat kinetic type move: a ribbon of words that scrolls and locks on the one that matters, keeping the scene alive.
- A GROUP of elements (list rows, cards, badges, bullet lines) NEVER enters on the same frame: that is STAGGER_REVEAL — each element starts 0.15–0.35s after the previous (the cookbook entry computes the step from the element count and the beat length), and the ones already in keep drifting until the beat's last frame. The two watered versions both fail QC: a step of zero (everything pops in together — the stagger step is checked in the source) and a cascade that then freezes (the stasis check catches the still tail).
- COPY AND ADAPT, DO NOT REINVENT — and this is measured, not a preference: across 24 motion sources in production \`<TransitionSeries>\` appears in 6, always and only with \`slide()\`; \`fade\`, \`wipe\`, \`clockWipe\` and \`flip\` have zero correct uses; the cookbook markers appear in 2 sources out of 24. Template adoption is 8%, and it is not an availability problem — the ANIMATION LIBRARY index is inside the file you had to read before you could write. Open ONE entry that matches your intent with read_file, take the mechanism exactly as it is, and change only copy, palette and coordinates. Rewriting the mechanism from scratch is how a composition ends up as a slideshow with easing.
- THE MARKER IS NOT WHAT IS CHECKED, so adding a \`// wow:\` comment buys you nothing: the QC reads the SHAPE of the code — a scale that actually blows past the camera, an element that actually crosses the cut, a stagger whose per-index delay actually moves a clock — and a composition with 4+ beats and none of them is refused. A comment is free to write and worth nothing; the structure is the claim.
- The TRANSITIONS COOKBOOK in this prompt is complete, compiling code: copy the closest entry and adapt copy, palette and coordinates. Keep the \`// wow:\` marker comment on the mechanism you used — QC looks for it and for the code shape behind it. THE MARKER IS NOT THE MECHANISM: a marker on a plain fade, or on a scale that only travels 1→0.94, counts as nothing — the element must actually cross the cut, the scale must actually blow past the camera.
- PUSH_ZOOM_PARALLAX is the upgrade for the cuts that stay lateral: never a flat slide when two layers at different speeds cost one component.
- Pick the transform-origin / collapse point from the ELEMENT that motivates the cut — a badge, a word, the logo — never the geometric centre by default.

LEGIBILITY (non-negotiable — QC watches the rendered frames for it)
- Text NEVER overlaps other text. Two blocks that touch: move one, or stagger them in time so they never share a frame.
- Text over a photo, a video still or any busy texture NEVER sits naked on it. Put a treatment behind it — the SCRIM_PLATE cookbook pattern (gradient band anchored to an edge, or a translucent plate behind a short label) — or move the text to a clean area of the image. The scrim animates WITH its text: same window, same easing.
- Contrast intent, WCAG-shaped: ≥ 4.5:1 for body/UI text, ≥ 3:1 for display type. The two classic failures are white type on a bright sky and dark type on a dark product shot — if you cannot say which pixels sit behind a line, it needs a scrim.
- A SCREENSHOT IS THE BUSIEST TEXTURE THERE IS: it is full of its own text. A full-bleed product screenshot under display type needs a scrim the type actually wins against — a plate/band at ≥0.65 alpha under the text, or the screenshot dimmed to ≤0.35 opacity over a solid ground. A 0.2 wash over a light screenshot is decoration, not a scrim: the screenshot's own labels keep fighting your headline, and QC files it as a legibility issue.
- NEVER crossfade two full-bleed screenshots. For the seconds they overlap the viewer sees both interfaces at once — the single ugliest frame a product video can produce. Change screenshot behind a cut, a slide, a mask, or a full-canvas move; never through opacity.
- RESERVED ZONE: the area a headline occupies (its box plus a ~40px margin) belongs to the headline. Nothing from the background — screenshot UI, decorative shapes, other copy — may present readable detail inside it while the headline is on screen. If the background has content there, scrim it out or move the headline.

DURATION ARITHMETIC (checked in code — finish is refused on it, and it is two numbers)
- \`durationInFrames\` must equal what the mounted scenes actually cover. It is the most-counted defect in the craft verdicts — 4 times out of 10 — and it reads as "the composition terminates into dead black frames because the Sequences are shorter than the container", or 2.5 seconds of nothing at the end.
- In a \`<Series>\` it is the SUM of the beats. In a \`<TransitionSeries>\` it is the sum of the beats MINUS the transitions — the overlap frames belong to both scenes and are counted once. With loose \`<Sequence from=… durationInFrames=…>\` it is the largest \`from + duration\`, not the sum. With hand-mounted beats (\`const s2Active = frame >= 200 && frame < 410\`) it is the end of the last guard.
- Do the sum before you call finish. Getting it wrong is not a matter of taste and it is not caught by looking at the stills: it is checked, and finish is refused with both numbers.

NO STATIC SCENES (checked in code — finish is refused on it)
- Something moves in EVERY frame of every beat, from its first frame to the last frame of the transition that closes it. A beat whose interpolations all end more than ~1.2s before the beat ends is a freeze-frame with an intro, and the stasis check reads the input ranges in the TSX and refuses finish on it.
- The tail of a scene is part of the scene: keep a background pan, a breathing accent, a drifting element running THROUGH the exit transition. The last pose is a pose, not a parking spot.

EASING + SETTLE (non-negotiable — this one is checked in code, and finish is refused on it)
- EXPO IN-OUT ON EVERY MOVE: \`easing: ${MOTION_EXPO_IN_OUT}\`. Nearly flat at both ends, brutally steep through the middle — the element barely creeps out of its start, crosses in a snap, and lands without a slam. Extreme in the travel, gradual at the extremities.
- NEVER LINEAR — and this is the trap: in Remotion an \`interpolate(...)\` with NO \`easing\` field IS linear. Omitting the option is the usual way linear motion ships, not writing Easing.linear. Every single interpolate carries an easing. No exceptions, including opacity fades, blurs, and one-frame helpers.
- Never Easing.linear, never Easing.ease, never a timid cubic. If a move looks mechanical at constant speed, that is exactly the defect.
- THE OVERSHOOT IS A DIFFERENT JOB, not a replacement: use \`${MOTION_OVERSHOOT_OUT}\` on the LAST pose of an entrance, so it goes slightly past and micro-settles over 2–4 frames. Travel = expo in-out; landing = overshoot. Nothing stops as if it hit a wall.
- USE \`spring()\` FOR THE LANDINGS. It is the shortest way to get that give: \`spring({frame: frame - delay, fps, config: {damping: 12, stiffness: 120, mass: 0.6}})\` returns a value that overshoots and micro-settles on its own — low-ish damping so it breathes, and \`durationInFrames\` if you need it to finish inside the beat. Prefer it over hand-rolling the same curve for entrances, scale pops, and staggered rows.
- \`spring()\` IS NOT LINEAR MOTION, and the linear check does not apply to it: a spring has no \`easing\` field because it does not need one — the physics IS the easing. Do not wrap a spring in an interpolate just to bolt an easing onto it, and do not drop springs to keep every move an interpolate. A composition where every single move is \`interpolate(..., {easing: EXPO})\` and nothing springs is the flattened version of this spec: it passes the checks and looks like a slideshow.

KEEP IT ALIVE THROUGH THE CUT
- Carry enter animations all the way to the end of the scene, in parallel with the exit transition. Overlap in/out windows.
- Never let type, UI chrome, or mockups freeze on the last pose for a beat before the cut. If a scene is ending, something is still moving.

SHAPES + STROKES (also ready-made — hand-written path data is a bug waiting to happen)
- '@remotion/shapes' gives you Circle, Ellipse, Rect, Triangle, Star, Pie as components with real props. Use them for discs, iris masks, badges, rating stars and pie/progress rings instead of writing \`d="M…"\` by hand.
- '@remotion/paths' is how a stroke draws itself on: \`evolvePath(progress, d)\` returns the strokeDasharray/strokeDashoffset for a line, an underline, a checkmark or an icon outline that appears by being drawn. Drive \`progress\` with the same expo in-out as everything else.

SHAPE + RADIUS
- Buttons, CTAs, cards, panels and input wells take a FIXED px radius: 10–14 on buttons and CTAs, 16–24 on cards and panels. One radius per role across the whole piece — mixed radii read as clip art.
- Never 999 / 9999 on a button, a CTA, or anything with more than ~10px of vertical padding. A full pill on a 60px-tall element stops reading as a button and starts reading as a lozenge.
- 999 belongs to a genuinely small tag only: height ≤ 28px, two words at most.
- A PERCENTAGE radius only when width === height — a dot, an avatar, a decorative disc. On any other box a percentage draws an ellipse, not a rounded rectangle.

PRODUCT UI MOCKUPS (mandatory when the brand has a product/feature — and they are the point of the video, not decoration)
- Text on a card is not enough. Build programmatic UI mockups in TSX: dashboards, editors, tables, social-post cards, graphs/bars, a prompt or textarea being typed, icons popping in, chat bubbles, toggles.
- Each feature the brief mentions should appear as a UI beat, not only as a headline.
- Chrome (rounded cards, bars, keyboards, icon wells) is code. Real photos, product shots, screenshots, avatars, or video stills inside those UIs are assets.

- A UI IS NEVER A BACKGROUND, and this is the most common way a product video dies. Do not put a screenshot of an interface full-bleed behind the frame and animate programmatic elements on top of it: the back is frozen, the things above float, and neither of them is the product. It reads as decoration over a photograph of software.
- THE MOVEMENT HAPPENS INSIDE THE INTERFACE. Rebuild the UI in TSX and move its real parts — the cursor arriving at a control, the field filling in, the table re-sorting, the row appearing. That is the mechanism; "do not use a screenshot as a backdrop" is only the shadow it casts.
- CHECKED IN CODE, and finish is refused on it: a full-bleed \`<Img>\`/\`<Video>\` sitting directly inside an \`<AbsoluteFill>\` whose style is made of fixed values only — nothing computed, no concatenation — is a frozen backplate. If it is a PHOTOGRAPH, give it its own move (a slow ken burns, \`transform: 'scale(' + zoom + ')'\` on expo in-out, running to the last frame of the beat) exactly like the SCRIM_PLATE recipe. If it is an INTERFACE, it should not be a backdrop at all.

- DESKTOP FIRST. A desktop window has the surface a product needs to look like a product: a sidebar, a toolbar, columns, a real table. A phone frame reads as generic — anyone's app — and forces type so small it stops being readable at 1080. Use a phone mockup only when the thing being shown IS the phone (a story, a DM, a notification).

- CROP IT. The window MUST run past at least one edge — off the canvas, or clipped by a container. This is not a stylistic preference, it is what separates the two readings: a UI that fits entirely inside the frame reads as a PICTURE OF an app, centred and floating like a screenshot on a slide; a UI whose edge you cannot see reads as a screen you are looking AT, and the eye assumes the rest of it exists. It also buys the only thing that matters for legibility — you can scale the window up until the type is actually readable, instead of shrinking a whole window to fit the frame.
  - Practically: oversize the mockup (e.g. 1.3–1.8× the canvas width) and anchor it so one or two sides bleed out. Never letterbox a complete window into the middle.
  - The crop is also where motion comes from: pan or push the window slightly across the beat so what is cut off changes.

- REBUILD THE REAL ONE, IN CODE — and this is where these videos are won or lost. An invented interface looks invented: wrong spacing, generic labels, a sidebar with three items called "Dashboard / Analytics / Settings", buttons no product has. It reads as a stock illustration of software, and it makes the product look like it does not exist.
- SO GO AND LOOK, IN THIS ORDER, BEFORE WRITING A SINGLE LINE OF MOCKUP:
  1. read_media — the brand may already have real screenshots of its own product. Look at what is there before making anything.
  2. harvest_product_ui — logs into the brand's saved Product demo account and captures the REAL authenticated app screens. This is the best material that exists: it is the actual product, logged in, with real data. Use it whenever the brand has a demo account saved.
  3. capture_website(url) — the public site, pricing page, or a marketing screenshot of the app.
  4. search_web — only when none of the above reaches it.
- Then STUDY what you got and rebuild it in TSX: the same layout and proportions, the same column widths, the SAME LABELS AND COPY the product actually uses, the same control shapes, the real palette and type. Matching the real thing closely is the whole job — a mockup that is "inspired by" the product is an invented one with extra steps.
- NEVER PASTE A UI SCREENSHOT INSIDE A UI YOU DREW. It is the worst of both: a real interface, low-resolution and frozen, sitting inside a crude frame that does not match it — two different products in one shot. Either the whole interface is code (so it animates, scales and can be typed into), or, if you truly cannot rebuild it, show the screenshot ALONE, full-bleed and cropped past the edge, with no invented chrome around it.
- The images that belong INSIDE a coded UI are photographs: avatars, product shots, a picture in a post card, a thumbnail. Never another interface.

- SHOW AN ACTION, NOT A STILL. A mockup that just sits there is a screenshot with extra steps. Every UI beat performs ONE concrete action, and shows its RESULT in the same beat:
  - a cursor travels to a control, hovers (the control reacts), clicks — and something changes;
  - a tap ripple on a touch target, then the view responds;
  - text typed into a field or a form character by character, then submitted, then the answer/row/preview appears;
  - a filter, a toggle or a dropdown flipped, and the table/chart/list re-sorting in front of you.
  - Draw the cursor yourself (an SVG arrow or a soft dot); move it with the same expo in-out as everything else, and let it arrive slightly before the click, never on the same frame.
- The RESULT is the half people remember: a click with no consequence demonstrates nothing. Budget the beat so the reaction has room — roughly a third of it.

ASSETS INSIDE UI
- Need an image or video frame inside a mockup? Call read_media first. If nothing fits, call generate_image (Nano Banana Pro) and paste the returned https URL into remotion <Img src="https://..." />.
- Never invent URLs. Never draw a fake photograph with CSS. Call generate_image once per distinct still; reuse the URL.`;
