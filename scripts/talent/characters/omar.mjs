export default {
  slug: 'omar',
  name: 'Omar',
  gender: 'man',
  age: 30,
  body_type: 'muscular',
  height_band: 'tall',
  ethnicity: 'middle-eastern',
  summary:
    '30-year-old Middle Eastern man with a strong athletic presence — tall muscular frame, short dark hair and beard, warm olive-brown skin, and a steady calm expression.',
  identity: `Omar, a 30-year-old Middle Eastern man.
Tall muscular athletic build — broad shoulders, defined chest and arms, narrow waist, strong legs, low body fat.
Warm olive-brown Middle Eastern skin with golden undertone.
Dark brown iris with visible white sclera and distinct pupil.
Strong rectangular face, defined jaw, straight nose, full dark brows.
Neat short full beard and mustache (trimmed, consistent length every shot — ~5–8mm).
Steady calm closed-mouth expression with a slight warm hint of a smile.
One small faint mole on the left cheek, barely noticeable.
Photorealistic real human, not CGI, not illustration.`,
  hair: `HAIR LOCK — identical cut AND styling in EVERY photo:
• Color: deep black.
• Cut: short neat crop, faded/clean on the sides, slightly longer on top (~3–5cm), natural texture.
• Beard: neat short full beard + mustache, always the same trimmed length.
• FORBIDDEN: clean-shaven, longer beard, different haircut, slicked wet look, or any restyle.`,
  hairMatch: `HAIR MATCH: same short black crop and same neat short full beard length as the face reference. Do NOT restyle.`,
  wardrobe: `WARDROBE LOCK — identical garment in EVERY photo:
• Bottom only: soft heather medium-gray athletic trunks / sport briefs, mid-rise, clean sporty cut. NOT logos, NOT fashion posing briefs.
• Torso: bare chest on body shots. Face shots may show bare shoulders/collarbones.
• Barefoot. No jewelry or watches. Calm athletic underwear only.`,
  wardrobeMatch: `CLOTHING MATCH: same heather-gray athletic trunks as the body reference. Bare torso.`,
  traits: {
    hair: {
      color: 'deep black',
      length: 'short neat crop, slightly longer on top',
      style: 'neat short full beard + mustache, consistent trim'
    },
    eyes: 'dark brown iris with visible white sclera',
    face: 'strong rectangular face, defined jaw, straight nose',
    skin: 'warm olive-brown Middle Eastern with golden undertone',
    body: 'tall muscular athletic, broad shoulders, defined chest, narrow waist',
    marks: 'One small faint mole on the left cheek',
    wardrobe: {
      bottom: 'heather-gray athletic trunks, mid-rise',
      top: 'bare torso on body shots'
    }
  }
};
