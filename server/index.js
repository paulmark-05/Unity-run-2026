require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { appendRegistration, countRegistrations } = require('./sheets');
const { uploadPaymentScreenshot, sendMail } = require('./drive');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const FEES = { '10K': 500, '6K': 500, '4K': 350 };
const CATEGORY_LABELS = {
  '10K': '10K Timed Run',
  '6K': '6K Timed Run',
  '4K': '4K Walk',
};

// Registration closes at the end of 12 September 2026, or once the field is full.
const REGISTRATION_CLOSES = new Date('2026-09-12T23:59:59+05:30');
const PARTICIPANT_CAP = 300;

async function registrationStatus() {
  const closedByDate = Date.now() > REGISTRATION_CLOSES.getTime();
  let count = null;
  try {
    count = await countRegistrations();
  } catch (err) {
    console.error('could not read registration count:', err.message);
  }
  const closedByCap = count !== null && count >= PARTICIPANT_CAP;
  return {
    open: !closedByDate && !closedByCap,
    closedByDate,
    closedByCap,
    count,
    cap: PARTICIPANT_CAP,
    closesOn: '12 September 2026',
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.mimetype)) {
      return cb(new Error('Payment screenshot must be an image file (PNG, JPG, WEBP or HEIC).'));
    }
    cb(null, true);
  },
});

app.get('/api/config', async (req, res) => {
  res.json({
    fees: FEES,
    categoryLabels: CATEGORY_LABELS,
    registration: await registrationStatus(),
    upiVpa: process.env.UPI_VPA || null,
    upiPayeeName: process.env.UPI_PAYEE_NAME || 'Unity Run 2026',
    upiOrgId: process.env.UPI_ORG_ID || '159020',
    upiMerchantCode: process.env.UPI_MERCHANT_CODE || '7800',
    bankDetails: {
      accountName: process.env.BANK_ACCOUNT_NAME || '',
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || '',
      ifsc: process.env.BANK_IFSC || '',
      bankName: process.env.BANK_NAME || '',
      branch: process.env.BANK_BRANCH || '',
    },
  });
});

const REQUIRED_FIELDS = [
  'fullName', 'dob', 'gender', 'email', 'mobile',
  'emergencyName', 'emergencyRelationship', 'emergencyNumber',
  'category', 'tshirtSize', 'signature',
];

const PAYMENT_METHODS = ['UPI', 'Bank Transfer'];

function validateRegistration(data) {
  for (const field of REQUIRED_FIELDS) {
    if (!data[field] || String(data[field]).trim() === '') {
      return `Missing required field: ${field}`;
    }
  }
  if (!FEES[data.category]) return 'Invalid category selected.';
  if (!/^\S+@\S+\.\S+$/.test(data.email)) return 'Invalid email address.';
  if (!/^[0-9+\-\s]{7,15}$/.test(data.mobile)) return 'Invalid mobile number.';

  if (!PAYMENT_METHODS.includes(data.paymentMethod)) return 'Please choose how you paid.';
  if (data.paymentMethod === 'Bank Transfer') {
    if (!data.payerAccountName) return 'Account holder name is required for a bank transfer.';
    if (!/^\d{6,20}$/.test(String(data.payerAccountNumber || '').replace(/\s/g, ''))) {
      return 'Invalid account number.';
    }
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(data.payerIfsc || '')) {
      return 'Invalid IFSC code. It should look like SBIN0001234.';
    }
    if (!/^[A-Za-z0-9]{6,30}$/.test(data.bankUtr || '')) {
      return 'Invalid UTR / reference number.';
    }
  } else {
    if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(data.upiId || '')) {
      return 'Invalid UPI ID. It should look like name@bank.';
    }
    if (!/^[A-Za-z0-9]{6,30}$/.test(data.upiTxnRef || '')) {
      return 'Invalid UPI transaction ID.';
    }
  }

  if (data.waiverAccepted !== 'true' && data.waiverAccepted !== true) {
    return 'The participant waiver must be accepted.';
  }
  return null;
}

app.post('/api/register', upload.single('paymentScreenshot'), async (req, res) => {
  try {
    const registration = req.body;

    const status = await registrationStatus();
    if (!status.open) {
      return res.status(409).json({
        error: status.closedByCap
          ? `Registration is full — all ${PARTICIPANT_CAP} places have been taken.`
          : 'Registration closed on 12 September 2026.',
      });
    }

    const validationError = validateRegistration(registration);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a screenshot of your UPI payment.' });
    }

    const registrationId = `UR26-${Date.now().toString(36).toUpperCase()}`;

    // Screenshot uploads need the Apps Script endpoint (see scripts/apps-script-upload.gs).
    // Until it is deployed the form still works, but the proof of payment is discarded —
    // registrations are flagged in the sheet so nothing silently looks verified.
    const uploadConfigured = Boolean(process.env.APPS_SCRIPT_UPLOAD_URL && process.env.APPS_SCRIPT_SECRET);
    let screenshotLink = 'NOT SAVED — upload endpoint not configured';
    let paymentStatus = 'Pending verification — screenshot missing';

    if (uploadConfigured) {
      try {
        screenshotLink = await uploadPaymentScreenshot(req.file, registrationId);
        paymentStatus = 'Pending verification';
      } catch (err) {
        console.error('screenshot upload failed:', err.message);
        return res.status(500).json({ error: 'Your payment screenshot could not be uploaded. Please try again.' });
      }
    } else {
      console.warn('WARNING: APPS_SCRIPT_UPLOAD_URL is not set — screenshot was NOT saved.');
    }

    // Places are allocated in order of payment, so the sequence number is the
    // position in the sheet at the moment the row is written.
    const sequenceNo = (status.count === null ? 0 : status.count) + 1;

    await appendRegistration([
      new Date().toISOString(),
      sequenceNo,
      registrationId,
      registration.fullName,
      registration.dob,
      registration.gender,
      registration.email,
      registration.mobile,
      registration.emergencyName,
      registration.emergencyRelationship,
      registration.emergencyNumber,
      registration.category,
      registration.tshirtSize,
      FEES[registration.category],
      registration.paymentMethod,
      // One reference column: the UPI transaction ID or the bank UTR, whichever applies.
      (registration.paymentMethod === 'UPI' ? registration.upiTxnRef : registration.bankUtr || '').toUpperCase(),
      registration.paymentMethod === 'UPI' ? registration.upiId : '',
      registration.paymentMethod === 'Bank Transfer' ? registration.payerAccountName : '',
      registration.paymentMethod === 'Bank Transfer' ? registration.payerAccountNumber : '',
      registration.paymentMethod === 'Bank Transfer' ? String(registration.payerIfsc).toUpperCase() : '',
      screenshotLink,
      paymentStatus,
      'Yes',
      registration.signature,
      '', // Confirmation Sent — filled in by the sheet's confirmation script
    ]);

    // Provisional receipt. The final confirmation goes out from the sheet once
    // an organizer has checked the payment against the bank.
    try {
      await sendMail({
        to: registration.email,
        subject: `Unity Run 2026 — provisional receipt ${registrationId}`,
        body: [
          `Dear ${registration.fullName},`,
          '',
          'We have received your registration for Unity Run 2026.',
          '',
          `Registration no: ${registrationId}`,
          `Participant no: ${sequenceNo}`,
          `Category: ${CATEGORY_LABELS[registration.category] || registration.category}`,
          `T-shirt size: ${registration.tshirtSize}`,
          `Amount: Rs ${FEES[registration.category]}`,
          `Paid by: ${registration.paymentMethod}`,
          `Reference: ${(registration.paymentMethod === 'UPI' ? registration.upiTxnRef : registration.bankUtr) || '-'}`,
          '',
          'This is a PROVISIONAL receipt. Your payment will be checked against our',
          'bank records and a final confirmation will be emailed to you within 2',
          'working days. Please keep this email until then.',
          '',
          'Event: Sunday, 20 September 2026, Barasat Stadium. Flag-off 6:00 AM.',
          '',
          'Zila Sainik Board, North 24 Parganas',
        ].join('\n'),
      });
    } catch (err) {
      // A failed receipt must not lose a paid registration — the row is saved.
      console.error('provisional receipt email failed:', err.message);
    }

    res.json({ success: true, registrationId, sequenceNo });
  } catch (err) {
    console.error('registration failed:', err.message);
    res.status(500).json({ error: 'Registration could not be saved. Please try again, or contact the organizers.' });
  }
});

// Surfaces multer errors (file too large, wrong type) as readable messages.
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'That screenshot is larger than 5 MB. Please upload a smaller image.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Something went wrong with your upload.' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Unity Run 2026 server listening on port ${PORT}`);
});
