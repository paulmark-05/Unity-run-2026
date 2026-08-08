require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { appendRegistration } = require('./sheets');
const { uploadPaymentScreenshot } = require('./drive');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const FEES = { '3K': 500, '5K': 500, '10K': 500 };

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

app.get('/api/config', (req, res) => {
  res.json({
    fees: FEES,
    upiVpa: process.env.UPI_VPA || null,
    upiPayeeName: process.env.UPI_PAYEE_NAME || 'Unity Run 2026',
    upiOrgId: process.env.UPI_ORG_ID || '159020',
    upiMerchantCode: process.env.UPI_MERCHANT_CODE || '7800',
  });
});

const REQUIRED_FIELDS = [
  'fullName', 'dob', 'gender', 'email', 'mobile',
  'emergencyName', 'emergencyRelationship', 'emergencyNumber',
  'category', 'tshirtSize', 'upiId', 'signature',
];

function validateRegistration(data) {
  for (const field of REQUIRED_FIELDS) {
    if (!data[field] || String(data[field]).trim() === '') {
      return `Missing required field: ${field}`;
    }
  }
  if (!FEES[data.category]) return 'Invalid category selected.';
  if (!/^\S+@\S+\.\S+$/.test(data.email)) return 'Invalid email address.';
  if (!/^[0-9+\-\s]{7,15}$/.test(data.mobile)) return 'Invalid mobile number.';
  if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(data.upiId)) return 'Invalid UPI ID. It should look like name@bank.';
  if (data.waiverAccepted !== 'true' && data.waiverAccepted !== true) {
    return 'The participant waiver must be accepted.';
  }
  return null;
}

app.post('/api/register', upload.single('paymentScreenshot'), async (req, res) => {
  try {
    const registration = req.body;

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

    await appendRegistration([
      new Date().toISOString(),
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
      registration.upiId,
      screenshotLink,
      paymentStatus,
      'Yes',
      registration.signature,
    ]);

    res.json({ success: true, registrationId });
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
