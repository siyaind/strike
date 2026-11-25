#!/usr/bin/env python3
"""Make human-viewable composites of raw simulator glasses screenshots (alpha = lit pixels) → green-on-black, 2x, plus a contact sheet."""
import sys, glob, os
from PIL import Image, ImageDraw
src = sys.argv[1] if len(sys.argv) > 1 else 'evidence/g2-simulator'
out = os.path.join(src, 'view'); os.makedirs(out, exist_ok=True)
files = sorted(f for f in glob.glob(os.path.join(src, '*.png')))
tiles = []
for f in files:
    im = Image.open(f).convert('RGBA'); a = im.getchannel('A')
    bg = Image.new('RGB', im.size, (0, 0, 0)); bg.paste(Image.new('RGB', im.size, (90, 255, 140)), (0, 0), a)
    big = bg.resize((im.width * 2, im.height * 2), Image.NEAREST); big.save(os.path.join(out, os.path.basename(f)))
    t = bg.copy(); ImageDraw.Draw(t).text((4, 276), os.path.basename(f), fill=(255, 255, 255)); tiles.append(t)
if tiles:
    cols = 3; rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 580, rows * 292), (30, 30, 30))
    for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * 580 + 2, (i // cols) * 292 + 2))
    sheet.save(os.path.join(out, 'contact-sheet.png'))
print(f'{len(tiles)} views → {out}')
