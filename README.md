# Unity Run 2026

Event website and registration system for Unity Run 2026 — Barasat Stadium, 20 September 2026. Organized by ZSB North 24 Parganas.

- Static landing page (`public/`)
- 4-step registration form (Personal Details → Run Preferences → Waiver → Payment)
- Payment by UPI QR or bank transfer — runners pay, then submit the account they paid from and a screenshot as proof
- 10K and 6K timed runs (₹500) with separate men's and women's prizes, and a 4K walk (₹350)
- Provisional receipt on registration; final confirmation email once an organizer verifies the payment
- Registrations are written to a Google Sheet; screenshots are uploaded to a Google Drive folder and linked from the sheet
- Payments are verified manually by the organizers (each row lands as `Pending verification`)

## Project structure

```
public/          static site (HTML/CSS/JS) served directly
server/          Express backend (registration validation, Sheets write, screenshot upload)
scripts/         QR generator and the Apps Script to deploy for uploads
```

## Local setup

```bash
npm install
cp .env.example .env   # then fill in the values, see below
npm start
```

The site runs at `http://localhost:3000`.

## What you need before this goes live

### 1. Payment details
Runners choose between UPI and bank transfer on the last step of the form.

**UPI**
1. `UPI_VPA` is the UPI ID being paid into (e.g. `someone@okaxis`), and `UPI_PAYEE_NAME` is the name shown in the runner's UPI app.
2. `npm run qr` regenerates one QR per fee (`upi-qr-500.png`, `upi-qr-350.png`) with the amount baked in. Rerun whenever a fee changes.

**Bank transfer**
3. Fill in `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_IFSC`, `BANK_NAME` and `BANK_BRANCH`. Anything left blank shows as "to be confirmed" on the form, so fill these in before going live.

### 2. Google Sheet (where registrations land)
1. Create a new Google Sheet. Add a header row to the first tab, e.g.:
   `Timestamp | Sl No | Registration ID | Full Name | DOB | Gender | Email | Mobile | Emergency Name | Emergency Relationship | Emergency Number | Category | T-Shirt Size | Fee | Payment Method | Transaction Ref / UTR | Payer UPI ID | Payer Account Name | Payer Account Number | Payer IFSC | Payment Screenshot | Payment Status | Waiver Accepted | Signature | Confirmation Sent`
2. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an existing one), enable the **Google Sheets API**, and create a **Service Account**.
3. Create a JSON key for that service account and download it.
4. Share your Google Sheet with the service account's email address (found inside the JSON, field `client_email`) — give it **Editor** access.
5. Minify the JSON key to a single line and put it in `.env` as `GOOGLE_SERVICE_ACCOUNT_JSON`.
6. Copy the Sheet ID from its URL (`docs.google.com/spreadsheets/d/<THIS_PART>/edit`) into `GOOGLE_SHEET_ID`.

### 3. Payment screenshot uploads (Apps Script)
Screenshots can't be uploaded with the service account: service accounts have no
storage quota, so they can't own files in a personal Google Drive. Instead, a small
Apps Script web app runs inside the organizer's own account and saves the files there.

1. In Google Drive, create a folder, e.g. **Unity Run 2026 — Payment Screenshots**, and copy its ID from the URL into `GOOGLE_DRIVE_FOLDER_ID`.
2. Go to [script.google.com](https://script.google.com) → **New project**.
3. Paste in the contents of [`scripts/apps-script-upload.gs`](scripts/apps-script-upload.gs), then fill in `FOLDER_ID`, `SHARED_SECRET` and `SHEET_ID` at the top — they are placeholders so no credential is committed.
4. **Deploy → New deployment → Web app**, with **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and authorize it.
5. Copy the deployment's `/exec` URL into `APPS_SCRIPT_UPLOAD_URL`, and make sure `APPS_SCRIPT_SECRET` matches the secret in the script.

The endpoint is unauthenticated by URL, so the shared secret is what stops strangers uploading into the folder. If it ever leaks, change it in both the script and `.env`, and redeploy the script.

### 4. Confirmation emails
The same Apps Script sends mail as the organizer's Gmail account, so no SMTP
password is stored anywhere.

- **Provisional receipt** — sent automatically the moment a registration is saved.
- **Final confirmation** — sent once an organizer has checked the payment against
  the bank and set that row's **Payment Status** to `Confirmed`.

To enable the final confirmation, add a trigger in the Apps Script editor:
**Triggers → Add trigger →** function `sendPendingConfirmations`, event source
**Time-driven**, **Hour timer**, every hour. It emails every row marked
`Confirmed` that has not been mailed yet, then stamps the **Confirmation Sent**
column so nobody is mailed twice.

### 5. Registration window
Set in `server/index.js`: entries close end of **12 September 2026**, capped at
**300** participants. Once either limit is hit the form closes itself and the
API refuses new registrations. Participants are numbered in the order their
registration is received.

### 6. Deploy to Render
1. Push this repo to GitHub (already done if you're reading this from the repo).
2. On [render.com](https://render.com), create a **New Web Service**, connect the `Unity-run-2026` GitHub repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add the environment variables from `.env` (`UPI_VPA`, `UPI_PAYEE_NAME`, `UPI_ORG_ID`, `UPI_MERCHANT_CODE`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_IFSC`, `BANK_NAME`, `BANK_BRANCH`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `GOOGLE_DRIVE_FOLDER_ID`, `APPS_SCRIPT_UPLOAD_URL`, `APPS_SCRIPT_SECRET`) under the service's **Environment** tab — never commit `.env` itself.
5. Deploy. Render gives you a `https://unity-run-2026.onrender.com`-style URL; a custom domain can be attached later from the same dashboard.

## Notes
- Entry fees: ₹500 for the 10K and 6K timed runs, ₹350 for the 4K walk. Change the `FEES` object in `server/index.js`, then rerun `npm run qr` so the QR amounts match.
- Payment is **not** automatically verified. Every registration lands in the sheet as `Pending verification`; an organizer opens the linked screenshot, matches the transaction reference against the bank/UPI statement, and updates that cell. Budget time for this before the event.
- Screenshot uploads are capped at 5 MB and must be image files.
- The "tap to pay" QR link uses a `upi://` deep link, which only opens an app on mobile devices. On desktop, runners scan the QR with their phone instead.
