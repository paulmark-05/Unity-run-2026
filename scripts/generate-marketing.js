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
const INK = '#14161C';
const INK_SOFT = '#3C424E';
const PAPER = '#FFFFFF';

const DISPLAY = 'Georgia, serif';
const SANS = 'Arial, Helvetica, sans-serif';

const ASSETS = path.join(__dirname, '..', 'public', 'assets');
const OUT = path.join(__dirname, '..', 'marketing');

const dataUri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(ASSETS, file)).toString('base64')}`;

const runLogo = dataUri('unity-run-logo.jpg', 'image/jpeg');
const zsbLogo = dataUri('zsb-logo.jpg', 'image/jpeg');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(content, x, y, opts = {}) {
  const {
    size = 16, fill = INK, family = SANS, weight = 400,
    anchor = 'start', spacing = 0, italic = false,
  } = opts;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" `
    + `font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}"`
    + `${italic ? ' font-style="italic"' : ''}>${esc(content)}</text>`;
}

/** Stacked layout — squares, stories, posters. */
function stacked(w, h, qr) {
  const pad = w * 0.075;
  const cx = w / 2;
  // Type scales with width, but is held back on tall canvases so a story or a
  // poster doesn't end up with headline text the size of the logo.
  const u = Math.min(w / 1080, h / 1350);

  // Vertical budget as fractions of the canvas — keeps every format in bounds.
  const BANDS = { header: 0.155, logo: 0.28, tagline: 0.07, when: 0.17, cats: 0.15, footer: 0.175 };
  const top = {};
  let acc = 0;
  for (const [k, v] of Object.entries(BANDS)) { top[k] = h * acc; acc += v; }

  const parts = [`<rect width="${w}" height="${h}" fill="${PAPER}"/>`];

  // Header — organizer identity
  const headerH = h * BANDS.header;
  const zsbH = headerH * 0.52;
  const zsbW = zsbH * (425 / 508);
  parts.push(`<image href="${zsbLogo}" x="${cx - zsbW / 2}" y="${top.header + headerH * 0.14}" width="${zsbW}" height="${zsbH}"/>`);
  parts.push(text('ORGANIZED BY ZILA SAINIK BOARD, NORTH 24 PARGANAS', cx, top.header + headerH * 0.88, {
    size: 20 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'middle', spacing: 3 * u,
  }));

  // Logo — fitted inside its band
  const logoBandH = h * BANDS.logo;
  const logoW = Math.min(w - pad * 2, logoBandH * 0.94 * (1100 / 729));
  const logoH = logoW * (729 / 1100);
  parts.push(`<image href="${runLogo}" x="${cx - logoW / 2}" y="${top.logo + (logoBandH - logoH) / 2}" width="${logoW}" height="${logoH}"/>`);

  // Tagline
  const tagH = h * BANDS.tagline;
  parts.push(`<rect x="${cx - 90 * u}" y="${top.tagline + tagH * 0.16}" width="${180 * u}" height="${5 * u}" fill="${RED}"/>`);
  parts.push(text('RUN TOGETHER. STAND UNITED.', cx, top.tagline + tagH * 0.86, {
    size: 38 * u, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle',
  }));

  // Date and venue
  const whenH = h * BANDS.when;
  parts.push(text('20 SEPTEMBER 2026', cx, top.when + whenH * 0.46, {
    size: 62 * u, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle', spacing: 1 * u,
  }));
  parts.push(text('BARASAT STADIUM', cx, top.when + whenH * 0.78, {
    size: 30 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'middle', spacing: 6 * u,
  }));

  // Category chips
  const catsH = h * BANDS.cats;
  const chips = ['3K', '5K', '10K'];
  const chipH = Math.min(74 * u, catsH * 0.46);
  const chipW = chipH * 2.3;
  const gap = chipW * 0.14;
  const totalW = chips.length * chipW + (chips.length - 1) * gap;
  const chipY = top.cats + catsH * 0.1;
  chips.forEach((c, i) => {
    const x = cx - totalW / 2 + i * (chipW + gap);
    parts.push(`<rect x="${x}" y="${chipY}" width="${chipW}" height="${chipH}" fill="none" stroke="${NAVY}" stroke-width="${2.5 * u}"/>`);
    parts.push(text(c, x + chipW / 2, chipY + chipH * 0.7, {
      size: chipH * 0.52, family: DISPLAY, weight: 700, fill: NAVY, anchor: 'middle',
    }));
  });
  parts.push(text('FUN RUN  ·  TIMED RUNS  ·  OPEN TO ALL AGES', cx, chipY + chipH + catsH * 0.28, {
    size: 21 * u, family: SANS, weight: 700, fill: INK_SOFT, anchor: 'middle', spacing: 3 * u,
  }));

  // Footer band
  const bandH = h * BANDS.footer;
  const bandY = h - bandH;
  const qrSize = bandH * 0.66;
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${bandH}" fill="${NAVY}"/>`);
  parts.push(`<rect x="0" y="${bandY}" width="${w}" height="${6 * u}" fill="${RED}"/>`);
  parts.push(`<rect x="${w - pad - qrSize}" y="${bandY + (bandH - qrSize) / 2}" width="${qrSize}" height="${qrSize}" fill="#fff"/>`);
  parts.push(`<image href="${qr}" x="${w - pad - qrSize + 6 * u}" y="${bandY + (bandH - qrSize) / 2 + 6 * u}" width="${qrSize - 12 * u}" height="${qrSize - 12 * u}"/>`);

  parts.push(text('REGISTER NOW', pad, bandY + bandH * 0.42, {
    size: 44 * u, family: DISPLAY, weight: 700, fill: '#fff',
  }));
  parts.push(text(`ENTRY ₹${FEE}   ·   SCAN TO REGISTER`, pad, bandY + bandH * 0.64, {
    size: 22 * u, family: SANS, weight: 700, fill: SKY, spacing: 2 * u,
  }));
  parts.push(text(REGISTER_URL.replace(/^https?:\/\//, ''), pad, bandY + bandH * 0.84, {
    size: 20 * u, family: SANS, weight: 400, fill: '#C9D2E8',
  }));

  return parts.join('\n');
}

/** Split layout — Meta ads, website banners, flex banners. */
function landscape(w, h, qr) {
  const u = h / 628;
  const pad = h * 0.09;
  const parts = [`<rect width="${w}" height="${h}" fill="${PAPER}"/>`];

  // Left: the logo panel. Kept white — the logo artwork has a white background,
  // so any tint would show as a box around it.
  const leftW = w * 0.42;
  parts.push(`<rect x="${leftW - 5 * u}" y="0" width="${5 * u}" height="${h}" fill="${RED}"/>`);
  const logoW = leftW * 0.78;
  const logoH = logoW * (729 / 1100);
  parts.push(`<image href="${runLogo}" x="${(leftW - logoW) / 2}" y="${(h - logoH) / 2}" width="${logoW}" height="${logoH}"/>`);

  // Right: details
  const rx = leftW + pad;
  let y = pad + 40 * u;

  const zsbW = 62 * u;
  parts.push(`<image href="${zsbLogo}" x="${rx}" y="${y - 46 * u}" width="${zsbW}" height="${zsbW * (508 / 425)}"/>`);
  parts.push(text('ORGANIZED BY ZILA SAINIK BOARD', rx + zsbW + 16 * u, y - 14 * u, {
    size: 15 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
  }));
  parts.push(text('NORTH 24 PARGANAS', rx + zsbW + 16 * u, y + 8 * u, {
    size: 15 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
  }));

  y += 92 * u;
  parts.push(text('Run together.', rx, y, { size: 54 * u, family: DISPLAY, weight: 700, fill: NAVY }));
  y += 58 * u;
  parts.push(text('Stand united.', rx, y, { size: 54 * u, family: DISPLAY, weight: 700, fill: RED, italic: true }));

  y += 62 * u;
  parts.push(text('20 SEPTEMBER 2026  ·  BARASAT STADIUM', rx, y, {
    size: 22 * u, family: SANS, weight: 700, fill: INK, spacing: 2 * u,
  }));
  y += 40 * u;
  parts.push(text('3K  ·  5K  ·  10K', rx, y, {
    size: 22 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
  }));
  parts.push(text(`ENTRY ₹${FEE}`, rx + 230 * u, y, {
    size: 22 * u, family: SANS, weight: 700, fill: RED, spacing: 2 * u,
  }));

  // CTA + QR
  const btnH = 76 * u;
  const btnW = 300 * u;
  const btnY = h - pad - btnH;
  parts.push(`<rect x="${rx}" y="${btnY}" width="${btnW}" height="${btnH}" fill="${RED}"/>`);
  parts.push(text('REGISTER NOW', rx + btnW / 2, btnY + btnH * 0.63, {
    size: 26 * u, family: SANS, weight: 700, fill: '#fff', anchor: 'middle', spacing: 3 * u,
  }));

  const qrSize = btnH * 1.35;
  parts.push(`<image href="${qr}" x="${rx + btnW + 28 * u}" y="${btnY + btnH - qrSize}" width="${qrSize}" height="${qrSize}"/>`);
  parts.push(text('SCAN TO', rx + btnW + 28 * u + qrSize + 16 * u, btnY + btnH - qrSize * 0.55, {
    size: 17 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
  }));
  parts.push(text('REGISTER', rx + btnW + 28 * u + qrSize + 16 * u, btnY + btnH - qrSize * 0.25, {
    size: 17 * u, family: SANS, weight: 700, fill: INK_SOFT, spacing: 2 * u,
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
