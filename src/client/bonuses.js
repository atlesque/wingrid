import { createArt } from './art.js';
import { motion } from './motion.js';
import * as sound from './sound.js';

const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GEM = 'allgamesJackpot_slick-colors_mic_gem_';
const FACES = { minor: 'j', major: 'q', mega: 'k', grand: 'a' };

export function createBonuses({ pick, onState, onError, react }) {
  const hud = document.querySelector('#bonus-hud');
  const meter = document.createElement('output'); meter.className = 'multiplier-meter'; meter.setAttribute('aria-label', 'Total multiplier');
  hud.querySelector('.feature-status').after(meter);
  const dialog = document.querySelector('#jackpot');
  const gems = dialog.querySelector('.jackpot-gems'), title = dialog.querySelector('h2');
  const detail = dialog.querySelector('.jackpot-detail'), close = dialog.querySelector('.jackpot-close'), rules = dialog.querySelector('.bonus-rules');
  let state, config, settling = false, finished, revealing, art, view, displayMult = 0;
  const cards = new Map();
  const surface = () => art ||= createArt(dialog.querySelector('.jackpot-art'));

  function setMultiplier(value) {
    displayMult = value;
    meter.textContent = `${value}×`;
    meter.classList.remove('is-collecting'); void meter.offsetWidth; meter.classList.add('is-collecting');
  }
  function render(next, cfg = config) {
    state = next; config = cfg;
    const f = state.feature;
    hud.classList.toggle('is-free', !!f);
    hud.querySelector('.feature-status').textContent = f
      ? `${f.left} FREE SPINS LEFT · TOTAL ${f.totalMult}x · WON ${money(f.won)}`
      : 'MULTIPLIERS 2x–500x · 4 MBP = 15 FREE SPINS';
    meter.textContent = `${f?.totalMult ?? displayMult}×`;
    hud.querySelector('.jackpot-pools').replaceChildren(...(state.jackpots || cfg.jackpots.tiers).map(tier => {
      const row = document.createElement('div'), name = document.createElement('span'), amount = document.createElement('strong');
      name.textContent = tier.name; amount.textContent = money(tier.amount); row.append(name, amount); return row;
    }));
    hud.querySelector('button').textContent = state.jackpot ? 'Reveal your jackpot' : 'Jackpots & bonus rules';
    if (dialog.open && state.jackpot && !settling) updateCards(state.jackpot.picks);
  }
  function updateCards(picks) {
    const counts = {};
    for (const p of picks) counts[p.tier] = (counts[p.tier] || 0) + 1;
    const suspense = Object.values(counts).includes(2);
    for (const [index, card] of cards) {
      const revealed = picks.find(p => p.index === index);
      card.button.disabled = !!revealed || settling;
      card.button.classList.toggle('is-unrevealed', !revealed);
      card.button.classList.toggle('is-anticipating', !revealed && suspense);
      card.button.querySelector('.gem-label').textContent = revealed ? revealed.tier.toUpperCase() : '✦';
      card.button.setAttribute('aria-label', revealed ? `Gem ${index + 1}: ${revealed.tier}` : `Open gem ${index + 1}`);
      if (revealed) card.button.dataset.tier = revealed.tier;
      else if (suspense && !card.anticipating) { card.art?.play(`${GEM}anticipation`, true); card.anticipating = true; }
    }
  }
  async function choose(index) {
    if (settling || !state.jackpot) return;
    const pending = state.jackpot, card = cards.get(index);
    settling = true; updateCards(pending.picks);
    sound.play(sound.CLIPS.jackpotPick);
    const clicked = card.art?.play(`${GEM}click`);
    let settled;
    try {
      const response = await pick(pending.id, index);
      settled = response.result;
      onState(response.state); render(response.state);
      view.picks = [...pending.picks, response.result.pick];
      await clicked;
      card.button.classList.add('is-flipping');
      await card.art?.play(`${GEM}flip_${FACES[response.result.pick.tier]}`);
      card.button.classList.remove('is-flipping');
      sound.play(sound.CLIPS.jackpotReveal);
      updateCards(view.picks);
      if (response.result.complete) {
        for (const { button } of cards.values()) button.disabled = true;
        title.textContent = `${response.result.tier.toUpperCase()} JACKPOT!`;
        detail.textContent = 'THREE MATCHES · PLAY CREDITS WON';
        react?.('bonus'); sound.play(sound.CLIPS.jackpotWin);
        if (view.logo) { await view.logo.play('allgamesJackpot_slick-colors_mic_logo_out'); view.logo.remove(); view.logo = null; }
        const winner = await surface().add('jackpots_all', `${response.result.tier}_in`, surface().rect(dialog.querySelector('.jackpot-logo'), 1.2));
        winner.hideSlots(/^value_container$/);
        await winner.play(`${response.result.tier}_in`); winner.play(`${response.result.tier}_loop`, true);
        for (const p of view.picks.filter(p => p.tier === response.result.tier)) {
          const matched = cards.get(p.index); matched.button.classList.add('is-matched');
          surface().add('allgamesJackpot_slick-colors_mic_winframe', 'allgamesJackpot_slick-colors_mic_winframe', surface().rect(matched.button, 1.05), true);
        }
        sound.counting(true);
        await motion.animate(1800, p => { detail.textContent = `${money(response.result.won * p)} play credits`; });
        sound.counting(false);
        detail.textContent = `${money(response.result.won)} play credits added to your balance.`;
        close.hidden = false; close.focus();
        view.winner = winner; view.tier = response.result.tier;
      }
    } catch (error) {
      onError(error); card.button.classList.remove('is-flipping');
      if (settled?.complete) {
        updateCards(view.picks);
        for (const { button } of cards.values()) button.disabled = true;
        title.textContent = `${settled.tier.toUpperCase()} JACKPOT!`;
        detail.textContent = `${money(settled.won)} play credits added to your balance.`;
        close.hidden = false; close.focus();
      }
    }
    finally { settling = false; if (state.jackpot) updateCards(state.jackpot.picks); }
  }
  async function enter() {
    view = { ...state.jackpot, picks: [...state.jackpot.picks] };
    title.textContent = 'JACKPOT BONUS'; detail.textContent = 'Choose gems. Match three names to reveal your credit prize.';
    rules.hidden = true; gems.hidden = false; close.hidden = true;
    cards.clear(); gems.replaceChildren();
    for (let index = 0; index < view.size; index++) {
      const button = document.createElement('button'), label = document.createElement('span');
      button.type = 'button'; label.className = 'gem-label'; label.textContent = '✦'; button.append(label);
      button.onclick = () => choose(index); gems.append(button); cards.set(index, { button });
    }
    dialog.showModal(); surface().clear();
    settling = true; updateCards(view.picks);
    try {
      const logo = await surface().add('allgamesJackpot_slick-colors_mic_logo', 'allgamesJackpot_slick-colors_mic_logo_ in', surface().rect(dialog.querySelector('.jackpot-logo')));
      const reel = await surface().add('allgamesJackpot_slick-colors_mic', 'allgamesJackpot_slick-colors_mic_reel_in', surface().rect(gems, 1.12));
      view.logo = logo; view.reel = reel;
      await Promise.all([logo.play('allgamesJackpot_slick-colors_mic_logo_ in'), reel.play('allgamesJackpot_slick-colors_mic_reel_in'),
        ...[...cards].map(async ([index, card]) => {
          const revealed = view.picks.find(p => p.index === index);
          card.art = await surface().add('allgamesJackpot_slick-colors_mic_symbol', revealed ? `${GEM}flip_${FACES[revealed.tier]}` : `${GEM}click`, surface().rect(card.button, .9));
          card.button.classList.add('has-art');
          await card.art.play(revealed ? `${GEM}flip_${FACES[revealed.tier]}` : `${GEM}click`);
        })]);
      logo.play('allgamesJackpot_slick-colors_mic_logo_ loop', true); reel.play('allgamesJackpot_slick-colors_mic_reel_loop', true);
    } catch (error) { onError(error); }
    finally { settling = false; updateCards(view.picks); }
  }
  function reveal() {
    if (!state.jackpot) return Promise.resolve();
    if (revealing) return revealing;
    revealing = new Promise(resolve => { finished = () => { revealing = null; resolve(); }; });
    enter().catch(onError);
    return revealing;
  }
  close.onclick = async () => {
    close.disabled = true;
    if (view?.tier) await view.winner.play(`${view.tier}_out`);
    if (view?.reel) await view.reel.play('allgamesJackpot_slick-colors_mic_reel_out');
    if (view?.logo) await view.logo.play('allgamesJackpot_slick-colors_mic_logo_out');
    art?.clear(); view = null; dialog.close(); close.disabled = false; finished?.(); finished = null;
  };
  dialog.oncancel = event => { if (state.jackpot || revealing) event.preventDefault(); };
  hud.querySelector('button').onclick = () => {
    if (state.jackpot) { reveal(); return; }
    title.textContent = 'WINGRID BONUSES'; detail.textContent = 'Play credits only. All prizes are settled by the game server.';
    gems.hidden = true; rules.hidden = false; close.hidden = false; art?.clear();
    if (!dialog.open) dialog.showModal();
    title.tabIndex = -1; title.focus(); dialog.scrollTop = 0;
  };
  return { render, reveal, setMultiplier };
}
