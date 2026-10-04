const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const sharp = require('sharp');
const { pipeline } = require('stream/promises');

const GALLERY_YEAR = process.env.GALLERY_YEAR || '2026';
const GALLERY_FOLDER_ID = process.env.GOOGLE_GALLERY_FOLDER_ID || '';
const GALLERY_DIR = path.join(__dirname, '..', 'public', 'assets', 'gallery', GALLERY_YEAR);
const THUMB_DIR = path.join(GALLERY_DIR, 'thumb');
const STATE_FILE = path.join(__dirname, '..', `.gallery-sync-state-${GALLERY_YEAR}.json`);
const MAX_VIDEO_BYTES = Math.max(1, Number(process.env.GALLERY_MAX_VIDEO_MB || 250)) * 1024 * 1024;

const syncStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  count: 0,
  images: 0,
  videos: 0,
  removed: 0,
};

function parseServiceAccount() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const encoded = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();

  if (!raw && !encoded) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) is not set');
  }

  let credentials;
  try {
    if (raw) {
      credentials = JSON.parse(raw);
    } else {
      credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    }
  } catch (err) {
    throw new Error(`Google service-account credentials are not valid JSON: ${err.message}`);
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google service-account credentials are missing client_email or private_key');
  }

  credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
  return credentials;
}

function getAuth() {
  const credentials = parseServiceAccount();
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return { files: {} }; }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function safeOutputName(index) {
  return `${GALLERY_YEAR}-${String(index + 1).padStart(2, '0')}.jpg`;
}

function safeVideoName(index, mimeType, originalName) {
  const extFromName = path.extname(originalName || '').toLowerCase();
  const ext = extFromName && /^[.][a-z0-9]{2,5}$/.test(extFromName)
    ? extFromName
    : (mimeType === 'video/webm' ? '.webm' : mimeType === 'video/quicktime' ? '.mov' : '.mp4');
  return `${GALLERY_YEAR}-video-${String(index + 1).padStart(2, '0')}${ext}`;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function writeVideoThumb(outPath, title) {
  const safeTitle = escapeXml(title || 'Unity Run event video').slice(0, 42);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#10153F"/>
  <rect x="34" y="34" width="892" height="472" rx="18" fill="#1B2260" stroke="#46AEE0" stroke-width="3"/>
  <circle cx="480" cy="245" r="72" fill="#C41E2A"/>
  <polygon points="458,207 458,283 520,245" fill="#FFFFFF"/>
  <text x="480" y="380" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="26" font-weight="700">UNITY RUN 2026</text>
  <text x="480" y="420" text-anchor="middle" fill="#DDEEFF" font-family="Arial, sans-serif" font-size="20">${safeTitle}</text>
</svg>`;
  fs.writeFileSync(outPath, svg);
}

async function listMedia(drive) {
  if (!GALLERY_FOLDER_ID) throw new Error('GOOGLE_GALLERY_FOLDER_ID is not set');

  const files = [];
  const foldersToVisit = [GALLERY_FOLDER_ID];
  const visitedFolders = new Set();

  while (foldersToVisit.length) {
    const parentId = foldersToVisit.pop();
    if (!parentId || visitedFolders.has(parentId)) continue;
    visitedFolders.add(parentId);

    let pageToken;
    do {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, size)',
        pageSize: 1000,
        orderBy: 'name_natural, name',
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of res.data.files || []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          foldersToVisit.push(file.id);
          continue;
        }

        if ((file.mimeType && file.mimeType.startsWith('image/')) ||
            (file.mimeType && file.mimeType.startsWith('video/'))) {
          files.push(file);
        }
      }

      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  return files;
}

async function downloadDriveFile(drive, fileId, outPath) {
  const resp = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await pipeline(resp.data, fs.createWriteStream(outPath));
}

async function syncGalleryYear() {
  syncStatus.running = true;
  syncStatus.lastRunAt = new Date().toISOString();
  syncStatus.lastError = null;

  try {
    if (!GALLERY_FOLDER_ID) {
      console.warn('Gallery sync skipped: GOOGLE_GALLERY_FOLDER_ID is not set.');
      return { skipped: true, reason: 'missing folder id' };
    }

    fs.mkdirSync(GALLERY_DIR, { recursive: true });
    fs.mkdirSync(THUMB_DIR, { recursive: true });

    const drive = google.drive({ version: 'v3', auth: getAuth() });
    const folder = await drive.files.get({
      fileId: GALLERY_FOLDER_ID,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    if (folder.data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`GOOGLE_GALLERY_FOLDER_ID is not a folder: ${folder.data.name || GALLERY_FOLDER_ID}`);
    }
    const sourceFiles = await listMedia(drive);
    const previous = readState();
    const previousFiles = previous.files || {};
    const currentIds = new Set(sourceFiles.map((f) => f.id));
    const usedNames = new Set();
    const nextState = { files: {} };
    const manifest = [];
    let nextImageIndex = 0;
    let nextVideoIndex = 0;

    const allocateImageName = () => {
      while (true) {
        const name = safeOutputName(nextImageIndex++);
        if (!usedNames.has(name)) return name;
      }
    };
    const allocateVideoName = (mimeType, originalName) => {
      while (true) {
        const name = safeVideoName(nextVideoIndex++, mimeType, originalName);
        if (!usedNames.has(name)) return name;
      }
    };

    for (const file of sourceFiles) {
      const isVideo = file.mimeType.startsWith('video/');
      if (isVideo && Number(file.size || 0) > MAX_VIDEO_BYTES) {
        console.warn(`Gallery video skipped (over ${MAX_VIDEO_BYTES / 1024 / 1024} MB): ${file.name}`);
        const old = previousFiles[file.id];
        if (old) {
          for (const candidate of [old.file ? path.join(GALLERY_DIR, old.file) : null, old.thumb ? path.join(GALLERY_DIR, old.thumb) : null]) {
            if (!candidate) continue;
            try { fs.unlinkSync(candidate); } catch (_) {}
          }
        }
        continue;
      }

      const old = previousFiles[file.id];
      const sameType = old && old.type === (isVideo ? 'video' : 'image');
      const outName = sameType && old.file
        ? old.file
        : (isVideo ? allocateVideoName(file.mimeType, file.name) : allocateImageName());
      usedNames.add(outName);
      const outPath = path.join(GALLERY_DIR, outName);
      const thumbExt = isVideo ? '.svg' : '.jpg';
      const thumbName = old && old.thumb ? path.basename(old.thumb) : `${path.basename(outName, path.extname(outName))}${thumbExt}`;
      const thumbPath = path.join(THUMB_DIR, thumbName);
      const unchanged = old &&
        old.modifiedTime === file.modifiedTime &&
        old.md5Checksum === (file.md5Checksum || '') &&
        fs.existsSync(outPath) && fs.existsSync(thumbPath);

      if (!unchanged) {
        if (isVideo) {
          await downloadDriveFile(drive, file.id, outPath);
          writeVideoThumb(thumbPath, file.name);
        } else {
          const resp = await drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(resp.data);
          const meta = await sharp(buffer).metadata();
          const orientedWidth = meta.orientation && meta.orientation >= 5 ? meta.height : meta.width;
          await sharp(buffer)
            .rotate()
            .resize({ width: Math.min(orientedWidth || 1920, 1920), withoutEnlargement: true })
            .jpeg({ quality: 82, mozjpeg: true })
            .toFile(outPath);
          await sharp(buffer)
            .rotate()
            .resize({ width: 480, withoutEnlargement: true })
            .jpeg({ quality: 75, mozjpeg: true })
            .toFile(thumbPath);
        }
      }

      nextState.files[file.id] = {
        file: outName,
        thumb: `thumb/${thumbName}`,
        modifiedTime: file.modifiedTime || '',
        md5Checksum: file.md5Checksum || '',
        name: file.name,
        mimeType: file.mimeType,
        type: isVideo ? 'video' : 'image',
      };
      manifest.push({
        type: isVideo ? 'video' : 'image',
        source: 'drive',
        file: outName,
        thumb: `thumb/${thumbName}`,
        name: file.name,
        mimeType: file.mimeType,
      });
    }

    const removedIds = Object.keys(previousFiles).filter((id) => !currentIds.has(id));
    for (const id of removedIds) {
      const old = previousFiles[id];
      for (const candidate of [old && old.file ? path.join(GALLERY_DIR, old.file) : null,
        old && old.thumb ? path.join(GALLERY_DIR, old.thumb) : null]) {
        if (!candidate) continue;
        try { fs.unlinkSync(candidate); } catch (_) {}
      }
    }

    fs.writeFileSync(path.join(GALLERY_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeState(nextState);

    const result = {
      skipped: false,
      count: manifest.length,
      images: manifest.filter((m) => m.type === 'image').length,
      videos: manifest.filter((m) => m.type === 'video').length,
      removed: removedIds.length,
    };

    syncStatus.lastSuccessAt = new Date().toISOString();
    syncStatus.lastError = null;
    syncStatus.count = result.count;
    syncStatus.images = result.images;
    syncStatus.videos = result.videos;
    syncStatus.removed = result.removed;
    return result;
  } catch (err) {
    syncStatus.lastError = err.message || String(err);
    throw err;
  } finally {
    syncStatus.running = false;
  }
}

function getGallerySyncStatus() {
  return { ...syncStatus, folderConfigured: Boolean(GALLERY_FOLDER_ID), year: GALLERY_YEAR };
}

module.exports = { syncGalleryYear, getGallerySyncStatus, GALLERY_YEAR };
