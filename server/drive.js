const { Readable } = require('stream');
const { google } = require('googleapis');

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
}

/**
 * Uploads a payment screenshot to the configured Drive folder.
 * Returns a link the organizers can open from the spreadsheet.
 */
async function uploadPaymentScreenshot(file, registrationId) {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');
  }
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const extension = (file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];
  const res = await drive.files.create({
    requestBody: {
      name: `${registrationId}${extension}`,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: 'id, webViewLink',
  });

  return res.data.webViewLink;
}

module.exports = { uploadPaymentScreenshot };
