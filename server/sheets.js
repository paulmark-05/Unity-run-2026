const { google } = require('googleapis');

const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Registrations';

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function appendRegistration(row) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_TAB}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Column positions (0-based) within a data row, matching the sheet header:
// ... L:Category(12) ... W:PaymentStatus(22)
const COL_CATEGORY = 12;
const COL_PAYMENT_STATUS = 22;
const CATEGORIES = ['10K', '6K', '4K'];
const CONFIRMED_VALUES = new Set(['confirmed', 'verified', 'yes']);

/**
 * One sheet read, two views of it:
 *  - totalRows / totalByCategory: every registration regardless of payment
 *    status — used to enforce the per-category slot caps, since a pending
 *    registration still holds a slot.
 *  - confirmedByCategory: only rows an organizer has marked as a confirmed
 *    payment — this is what the public live counters show.
 */
async function getRegistrationStats() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_TAB}!A2:Z`, // skip the header row
  });
  const rows = res.data.values || [];

  const totalByCategory = { '10K': 0, '6K': 0, '4K': 0 };
  const confirmedByCategory = { '10K': 0, '6K': 0, '4K': 0 };

  for (const row of rows) {
    const category = (row[COL_CATEGORY] || '').trim();
    if (!CATEGORIES.includes(category)) continue;
    totalByCategory[category] += 1;
    const status = String(row[COL_PAYMENT_STATUS] || '').trim().toLowerCase();
    if (CONFIRMED_VALUES.has(status)) {
      confirmedByCategory[category] += 1;
    }
  }

  return { totalRows: rows.length, totalByCategory, confirmedByCategory };
}

const RESULTS_TAB = 'Results';

/**
 * Reads the Results tab: Year | Category | Gender | Rank | Bib No | Name | Finish Time.
 * An organizer fills this in after the event — no row for a year means no
 * results yet, which the site shows as "not published" for that year.
 */
async function getResultRows() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  let rows;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${RESULTS_TAB}!A2:G`,
    });
    rows = res.data.values || [];
  } catch (err) {
    // Tab not created yet, or temporarily unreachable — treat as no results.
    console.error('could not read results sheet:', err.message);
    return [];
  }

  return rows
    .filter((r) => r[0] && r[1]) // needs at least a year and a category
    .map((r) => ({
      year: String(r[0]).trim(),
      category: String(r[1]).trim(),
      gender: String(r[2] || '').trim(),
      rank: Number(r[3]) || null,
      bib: String(r[4] || '').trim(),
      name: String(r[5] || '').trim(),
      time: String(r[6] || '').trim(),
    }));
}

module.exports = { appendRegistration, getRegistrationStats, getResultRows };
