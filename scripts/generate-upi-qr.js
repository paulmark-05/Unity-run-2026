/**
 * Regenerates public/assets/upi-qr.png with the registration fee baked in.
 *
 *   npm run qr           # uses REGISTRATION_FEE below
 *   npm run qr -- 750    # overrides the amount
 *
 * The source QR (from the bank) is unsigned, so adding a fixed amount is safe —
 * UPI apps will open with the amount pre-filled and locked to this payee.
 */
require('dotenv').config();
const path = require('path');
const QRCode = require('qrcode');

const REGISTRATION_FEE = 500;

const amount = process.argv[2] || String(REGISTRATION_FEE);
const vpa = process.env.UPI_VPA;
const payeeName = process.env.UPI_PAYEE_NAME;

if (!vpa || !payeeName) {
  console.error('UPI_VPA and UPI_PAYEE_NAME must be set in .env');
  process.exit(1);
}

// Mirrors the bank's original QR parameters, with the amount filled in.
const params = new URLSearchParams({
  ver: '01',
  pa: vpa,
  pn: payeeName,
  tn: 'Unity Run 2026 Registration',
  am: amount,
  cu: 'INR',
  mode: '00',
  purpose: '00',
  orgid: process.env.UPI_ORG_ID || '159020',
  mc: process.env.UPI_MERCHANT_CODE || '7800',
});

const upiUri = `upi://pay?${params.toString()}`;
const outPath = path.join(__dirname, '..', 'public', 'assets', 'upi-qr.png');

QRCode.toFile(outPath, upiUri, {
  width: 900,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#1B2260', light: '#FFFFFF' },
})
  .then(() => {
    console.log(`QR written to ${outPath}`);
    console.log(`Amount: Rs ${amount}`);
    console.log(`Payload: ${upiUri}`);
  })
  .catch((err) => {
    console.error('Failed to generate QR:', err.message);
    process.exit(1);
  });
