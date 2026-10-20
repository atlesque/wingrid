// Stable engine IDs keep existing saves, payouts and probabilities intact.
// The last three plain gems are replaced by the approved text medallions.
export const GEM_ART = {
  crown: 'vlaanderen', chalice: 'burgerprofiel-ruby', hourglass: 'lbk',
  ring: 'burgerprofiel-blue', amethyst: 'vlaanderen-ruby', topaz: 'blue-gem',
  emerald: 'ajh', sapphire: 'dch', ruby: 'pini',
};
const ATLAS_GEMS = Object.values(GEM_ART);
export function gemAsset(atlas, sprite) {
  const match = /^(S0[3-9]|S10|S11)(?:M|Revised)?$/.exec(sprite);
  if (!match || (atlas !== 'thumbs' && atlas !== match[1])) return null;
  return `/symbols/vlaanderen/${ATLAS_GEMS[Number(match[1].slice(1)) - 3]}.png`;
}
