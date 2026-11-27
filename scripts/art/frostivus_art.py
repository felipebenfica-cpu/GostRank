#!/usr/bin/env python3
"""Arte original do tema Frostivus (nenhum recurso de terceiros).
Gera as camadas em SVG, rasteriza no Chrome (Playwright) e grava WebP em src/renderer/frostivus/.
Uso: python3 scripts/art/frostivus_art.py   (precisa de playwright e Pillow)"""
import io, math, random, pathlib
from PIL import Image
from playwright.sync_api import sync_playwright

W, H = 1920, 1080
OUT = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'renderer' / 'frostivus'
R = random.Random(2026)

def poly(pts, fill, op=1, extra=''):
    p = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
    return f'<polygon points="{p}" fill="{fill}" opacity="{op}" {extra}/>'

def jag(x0, y0, x1, y1, rough, depth):
    """Linha fraturada por deslocamento do ponto médio."""
    if depth == 0:
        return [(x0, y0)]
    mx = (x0 + x1) / 2 + R.uniform(-rough, rough) * 0.35
    my = (y0 + y1) / 2 + R.uniform(-rough, rough)
    return jag(x0, y0, mx, my, rough * 0.55, depth - 1) + jag(mx, my, x1, y1, rough * 0.55, depth - 1)

def ridge(keys, rough, depth=5):
    out = []
    for (a, b), (c, d) in zip(keys, keys[1:]):
        out += jag(a, b, c, d, rough, depth)
    return out + [keys[-1]]

def mountain(keys, rough, top, bottom, gid, snow=None, snow_op=.8):
    line = ridge(keys, rough)
    s = f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>'
    s += poly(line + [(keys[-1][0], H), (keys[0][0], H)], f'url(#{gid})')
    # facetas de rocha: sombras e luzes descendo dos picos
    for i in range(2, len(line) - 2, 3):
        x, y = line[i]
        l = R.uniform(40, 190)
        s += poly([(x, y), (x + R.uniform(-8, 26), y + l), (x - R.uniform(10, 55), y + l * R.uniform(.5, 1.1))], '#02040c', R.uniform(.18, .42))
        s += poly([(x, y), (x + R.uniform(14, 48), y + l * .75), (x + R.uniform(2, 14), y + l * .4)], '#4a6fd0', R.uniform(.06, .2))
    if snow:
        # manto de neve contínuo acompanhando a crista, mais grosso nos topos
        under = [(x + R.uniform(-5, 5), y + R.uniform(5, 24)) for x, y in reversed(line)]
        s += poly(line + under, snow, snow_op * .8)
        for i in range(2, len(line) - 2, 4):
            x, y = line[i]
            s += poly([(line[i-1][0], line[i-1][1]), (x, y), (line[i+1][0], line[i+1][1]), (x + R.uniform(-6, 18), y + R.uniform(30, 62)), (x - 8, y + 18)], snow, snow_op * .45)
    return s

def spire(x, base, w, h, c, lit):
    top = base - h
    s = poly([(x - w, base), (x - w * .62, top + h * .38), (x - w * .3, top + h * .45), (x - w * .08, top),
              (x + w * .22, top + h * .22), (x + w * .5, top + h * .18), (x + w * .66, top + h * .55), (x + w, base)], c)
    s += poly([(x - w * .08, top), (x + w * .22, top + h * .22), (x + w * .1, base), (x - w * .05, top + h * .5)], lit, .35)
    s += poly([(x - w * .08, top - 1), (x + w * .1, top + h * .13), (x - w * .02, top + h * .09), (x - w * .17, top + h * .17)], '#bcd8ff', .75)
    return s

def fortress(cx, base, k, body, edge, window):
    s = ''
    def tower(x, w, h):
        t = base - h * k; x = cx + x * k; w *= k
        o = f'<rect x="{x-w/2:.1f}" y="{t:.1f}" width="{w:.1f}" height="{base-t:.1f}" fill="{body}"/>'
        o += f'<rect x="{x-w*.64:.1f}" y="{t:.1f}" width="{w*1.28:.1f}" height="{10*k:.1f}" fill="{body}"/>'
        o += poly([(x - w * .72, t), (x, t - w * 1.55), (x + w * .72, t)], body)
        o += poly([(x - w * .72, t), (x, t - w * 1.55), (x - w * .16, t - w * .5)], edge, .55)
        o += f'<rect x="{x+w*.36:.1f}" y="{t:.1f}" width="{w*.14:.1f}" height="{base-t:.1f}" fill="{edge}" opacity=".3"/>'
        for i in range(int(h // 42)):
            if R.random() < .6:
                o += f'<rect x="{x-w*.12:.1f}" y="{t+(24+i*38)*k:.1f}" width="{max(2,w*.12):.1f}" height="{11*k:.1f}" fill="{window}" opacity="{R.uniform(.5,.95):.2f}"/>'
        return o
    s += f'<rect x="{cx-150*k:.1f}" y="{base-96*k:.1f}" width="{300*k:.1f}" height="{96*k:.1f}" fill="{body}"/>'
    for i in range(-7, 8):
        s += f'<rect x="{cx+i*20*k-6*k:.1f}" y="{base-108*k:.1f}" width="{12*k:.1f}" height="{14*k:.1f}" fill="{body}"/>'
    for x, w, h in [(-150, 34, 150), (-96, 28, 205), (-40, 44, 250), (8, 36, 330), (66, 40, 235), (118, 26, 190), (156, 32, 140)]:
        s += tower(x, w, h)
    s += f'<path d="M{cx-24*k},{base} v{-30*k} a{24*k},{30*k} 0 0 1 {48*k},0 v{30*k} z" fill="{window}" opacity=".85"/>'
    return s

def defs():
    return ('<filter id="b4"><feGaussianBlur stdDeviation="4"/></filter><filter id="b14"><feGaussianBlur stdDeviation="14"/></filter>'
            '<filter id="b40" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="40"/></filter>'
            '<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".008 .014" numOctaves="5" seed="7"/>'
            '<feColorMatrix type="matrix" values="0 0 0 0 .38  0 0 0 0 .45  0 0 0 0 .95  1.6 0 0 0 -.55"/></filter>')

def ellipse(cx, cy, rx, ry, c, op, f='b40'):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{c}" opacity="{op}" filter="url(#{f})"/>'

def background():
    s = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070D"/><stop offset=".38" stop-color="#101a4a"/>'
         '<stop offset=".66" stop-color="#27286a"/><stop offset="1" stop-color="#080F20"/></linearGradient>'
         f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    s += f'<rect width="{W}" height="780" filter="url(#grain)" opacity=".42"/>'
    for _ in range(260):
        s += f'<circle cx="{R.uniform(0,W):.0f}" cy="{R.uniform(0,420):.0f}" r="{R.uniform(.5,1.5):.1f}" fill="#E4F4FF" opacity="{R.uniform(.15,.7):.2f}"/>'
    s += ellipse(900, 600, 430, 210, '#873DFF', .42) + ellipse(900, 650, 300, 150, '#FF391C', .55) + ellipse(900, 690, 120, 90, '#ff9a4a', .5)
    s += mountain([(0, 520), (260, 360), (470, 560), (650, 470), (900, 650), (1150, 450), (1380, 540), (1640, 330), (1920, 470)], 80, '#3a4690', '#161c46', 'm1', '#a9c4f5', .55)
    s += ellipse(900, 680, 520, 70, '#6a5acd', .35)
    s += mountain([(620, 860), (740, 735), (790, 692), (900, 696), (1015, 690), (1075, 740), (1200, 860)], 16, '#1c1c48', '#0e1130', 'hill', '#8f9ee0', .55)
    s += fortress(900, 700, .82, '#141636', '#5a63b8', '#ff6a2a')
    s += ellipse(900, 705, 330, 40, '#FF391C', .4)
    for x, b, w, h in [(70, 800, 90, 520), (190, 830, 70, 390), (330, 800, 105, 590), (455, 820, 62, 330), (560, 790, 78, 440), (650, 810, 48, 250),
                       (1170, 800, 55, 270), (1260, 830, 84, 420), (1385, 800, 60, 320), (1760, 820, 96, 500), (1880, 840, 80, 430)]:
        s += spire(x, b + 170, w, h + 170, '#0d1130', '#5560c0')
    # rachaduras incandescentes
    for x, y in [(334, 430), (560, 545), (1262, 590), (200, 640)]:
        pts = ridge([(x, y), (x + R.uniform(-26, 26), y + 90), (x + R.uniform(-30, 30), y + 190)], 18, 3)
        d = 'M' + ' L'.join(f'{a:.0f},{b:.0f}' for a, b in pts)
        s += f'<path d="{d}" stroke="#FF391C" stroke-width="9" fill="none" opacity=".55" filter="url(#b4)"/><path d="{d}" stroke="#ffb15a" stroke-width="2" fill="none" opacity=".9"/>'
    s += mountain([(0, 600), (180, 690), (420, 745), (640, 850), (900, 905), (1180, 830), (1450, 760), (1700, 700), (1920, 610)], 55, '#1b2560', '#0a1030', 'm2', '#9fbcf2', .85)
    s += ellipse(780, 880, 520, 46, '#48BFFF', .2)
    s += mountain([(0, 800), (300, 840), (560, 930), (900, 990), (1300, 930), (1650, 870), (1920, 800)], 40, '#16214f', '#080F20', 'm3', '#c3d9ff', .75)
    return s

def statue():
    """Sentinela encapuzado (desenho original) com cajado de orbe glacial."""
    g = '<linearGradient id="cloak" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4d66ad"/><stop offset=".45" stop-color="#1f2c62"/><stop offset="1" stop-color="#0a0f2a"/></linearGradient>'
    s = g
    s += ellipse(1636, 190, 105, 105, '#007BFF', .55) + ellipse(1636, 190, 46, 46, '#48BFFF', .9, 'b14')
    s += poly([(1626, 215), (1646, 215), (1633, 820), (1619, 820)], '#141c40') + poly([(1626, 215), (1632, 215), (1624, 820), (1619, 820)], '#7fb4ff', .6)
    for dx in (-1, 1):
        s += f'<path d="M1636,236 C{1636+dx*52},228 {1636+dx*56},176 {1636+dx*24},150 C{1636+dx*36},184 {1636+dx*28},206 1636,214 z" fill="#1a2450" stroke="#8fc4ff" stroke-width="2"/>'
    s += '<circle cx="1636" cy="188" r="27" fill="#48BFFF"/><circle cx="1636" cy="188" r="19" fill="#bfeaff"/><circle cx="1629" cy="181" r="7" fill="#fff"/>'
    # manto
    s += poly([(1470, 392), (1522, 372), (1566, 398), (1606, 470), (1652, 600), (1668, 735), (1712, 832), (1630, 812), (1606, 860), (1546, 826), (1500, 868),
               (1456, 822), (1392, 858), (1396, 760), (1352, 700), (1384, 620), (1378, 520), (1416, 436)], 'url(#cloak)')
    for a, b, c, o in [((1440, 430), (1420, 640), (1396, 850), .55), ((1484, 450), (1480, 640), (1500, 862), .5), ((1530, 450), (1552, 630), (1548, 826), .55), ((1570, 470), (1612, 650), (1626, 810), .5)]:
        s += f'<path d="M{a[0]},{a[1]} Q{b[0]},{b[1]} {c[0]},{c[1]} L{c[0]+26},{c[1]-14} Q{b[0]+20},{b[1]} {a[0]+8},{a[1]} z" fill="#060a20" opacity="{o}"/>'
        s += f'<path d="M{a[0]-4},{a[1]+6} Q{b[0]-6},{b[1]} {c[0]-4},{c[1]-8}" stroke="#7ea6ee" stroke-width="2.5" fill="none" opacity=".5"/>'
    # ombreiras, peitoral e capuz
    s += poly([(1404, 430), (1448, 382), (1498, 396), (1478, 448), (1420, 466)], '#31437e') + poly([(1404, 430), (1448, 382), (1498, 396), (1452, 404)], '#a9c8ff', .8)
    s += poly([(1540, 390), (1590, 386), (1626, 432), (1604, 470), (1556, 446)], '#25346a') + poly([(1540, 390), (1590, 386), (1626, 432), (1580, 408)], '#a9c8ff', .65)
    s += poly([(1470, 396), (1546, 396), (1530, 500), (1508, 528), (1488, 498)], '#182454') + poly([(1508, 412), (1522, 452), (1508, 500), (1496, 452)], '#48BFFF', .55)
    s += poly([(1472, 396), (1466, 340), (1486, 296), (1510, 268), (1522, 300), (1548, 332), (1548, 392), (1510, 414)], '#2a3a74')
    s += poly([(1486, 296), (1510, 268), (1506, 330), (1476, 352)], '#8fb0f0', .75)
    s += poly([(1488, 344), (1516, 332), (1536, 348), (1530, 392), (1510, 404), (1492, 388)], '#050816')
    for x in (1499, 1520):
        s += f'<ellipse cx="{x}" cy="361" rx="7" ry="3" fill="#8fe0ff"/><ellipse cx="{x}" cy="361" rx="12" ry="7" fill="#48BFFF" opacity=".6" filter="url(#b4)"/>'
    s += poly([(1556, 446), (1604, 468), (1640, 512), (1616, 534), (1570, 500)], '#22306a') + '<circle cx="1630" cy="520" r="17" fill="#3a4c8c"/>'
    # neve acumulada
    for x, y, r in [(1448, 386, 34), (1590, 388, 26), (1508, 272, 11), (1392, 620, 16), (1668, 734, 12)]:
        s += f'<path d="M{x-r},{y+5} q{r*.4},{-r*.55} {r},{-r*.42} q{r*.7},0 {r},{r*.5} q{-r},{-r*.1} {-r*2},{-r*.08} z" fill="#E4F4FF" opacity=".92"/>'
    return s

def crystal(x, y, h, lean):
    w = h * .17
    tx = x + lean
    return (ellipse(x, y - h * .3, w * 1.7, h * .4, '#48BFFF', .28, 'b14')
            + poly([(x - w, y), (tx - w * .75, y - h * .72), (tx, y - h), (x, y - h * .1)], '#2f7fe0', .9)
            + poly([(x, y - h * .1), (tx, y - h), (tx + w * .8, y - h * .7), (x + w, y)], '#8fd8ff', .85)
            + f'<path d="M{x},{y-h*.1} L{tx},{y-h}" stroke="#E4F4FF" stroke-width="2" opacity=".8"/>')

def foreground():
    s = statue()
    # pedestal rochoso
    s += mountain([(1300, 930), (1380, 830), (1470, 806), (1580, 812), (1700, 786), (1800, 830), (1920, 760)], 34, '#202c64', '#070c24', 'p1', '#dcebff', .95)
    # haste do estandarte (o pano é animado na tela)
    s += poly([(1760, 470), (1772, 470), (1748, 900), (1736, 900)], '#0b0f24') + poly([(1700, 520), (1830, 474), (1833, 484), (1703, 531)], '#151a36')
    s += poly([(1766, 448), (1779, 474), (1766, 486), (1753, 474)], '#C5A05C')
    for x, y, h, l in [(1385, 905, 90, -22), (1418, 915, 55, 8), (1850, 900, 130, 26), (1885, 915, 72, 40), (60, 950, 150, -30), (105, 965, 90, 12), (140, 975, 52, 24)]:
        s += crystal(x, y, h, l)
    s += mountain([(0, 880), (150, 930), (330, 985), (520, 1045), (760, 1070)], 24, '#2b3b80', '#0a1130', 'f1', '#E4F4FF', .9)
    s += mountain([(1060, 1070), (1300, 1020), (1560, 940), (1760, 925), (1920, 880)], 26, '#2b3b80', '#0a1130', 'f2', '#E4F4FF', .9)
    return s

def render(page, body, transparent):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{defs()}</defs>{body}</svg>'
    page.set_content(f'<style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style>{svg}')
    return Image.open(io.BytesIO(page.screenshot(omit_background=transparent))).convert('RGBA' if transparent else 'RGB')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome' if pathlib.Path('/usr/bin/google-chrome').exists() else None)
        page = b.new_page(viewport={'width': W, 'height': H})
        for name, fn, alpha in [('cena', background, False), ('frente', foreground, True)]:
            img = render(page, fn(), alpha)
            img.save(OUT / f'{name}.webp', 'WEBP', quality=80, method=6)
            img.resize((960, 540), Image.LANCZOS).save(OUT / f'{name}-960.webp', 'WEBP', quality=76, method=6)
        b.close()
    for f in sorted(OUT.glob('*.webp')):
        print(f.name, f.stat().st_size // 1024, 'KB')

if __name__ == '__main__':
    main()
