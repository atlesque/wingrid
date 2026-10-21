# Link-preview and icon art, made only from the game's own art: the Fuji backdrop, the Wingrid logo, the
# princess painting and the MBP and gem symbols. Writes public/share/og.jpg (1200 x 630, used by Open Graph
# and Twitter cards) and the crown icons in public/icons/. Run from the repo root: python3 scripts/share-art.py
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path('public')
W, H = 1200, 630
NIGHT = (34, 14, 74)


def load(path):
    return Image.open(PUBLIC / path).convert('RGBA')


def fit(im, w=None, h=None):
    scale = min(w / im.width if w else 9, h / im.height if h else 9)
    return im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)


def shadow(im, blur=14, alpha=150):
    pad = blur * 3
    s = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    a = im.getchannel('A').point(lambda v: v * alpha // 255)
    s.paste((10, 4, 30, 255), (pad, pad), a)
    return s.filter(ImageFilter.GaussianBlur(blur)), pad


def place(canvas, im, x, y, drop=True):
    if drop:
        s, pad = shadow(im)
        canvas.alpha_composite(s, (x - pad + 6, y - pad + 10))
    canvas.alpha_composite(im, (x, y))


def og():
    bg = load('theme/japan/backdrop-base-land.webp')
    bg = fit(bg, w=W)
    canvas = bg.crop((0, (bg.height - H) // 2, W, (bg.height - H) // 2 + H))
    # deepen the left and the bottom a little so the logo and gems stand off the bright sky
    veil = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(veil)
    for x in range(W):
        d.line([(x, 0), (x, H)], fill=NIGHT + (max(0, int(120 * (1 - x / 760))),))
    for y in range(H):
        d.line([(0, y), (W, y)], fill=NIGHT + (max(0, int(150 * (y - 380) / 250)),)) if y > 380 else None
    canvas.alpha_composite(veil)

    princess = fit(load('characters/princess-v2/character-v2-reference.png'), h=700)
    place(canvas, princess, W - princess.width + 40, -10)

    logo = fit(load('branding/wingrid-logo.png'), w=600)
    place(canvas, logo, 40, 40)

    names = ['characters/princess-v2/scatter.png', 'symbols/vlaanderen/blue-gem.png', 'symbols/vlaanderen/green-gem.png',
             'symbols/vlaanderen/yellow-gem.png', 'symbols/vlaanderen/teal-gem.png', 'symbols/vlaanderen/vlaanderen-ruby.png']
    x = 52
    for i, name in enumerate(names):
        gem = fit(load(name), h=140 if i == 0 else 104)
        place(canvas, gem, x, 600 - gem.height - (0 if i == 0 else 16))
        x += gem.width + (14 if i == 0 else 4)

    out = PUBLIC / 'share' / 'og.jpg'
    out.parent.mkdir(exist_ok=True)
    canvas.convert('RGB').save(out, quality=86, optimize=True, progressive=True)


def icons():
    logo = load('branding/wingrid-logo.png')
    crown = logo.crop((480, 30, 1070, 342))  # the crown and its purple glow, without the wordmark

    def tile(size, inset, radius):
        im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        grad = Image.new('RGBA', (1, size))
        for y in range(size):
            t = y / size
            grad.putpixel((0, y), (int(92 - 50 * t), int(36 - 20 * t), int(170 - 90 * t), 255))
        grad = grad.resize((size, size))
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        im.paste(grad, (0, 0), mask)
        c = fit(crown, w=size - inset * 2)
        im.alpha_composite(c, ((size - c.width) // 2, (size - c.height) // 2 + size // 40))
        return im

    out = PUBLIC / 'icons'
    out.mkdir(exist_ok=True)
    tile(512, 40, 96).save(out / 'icon-512.png', optimize=True)
    tile(192, 14, 36).save(out / 'icon-192.png', optimize=True)
    tile(512, 110, 0).save(out / 'maskable-512.png', optimize=True)  # crown inside the maskable safe zone
    tile(180, 16, 0).convert('RGB').save(out / 'apple-touch-icon.png', optimize=True)  # iOS rounds it itself
    small = tile(256, 8, 48)
    small.save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    small.resize((32, 32), Image.LANCZOS).save(out / 'favicon-32.png', optimize=True)


og()
icons()
