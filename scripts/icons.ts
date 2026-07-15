/**
 * Renders the full icon set from public/icons/icon.svg. Never hand-edit the
 * PNGs — change the SVG and re-run `pnpm icons`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ICONS_DIR = join(process.cwd(), 'public', 'icons');
const SVG_PATH = join(ICONS_DIR, 'icon.svg');
const PAPER = '#F5F4F0';

// Every mark must sit within the centre 80% circle (radius 205 from 256,256)
// so it survives Android's maskable crop. Asserted, not eyeballed.
function assertMaskableSafe(svg: string) {
  const polygons = [...svg.matchAll(/points="([^"]+)"/g)].map((m) => m[1] ?? '');
  if (polygons.length === 0) throw new Error('icon.svg: no polygons found');
  for (const points of polygons) {
    for (const pair of points.trim().split(/\s+/)) {
      const [x, y] = pair.split(',').map(Number);
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
        throw new Error(`icon.svg: unparseable point "${pair}"`);
      }
      const r = Math.hypot(x - 256, y - 256);
      if (r > 205) {
        throw new Error(
          `icon.svg: point (${x},${y}) is ${r.toFixed(1)}px from centre — outside the 205px maskable safe zone`,
        );
      }
    }
  }
}

/** Same marks, full-bleed paper background, no corner radius. */
function fullBleedVariant(svg: string): string {
  return svg.replace(/<rect [^/]*\/>/, `<rect width="512" height="512" fill="${PAPER}"/>`);
}

async function renderPng(svg: string, size: number, opaque = false): Promise<Buffer> {
  const pipeline = sharp(Buffer.from(svg), { density: 300 }).resize(size, size);
  return (opaque ? pipeline.removeAlpha() : pipeline).png().toBuffer();
}

// Current iPhone logical sizes × device pixel ratio (portrait).
const SPLASH_SIZES: Array<[number, number, number]> = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [414, 896, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];

async function main() {
  const svg = readFileSync(SVG_PATH, 'utf8');
  assertMaskableSafe(svg);
  const fullBleed = fullBleedVariant(svg);

  // Rounded tile icons.
  writeFileSync(join(ICONS_DIR, 'icon-192.png'), await renderPng(svg, 192));
  writeFileSync(join(ICONS_DIR, 'icon-512.png'), await renderPng(svg, 512));

  // Maskable: full-bleed so the OS mask has solid colour to cut into.
  writeFileSync(join(ICONS_DIR, 'icon-maskable-512.png'), await renderPng(fullBleed, 512));

  // iOS applies its own mask: full-bleed, no transparency, no radius.
  writeFileSync(join(ICONS_DIR, 'apple-touch-icon.png'), await renderPng(fullBleed, 180, true));

  // Multi-size favicon.
  const icoSizes = await Promise.all([16, 32, 48].map((s) => renderPng(fullBleed, s)));
  writeFileSync(join(ICONS_DIR, 'favicon.ico'), await pngToIco(icoSizes));

  // Splash screens: paper background, mark centred at ~30% of the short edge.
  for (const [w, h, r] of SPLASH_SIZES) {
    const [W, H] = [w * r, h * r];
    const markSize = Math.round(Math.min(W, H) * 0.3);
    const mark = await renderPng(svg, markSize);
    const splash = await sharp({
      create: { width: W, height: H, channels: 3, background: PAPER },
    })
      .composite([{ input: mark, gravity: 'centre' }])
      .png()
      .toBuffer();
    writeFileSync(join(ICONS_DIR, `splash-${W}x${H}.png`), splash);
  }

  console.log(
    `icons: rendered tile, maskable, apple-touch, favicon.ico, ${SPLASH_SIZES.length} splash screens`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
