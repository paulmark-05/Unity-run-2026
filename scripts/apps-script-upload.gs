/**
 * Unity Run 2026 — uploads and email, running in the organizer's own account.
 *
 * This handles two things the server cannot do on its own:
 *   1. Saving payment screenshots to Drive. A service account has no storage
 *      quota, so it cannot own files in a personal Google Drive; this script
 *      runs as the organizer, so the files are theirs.
 *   2. Sending email as the organizer's Gmail address, with no SMTP password
 *      stored anywhere.
 *
 * Deploy: script.google.com -> paste this -> fill in the three values below ->
 * Deploy -> New deployment -> Web app -> Execute as "Me",
 * Who has access "Anyone" -> Deploy. Put the /exec URL in APPS_SCRIPT_UPLOAD_URL.
 *
 * Then, for final confirmations, add a time-driven trigger:
 * Triggers -> Add trigger -> function `sendPendingConfirmations`,
 * event source "Time-driven", "Hour timer", every hour.
 */

const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';
const SHARED_SECRET = 'PASTE_SHARED_SECRET_HERE';
const SHEET_ID = 'PASTE_SHEET_ID_HERE';

const SHEET_TAB = 'Registrations';
const ORGANIZER_NAME = 'Zila Sainik Board, North 24 Parganas';

// Column positions, 1-based, matching the header row.
const COL = {
  slNo: 2,
  registrationId: 3,
  fullName: 4,
  email: 8,
  category: 13,
  tshirt: 14,
  fee: 15,
  paymentStatus: 23,
  confirmationSent: 26,
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ error: 'Unauthorized' });
    }

    if (body.action === 'sendMail') {
      if (!body.to || !body.subject) {
        return jsonResponse({ error: 'Missing mail fields' });
      }
      MailApp.sendEmail({ to: body.to, subject: body.subject, body: body.body || '' });
      return jsonResponse({ sent: true });
    }

    // Default action: upload a payment screenshot.
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

/**
 * Emails runners once an organizer sets their Payment Status to Confirmed
 * or Rejected. Run hourly on a time-driven trigger.
 *
 * The "Confirmation Sent" column stores which outcome was last emailed
 * (e.g. "Confirmed – 9/5/2026, 10:03:00 AM"), not just a timestamp — so a
 * row is only skipped if it's already been mailed for its *current*
 * outcome. If an organizer rejects a row and later corrects that to
 * Confirmed (or vice versa), the changed outcome no longer matches what's
 * stamped, so the right email goes out again rather than being silently
 * skipped forever.
 */
function sendPendingConfirmations() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_TAB);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = String(row[COL.paymentStatus - 1] || '').trim().toLowerCase();
    const alreadySentFor = String(row[COL.confirmationSent - 1] || '').trim().toLowerCase();
    const email = String(row[COL.email - 1] || '').trim();
    if (!email) continue;

    const confirmed = status === 'confirmed' || status === 'verified' || status === 'yes';
    const rejected = status === 'rejected';
    if (!confirmed && !rejected) continue;

    const outcome = confirmed ? 'confirmed' : 'rejected';
    if (alreadySentFor.indexOf(outcome) === 0) continue; // already mailed for this exact outcome

    const name = row[COL.fullName - 1];
    const regId = row[COL.registrationId - 1];
    const slNo = row[COL.slNo - 1];
    const category = row[COL.category - 1];
    const tshirt = row[COL.tshirt - 1];

    let subject, body;
    if (confirmed) {
      subject = 'Unity Run 2026 — registration confirmed (' + regId + ')';
      body = [
        'Dear ' + name + ',',
        '',
        'Your payment has been verified and your place in Unity Run 2026 is CONFIRMED.',
        '',
        'Registration no: ' + regId,
        'Participant no: ' + slNo,
        'Category: ' + category,
        'T-shirt size: ' + tshirt,
        '',
        'Event details',
        '  Date:     Sunday, 27 September 2026',
        '  Venue:    Barasat Stadium',
        '  Flag-off: 6:00 AM for the 6K run, followed by the 4K walk',
        '  Report:   Please arrive by 5:30 AM to collect your bib',
        '',
        'Please bring this email and a photo ID to collect your bib and T-shirt.',
        '',
        'See you there!',
        '',
        ORGANIZER_NAME,
      ].join('\n');
    } else {
      subject = 'Unity Run 2026 — payment could not be verified (' + regId + ')';
      body = [
        'Dear ' + name + ',',
        '',
        'We could not verify the payment for your Unity Run 2026 registration',
        '(no. ' + regId + ') against our bank records.',
        '',
        'Please reply to this email with a clear screenshot of your payment',
        'confirmation, showing the amount, date, and transaction/UTR reference',
        'number, so we can check it again.',
        '',
        ORGANIZER_NAME,
      ].join('\n');
    }

    MailApp.sendEmail({ to: email, subject: subject, body: body });

    sheet.getRange(i + 1, COL.confirmationSent).setValue(
      (confirmed ? 'Confirmed' : 'Rejected') + ' – ' + new Date().toLocaleString()
    );
    SpreadsheetApp.flush();
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
