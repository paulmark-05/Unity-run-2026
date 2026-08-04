require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Razorpay = require('razorpay');
const { appendRegistration } = require('./sheets');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const FEES = { '3K': 500, '5K': 500, '10K': 500 };

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay keys are not configured');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

app.get('/api/config', (req, res) => {
  res.json({
    keyId: process.env.RAZORPAY_KEY_ID || null,
    fees: FEES,
  });
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { category } = req.body;
    const amount = FEES[category];
    if (!amount) {
      return res.status(400).json({ error: 'Invalid category selected.' });
    }
    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `ur26_${Date.now()}`,
      notes: { category },
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('create-order failed:', err.message);
    res.status(500).json({ error: 'Could not start payment. Please try again shortly.' });
  }
});

const REQUIRED_FIELDS = [
  'fullName', 'dob', 'gender', 'email', 'mobile',
  'emergencyName', 'emergencyRelationship', 'emergencyNumber',
  'category', 'tshirtSize',
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
  if (!data.waiverAccepted) return 'The participant waiver must be accepted.';
  if (!data.signature || String(data.signature).trim() === '') return 'Digital signature is required.';
  return null;
}

app.post('/api/verify-and-register', async (req, res) => {
  try {
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      registration,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment confirmation details.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed.' });
    }

    const validationError = validateRegistration(registration || {});
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const registrationId = `UR26-${Date.now().toString(36).toUpperCase()}`;

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
      razorpay_payment_id,
      razorpay_order_id,
      'Yes',
      registration.signature,
    ]);

    res.json({ success: true, registrationId });
  } catch (err) {
    console.error('verify-and-register failed:', err.message);
    res.status(500).json({ error: 'Registration could not be saved. Please contact the organizers with your payment ID.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Unity Run 2026 server listening on port ${PORT}`);
});
