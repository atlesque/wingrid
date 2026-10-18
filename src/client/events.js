export const WIN_STAGES = [
  { at: 20, art: 'nice', title: 'BIG WIN' },
  { at: 35, art: 'superb', title: 'SUPERB WIN' },
  { at: 50, art: 'mega', title: 'MEGA WIN' },
  { at: 100, art: 'sensational', title: 'SENSATIONAL WIN' },
];
export const winStages = (win, bet, capped = false) => {
  const stages = WIN_STAGES.filter(stage => win >= stage.at * bet);
  return capped ? [...stages, { at: 5000, art: 'sensational', title: 'MAXIMUM WIN', max: true }] : stages;
};
