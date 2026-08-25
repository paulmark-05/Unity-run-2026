require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server: SocketIOServer } = require('socket.io');
const { appendRegistration, getRegistrationStats } = require('./sheets');
const { uploadPaymentScreenshot, sendMail } = require('./drive');

const app = express();
app.use(express.json());

// Everything for this event lives under /unity-run-2026, so zsb-barasat.in
// can host multiple sites side by side — this one, plus the Visitor
// Management System proxied in further down.
const site = express.Router();
app.use('/unity-run-2026', site);

site.use(express.static(path.join(__dirname, '..', 'public')));

const FEES = { '10K': 500, '6K': 500, '4K': 350 };
const CATEGORY_LABELS = {
  '10K': '10K Timed Run',
  '6K': '6K Timed Run',
  '4K': '4K Walk',
};

// Registration closes at the end of 12 September 2026, or once a category
// group's slots are full — the 10K and 6K runs share one pool, the 4K walk
// has its own.
const REGISTRATION_CLOSES = new Date('2026-09-12T23:59:59+05:30');
const RUN_CAP = 300; // 10K + 6K combined
const WALK_CAP = 200; // 4K only
const GROUP_OF_CATEGORY = { '10K': 'run', '6K': 'run', '4K': 'walk' };

async function registrationStatus() {
  const closedByDate = Date.now() > REGISTRATION_CLOSES.getTime();
  let stats = null;
  try {
    stats = await getRegistrationStats();
  } catch (err) {
    console.error('could not read registration stats:', err.message);
  }

  const runCount = stats ? stats.totalByCategory['10K'] + stats.totalByCategory['6K'] : null;
  const walkCount = stats ? stats.totalByCategory['4K'] : null;

  return {
    closedByDate,
    closesOn: '12 September 2026',
    stats,
    groups: {
      run: { count: runCount, cap: RUN_CAP, full: runCount !== null && runCount >= RUN_CAP },
      walk: { count: walkCount, cap: WALK_CAP, full: walkCount !== null && walkCount >= WALK_CAP },
    },
  };
}

/** Whether a given category can still accept registrations right now. */
function openFor(status, category) {
  if (status.closedByDate) return false;
  const group = GROUP_OF_CATEGORY[category];
  if (!group) return false;
  return !status.groups[group].full;
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

site.get('/api/config', async (req, res) => {
  const status = await registrationStatus();
  res.json({
    fees: FEES,
    categoryLabels: CATEGORY_LABELS,
    registration: status,
    counts: status.stats ? status.stats.confirmedByCategory : { '10K': 0, '6K': 0, '4K': 0 },
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
  if (data.liabilityAccepted !== 'true' && data.liabilityAccepted !== true) {
    return 'The voluntary participation declaration must be accepted before payment.';
  }
  return null;
}

site.post('/api/register', upload.single('paymentScreenshot'), async (req, res) => {
  try {
    const registration = req.body;

    const status = await registrationStatus();
    if (status.closedByDate) {
      return res.status(409).json({ error: 'Registration closed on 12 September 2026.' });
    }
    if (!openFor(status, registration.category)) {
      const group = GROUP_OF_CATEGORY[registration.category];
      const label = group === 'walk' ? '4K Walk' : '10K / 6K Run';
      const cap = group === 'walk' ? WALK_CAP : RUN_CAP;
      return res.status(409).json({ error: `${label} registration is full — all ${cap} places have been taken.` });
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
    const sequenceNo = (status.stats ? status.stats.totalRows : 0) + 1;

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
site.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'That screenshot is larger than 5 MB. Please upload a smaller image.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Something went wrong with your upload.' });
  }
  next();
});

// zsb-barasat.in root — a small portal now that there are two real sites to
// choose between. Add a card here the same way whenever a third one exists.
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Zila Sainik Board, North 24 Parganas</title>
<style>
  :root { --navy: #1B2260; --red: #C41E2A; --ink-soft: #3C424E; --line: rgba(27,34,96,0.14); }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, serif; background: #fff; color: #14161C; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 56px 24px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 40px; }
  header img { width: 48px; height: auto; }
  h1 { font-size: 1.3rem; color: var(--navy); margin: 0; }
  .sites { display: flex; flex-direction: column; gap: 16px; }
  .card {
    display: block; text-decoration: none; color: inherit;
    border: 1px solid var(--line); border-left: 3px solid var(--red);
    padding: 20px 22px; transition: box-shadow 0.15s ease;
  }
  .card:hover { box-shadow: 0 12px 26px -18px rgba(27,34,96,0.4); }
  .card .name { font-weight: 700; color: var(--navy); font-size: 1.05rem; }
  .card .desc { font-family: Arial, sans-serif; font-size: 0.85rem; color: var(--ink-soft); margin-top: 6px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <img src="/unity-run-2026/assets/zsb-logo.jpg" alt="ZSB North 24 Parganas" />
      <h1>Zila Sainik Board, North 24 Parganas</h1>
    </header>
    <div class="sites">
      <a class="card" href="/unity-run-2026/">
        <div class="name">Unity Run 2026</div>
        <div class="desc">10K &amp; 6K timed runs and a 4K walk — Barasat Stadium, 20 September 2026. Registration open.</div>
      </a>
      <a class="card" href="/visitor-management-system/">
        <div class="name">Visitor Management System</div>
        <div class="desc">Visitor registration and tracking.</div>
      </a>
    </div>
  </div>
</body>
</html>`);
});

// Live registration counters. Socket.IO sits on the raw HTTP server (it
// isn't Express middleware), so it's given its own path under
// /unity-run-2026 to match the rest of the site instead of claiming the
// shared /socket.io root — the Visitor Management System can have its own
// without colliding with this one.
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { path: '/unity-run-2026/socket.io' });

async function currentCounts() {
  const stats = await getRegistrationStats();
  return stats.confirmedByCategory;
}

io.on('connection', async (socket) => {
  try {
    socket.emit('counts', await currentCounts());
  } catch (err) {
    console.error('could not send initial counts:', err.message);
  }
});

const COUNTS_BROADCAST_INTERVAL_MS = 25 * 1000;
setInterval(async () => {
  if (io.engine.clientsCount === 0) return; // nobody listening, skip the API call
  try {
    io.emit('counts', await currentCounts());
  } catch (err) {
    console.error('counts broadcast failed:', err.message);
  }
}, COUNTS_BROADCAST_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Unity Run 2026 server listening on port ${PORT}`);
});
