/**
 * Generates the Unity Run 2026 campaign artwork — social posts, Meta ads,
 * website banner, poster and flex banner — from one design definition.
 *
 *   npm run marketing
 *   npm run marketing -- https://your-live-url.com
 *
 * Every format is written as both SVG (vector, hand to a printer) and PNG
 * (upload straight to Instagram/Facebook). Rerun after the site is deployed
 * so the QR code points at the real registration URL.
 *
 * Layout follows a three-band structure: a white header strip carrying the
 * logos, a photographic middle with a navy scrim for legibility, and a navy
 * action bar with the fee and QR.
 *
 * Photography: marketing/photos/*.jpg, from Pexels. The Pexels licence allows
 * commercial and print use, modification, and requires no attribution.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const REGISTER_URL = process.argv[2] || 'https://unity-run-2026.onrender.com';
const FEE_RUN = 600;
const FEE_WALK = 350;

const NAVY = '#1B2260';
const RED = '#C41E2A';
const SKY = '#46AEE0';
const INK_SOFT = '#3C424E';
const PAPER = '#FFFFFF';

const DISPLAY = 'Georgia, serif';
const SANS = 'Arial, Helvetica, sans-serif';

const ASSETS = path.join(__dirname, '..', 'public', 'assets');
const PHOTOS = path.join(__dirname, '..', 'marketing', 'photos');
const OUT = path.join(__dirname, '..', 'marketing');

const uri = (dir, file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;

const runLogo = uri(ASSETS, 'unity-run-logo-transparent.png', 'image/png');
// Actual pixel dimensions of unity-run-logo-transparent.png (width / height) —
// keep this in sync whenever the source logo is replaced, since the <image>
// elements below are given explicit width/height and won't preserve aspect
// ratio on their own.
const LOGO_RATIO = 1100 / 936;
const zsbLogo = uri(ASSETS, 'zsb-logo.jpg', 'image/jpeg');
const photos = {
  wide: uri(PHOTOS, 'hero-wide.jpg', 'image/jpeg'),
  portrait: uri(PHOTOS, 'hero-portrait.jpg', 'image/jpeg'),
  square: uri(PHOTOS, 'hero-square.jpg', 'image/jpeg'),
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(content, x, y, opts = {}) {
  const {
    size = 16, fill = PAPER, family = SANS, weight = 400,
    anchor = 'start', spacing = 0, italic = false,
  } = opts;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" `
    + `font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}"`
    + `${italic ? ' font-style="italic"' : ''}>${esc(content)}</text>`;
}

/** White strip carrying the event logo and the organizer's crest. */
function headerStrip(w, h, stripH, u) {
  const pad = w * 0.035;
  const p = [`<rect x="0" y="0" width="${w}" height="${stripH}" fill="${PAPER}"/>`];

  const logoH = stripH * 0.84;
  const logoW = logoH * LOGO_RATIO;
  p.push(`<image href="${runLogo}" x="${pad}" y="${(stripH - logoH) / 2}" width="${logoW}" height="${logoH}"/>`);

  const zsbH = stripH * 0.66;
  const zsbW = zsbH * (425 / 508);
  p.push(`<image href="${zsbLogo}" x="${w - pad - zsbW}" y="${(stripH - zsbH) / 2}" width="${zsbW}" height="${zsbH}"/>`);
  p.push(text('ORGANIZED BY', w - pad - zsbW - 14 * u, stripH * 0.44, {
    size: 15 * u, weight: 700, fill: INK_SOFT, anchor: 'end', spacing: 2 * u,
  }));
  p.push(text('ZILA SAINIK BOARD, N24 PGS', w - pad - zsbW - 14 * u, stripH * 0.68, {
    size: 16 * u, weight: 700, fill: NAVY, anchor: 'end', spacing: 1 * u,
  }));

  p.push(`<rect x="0" y="${stripH}" width="${w}" height="${4 * u}" fill="${RED}"/>`);
  return p.join('\n');
}

/** Navy action bar: fee, URL and the registration QR. */
function actionBar(w, h, barY, barH, qr, u) {
  const pad = w * 0.035;
  const qrSize = barH * 0.74;
  const p = [`<rect x="0" y="${barY}" width="${w}" height="${barH}" fill="${NAVY}"/>`];
  p.push(`<rect x="0" y="${barY}" width="${w}" height="${4 * u}" fill="${RED}"/>`);

  p.push(text('REGISTER NOW', pad, barY + barH * 0.45, {
    size: 40 * u, family: DISPLAY, weight: 700, fill: PAPER,
  }));
  p.push(text(`ENTRY ₹${FEE_RUN} RUN · ₹${FEE_WALK} WALK   ·   ${REGISTER_URL.replace(/^https?:\/\//, '')}`, pad, barY + barH * 0.75, {
    size: 19 * u, weight: 700, fill: SKY, spacing: 1.5 * u,
  }));

  p.push(`<rect x="${w - pad - qrSize}" y="${barY + (barH - qrSize) / 2}" width="${qrSize}" height="${qrSize}" fill="${PAPER}"/>`);
  p.push(`<image href="${qr}" x="${w - pad - qrSize + 5 * u}" y="${barY + (barH - qrSize) / 2 + 5 * u}" width="${qrSize - 10 * u}" height="${qrSize - 10 * u}"/>`);
  p.push(text('SCAN TO REGISTER', w - pad - qrSize - 16 * u, barY + barH * 0.58, {
    size: 17 * u, weight: 700, fill: '#C9D2E8', anchor: 'end', spacing: 2 * u,
  }));
  return p.join('\n');
}

/** Landscape: photo right, copy over a navy scrim on the left. */
function landscape(w, h, qr, photo) {
  const u = h / 628;
  const pad = w * 0.035;
  const stripH = h * 0.19;
  const barH = h * 0.20;
  const barY = h - barH;

  const p = [`<defs>
    <linearGradient id="scrim-l" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${NAVY}" stop-opacity="0.96"/>
      <stop offset="45%" stop-color="${NAVY}" stop-opacity="0.76"/>
      <stop offset="78%" stop-color="${NAVY}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${NAVY}" stop-opacity="0.06"/>
    </linearGradient>
  </defs>`];

  p.push(`<image href="${photo}" x="0" y="${stripH}" width="${w}" height="${barY - stripH}" preserveAspectRatio="xMidYMid slice"/>`);
  p.push(`<rect x="0" y="${stripH}" width="${w}" height="${barY - stripH}" fill="url(#scrim-l)"/>`);

  const midTop = stripH;
  const midH = barY - stripH;
  let y = midTop + midH * 0.30;

  p.push(text('RUN TOGETHER. STAND UNITED.', pad, y, {
    size: 23 * u, weight: 700, fill: SKY, spacing: 4 * u,
  }));
  y += 62 * u;
  p.push(text('27 SEPTEMBER 2026', pad, y, {
    size: 60 * u, family: DISPLAY, weight: 700, fill: PAPER,
  }));
  y += 42 * u;
  p.push(text('BARASAT STADIUM', pad, y, {
    size: 26 * u, weight: 700, fill: PAPER, spacing: 4 * u,
  }));
  y += 44 * u;
  p.push(text('6K RUN  ·  4K WALK', pad, y, {
    size: 26 * u, weight: 700, fill: SKY, spacing: 4 * u,
  }));

  p.push(headerStrip(w, h, stripH, u));
  p.push(actionBar(w, h, barY, barH, qr, u));
  return p.join('\n');
}

/** Portrait and square: photo fills the middle, copy over a bottom-up scrim. */
function stacked(w, h, qr, photo) {
  const u = Math.min(w / 1080, h / 1350);
  const pad = w * 0.075;
  const cx = w / 2;
  const stripH = h * 0.115;
  const barH = h * 0.135;
  const barY = h - barH;

  const p = [`<defs>
    <linearGradient id="scrim-s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}" stop-opacity="0.10"/>
      <stop offset="38%" stop-color="${NAVY}" stop-opacity="0.28"/>
      <stop offset="72%" stop-color="${NAVY}" stop-opacity="0.90"/>
      <stop offset="100%" stop-color="${NAVY}" stop-opacity="0.97"/>
    </linearGradient>
  </defs>`];

  p.push(`<image href="${photo}" x="0" y="${stripH}" width="${w}" height="${barY - stripH}" preserveAspectRatio="xMidYMid slice"/>`);
  p.push(`<rect x="0" y="${stripH}" width="${w}" height="${barY - stripH}" fill="url(#scrim-s)"/>`);

  // Copy sits in the lower half, where the scrim is densest
  let y = barY - (barY - stripH) * 0.30;
  p.push(text('RUN TOGETHER. STAND UNITED.', cx, y, {
    size: 24 * u, weight: 700, fill: SKY, anchor: 'middle', spacing: 4 * u,
  }));
  y += 88 * u;
  p.push(text('27 SEPTEMBER 2026', cx, y, {
    size: 66 * u, family: DISPLAY, weight: 700, fill: PAPER, anchor: 'middle',
  }));
  y += 48 * u;
  p.push(text('BARASAT STADIUM', cx, y, {
    size: 28 * u, weight: 700, fill: PAPER, anchor: 'middle', spacing: 5 * u,
  }));

  // Distance chips
  y += 56 * u;
  const chips = ['6K', '4K'];
  const chipH = 66 * u;
  const chipW = chipH * 2.2;
  const gap = chipW * 0.14;
  const totalW = chips.length * chipW + (chips.length - 1) * gap;
  chips.forEach((c, i) => {
    const x = cx - totalW / 2 + i * (chipW + gap);
    p.push(`<rect x="${x}" y="${y}" width="${chipW}" height="${chipH}" fill="none" stroke="${PAPER}" stroke-width="${2.5 * u}" opacity="0.9"/>`);
    p.push(text(c, x + chipW / 2, y + chipH * 0.7, {
      size: chipH * 0.5, family: DISPLAY, weight: 700, fill: PAPER, anchor: 'middle',
    }));
  });

  p.push(headerStrip(w, h, stripH, u));
  p.push(actionBar(w, h, barY, barH, qr, u));
  return p.join('\n');
}

const FORMATS = [
  { name: 'social-square',   w: 1080, h: 1080, layout: 'stacked',   photo: 'wide',     note: 'Instagram / Facebook post, WhatsApp' },
  { name: 'social-story',    w: 1080, h: 1920, layout: 'stacked',   photo: 'portrait', note: 'Instagram / WhatsApp story' },
  { name: 'meta-ad',         w: 1200, h: 628,  layout: 'landscape', photo: 'wide',     note: 'Meta / Facebook feed ad' },
  { name: 'website-banner',  w: 1920, h: 640,  layout: 'landscape', photo: 'wide',     note: 'Website hero banner' },
  { name: 'poster-a4',       w: 2480, h: 3508, layout: 'stacked',   photo: 'portrait', note: 'A4 poster, 300 dpi print' },
  { name: 'flex-banner',     w: 3000, h: 1500, layout: 'landscape', photo: 'wide',     note: 'Flex banner, 6ft x 3ft' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const qr = await QRCode.toDataURL(REGISTER_URL, {
    width: 600, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: NAVY, light: '#FFFFFF' },
  });

  for (const f of FORMATS) {
    const body = f.layout === 'stacked'
      ? stacked(f.w, f.h, qr, photos[f.photo])
      : landscape(f.w, f.h, qr, photos[f.photo]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}">\n${body}\n</svg>`;

    fs.writeFileSync(path.join(OUT, `${f.name}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${f.name}.png`));
    console.log(`${f.name.padEnd(16)} ${String(f.w).padStart(4)}x${String(f.h).padEnd(4)}  ${f.note}`);
  }

  console.log(`\nQR points to: ${REGISTER_URL}`);
  console.log(`Output: ${OUT}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
