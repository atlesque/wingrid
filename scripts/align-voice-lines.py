# Works out the princess's mouth shapes for each of her voice lines (public/characters/princess-v2/character-v2-lipsync.json).
#
# Each line is written below as a rough phonetic spelling of what she says (the words came from a speech-to-text pass
# over the clips and were checked against spectrograms). A forced aligner (torchaudio's MMS_FA) places
# each sound of that spelling on the recording, and each sound maps to one of her painted mouth frames (the "mouths"
# in character-v2-face.json). Laughs follow their bursts of sound instead, and two sung, stretched words over music
# that the aligner can't follow are placed by hand. She rests her mouth wherever the line goes quiet.
#
# Usage: python3 scripts/align-voice-lines.py [audio dir, default public/starlight/audio]
#   needs ffmpeg, numpy, torch and torchaudio (pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu)
import sys, json, glob, subprocess, numpy as np, torch
from torchaudio.pipelines import MMS_FA as bundle
import torchaudio.functional as F

AUDIO = sys.argv[1] if len(sys.argv) > 1 else 'public/starlight/audio'
OUT = 'public/characters/princess-v2/character-v2-lipsync.json'
def load(clip):
    # the game names some clips by the start of their file name
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', glob.glob(f'{AUDIO}/{clip}*.mp3')[0], '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)

LINES = {
 '03779047f93b10646ab3d3eee1309492': ('Hahahaha!', 'h a h a h a h a'),
 '7930fd48': ('Hahahaha!', 'h a h a h a h a'),
 '1a25a01ef8e7cd547bb75ac540ff52d6': ('Haha!', 'h a h a'),
 '0a3bc36fc50b9244e87c823d966be202': ('Constellation Kiss!', 'k o n s t e l ei sh u n | k i s'),
 '0aff080168381d74b8ef04d3d99a8de2': ('So bright!', 's o u | b r a i t'),
 '26aedd61': ('(gasp)', 'h a'),
 '319798e85499b814fb494fb2872e8bde': ('Whoa!', 'w o a'),
 '37186c47': ('Meteor Blast!', 'm i t i o r | b l a s t'),
 '373fcd708bcd70d4eb782f94907de207': ('Speed of Light!', 's p i d | o v | l a i t'),
 '4b1c955e88b5b554792afce7bbb6fd8c': ('Mega!', 'm e g a'),
 '4d014ddc': ('Aha!', 'a h a'),
 '524f1e11': ('Oh!', 'o u'),
 '5fba3b88': ('Stardust Magic!', 's t a r d a s t | m a j i k'),
 '9afea735': ('Aha!', 'a h a'),
 '79ed4b89ec59d2f4e97acf8e18bb03ff': ('Sensational!', 's e n s ei sh u n a l'),
 '9b2b89de733f75e408c3f64898e9d93f': ('Sensational!', 's e n s ei sh u n a l'),
 '9d410ccf521225748a9a57d4b0e6f60e': ('Superb!', 's u p e r b'),
 'ca9c10c9c9f2c1949b3c8f94e987db41': ('Superb!', 's u p e r b'),
 'b03c7eb4': ('Star Power!', 's t a r | p a w e r'),
 'be9906e3ebb87f644b77189f8fee5d5f': ('Nice!', 'n a i s'),
 'c7b7fb85': ('Cosmic Riches!', 'k o z m i k | r i ch e s'),
 'd83927ce': ('To the stars!', 't u | th e | s t a r z'),
 'e8c6aa16': ('Celestial Bliss!', 's e l e s ch a l | b l i s'),
}
VISEME = {'a':'A','e':'E','ei':'E','i':'I','o':'O','u':'U','w':'U','m':'M','b':'M','p':'M','f':'F','v':'F',
          's':'S','z':'S','t':'S','d':'S','n':'S','sh':'S','ch':'S','j':'S','th':'S','l':'L','k':'K','g':'K','h':'K','r':'K'}
LAUGHS = {'03779047f93b10646ab3d3eee1309492', '7930fd48', '1a25a01ef8e7cd547bb75ac540ff52d6', '4d014ddc', '9afea735', '26aedd61'}
# lines the aligner can't follow (a sung, stretched word over the music): placed by hand from the spectrogram
BY_HAND = {
 '4b1c955e88b5b554792afce7bbb6fd8c': [[.02, 'M'], [.07, 'E'], [.40, 'K'], [.46, 'A']],
 'be9906e3ebb87f644b77189f8fee5d5f': [[.02, 'S'], [.07, 'A'], [1.85, 'I'], [2.15, 'S']],
}
model = bundle.get_model(with_star=True); labels = {c: i for i, c in enumerate(bundle.get_labels(star=None))}
out = {}
for clip, (text, spelling) in LINES.items():
    x = load(clip)
    env = np.sqrt(np.convolve(x**2, np.ones(320)/320, 'same'))[::160]  # 100 per second
    loud = env > .12 * env.max()
    if clip in BY_HAND: keys = [list(k) for k in BY_HAND[clip]]
    elif clip in LAUGHS:
        keys, on = [], False
        for i, l in enumerate(loud):
            if l and not on: keys += [[max(0, i/100 - .03), 'K'], [i/100 + .03, 'A']]
            on = l
    else:
        audio = torch.tensor(x.astype(np.float32))[None]
        with torch.inference_mode(): emission, _ = model(audio)
        tokens = [t for t in spelling.split() if t != '|']
        targets = torch.tensor([[labels[c] for t in tokens for c in t]], dtype=torch.int32)
        aligned, scores = F.forced_align(emission, targets, blank=0)
        spans = F.merge_tokens(aligned[0], scores[0].exp())
        sec = audio.shape[1] / emission.shape[1] / 16000
        keys, i = [], 0
        for t in tokens:
            keys.append([spans[i].start * sec, VISEME[t]]); i += len(t)
    # rest wherever she is quiet for a tenth of a second or more, and once the line ends
    final, quiet = [], 0
    for i in range(len(loud)):
        quiet = 0 if loud[i] else quiet + 1
        if quiet == 10: final.append([(i - 9) / 100, 'X'])
    keys = sorted(keys + final)
    merged = []
    for t, v in keys:
        if merged and merged[-1][1] == v: continue
        if merged and t - merged[-1][0] < .03: merged.pop()
        level = float(env[min(len(env) - 1, int(t * 100) + 3)])
        merged.append([round(t, 2), v, round(min(1, .5 + .5 * level / float(env.max())), 2) if v != 'X' else 0])
    if merged[-1][1] != 'X': merged.append([round(max(merged[-1][0] + .12, (np.nonzero(loud)[0][-1] + 1) / 100), 2), 'X', 0])
    out[clip] = {'says': text, 'keys': merged}
    print(clip, text, ' '.join(f'{t}{v}' for t, v, _ in merged))
lines = ',\n'.join(f'    "{clip}": {{ "says": {json.dumps(line["says"])}, "keys": {json.dumps([[t, v, w] if v != "X" else [t, v] for t, v, w in line["keys"]], separators=(",", ":"))} }}'
                   for clip, line in out.items())
open(OUT, 'w').write('{\n  "lines": {\n' + lines + '\n  }\n}\n')
