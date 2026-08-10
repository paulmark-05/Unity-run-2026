/**
 * Bundles the generated campaign artwork into a single review PDF:
 * a contents page listing every asset in order, then one page per asset.
 *
 *   npm run marketing:pdf
 *
 * Run `npm run marketing` first — this reads the PNGs it produces.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const NAVY = '#1B2260';
const RED = '#C41E2A';
const INK_SOFT = '#3C424E';

const MARKETING = path.join(__dirname, '..', 'marketing');
const OUT_FILE = path.join(MARKETING, 'unity-run-2026-campaign.pdf');

const ASSETS = [
  { file: 'social-square.png',  title: 'Social post — square',   size: '1080 × 1080 px',  use: 'Instagram feed, Facebook feed, WhatsApp forward' },
  { file: 'social-story.png',   title: 'Social story',           size: '1080 × 1920 px',  use: 'Instagram story, WhatsApp status, Facebook story' },
  { file: 'meta-ad.png',        title: 'Meta / Facebook ad',     size: '1200 × 628 px',   use: 'Paid Facebook & Instagram feed ads, link previews' },
  { file: 'website-banner.png', title: 'Website banner',         size: '1920 × 640 px',   use: 'Hero banner on the registration site' },
  { file: 'poster-a4.png',      title: 'Poster — A4',            size: '2480 × 3508 px',  use: 'Printed poster, 300 dpi. Use the SVG for the printer.' },
  { file: 'flex-banner.png',    title: 'Flex banner — 6ft × 3ft', size: '3000 × 1500 px', use: 'Large-format venue banner. Use the SVG for the printer.' },
];

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 46;

function contentsPage(doc) {
  doc.rect(0, 0, A4.w, 128).fill(NAVY);
  doc.rect(0, 128, A4.w, 5).fill(RED);

  doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(28)
    .text('Unity Run 2026', MARGIN, 44);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#8FBFE0')
    .text('CAMPAIGN ARTWORK  ·  CONTENTS', MARGIN, 84, { characterSpacing: 2 });

  let y = 172;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK_SOFT)
    .text('#', MARGIN, y, { characterSpacing: 1 })
    .text('ASSET', MARGIN + 26, y, { characterSpacing: 1 })
    .text('DIMENSIONS', MARGIN + 232, y, { characterSpacing: 1 })
    .text('PAGE', A4.w - MARGIN - 34, y, { characterSpacing: 1 });

  y += 16;
  doc.moveTo(MARGIN, y).lineTo(A4.w - MARGIN, y).lineWidth(1).stroke(NAVY);
  y += 16;

  ASSETS.forEach((a, i) => {
    doc.font('Times-Bold').fontSize(12).fillColor(RED).text(String(i + 1), MARGIN, y);
    doc.font('Times-Bold').fontSize(12).fillColor(NAVY).text(a.title, MARGIN + 26, y);
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT).text(a.size, MARGIN + 232, y + 2);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(String(i + 2), A4.w - MARGIN - 34, y + 1);

    doc.font('Helvetica').fontSize(8.5).fillColor(INK_SOFT)
      .text(a.use, MARGIN + 26, y + 17, { width: A4.w - MARGIN * 2 - 90 });

    y += 44;
    doc.moveTo(MARGIN, y - 10).lineTo(A4.w - MARGIN, y - 10).lineWidth(0.5).stroke('#D8DEEA');
  });

  y += 14;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text('BEFORE PRINTING', MARGIN, y, { characterSpacing: 1.5 });
  y += 16;
  const notes = [
    'The QR code points at the registration site. Regenerate the artwork once the site is live: npm run marketing -- https://your-url',
    'For the poster and flex banner, give the printer the .svg file — it is vector and stays sharp at any size.',
    'Event details (date, venue, categories, ₹499 entry) are baked into every asset. Confirm them before any print run.',
  ];
  notes.forEach((n) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(INK_SOFT)
      .text('·  ' + n, MARGIN, y, { width: A4.w - MARGIN * 2 });
    y += doc.heightOfString('·  ' + n, { width: A4.w - MARGIN * 2 }) + 6;
  });
}

function assetPage(doc, asset, index) {
  doc.addPage();

  doc.font('Times-Bold').fontSize(17).fillColor(NAVY)
    .text(`${index + 1}.  ${asset.title}`, MARGIN, MARGIN - 8);
  doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT)
    .text(`${asset.size}   ·   ${asset.use}`, MARGIN, MARGIN + 16, { width: A4.w - MARGIN * 2 });

  const top = MARGIN + 46;
  const boxW = A4.w - MARGIN * 2;
  const boxH = A4.h - top - MARGIN - 14;

  doc.image(path.join(MARKETING, asset.file), MARGIN, top, {
    fit: [boxW, boxH],
    align: 'center',
    valign: 'center',
  });

  doc.font('Helvetica').fontSize(7.5).fillColor('#8A93A6')
    .text(asset.file, MARGIN, A4.h - MARGIN + 2);
}

const missing = ASSETS.filter((a) => !fs.existsSync(path.join(MARKETING, a.file)));
if (missing.length) {
  console.error(`Missing artwork: ${missing.map((m) => m.file).join(', ')}\nRun "npm run marketing" first.`);
  process.exit(1);
}

const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
doc.pipe(fs.createWriteStream(OUT_FILE));
contentsPage(doc);
ASSETS.forEach((a, i) => assetPage(doc, a, i));
doc.end();

console.log(`PDF written to ${OUT_FILE}`);
console.log(`${ASSETS.length} assets + contents page`);
