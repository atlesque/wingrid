# Cuts the princess's lower face out of her painting as its own piece (character-v2-jaw.png), so her jaw can drop
# as one when she speaks: the lower lip, chin and jawline slide down together over her collar, while the painting
# underneath stays put and is covered by the piece. The piece is every skin pixel below the line between her lips
# (and that line carried out to her cheeks), up to the dark outline of her chin, which it keeps. On her right, where
# face and neck share one skin tone, it stops at the soft shadow line of the jaw.
#
# Usage: python3 scripts/build-character-jaw.py   (needs Pillow and numpy; rerun build-character-rig.mjs after)
from collections import deque
import json, numpy as np
from PIL import Image, ImageFilter

DIR = 'public/characters/princess-v2'
painting = Image.open(f'{DIR}/character-v2-reference.png').convert('RGBA')
rgb = np.asarray(painting.convert('RGB')).astype(int)
H, W = rgb.shape[:2]
seam = json.load(open(f'{DIR}/character-v2-face.json'))['mouth']['seam']
def seam_y(x):
    if x <= seam[0][0]: return seam[0][1]
    for (x0, y0), (x1, y1) in zip(seam, seam[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return seam[-1][1]
# her right jaw: from the chin up to below the ear, painting pixels
CHIN, RIGHT_JAW = (521, 250), (588, 206)
def below_right_jaw(x, y):
    (x0, y0), (x1, y1) = CHIN, RIGHT_JAW
    return x > x0 and y > y0 + (y1 - y0) * (x - x0) / (x1 - x0)

seed = (235, 515)
skin = rgb[seed]
def is_skin(y, x): return abs(rgb[y, x] - skin).sum() < 110 and rgb[y, x].sum() > 480
inside = np.zeros((H, W), bool)
queue = deque([seed]); inside[seed] = True
while queue:
    y, x = queue.popleft()
    for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 180 < Y < 300 and 420 < X < 640 and not inside[Y, X] and Y >= seam_y(X) - 1 and not below_right_jaw(X, Y) and is_skin(Y, X):
            inside[Y, X] = True; queue.append((Y, X))
# the lips, the painted line between them and small marks are not skin-toned: fill the holes, then take in the
# outline round the chin (two pixels)
mask = Image.fromarray((inside * 255).astype(np.uint8))
mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
m = np.asarray(mask) > 0
ys, xs = np.mgrid[0:H, 0:W]
top = np.array([seam_y(x) for x in range(W)])
m &= ys >= np.floor(top[None, :] - .5)
m &= ~((xs > CHIN[0]) & (ys > CHIN[1] + (RIGHT_JAW[1] - CHIN[1]) * (xs - CHIN[0]) / (RIGHT_JAW[0] - CHIN[0]) + 1))
alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(.6))
# the painting's own colours under the cut's alpha (not blended towards black, which would darken its edge)
piece = painting.copy()
piece.putalpha(alpha)
piece = Image.fromarray(np.where(np.asarray(alpha)[..., None] > 0, np.asarray(piece), 0).astype(np.uint8))
piece.save(f'{DIR}/character-v2-jaw.png', optimize=True)
box = piece.getbbox()
print('jaw piece', box)
