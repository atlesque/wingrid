# Wingrid

A free-to-play tumbling slot at **https://wingrid.atlesque.dev**. Credits are play money only: players start with 1,000, they can't be bought or cashed out, and a player who runs out can claim 1,000 more once an hour. Signed in with an [Atlesque Play](https://github.com/atlesque/mbp-games) account, credits and stats follow the player to every device.

## How it plays

- A 6×5 grid. **8 or more** of a symbol **anywhere** pays (8-9, 10-11 and 12+ tiers).
- Winning symbols vanish and the rest **tumble** down; new ones fill in from the top, until nothing more wins.
- **Multiplier orbs** (2x to 500x) can land on any tumble. When a spin wins, the orbs on the grid add up and multiply the win.
- **Wish stars** (scatters) pay anywhere. 4 or more start **15 free spins**, where orbs on winning spins add to one total multiplier for the whole feature; 3 or more add 5 spins.
- **Ante bet** (1.25x the bet) doubles the chance of wish stars. **Buy free spins** for 100x the bet.
- One spin or one feature never pays more than 5,000x the bet.

Simulated return to player is about 96-98% (`npm run rtp -- 1000000 base|ante|buy`); free spins come about 1 in 390 spins, or 1 in 190 with the ante bet.

## Code

Plain HTML, CSS and JavaScript modules in `public/`, served as static assets by a Cloudflare Worker. No build step.

- `public/js/engine.js`: the rules, paytable and odds, with no DOM. Change the numbers here and rerun `npm run rtp`.
- `public/js/feature.js`: a whole round including free spins, for the RTP script and tests.
- `public/js/game.js`: the page: drawing the grid, the tumble animations, controls and dialogs.
- `public/js/save.js`: credits, bet settings, stats and unfinished free spins, kept in `localStorage`.
- `public/js/account.js`: the Atlesque Play client (PKCE sign-in, progress sync with revisions).

## Replacing the art

Every symbol is one SVG in `public/assets/symbols/` (`crown`, `chalice`, `hourglass`, `ring`, `amethyst`, `topaz`, `emerald`, `sapphire`, `ruby`, `scatter`, `mult`). Drop in new files with the same names, square, and they show up everywhere, paytable included. To use PNG or WebP instead, change the extension in `cellEl()` and `paytable()` in `game.js`. Colours and the background live at the top of `public/style.css`.

## Atlesque Play

The game id is `wingrid`, registered in `src/clients.js` of [mbp-games](https://github.com/atlesque/mbp-games). The save is `{ credits, bet, ante, stats, feature, lastTopUp }`; the admin page shows credits, spins and the biggest win from it. Point a local copy at a local accounts service with `?debug&accounts=http://localhost:8787`.

## Running it

```sh
npm install
npm run dev      # http://localhost:8790
npm test         # rules, tumbles, free spins and RTP bounds
npm run deploy   # to wingrid.atlesque.dev
```
