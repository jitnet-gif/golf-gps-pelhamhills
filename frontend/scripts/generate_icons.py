"""Generate the PWA icon set referenced by vite.config.ts and index.html.

The manifest advertised these files for months but none of them were ever in
the repo, and Vercel's SPA rewrite answers a missing /pwa-192x192.png with
index.html - a 200 carrying text/html, which is why the browser said "Download
error or resource isn't a valid image" instead of a plain 404.

Run from golf-gps-app/frontend:  python scripts/generate_icons.py
Requires Pillow. Output is committed, so this only needs re-running when the
mark changes.
"""

from PIL import Image, ImageDraw

OUT = "public"

NAVY = (30, 64, 175)      # theme_color #1e40af
GREEN = (22, 163, 74)     # the putting surface
WHITE = (255, 255, 255)

# The mark is drawn in a unit square and scaled up, so one set of coordinates
# serves every size. SS is a supersampling factor - Pillow has no antialiased
# polygon fill, so we draw large and shrink.
SS = 8


def draw_mark(d, x, y, s):
    """Flag on a green, with a ball. (x, y) is the top-left of an s-by-s box."""
    def p(u, v):
        return (x + u * s, y + v * s)

    # The green: an ellipse the pole and ball stand on.
    d.ellipse([p(0.06, 0.72), p(0.94, 0.98)], fill=GREEN)

    # Flagpole, from the cup up past the flag.
    pole_w = 0.05 * s
    d.rounded_rectangle(
        [p(0.38, 0.10), (x + 0.38 * s + pole_w, y + 0.86 * s)],
        radius=pole_w / 2,
        fill=WHITE,
    )

    # Pennant, flying right off the top of the pole.
    d.polygon([p(0.42, 0.12), p(0.42, 0.40), p(0.84, 0.26)], fill=WHITE)

    # Ball, resting on the green beside the pole.
    d.ellipse([p(0.58, 0.60), p(0.86, 0.88)], fill=WHITE)
    for u, v in ((0.66, 0.68), (0.75, 0.66), (0.71, 0.76), (0.79, 0.75)):
        r = 0.017 * s
        d.ellipse([(x + u * s - r, y + v * s - r), (x + u * s + r, y + v * s + r)], fill=GREEN)


def render(size, inset, radius_frac, bg=NAVY):
    """One icon. `inset` is the fraction of the canvas left as margin around
    the mark; `radius_frac` rounds the background square (0 = full bleed)."""
    n = size * SS
    img = Image.new("RGB", (n, n), bg)
    d = ImageDraw.Draw(img)
    if radius_frac:
        # Rounded plate on a transparent-looking navy field: draw the plate
        # itself so the corners are not just the background colour.
        img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=radius_frac * n, fill=bg)
    box = n * (1 - 2 * inset)
    draw_mark(d, n * inset, n * inset, box)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    # No convert("RGB") here. The rounded plates are RGBA with transparent
    # corners, and flattening drops the alpha while keeping the RGB underneath -
    # which is black, so the tile ships with four black corners. PNG and ICO
    # both carry alpha; the full-bleed icons are already RGB and pass through.
    path = f"{OUT}/{name}"
    img.save(path)
    print("wrote", path)


# "any" icons: the mark nearly fills the plate, corners rounded so it reads as
# an app tile wherever the platform does not mask it itself.
for px in (192, 512):
    save(render(px, inset=0.10, radius_frac=0.18), f"pwa-{px}x{px}.png")

# Maskable: full bleed, and the mark pulled well inside the 80% safe zone so a
# circular or squircle mask never clips the pennant or the ball.
for px in (192, 512):
    save(render(px, inset=0.22, radius_frac=0), f"pwa-maskable-{px}x{px}.png")

# iOS applies its own rounding to a square, opaque image.
save(render(180, inset=0.12, radius_frac=0), "apple-touch-icon.png")

# favicon.ico carries the sizes Windows and the tab strip actually ask for.
ico = render(64, inset=0.06, radius_frac=0.18)
ico.save(f"{OUT}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("wrote", f"{OUT}/favicon.ico")
