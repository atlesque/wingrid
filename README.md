# Wingrid — Starlight rebuild with Princess v2

Our own JavaScript version of the archived Starlight Princess slot. It's a 6×5 tumbling grid that pays for 8 or more of a symbol anywhere, with multiplier orbs and free spins, and it runs on a Cloudflare stack:

- **Front end** (`index.html`, `src/client/`): PixiJS 7 with `pixi-spine`, drawing the archived Spine skeletons and backgrounds. The page never decides a spin. It sends the request and animates the tumbles it gets back.
- **Worker** (`src/worker/index.js`): owns credits, bets, free spins and stats in **D1**. Every spin runs here with `crypto.getRandomValues`, and a version check on the player row stops two requests from spending the same credits.
- **Rules** (`src/shared/engine.js`, `round.js`): Wingrid's engine plus the round logic, shared by the Worker and the tests. Credits are play money only.

None of Pragmatic's engine code is used. The archive is only a source of art.

## Bonus behavior

Wingrid runs its own rules in `src/shared/engine.js` and `round.js`; `/api/spin`
does not use the archive's emulator or its recorded response subset. Natural
4+ SCATTERs and the 100x buy start 15 free spins; 3+ SCATTERs within the feature
add five more. Base-game orbs add together at the end of a winning tumble sequence.
In free spins, winning orbs add to a persistent multiplier, used whenever new orbs
land with a symbol win. Scatter pays remain separate. The triggering spin and the
entire free-spin feature share a 5,000x base-bet cap. Buying is disabled during ante.

The client switches to the free-spin background, shows spins left, feature winnings
and the multiplier total, announces retriggers and celebrates 20x/35x/50x/100x wins.
`spin.win` is the actual credited amount; `tumbleWin` and `scatterWin` are in base bets.

The archived `MDL_Jackpot` is an optional operator service, with no jackpot outcome
in the captured mock API. Wingrid now has its own **play-credit** progressive system
in `src/shared/jackpot.js`, with explicit rates and seeds shown under **Jackpots &
bonus rules**. These rules and probabilities are Wingrid's, not Pragmatic's proprietary
jackpot mathematics or a claim of matching the original RTP.

Four shared D1 pools receive 1% of paid spin cost. Eligible base/ante spins can
reserve a pool; bought and free spins cannot trigger jackpots. The server stores
the hidden match-three reveal and reserves the prize atomically, resets the pool
to its seed, and credits the player exactly once on completion. Reloading resumes
unopened gems. Pending prizes are local to the Wingrid database and are never
accepted from an imported account save. Optimistic-write guards roll back a stale
spin, its log and pool changes together.

Apply `0002_jackpots.sql` before deploying this version (`npm run db:migrate:remote`).
Tests cover fixed-seed natural/bought/retrigger and multiplier results, cap accounting,
API credit units, hidden-deck reveals, replay rejection and competing transactions.

Presentation uses the archived symbol landing/win/exit poses, feature banners,
buy confirmation, screen wipe, multiplier-meter effects and all four big-win tiers.
The approved brown-haired character has mesh-based anticipation, win, spell and bonus
reactions. SCATTER uses its approved emblem with orbiting stars, shimmer and anticipation
effects; it never plays the old red-haired portrait rig. Winning orbs fly to the multiplier
meter. Jackpots have animated gems, two-match anticipation, matching frames and tier
celebrations. `spin.maxWin` explicitly signals the capped total, including a feature
whose last spin only pays the small remaining balance.

`src/client/motion.js` shares one speed clock between counters, tweens and Spine tracks.
Reduced-motion preferences shorten transitions and suppress repeating CSS effects.
Audio resumes in the correct mood after unlocking and discards stale asynchronous loads.

## Guests and accounts

A new browser gets a guest session (`POST /api/guest`) and plays straight away. **Sign in** sends the player to Atlesque Play ([mbp-games](https://github.com/atlesque/mbp-games)) and back with a one-time code. The Worker swaps that code for the account token, so the token never sits in the page. After that:

- an account the game already knows takes over the session, so the same credits show up on every device;
- a new account takes the guest's progress, unless Atlesque Play already holds a save for it (for example from Wingrid), in which case that save wins;
- every change goes up to Atlesque Play as the game's progress, with its revision. If the account's copy moved on without us (another device, an admin reset), the account's copy replaces ours.

The save uses Wingrid's format (`{ credits, bet, ante, stats, feature, lastTopUp }`), and `PLAY_GAME_ID` is `wingrid` for now. This Wingrid deployment intentionally uses its existing game id.

## Running it

```sh
npm install
npm run assets       # copies the art from ../starlight-princess-archive/extracted into public/starlight/
npm run db:migrate   # creates the local D1 tables
npm run dev          # http://127.0.0.1:8796 (Vite and the Worker on one origin)
npm test
```

Copy `.dev.vars.example` to `.dev.vars` so sign-in goes to a local Atlesque Play rather than the live one. To try sign-in, run mbp-games locally as well (`npm run dev` there, on :8787). Its emails are saved under `.wrangler/tmp/email` rather than sent, and the link inside points at `play.atlesque.dev`, so open it with `http://localhost:8787` in its place.

## Deploying Wingrid

This copy deploys the existing **https://wingrid.atlesque.dev** Worker (`wingrid`).
Its D1 database is `wingrid` (`744548f7-ea4e-4ad8-a97d-e7d261171e51`), separate
from Starlight's database. Atlesque Play keeps the existing `wingrid` game id,
so account saves and sign-in continue to use Wingrid's established identity.

Run `npm run assets` on a fresh checkout to import the archived game art, then
`npm run db:migrate:remote` before `npm run deploy`. All game art, fonts, and
sound are uploaded as Cloudflare static assets together with the build.
This copy does not read or upload to Starlight's R2 bucket.

### Automatic deployment

Cloudflare Workers Builds is connected to `atlesque/wingrid`, with `main` as
its production branch. Pushes and merges to `main` build and deploy the existing
`wingrid` Worker using its existing Cloudflare build token. GitHub Actions runs
checks for pull requests and `main`; it does not need Cloudflare credentials.

Cloudflare production build settings:

- Build command: `npm run build:ci`
- Deploy command: `npm run deploy:ci`
- Root directory: `/`

The build runs tests, restores artwork, builds the app, and validates the deployment
package. Deployment applies D1 migrations, deploys the Worker, and checks the live
home page and `/api/config`. To retry a deployment, use **Retry build** in the
Worker's Cloudflare deployment history. Production-only automatic deployments
are intended; preview deployments are disabled.

The imported artwork remains outside Git. `npm run assets:ci` downloads the
existing files served at `https://wingrid.atlesque.dev/starlight/` and verifies
each SHA-256 against `scripts/ci-assets.json`, then overlays the checkout's tracked
`layout/` files. This also works for a fresh local checkout without the sibling
archive. CI depends on those production asset URLs remaining available; a missing
or changed file stops the build before deployment. For intentional imported-art
updates, use the local archive and manual deployment path and update the manifest
checksums in the same source change. Princess v2 and Wingrid branding continue
to come from the tracked `public/` files.

The previous Wingrid checkout is saved in `.backups/before-starlight-rebuild-20261016.tar.gz`.
The previous production Worker version is recorded in `.backups/previous-deployment.txt`.
The `starlight-rebuild` source checkout was not modified.

## Princess v2

`src/client/character-v2.js` loads our exact-source 13-part, 21-bone mesh rig
using Pixi 7 and Spine 3.7. It includes the stronger independent motion and
original-pixel eyelid blinking from the character demo. Reduced-motion settings
show the undeformed reference pose. The character replaces the old princess
in both captured layouts. In landscape she floats over the board's right edge, as the original's
princess does: her wing crosses the reel frame (`CHARACTER_OVERLAP` in `scene.js`), her head tucks
under the logo and her feet stay clear of the bottom bar. In both layouts she drifts and sways with
stars twinkling round her. When a multiplier orb lands she flashes and raises her wand, and lightning
strikes the orb from above the board, as in the original.

In free spins the board turns purple and, in landscape, the buy and bet panels give way to a
total-multiplier panel and a free-spins-left panel with the winged cat perched on top, as in the
original. Collected orbs fly to that panel (`buildFreeHud` and `setFreeHud` in `scene.js`).

Its source image, rig, atlas metadata, and source checksum live in
`public/characters/princess-v2/` and are included in the deployment. To import
updated art/rig files from the archive demo, run `npm run character:import`.
The runtime adapter is maintained in `src/client/character-v2.js`.

Wingrid's SCATTER emblem uses the approved brown-haired mascot artwork in
`public/characters/princess-v2/scatter.png`. The scene adapter keeps the symbol's
original padding and proportions and pulses this artwork for landing and win
effects, rather than displaying the original portrait's animation. It also uses
the new emblem for SCATTER thumbnails. The asset lives outside `public/starlight/`
so archive imports and CI artwork restoration preserve the Wingrid customization.

## Looking exactly like the original

The screen is not laid out by hand. `layout/landscape.json` and `layout/portrait.json` are single frames captured from the archived original, listing every sprite, label and Spine skeleton it drew, in draw order, with where and how big each was on screen. `layout/symbols.json` holds each symbol's rig: its idle sprite and its land, win, win-frame and disappear animations, with their offsets. `src/client/scene.js` draws those lists with the original art, and puts our grid of symbols where the original's reels were.

To recapture (for another screen, or after re-mirroring the archive), run the original on 127.0.0.1:8788, start `node scripts/capture-server.mjs`, and in the original's page run the code in `scripts/capture-layout.js`, then `await captureLayout('landscape')` (a 16:9 window) or `'portrait'` (a phone, which loads the original's mobile build). After that, run `npm run assets`.

`npm run assets` rebuilds everything from the archive:

- **Spine**: each skeleton comes from the desktop build. (The decoded archive sometimes kept the mobile or mini copy, which has other animations.) Each skeleton's `.atlas` is rebuilt from the desktop scene data. In the original's sprite lists, a rotated sprite's width and height are its rect on the page, so upright it is height × width. This was checked against every skeleton's own attachment sizes. Padding counts toward the attachment size. The atlases in `extracted/` mixed in the mini build's rects and drew garbled.
- **NGUI atlases**: `ui/atlases.json` has every sprite list, used for the backgrounds, reel frame, logo, symbols, buttons and panels.
- **Fonts**: `fonts.css` has the game's fonts under their original family names.

`public/starlight/` is git-ignored. The art is licensed for this private copy, and it will be replaced with our own later. Each symbol is one prefab rig (`PREFAB` in `scene.js`), so replacements can go in one at a time.

## Typography

The canvas labels use the game's own captured fonts. The page's own text (bonus panel, banners,
dialogs, loading screen, toasts and buttons) uses two free OFL fonts bundled from npm, so nothing is
fetched from a font CDN: **Lilita One** for titles, numbers and buttons, matching the heavy rounded
lettering on the reels, and **Nunito** for running text. Titles and amounts use the game's gold
gradient with a deep purple outline.

## Sound, autoplay and volume

`src/client/sound.js` plays the original's own clips at the moments the original plays them. We worked this out by hooking its sound engine during spins (`layout/sound-refs.json` maps each clip to the part of the original that uses it):

- an ambience loop that never stops;
- music in layers (idle, spinning, tumbling wins) that run in step and crossfade over 3 seconds;
- the spin button, the six reel stops, the vanish sound (which climbs with each tumble), tumble fills, the win count-up and the scatter and multiplier voices.

Audio starts on the first tap or key, as browsers require.

The autoplay settings window (turbo, quick spin, skip screens, number of spins) and the volume popover are drawn from frames captured with them open in the original (`layout/autoplay-landscape.json`, `layout/sound-landscape.json`). On a phone they open centred. The original's own mobile versions of these aren't captured yet.

## API

| Call | Does |
|------|------|
| `POST /api/guest` | new guest → `{ token, state }` |
| `GET /api/state` | the player's state (pulls from Atlesque Play when signed in) |
| `POST /api/spin { buy? }` | the next paid or free spin → `{ spin, state }`, where `spin.steps` holds every tumble |
| `POST /api/bet { bet?, ante? }` | bet index and ante |
| `POST /api/topup` | 1,000 free credits when broke, once an hour |
| `POST /api/signin { code, code_verifier, redirect_uri }` | finishes the Atlesque Play sign-in |
| `POST /api/signout` | ends the session; the page starts a new guest |

Every call except `guest` and `config` sends `Authorization: Bearer <token>`. POSTs must come from the page's own origin.
