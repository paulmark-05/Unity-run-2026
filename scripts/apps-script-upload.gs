/**
 * Unity Run 2026 — payment screenshot upload endpoint.
 *
 * This runs inside the organizer's own Google account, so uploaded files are
 * owned by that account and use its Drive storage. (A service account can't do
 * this — it has no storage quota of its own.)
 *
 * Deploy: script.google.com → paste this → Deploy → New deployment →
 * type "Web app" → Execute as "Me" → Who has access "Anyone" → Deploy.
 * Then put the resulting /exec URL in the server's APPS_SCRIPT_UPLOAD_URL.
 */

// Fill both of these in inside the Apps Script editor before deploying.
// They are deliberately not committed: SHARED_SECRET must match APPS_SCRIPT_SECRET
// in the server's .env, and FOLDER_ID is the Drive folder screenshots go into.
const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';
const SHARED_SECRET = 'PASTE_SHARED_SECRET_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ error: 'Unauthorized' });
    }
    if (!body.data || !body.filename) {
      return jsonResponse({ error: 'Missing file data' });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const blob = Utilities.newBlob(
      Utilities.base64Decode(body.data),
      body.mimeType || 'image/png',
      body.filename
    );
    const file = folder.createFile(blob);

    return jsonResponse({ url: file.getUrl() });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
