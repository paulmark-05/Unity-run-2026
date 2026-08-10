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
 * The artwork is built around an illustrated scene: a road curving to a city
 * horizon with runners receding along it. The runner is the figure from the
 * event logo, lifted out by colour and reused as a flat silhouette.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const REGISTER_URL = process.argv[2] || 'https://unity-run-2026.onrender.com';
const FEE = 499;

const NAVY = '#1B2260';
const RED = '#C41E2A';
const SKY = '#46AEE0';
const INK_SOFT = '#3C424E';
const PAPER = '#FFFFFF';
const CREAM = '#FDF3EA';
const SKYLINE = '#AEB6DC';
const ROAD = '#E8EBF3';

const DISPLAY = 'Georgia, serif';
const SANS = 'Arial, Helvetica, sans-serif';

const ASSETS = path.join(__dirname, '..', 'public', 'assets');
const OUT = path.join(__dirname, '..', 'marketing');

const dataUri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(ASSETS, file)).toString('base64')}`;

const runLogo = dataUri('unity-run-logo-transparent.png', 'image/png');
const zsbLogo = dataUri('zsb-logo.jpg', 'image/jpeg');
const runnerNavy = dataUri('runner-navy.png', 'image/png');
const runnerSky = dataUri('runner-sky.png', 'image/png');
const RUNNER_RATIO = 651 / 576; // height / width

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(content, x, y, opts = {}) {
  const {
    size = 16, fill = NAVY, family = SANS, weight = 400,
    anchor = 'start', spacing = 0, italic = false,
  } = opts;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" `
    + `font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}"`
    + `${italic ? ' font-style="italic"' : ''}>${esc(content)}</text>`;
}

/** A runner standing on the road: x/feetY are absolute, height is in px. */
function runner(x, feetY, height, image) {
  const w = height / RUNNER_RATIO;
  return `<image href="${image}" x="${x - w / 2}" y="${feetY - height}" width="${w}" height="${height}"/>`;
}

/**
 * The illustrated band: a pack of runners on a track, receding to the right.
 * Strictly contained between topY and bottomY so it never collides with type.
 */
function scene(w, topY, bottomY, id) {
  const h = bottomY - topY;
  const ground = bottomY - h * 0.16; // baseline the runners stand on
  const p = [];

  p.push(`<defs>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${CREAM}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${CREAM}"/>
    </linearGradient>
    <clipPath id="scene-${id}"><rect x="0" y="${topY}" width="${w}" height="${h}"/></clipPath>
  </defs>`);

  p.push(`<g clip-path="url(#scene-${id})">`);
  p.push(`<rect x="0" y="${topY}" width="${w}" height="${h}" fill="url(#sky-${id})"/>`);

  // Track: a plain ground plane with a single lane rule. Deliberately sparse —
  // anything busier competes with the runners.
  p.push(`<rect x="0" y="${ground}" width="${w}" height="${bottomY - ground}" fill="${ROAD}"/>`);
  p.push(`<rect x="0" y="${ground}" width="${w}" height="${h * 0.018}" fill="${SKY}" opacity="0.75"/>`);

  // The pack: tallest at the left, receding to the right. Feet on the baseline.
  const pack = [
    { x: 0.13, s: 0.86, img: runnerNavy },
    { x: 0.34, s: 0.68, img: runnerNavy },
    { x: 0.51, s: 0.54, img: runnerNavy },
    { x: 0.65, s: 0.42, img: runnerSky },
    { x: 0.76, s: 0.32, img: runnerSky },
    { x: 0.85, s: 0.24, img: runnerSky },
  ];
  pack.forEach((r) => {
    p.push(runner(w * r.x, ground + h * 0.01, h * r.s, r.img));
  });

  p.push(`</g>`);
  return p.join('\n');
}

/** Stacked layout — squares, stories, posters. */
function stacked(w, h, qr) {
  const pad = w * 0.075;
  const cx = w / 2;
  const u = Math.min(w / 1080, h / 1350);

  const footerH = h * 0.145;
  const sceneBottom = h - footerH;
  const sceneTop = sceneBottom - h * 0.20;

  const parts = [`<rect width="${w}" height="${h}" fill="${PAPER}"/>`];
  parts.push(scene(w, sceneTop, sceneBottom, 'p'));

  // Header — organizer identity
  let y = pad * 0.9;
  const zsbH = h * 0.072;
  const zsbW = zsbH * (425 / 508);
  parts.push(`<image href="${zsbLogo}" x="${cx - zsbW / 2}" y="${y}" width="${zsbW}" height="${zsbH}"/>`);
  y += zsbH + 26 * u;
  parts.push(text('ORGANIZED BY ZILA SAINIK BOARD, NORTH 24 PARGANAS', cx, y, {
    size: 19 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'middle', spacing: 3 * u,
  }));

  // Event logo
  y += 24 * u;
  const logoW = Math.min(w - pad * 2, (h * 0.20) * (1100 / 728));
  const logoH = logoW * (728 / 1100);
  parts.push(`<image href="${runLogo}" x="${cx - logoW / 2}" y="${y}" width="${logoW}" height="${logoH}"/>`);
  y += logoH + 40 * u;

  parts.push(`<rect x="${cx - 80 * u}" y="${y}" width="${160 * u}" height="${5 * u}" fill="${RED}"/>`);
  y += 46 * u;
  parts.push(text('RUN TOGETHER. STAND UNITED.', cx, y, {
    size: 36 * u, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle',
  }));

  y += 84 * u;
  parts.push(text('20 SEPTEMBER 2026', cx, y, {
    size: 58 * u, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle',
  }));
  y += 44 * u;
  parts.push(text('BARASAT STADIUM', cx, y, {
    size: 27 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'middle', spacing: 6 * u,
  }));

  // Distance chips
  y += 44 * u;
  const chips = ['3K', '5K', '10K'];
  const chipH = 64 * u;
  const chipW = chipH * 2.2;
  const gap = chipW * 0.14;
  const totalW = chips.length * chipW + (chips.length - 1) * gap;
  chips.forEach((c, i) => {
    const x = cx - totalW / 2 + i * (chipW + gap);
    parts.push(`<rect x="${x}" y="${y}" width="${chipW}" height="${chipH}" fill="${PAPER}" stroke="${NAVY}" stroke-width="${2.5 * u}"/>`);
    parts.push(text(c, x + chipW / 2, y + chipH * 0.7, {
      size: chipH * 0.5, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle',
    }));
  });

  // Footer band
  const bandY = h - footerH;
  const qrSize = footerH * 0.72;
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${footerH}" fill="${NAVY}"/>`);
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${6 * u}" fill="${RED}"/>`);
  parts.push(`<rect x="${w - pad - qrSize}" y="${bandY + (footerH - qrSize) / 2}" width="${qrSize}" height="${qrSize}" fill="#fff"/>`);
  parts.push(`<image href="${qr}" x="${w - pad - qrSize + 5 * u}" y="${bandY + (footerH - qrSize) / 2 + 5 * u}" width="${qrSize - 10 * u}" height="${qrSize - 10 * u}"/>`);

  parts.push(text('REGISTER NOW', pad, bandY + footerH * 0.44, {
    size: 42 * u, family: DISPLAY, weight: 700, fill: '#fff',
  }));
  parts.push(text(`ENTRY ₹${FEE}   ·   SCAN TO REGISTER`, pad, bandY + footerH * 0.68, {
    size: 21 * u, family: SANS, weight: 700, fill: SKY, spacing: 2 * u,
  }));
  parts.push(text(REGISTER_URL.replace(/^https?:\/\//, ''), pad, bandY + footerH * 0.88, {
    size: 18 * u, family: SANS, fill: '#C9D2E8',
  }));

  return parts.join('\n');
}

/** Full-bleed scene with details overlaid — ads, website and flex banners. */
function landscape(w, h, qr) {
  const u = h / 628;
  const pad = w * 0.045;
  const footerH = h * 0.155;

  const parts = [`<rect width="${w}" height="${h}" fill="${PAPER}"/>`];
  // Runner band sits in the lower portion only — type lives above it.
  parts.push(scene(w, h * 0.38, h - footerH, 'l'));

  // Event logo, upper left — height-capped so it can't push the details
  // block down into the runner band.
  const topZone = h * 0.46;
  const logoH = Math.min(topZone * 0.62, w * 0.20 * (728 / 1100));
  const logoW = logoH * (1100 / 728);
  parts.push(`<image href="${runLogo}" x="${pad}" y="${h * 0.06}" width="${logoW}" height="${logoH}"/>`);

  // Organizer, upper right
  const zsbH = h * 0.13;
  const zsbW = zsbH * (425 / 508);
  parts.push(`<image href="${zsbLogo}" x="${w - pad - zsbW}" y="${h * 0.07}" width="${zsbW}" height="${zsbH}"/>`);
  parts.push(text('ORGANIZED BY', w - pad - zsbW - 14 * u, h * 0.07 + zsbH * 0.42, {
    size: 15 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'end', spacing: 2 * u,
  }));
  parts.push(text('ZILA SAINIK BOARD, N24 PGS', w - pad - zsbW - 14 * u, h * 0.07 + zsbH * 0.72, {
    size: 15 * u, family: SANS, weight: 700, fill: NAVY, anchor: 'end', spacing: 1 * u,
  }));

  // Details sit beside the logo, keeping the whole block clear of the runners
  const dx = pad + logoW + w * 0.05;
  let y = h * 0.06 + logoH * 0.42;
  parts.push(text('RUN TOGETHER. STAND UNITED.', dx, y, {
    size: 24 * u, family: SANS, weight: 700, fill: RED, spacing: 3 * u,
  }));
  y += 52 * u;
  parts.push(text('20 SEPTEMBER 2026', dx, y, {
    size: 48 * u, family: DISPLAY, weight: 700, fill: NAVY,
  }));
  y += 36 * u;
  parts.push(text('BARASAT STADIUM  ·  3K · 5K · 10K', dx, y, {
    size: 22 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
  }));
  y += 32 * u;
  parts.push(text(`ENTRY ₹${FEE}`, dx, y, {
    size: 23 * u, family: SANS, weight: 700, fill: RED, spacing: 2 * u,
  }));

  // Footer band
  const bandY = h - footerH;
  const qrSize = footerH * 0.74;
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${footerH}" fill="${NAVY}"/>`);
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${5 * u}" fill="${RED}"/>`);
  parts.push(text('REGISTER NOW', pad, bandY + footerH * 0.48, {
    size: 40 * u, family: DISPLAY, weight: 700, fill: '#fff',
  }));
  parts.push(text(REGISTER_URL.replace(/^https?:\/\//, ''), pad, bandY + footerH * 0.78, {
    size: 19 * u, family: SANS, weight: 700, fill: SKY, spacing: 1 * u,
  }));
  parts.push(`<rect x="${w - pad - qrSize}" y="${bandY + (footerH - qrSize) / 2}" width="${qrSize}" height="${qrSize}" fill="#fff"/>`);
  parts.push(`<image href="${qr}" x="${w - pad - qrSize + 5 * u}" y="${bandY + (footerH - qrSize) / 2 + 5 * u}" width="${qrSize - 10 * u}" height="${qrSize - 10 * u}"/>`);
  parts.push(text('SCAN TO REGISTER', w - pad - qrSize - 16 * u, bandY + footerH * 0.62, {
    size: 18 * u, family: SANS, weight: 700, fill: '#C9D2E8', anchor: 'end', spacing: 2 * u,
  }));

  return parts.join('\n');
}

const FORMATS = [
  { name: 'social-square',   w: 1080, h: 1080, layout: 'stacked',   note: 'Instagram / Facebook post, WhatsApp' },
  { name: 'social-story',    w: 1080, h: 1920, layout: 'stacked',   note: 'Instagram / WhatsApp story' },
  { name: 'meta-ad',         w: 1200, h: 628,  layout: 'landscape', note: 'Meta / Facebook feed ad' },
  { name: 'website-banner',  w: 1920, h: 640,  layout: 'landscape', note: 'Website hero banner' },
  { name: 'poster-a4',       w: 2480, h: 3508, layout: 'stacked',   note: 'A4 poster, 300 dpi print' },
  { name: 'flex-banner',     w: 3000, h: 1500, layout: 'landscape', note: 'Flex banner, 6ft x 3ft' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const qr = await QRCode.toDataURL(REGISTER_URL, {
    width: 600, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: NAVY, light: '#FFFFFF' },
  });

  for (const f of FORMATS) {
    const body = f.layout === 'stacked' ? stacked(f.w, f.h, qr) : landscape(f.w, f.h, qr);
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
