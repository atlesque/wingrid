# Background music

Our own music, made on the local YuE2 render node from text prompts. The game plays the loops below; each render
section further down is the full take a loop was cut from (the takes themselves are kept out of the repo and archived
with the render node's output).

| File | Plays | Cut from |
| --- | --- | --- |
| wingrid-base-loop.mp3 | base game, spinning and winning layers | wingrid-base-v1, 11.10 s for 80.25 s (48 bars at 143.5 BPM) |
| wingrid-idle-loop.mp3 | base game, idle layer | the same loop with its drums removed (harmonic part only), so the layers stay in step |
| wingrid-bigwin-loop.mp3 | big-win celebration, over the ducked base music | wingrid-bigwin-v1, 88.80 s for 13.25 s (8 bars) |

Each loop's head is crossfaded with the audio that followed its end in the take, so the wrap continues the way the
take did. Loudness is matched to the original game's music (about -18.5 LUFS).

## wingrid-base-v1.mp3

- Model: YuE2-3B (local, RTX 5090 render node), instrumental
- Seed: 1
- Duration requested: 90 s; actual: 188 s (YuE2 treats duration as advisory)
- Format: MP3, 320 kbps, 48 kHz stereo
- Job ID: 20261018-230314-288034
- Prompt:

  > instrumental fantasy game background music, celestial magical-girl pop orchestral, 144 BPM, D minor, bright and adventurous, shimmering bells, harp and glockenspiel arpeggios, plucked synth lead, staccato string ostinato, airy choir pads, driving dance drums with taiko accents, sparkling and uplifting, steady energy, seamless loop, no vocals

## wingrid-bigwin-v1.mp3

- Model: YuE2-3B (local, RTX 5090 render node), instrumental
- Seed: 1
- Duration requested: 40 s; actual: 141.5 s (YuE2 treats duration as advisory)
- Format: MP3, 320 kbps, 48 kHz stereo
- Job ID: 20261018-232856-10851d
- Prompt:

  > instrumental fantasy game victory music, celestial magical-girl pop orchestral, 144 BPM, E-flat major, triumphant celebration that keeps building in intensity, brass fanfare, soaring choir pads, sparkling bells and glockenspiel, harp glissandos, rolling timpani and taiko, cymbal swells, joyful and huge, no vocals

No reference audio was used and no artist or song was named.
