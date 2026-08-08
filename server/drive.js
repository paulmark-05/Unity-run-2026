/**
 * Uploads payment screenshots into the organizer's Drive folder.
 *
 * Uploads go through a Google Apps Script web app rather than the Drive API
 * directly: a service account has no storage quota of its own, so it cannot
 * own files in a personal Google Drive. The Apps Script runs as the organizer,
 * so the files are owned by — and stored against — that account.
 * See scripts/apps-script-upload.gs.
 */

async function uploadPaymentScreenshot(file, registrationId) {
  const endpoint = process.env.APPS_SCRIPT_UPLOAD_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;

  if (!endpoint || !secret) {
    throw new Error('APPS_SCRIPT_UPLOAD_URL / APPS_SCRIPT_SECRET are not set');
  }

  const extension = (file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      filename: `${registrationId}${extension}`,
      mimeType: file.mimetype,
      data: file.buffer.toString('base64'),
    }),
  });

  if (!res.ok) {
    throw new Error(`Upload endpoint returned ${res.status}`);
  }

  const result = await res.json();
  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.url) {
    throw new Error('Upload endpoint did not return a file URL');
  }

  return result.url;
}

module.exports = { uploadPaymentScreenshot };
