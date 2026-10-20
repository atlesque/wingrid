# Builds the princess's mouth frames (character-v2-mouths.png) from a sheet of painted mouth shapes.
#
# The sheet is a grid of eleven paintings of her lower face, one per mouth shape, in the order below, each a
# 375 x 325 crop of the painting's (440, 150)-(590, 280) region at 2.5 times its size, under a label row. The
# frames repaint the whole crop, so only the part that changes from shape to shape is kept (her lips, chin and
# jaw, never her eyes or nose), under a soft edge, with its colours matched to the painting it covers. The frames
# go side by side in one image at their painted size; the "mouths" entry it prints goes in character-v2-face.json.
#
# Usage: python3 scripts/build-character-mouths.py <sheet.png>   (needs Pillow and numpy)
import sys, json, numpy as np
from collections import deque
from PIL import Image, ImageFilter

DIR = 'public/characters/princess-v2'
NAMES = 'X A O U I S E F M L K'.split()
CROP, SCALE, CELL, TOPS = (440, 150, 590, 280), 2.5, (375, 325), (25, 373, 718)
sheet = Image.open(sys.argv[1]).convert('RGB')
frames = {}
for i, name in enumerate(NAMES):
    row, column = divmod(i, 4)
    x, y = column * CELL[0], TOPS[row]
    frames[name] = np.asarray(sheet.crop((x, y, x + CELL[0], y + CELL[1]))).astype(float)
painting = Image.open(f'{DIR}/character-v2-reference.png').convert('RGB').crop(CROP).resize(CELL, Image.LANCZOS)
painting = np.asarray(painting).astype(float)

# where the shapes differ from her resting mouth, below her nose, grown and softened
change = np.zeros(CELL[::-1])
for name in NAMES[1:]: change = np.maximum(change, np.abs(frames[name] - frames['X']).sum(2))
keep = change > 40
keep[:int((193 - CROP[1]) * SCALE)] = False
mask = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MaxFilter(9))
mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(9))
alpha = np.asarray(mask).astype(float) / 255
alpha[:int((191 - CROP[1]) * SCALE)] = 0
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(float) / 255

# and only on her face (skin, lips and a few pixels round her jaw, where some shapes drop it), since hair and
# collar move on bones of their own
rgb = np.asarray(Image.open(f'{DIR}/character-v2-reference.png').convert('RGB')).astype(int)
CHIN, RIGHT_JAW = (521, 250), (590, 204)
seed = (235, 515)
skin = rgb[seed]
face = np.zeros(rgb.shape[:2], bool); face[seed] = True
queue = deque([seed])
while queue:
    y, x = queue.popleft()
    for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        below_jaw = X > CHIN[0] and Y > CHIN[1] + (RIGHT_JAW[1] - CHIN[1]) * (X - CHIN[0]) / (RIGHT_JAW[0] - CHIN[0])
        if 185 <= Y < 300 and 420 < X < 640 and not face[Y, X] and not below_jaw \
                and abs(rgb[Y, X] - skin).sum() < 110 and rgb[Y, X].sum() > 480:
            face[Y, X] = True; queue.append((Y, X))
face = Image.fromarray((face * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
face = face.filter(ImageFilter.MaxFilter(13)).crop(CROP).resize(CELL, Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.5))
alpha *= np.asarray(face).astype(float) / 255

# match the frames' colours to the painting where the resting frame covers it
weight = alpha[..., None]
gain = (painting * weight).sum((0, 1)) / (frames['X'] * weight).sum((0, 1))
ys, xs = np.nonzero(alpha > 1 / 255)
box = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
w, h = box[2] - box[0], box[3] - box[1]
out = np.zeros((h, w * len(NAMES), 4), np.uint8)
for i, name in enumerate(NAMES):
    rgb = np.clip(frames[name] * gain, 0, 255)[box[1]:box[3], box[0]:box[2]]
    out[:, i * w:(i + 1) * w, :3] = rgb
    out[:, i * w:(i + 1) * w, 3] = (alpha[box[1]:box[3], box[0]:box[2]] * 255).round()
Image.fromarray(out).save(f'{DIR}/character-v2-mouths.png', optimize=True)

place = [round(CROP[0] + int(box[0]) / SCALE, 2), round(CROP[1] + int(box[1]) / SCALE, 2)]
print('"mouths":', json.dumps({'image': 'character-v2-mouths.png', 'at': place, 'size': [int(w), int(h)], 'scale': SCALE, 'frames': NAMES}))
