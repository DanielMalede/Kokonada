"""Composite an alpha'd foreground over a background and report the WCAG ratio."""
import sys


def srgb(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def lum(rgb):
    r, g, b = [srgb(x) for x in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def over(fg, a, bg):
    return tuple(a * f + (1 - a) * b for f, b in zip(fg, bg))


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


CASES = [
    # label, fg hex, alpha, bg hex, floor
    ('light  axis label  --track @ .42', '#6A6589', .42, '#F5F6FC', 4.5),
    ('light  axis label  --ink   @ .62', '#14163A', .62, '#F5F6FC', 4.5),
    ('light  axis label  --ink   @ .65', '#14163A', .65, '#F5F6FC', 4.5),
    ('dark   axis label  --track @ .42', '#A7A6D0', .42, '#0D0F26', 4.5),
    ('dark   axis label  --ink   @ .62', '#EEF1FC', .62, '#0D0F26', 4.5),
    ('dark   axis label  --ink   @ .65', '#EEF1FC', .65, '#0D0F26', 4.5),
    ('light  plate rim   --line  @ .6 ', '#14163A', .14 * .6, '#F5F6FC', 3.0),
    ('dark   plate rim   --line  @ .6 ', '#EEF1FC', .16 * .6, '#0D0F26', 3.0),
    ('light  dot ring    --track       ', '#6A6589', 1.0, '#F5F6FC', 3.0),
    ('dark   dot ring    --track       ', '#A7A6D0', 1.0, '#0D0F26', 3.0),
]

for name, fg, a, bg, floor in CASES:
    r = ratio(over(hx(fg), a, hx(bg)), hx(bg))
    print(f"{name}   {r:5.2f}:1   floor {floor}   {'PASS' if r >= floor else 'FAIL'}")
