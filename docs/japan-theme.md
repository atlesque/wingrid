# Japan theme art

## Backdrops

The four backdrops in `public/theme/japan/` were rendered on Alex's image node (ComfyUI on the RTX 5090
desktop) with **Qwen-Image** (`qwen_image_fp8_e4m3fn`, `qwen_2.5_vl_7b_fp8_scaled` text encoder,
`qwen_image_vae`; Apache-2.0), 30 steps, CFG 2.5, at 1664×928 / 928×1664, then upscaled 2x with
4x-AnimeSharp (scaled by 0.5, lanczos) to 3328×1856 / 1856×3328 and saved as WebP (quality 86).
The prompts were text only: no game art was used as a reference.

| File | Prompt | Seed |
|------|--------|------|
| `backdrop-base-land.webp` | base, landscape | 303 |
| `backdrop-base-port.webp` | base, portrait | 303 |
| `backdrop-free-land.webp` | free spins, landscape | 303 |
| `backdrop-free-port.webp` | free spins, portrait | 101 |

Style, added to every prompt: "anime mobile game background art, painterly, vibrant saturated colours,
soft volumetric light, highly detailed, clean shapes, no people".

Negative prompt: "people, person, girl, woman, character, animal, text, letters, kanji, signage,
watermark, signature, logo, frame, border, UI, blurry, lowres, jpeg artifacts, deformed".

- **Base, landscape (16:9)**: "A spring Japanese landscape on a sunny late afternoon: snow-capped Mount
  Fuji far away in the upper centre, a calm lake below it reflecting the sky, a vermilion five-storey
  pagoda on a hill at the far left edge, a large vermilion torii gate standing in the lake near the right
  edge, blooming pink cherry blossom trees framing the left and right edges with petals drifting in the
  air, stone lanterns on the shore, soft pink and golden clouds in a bright blue sky. Wide establishing
  shot. The middle of the picture is calm and open (soft sky, mist, lake) because a game board will cover
  it; the interesting things sit at the edges and along the top."
- **Base, portrait (9:16)**: "Mount Fuji and a bright blue sky with pink-gold clouds in the top third,
  cherry blossom branches hanging into both top corners, the middle third a soft hazy lake with mist (it
  will be covered), the bottom third a lakeshore with a vermilion torii gate in the water, stone lanterns
  and fallen cherry petals on the water."
- **Free spins, landscape (16:9)**: "The same Japanese landscape at night during a lantern festival: a
  huge glowing full moon, a deep purple and magenta night sky full of stars, Mount Fuji silhouetted in the
  distance, glowing red paper lanterns strung along the shore, a vermilion pagoda on the far left lit
  warmly from inside, a torii gate in the lake near the right edge, cherry blossom trees glowing pink with
  drifting petals and fireflies, the lake reflecting the lanterns and the moon. The middle of the picture
  is calm and open; the interesting things sit at the edges and along the top."
- **Free spins, portrait (9:16)**: "full moon and Mount Fuji in a purple starry sky in the top third with
  glowing cherry branches in the top corners, the middle third a calm misty lake (it will be covered), the
  bottom third a shore with glowing paper lanterns, a torii gate in the water and petals on the water."

Seeds 101, 202 and 303 were rendered for each prompt; the picks above sit best behind the board.

## Board

`board-base.webp` and `board-free.webp` are drawn by `scripts/japan-board.mjs` and rendered at 2x by
`node scripts/render-japan-art.mjs` (set `CHROMIUM` to a Chromium binary if Playwright's own is not
installed, and `SVG=1` to also write the SVG sources).
