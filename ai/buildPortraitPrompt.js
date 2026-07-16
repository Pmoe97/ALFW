// ai/buildPortraitPrompt.js — pure, deterministic prompt assembly for the
// character-creation wizard's Portrait step. Turns the structured Appearance
// data (entities/entitySchema.js) — including the itemized intimate-details
// list — into a single comma-separated image-generation prompt, in the same
// concrete-visual-elements style ai/generateImagePrompt.js targets for the
// location pipeline. No network, no randomness: identical inputs always
// produce a byte-identical string.

const KNOWN_KEYS = new Set(['heightBuild', 'hair', 'eyes', 'face', 'skin', 'body', 'distinguishingFeatures', 'intimate']);

function joinTruthy(parts, sep = ' ') {
  return parts.filter(Boolean).join(sep);
}

/**
 * @param {{age: number, gender: string, race: string}} identitySummary
 * @param {import('../entities/entitySchema.js').Appearance} appearance
 * @returns {string}
 */
export function buildPortraitPrompt(identitySummary, appearance) {
  const fragments = ['Professional studio portrait photograph'];

  fragments.push(joinTruthy([String(identitySummary.age ?? ''), identitySummary.gender, identitySummary.race]));

  if (appearance.heightBuild) fragments.push(appearance.heightBuild);

  const hair = appearance.hair || {};
  const hairFragment = joinTruthy([hair.length, hair.texture, hair.color, 'hair'])
    + (hair.style ? `, worn ${hair.style}` : '');
  if (hair.length || hair.texture || hair.color) fragments.push(hairFragment);

  const eyes = appearance.eyes || {};
  if (eyes.shape || eyes.color) fragments.push(joinTruthy([eyes.shape, eyes.color, 'eyes']));

  const face = appearance.face || {};
  if (face.shape) fragments.push(`${face.shape} face`);
  if (face.nose) fragments.push(`${face.nose} nose`);
  if (face.jawline) fragments.push(`${face.jawline} jawline`);
  if (face.lips) fragments.push(`${face.lips} lips`);
  if (face.facialHair && face.facialHair !== 'none') fragments.push(face.facialHair);

  const skin = appearance.skin || {};
  if (skin.tone) fragments.push(`${skin.tone} skin`);
  if (skin.texture) fragments.push(skin.texture);

  const body = appearance.body || {};
  if (body.shape) fragments.push(`${body.shape} build`);
  if (body.chest) fragments.push(`${body.chest} chest`);
  if (body.butt) fragments.push(`${body.butt} butt`);
  if (body.legs) fragments.push(`${body.legs} legs`);

  for (const key of Object.keys(appearance).filter((k) => !KNOWN_KEYS.has(k)).sort()) {
    const value = appearance[key];
    if (typeof value === 'string' && value) fragments.push(value);
  }

  if (appearance.distinguishingFeatures && appearance.distinguishingFeatures.length > 0) {
    fragments.push(`distinguishing features: ${appearance.distinguishingFeatures.join(', ')}`);
  }

  if (appearance.intimate && appearance.intimate.length > 0) {
    const intimateFragment = appearance.intimate
      .map((entry) => joinTruthy([entry.type, entry.size, entry.details], ', '))
      .join('; ');
    fragments.push(`intimate detail: ${intimateFragment}`);
  }

  fragments.push('photorealistic, neutral studio background, soft even lighting, head-and-shoulders framing, high detail');

  return fragments.filter(Boolean).join(', ');
}
