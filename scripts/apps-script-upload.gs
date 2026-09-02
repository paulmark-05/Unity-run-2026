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
const LOGO_URL = 'https://unity-run-2026.zsb-barasat.in/assets/zsb-logo-transparent.png';

/**
 * Wraps a block of content HTML in the branded email shell (logo + "ZSB
 * North 24 Parganas" headline, matching the site's navy/red/sky palette).
 * `contentHtml` should be a series of <p>/<div> blocks — no need to
 * include your own outer wrapper.
 */
function wrapEmailHtml(contentHtml) {
  return (
    '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #14161C; border: 1px solid #e3e5ea;">' +
      '<div style="background: #1B2260; padding: 22px 24px; text-align: center;">' +
        '<img src="' + LOGO_URL + '" alt="ZSB North 24 Parganas" width="60" style="display: block; margin: 0 auto 10px; border: 0;" />' +
        '<div style="color: #ffffff; font-size: 17px; font-weight: bold; letter-spacing: 0.4px;">ZSB North 24 Parganas</div>' +
      '</div>' +
      '<div style="padding: 24px; line-height: 1.6; font-size: 14px;">' +
        contentHtml +
      '</div>' +
      '<div style="padding: 14px 24px; border-top: 1px solid #eee; font-size: 11px; color: #888; text-align: center;">' +
        'Unity Run 2026 &middot; Zila Sainik Board, North 24 Parganas' +
      '</div>' +
    '</div>'
  );
}

// Column positions, 1-based, matching the header row.
const COL = {
  slNo: 2,
  registrationId: 3,
  fullName: 4,
  email: 9,
  category: 14,
  tshirt: 15,
  fee: 16,
  paymentStatus: 24,
  confirmationSent: 27,
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
      const mailOptions = { to: body.to, subject: body.subject, body: body.body || '' };
      if (body.htmlBody) mailOptions.htmlBody = body.htmlBody;
      MailApp.sendEmail(mailOptions);
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

    let subject, body, contentHtml;
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
        '  Report:   Please assemble at the venue by 5:00 AM',
        '',
        'Please bring this email and a photo ID to collect your bib and T-shirt.',
        '',
        'See you there!',
        '',
        ORGANIZER_NAME,
      ].join('\n');
      contentHtml =
        '<p>Dear ' + name + ',</p>' +
        '<p>Your payment has been verified and your place in <strong>Unity Run 2026</strong> is ' +
        '<strong style="color: #1B2260;">CONFIRMED</strong>.</p>' +
        '<table style="width: 100%; border-collapse: collapse; margin: 18px 0;">' +
          '<tr><td style="padding: 5px 0; color: #3C424E;">Registration no.</td><td style="padding: 5px 0; font-weight: bold; text-align: right;">' + regId + '</td></tr>' +
          '<tr><td style="padding: 5px 0; color: #3C424E;">Participant no.</td><td style="padding: 5px 0; font-weight: bold; text-align: right;">' + slNo + '</td></tr>' +
          '<tr><td style="padding: 5px 0; color: #3C424E;">Category</td><td style="padding: 5px 0; font-weight: bold; text-align: right;">' + category + '</td></tr>' +
          '<tr><td style="padding: 5px 0; color: #3C424E;">T-shirt size</td><td style="padding: 5px 0; font-weight: bold; text-align: right;">' + tshirt + '</td></tr>' +
        '</table>' +
        '<div style="background: #EAF6FD; border-left: 3px solid #46AEE0; padding: 14px 16px; margin: 0 0 18px;">' +
          '<div style="font-weight: bold; margin-bottom: 6px;">Event details</div>' +
          'Date: Sunday, 27 September 2026<br/>' +
          'Venue: Barasat Stadium<br/>' +
          'Flag-off: 6:00 AM for the 6K run, followed by the 4K walk<br/>' +
          'Report: Please assemble at the venue by 5:00 AM' +
        '</div>' +
        '<p>Please bring this email and a photo ID to collect your bib and T-shirt.</p>' +
        '<p><strong>See you there!</strong></p>';
    } else {
      subject = 'Unity Run 2026 — payment could not be verified (' + regId + ')';
      body = [
        'Dear ' + name + ',',
        '',
        'Your registration no. ' + regId + ' for Unity Run 2026 — your payment',
        'could not be verified. Please share your payment screenshot and the',
        'following details to this email:',
        '',
        '  - Full name',
        '  - Phone number',
        '  - Payment method (UPI / Bank Transfer)',
        '  - Transaction ID / UTR',
        '  - Payment screenshot',
        '  - Details of payment (amount and date)',
        '',
        ORGANIZER_NAME,
      ].join('\n');
      contentHtml =
        '<p>Dear ' + name + ',</p>' +
        '<p>Your registration no. <strong>' + regId + '</strong> for Unity Run 2026 — your payment ' +
        '<strong style="color: #C41E2A;">could not be verified</strong>. Please share your payment ' +
        'screenshot and the following details to this email:</p>' +
        '<ul style="margin: 0 0 18px; padding-left: 20px;">' +
          '<li>Full name</li>' +
          '<li>Phone number</li>' +
          '<li>Payment method (UPI / Bank Transfer)</li>' +
          '<li>Transaction ID / UTR</li>' +
          '<li>Payment screenshot</li>' +
          '<li>Details of payment (amount and date)</li>' +
        '</ul>';
    }

    MailApp.sendEmail({ to: email, subject: subject, body: body, htmlBody: wrapEmailHtml(contentHtml) });

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
