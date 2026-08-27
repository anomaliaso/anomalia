/** @typedef {import('./types.js').TalentCharacter} TalentCharacter */

/** @type {TalentCharacter} */
export default {
  slug: 'noah',
  name: 'Noah',
  gender: 'man',
  age: 27,
  body_type: 'athletic_slim',
  height_band: 'average',
  ethnicity: 'east-asian',
  summary:
    '27-year-old East Asian man with a calm athletic presence — lean toned frame, short textured black hair, warm light-olive skin, and an easy understated smile.',
  identity: `Noah, a 27-year-old East Asian man.
Lean athletic-slim build, light muscle definition, low body fat, long clean limbs.
Warm light-olive East Asian skin with natural undertone.
Dark brown iris with visible white sclera and distinct pupil.
Clean oval face, soft jawline, subtle cheekbones, straight nose.
Easy understated closed-mouth smile — relaxed, approachable, not posed.
One small faint mole (~1–2mm) on the left jawline near the cheek, barely noticeable.
Calm, modern, quietly confident presence. Photorealistic real human, not CGI, not illustration.`,
  hair: `HAIR LOCK — identical cut AND styling in EVERY photo:
• Color: deep black with natural sheen.
• Cut: short textured crop — faded/neat on the sides and nape, slightly longer on top (~4–6cm) with soft natural texture and a light forward fringe.
• Styling: ALWAYS the same — dry natural texture, never wet, never gelled shiny, never slicked back, never longer, never buzzed bald.
• FORBIDDEN: different length, undercut extreme fade change, pompadour, bun, wet look, dyed color, or any restyle between shots.`,
  hairMatch: `HAIR MATCH (critical): the attached face-reference photo defines the EXACT haircut and styling.
Keep the same short textured black crop, same fringe, same side length. Do NOT restyle or change length.`,
  wardrobe: `WARDROBE LOCK — identical garment in EVERY photo (same set, same color, same cut):
• Bottom only: soft heather medium-gray athletic trunks / sport briefs, mid-rise, clean sporty cut,
  same fabric texture throughout. Full coverage, NOT thong, NOT fashion posing briefs, NOT logos.
• Torso: bare chest (no shirt, no tank) on body shots. Face shots may show bare shoulders/collarbones only.
• Barefoot. No jewelry, shoes, socks, watches, or outerwear.
• Calm everyday athletic underwear look — never sexy fashion editorial.`,
  wardrobeMatch: `CLOTHING MATCH (critical): the attached body-reference photo defines the EXACT trunks.
Reproduce that same heather-gray athletic trunks — same shade, fabric, rise, and cut. Bare torso. Do not invent a different style.`,
  traits: {
    hair: {
      color: 'deep black with natural sheen',
      texture: 'soft natural texture',
      length: 'short textured crop, longer on top (~4–6cm), neat sides',
      style: 'always same dry natural crop with light forward fringe'
    },
    eyes: 'dark brown iris with visible white sclera and distinct pupil',
    face: 'clean oval face, soft jawline, subtle cheekbones, straight nose',
    skin: 'warm light-olive East Asian undertone',
    body: 'lean athletic-slim, light muscle definition, low body fat',
    marks: 'One small faint mole (~1–2mm) on the left jawline near the cheek',
    wardrobe: {
      bottom: 'heather medium-gray athletic trunks / sport briefs, mid-rise',
      top: 'bare torso on body shots',
      notes: 'calm sporty underwear only; barefoot; no jewelry'
    }
  }
};
