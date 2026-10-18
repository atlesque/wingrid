import { createArt } from './art.js';
import { motion } from './motion.js';
import { winStages } from './events.js';
import * as sound from './sound.js';

const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createPresentation({ react }) {
  const dialog = document.querySelector('#celebration');
  const panel = dialog.querySelector('.celebration-panel');
  const title = dialog.querySelector('h2'), detail = dialog.querySelector('p');
  const value = dialog.querySelector('output'), ok = dialog.querySelector('.event-continue'), cancel = dialog.querySelector('.event-cancel');
  let art;
  const surface = () => art ||= createArt(dialog.querySelector('.event-art'));
  const rect = () => surface().rect(panel, 1.4);
  function open(kind, heading, description) {
    delete dialog.dataset.choice;
    dialog.dataset.event = kind; title.textContent = heading; detail.textContent = description;
    value.textContent = ''; value.hidden = true; cancel.hidden = true; ok.disabled = true; ok.textContent = 'Continue';
    dialog.oncancel = event => event.preventDefault();
    dialog.showModal();
    surface().clear();
  }
  function choice(auto = 0) {
    return new Promise(resolve => {
      const timer = auto ? setTimeout(() => done(true), auto) : null;
      function done(accepted) { clearTimeout(timer); ok.onclick = cancel.onclick = dialog.oncancel = null; resolve(accepted); }
      ok.onclick = () => done(true); cancel.onclick = () => done(false);
      dialog.oncancel = event => { event.preventDefault(); done(false); };
    });
  }
  async function frame(heading, description, { kind, amount, auto = 3500 } = {}) {
    open(kind, heading, description);
    react('bonus');
    const banner = await surface().add('stpr_banner', 'stpr_banner_in', rect());
    if (amount == null) banner.hideSlots(/^meter_/);
    ok.disabled = true;
    await banner.play('stpr_banner_in');
    banner.play('stpr_banner_loop', true);
    if (amount != null) {
      value.hidden = false;
      sound.counting(true);
      await motion.animate(1100, p => { value.textContent = money(amount * p); });
      sound.counting(false, { free: true });
    }
    ok.disabled = false; ok.focus(); await choice(auto);
    ok.disabled = true;
    await banner.play('stpr_banner_out');
    surface().clear(); dialog.close();
  }
  return {
    feature: frame,
    async buy(cost) {
      open('buy', 'BUY FREE SPINS', `15 free spins · ${money(cost)} play credits`);
      const banner = await surface().add('stpr_buy_feature', 'stpr_buy_feature_center_in', rect());
      banner.hideSlots(/green_button|red_button|^right$|^x$|^buy|^free_spins/);
      ok.disabled = true;
      await banner.play('stpr_buy_feature_center_in'); banner.play('stpr_buy_feature_center_loop', true);
      ok.disabled = false; ok.textContent = 'Buy'; cancel.hidden = false; ok.focus();
      const accepted = await choice();
      ok.disabled = true; cancel.disabled = true; dialog.dataset.choice = accepted ? 'yes' : 'no';
      sound.play(sound.CLIPS.click);
      await banner.play(`stpr_buy_feature_center_${accepted ? 'yes' : 'no'}`);
      cancel.hidden = true; cancel.disabled = false;
      await banner.play('stpr_buy_feature_center_out');
      surface().clear(); dialog.close();
      return accepted;
    },
    async win(amount, bet, { capped = false, skip = false } = {}) {
      const stages = winStages(amount, bet, capped);
      if (!stages.length) return;
      open(capped ? 'max-win' : 'big-win', stages[0].title, capped ? '5,000× THE BASE BET · LIMIT REACHED' : 'PLAY CREDITS WON');
      value.hidden = false; value.textContent = money(0); ok.textContent = 'Skip count-up';
      react('bonus'); sound.play(sound.CLIPS.bigWin);
      let from = 0, fastForward = false;
      const counter = new AbortController();
      const jump = event => { event?.preventDefault(); fastForward = true; counter.abort(); };
      ok.disabled = false; ok.onclick = jump; dialog.oncancel = jump; ok.focus();
      sound.counting(true);
      let banner;
      for (let i = 0; i < stages.length; i++) {
        const stage = fastForward ? stages.at(-1) : stages[i];
        title.textContent = stage.title; dialog.dataset.tier = stage.art;
        if (banner) { await banner.play(`stpr_bigwin_${banner.tier}_out`); banner.remove(); }
        banner = await surface().add('stpr_bigwin_banner', `stpr_bigwin_${stage.art}_in`, rect());
        // Keep one accessible heading; the same art slot contains every archived tier label.
        banner.hideSlots(/^sensational|^glow\d*$/);
        banner.tier = stage.art;
        sound.play(sound.CLIPS.winVoices[stage.art]);
        await banner.play(`stpr_bigwin_${stage.art}_in`);
        banner.play(`stpr_bigwin_${stage.art}_loop`, true);
        const end = fastForward || i === stages.length - 1 ? amount : Math.min(amount, stages[i + 1].at * bet);
        await motion.animate(skip ? 420 : 1200, p => { value.textContent = money(from + (end - from) * p); }, { signal: counter.signal });
        from = end;
        if (fastForward) {
          // If the click came during this stage, still show the final tier before leaving.
          if (stage !== stages.at(-1)) { i = stages.length - 2; continue; }
          break;
        }
      }
      value.textContent = money(amount); sound.counting(false);
      ok.textContent = 'Continue'; await choice(skip ? 700 : 3000);
      ok.disabled = true;
      await banner.play(`stpr_bigwin_${banner.tier}_out`);
      surface().clear(); dialog.close();
    },
  };
}
