# Unity Run 2026

Event website and registration system for Unity Run 2026 — Barasat Stadium, 20 September 2026. Organized by ZSB North 24 Parganas.

- Static landing page (`public/`)
- 4-step registration form (Personal Details → Run Preferences → Waiver → Payment)
- Razorpay checkout for payment
- Registrations are written to a Google Sheet on successful payment

## Project structure

```
public/          static site (HTML/CSS/JS) served directly
server/          Express backend (Razorpay orders, payment verification, Sheets write)
```

## Local setup

```bash
npm install
cp .env.example .env   # then fill in the values, see below
npm start
```

The site runs at `http://localhost:3000`.

## What you need before this goes live

### 1. Razorpay
1. Create an account at [dashboard.razorpay.com](https://dashboard.razorpay.com).
2. Go to **Settings → API Keys** and generate a **Test** key pair first. Put them in `.env` as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
3. Test the full registration + payment flow using [Razorpay's test cards/UPI](https://razorpay.com/docs/payments/payments/test-card-upi-details/).
4. Once you're happy, complete Razorpay's KYC/activation and switch to **Live** keys before the event goes public.

### 2. Google Sheet (where registrations land)
1. Create a new Google Sheet. Add a header row to the first tab, e.g.:
   `Timestamp | Registration ID | Full Name | DOB | Gender | Email | Mobile | Emergency Name | Emergency Relationship | Emergency Number | Category | T-Shirt Size | Fee | Payment ID | Order ID | Waiver Accepted | Signature`
2. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an existing one), enable the **Google Sheets API**, and create a **Service Account**.
3. Create a JSON key for that service account and download it.
4. Share your Google Sheet with the service account's email address (found inside the JSON, field `client_email`) — give it **Editor** access.
5. Minify the JSON key to a single line and put it in `.env` as `GOOGLE_SERVICE_ACCOUNT_JSON`.
6. Copy the Sheet ID from its URL (`docs.google.com/spreadsheets/d/<THIS_PART>/edit`) into `GOOGLE_SHEET_ID`.

### 3. Deploy to Render
1. Push this repo to GitHub (already done if you're reading this from the repo).
2. On [render.com](https://render.com), create a **New Web Service**, connect the `Unity-run-2026` GitHub repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add the environment variables from `.env` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`) under the service's **Environment** tab — never commit `.env` itself.
5. Deploy. Render gives you a `https://unity-run-2026.onrender.com`-style URL; a custom domain can be attached later from the same dashboard.

## Notes
- Entry fee is currently a flat ₹500 for all categories — change the `FEES` object in `server/index.js` if categories should have different prices.
- The Razorpay key ID (public, safe to expose) is served to the frontend via `/api/config`; the secret key never leaves the server.
- Payment signatures are verified server-side (`/api/verify-and-register`) before anything is written to the Sheet, so a registration can't be faked without a valid payment.
