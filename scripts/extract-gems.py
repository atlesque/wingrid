"""Extract twelve isolated jewels from the approved transparent atlas (requires Pillow)."""
from collections import deque
from pathlib import Path
import sys
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'design/gems/vlaanderen-gems-cutouts.png'
output = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'public/symbols/vlaanderen'
names = ['vlaanderen', 'burgerprofiel-ruby', 'lbk', 'burgerprofiel-blue',
         'vlaanderen-ruby', 'blue-gem', 'green-gem', 'teal-gem', 'yellow-gem',
         'ajh', 'dch', 'pini']
image = Image.open(source).convert('RGBA')
width, height = image.size
# Measure connected opaque silhouettes, ignoring isolated generation specks.
# Do not assume exact cell boundaries in a generated image: that can clip tips.
remaining = {i for i, value in enumerate(image.getchannel('A').tobytes()) if value > 128}
components = []
while remaining:
    start = remaining.pop()
    queue, count = deque([start]), 1
    xmin = xmax = start % width
    ymin = ymax = start // width
    while queue:
        index = queue.popleft()
        x, y = index % width, index // width
        xmin, xmax, ymin, ymax = min(xmin,x), max(xmax,x), min(ymin,y), max(ymax,y)
        for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            neighbor = ny * width + nx
            if 0 <= nx < width and 0 <= ny < height and neighbor in remaining:
                remaining.remove(neighbor)
                queue.append(neighbor)
                count += 1
    components.append((count, (max(0,xmin-2), max(0,ymin-2), min(width,xmax+3), min(height,ymax+3))))
components = sorted(components, reverse=True)[:12]
if len(components) != 12 or min(count for count, _ in components) < 10000:
    raise ValueError('Expected twelve complete isolated jewel silhouettes')
by_row = sorted((bounds for _, bounds in components), key=lambda b: (b[1]+b[3])/2)
ordered = []
for row in range(4):
    ordered.extend(sorted(by_row[row*3:row*3+3], key=lambda b: (b[0]+b[2])/2))
output.mkdir(parents=True, exist_ok=True)
for name, bounds in zip(names, ordered):
    tile = image.crop(bounds)
    tile.thumbnail((352, 352), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (384, 384))
    canvas.paste(tile, ((384-tile.width)//2, (384-tile.height)//2))
    canvas.save(output / f'{name}.png', optimize=True)
    print(name, bounds)
