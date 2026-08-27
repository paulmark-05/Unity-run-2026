/**
 * Downloads every image from a shared Google Drive folder into
 * public/assets/gallery/<year>/, re-encoded for the web, plus thumbnails
 * and a manifest.json the gallery section reads at runtime.
 *
 * Usage:
 *   npm run gallery -- 2025 1L7g4_ATwvOAGuYloADc8vYOGhktt3Vu4
 *
 * The folder just needs "Anyone with the link can view" sharing — the
 * service account can read those without being added as a collaborator.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const sharp = require('sharp');

const [, , year, folderId] = process.argv;
if (!year || !folderId) {
  console.error('Usage: npm run gallery -- <year> <drive-folder-id>');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'gallery', year);
const OUT_DIR_THUMB = path.join(OUT_DIR, 'thumb');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR_THUMB, { recursive: true });

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
    orderBy: 'name',
  });

  const files = res.data.files.filter((f) => f.mimeType.startsWith('image/'));
  console.log(`Downloading ${files.length} images for ${year}...`);

  const manifest = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const outName = `${year}-${String(i + 1).padStart(2, '0')}.jpg`;
    const outPath = path.join(OUT_DIR, outName);
    const thumbPath = path.join(OUT_DIR_THUMB, outName);

    const resp = await drive.files.get(
      { fileId: f.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(resp.data);
    const meta = await sharp(buffer).metadata();
    const orientedWidth = meta.orientation && meta.orientation >= 5 ? meta.height : meta.width;

    // Full-size: cap at 1920px wide, re-encode as JPEG q82 to keep page weight sane.
    await sharp(buffer)
      .rotate()
      .resize({ width: Math.min(orientedWidth || 1920, 1920), withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outPath);

    // Thumbnail: for carousel dot/grid previews, small + fast.
    await sharp(buffer)
      .rotate()
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toFile(thumbPath);

    const outStat = fs.statSync(outPath);
    console.log(`${f.name} -> ${outName} (${(outStat.size / 1024).toFixed(0)} KB)`);
    manifest.push({ file: outName, thumb: `thumb/${outName}` });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Wrote manifest.json with', manifest.length, 'entries.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
