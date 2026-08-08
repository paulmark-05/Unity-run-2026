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

const FOLDER_ID = '1EE-YOBK9mFiN6HFAxM3__hw5ne_x-N1F';
const SHARED_SECRET = '6764c4ad18a9168b47bcb39d845c91b3b25ee0ec0b8049ae';

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
