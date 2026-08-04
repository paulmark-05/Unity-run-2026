(function () {
  const modal = document.getElementById('regModal');
  const form = document.getElementById('regForm');
  const pages = Array.from(document.querySelectorAll('.form-page'));
  const stepIndicators = Array.from(document.querySelectorAll('#formSteps .step'));
  const stepLabel = document.getElementById('stepLabel');
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const formFooter = document.getElementById('formFooter');
  const formError = document.getElementById('formError');
  const successView = document.getElementById('successView');
  const formBodyForm = form;

  const STEP_TITLES = [
    'SECTION 1 OF 4 · PERSONAL DETAILS',
    'SECTION 2 OF 4 · RUN & EVENT PREFERENCES',
    'SECTION 3 OF 4 · DECLARATION & WAIVER',
    'SECTION 4 OF 4 · REVIEW & PAYMENT',
  ];

  let currentStep = 1;
  let fees = { '3K': 500, '5K': 500, '10K': 500 };
  let razorpayKeyId = null;

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    resetToStep1();
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.fees) fees = cfg.fees;
        razorpayKeyId = cfg.keyId;
      })
      .catch(() => {});
    const dateField = document.getElementById('waiverDate');
    if (dateField && !dateField.value) {
      dateField.value = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function resetToStep1() {
    currentStep = 1;
    hideError();
    successView.style.display = 'none';
    formFooter.style.display = 'flex';
    formBodyForm.style.display = 'block';
    showStep(1);
  }

  function showStep(n) {
    pages.forEach((p) => p.classList.toggle('active', Number(p.dataset.page) === n));
    stepIndicators.forEach((s, i) => {
      s.classList.toggle('active', i + 1 === n);
      s.classList.toggle('done', i + 1 < n);
    });
    stepLabel.textContent = STEP_TITLES[n - 1];
    backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = '';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    if (n === 4) {
      nextBtn.append('Pay & Register ');
      nextBtn.append(arrow);
      renderSummary();
    } else {
      nextBtn.append('Continue ');
      nextBtn.append(arrow);
    }
    hideError();
  }

  function showError(message) {
    formError.textContent = message;
    formError.classList.add('show');
  }
  function hideError() {
    formError.classList.remove('show');
    formError.textContent = '';
  }

  function getFieldValue(name) {
    const el = form.elements[name];
    if (!el) return '';
    if (el instanceof RadioNodeList) {
      const checked = Array.from(el).find((r) => r.checked);
      return checked ? checked.value : '';
    }
    if (el.type === 'checkbox') return el.checked;
    return el.value.trim();
  }

  function validateStep(n) {
    if (n === 1) {
      if (!getFieldValue('fullName')) return 'Please enter your full name.';
      if (!getFieldValue('dob')) return 'Please enter your date of birth.';
      if (!getFieldValue('gender')) return 'Please select a gender option.';
      const email = getFieldValue('email');
      if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email address.';
      const mobile = getFieldValue('mobile');
      if (!/^[0-9+\-\s]{7,15}$/.test(mobile)) return 'Please enter a valid mobile number.';
      if (!getFieldValue('emergencyName')) return 'Please enter an emergency contact name.';
      if (!getFieldValue('emergencyRelationship')) return 'Please enter the emergency contact relationship.';
      if (!getFieldValue('emergencyNumber')) return 'Please enter an emergency contact number.';
    }
    if (n === 2) {
      if (!getFieldValue('category')) return 'Please select a run category.';
      if (!getFieldValue('tshirtSize')) return 'Please select a T-shirt size.';
    }
    if (n === 3) {
      if (!getFieldValue('waiverAccepted')) return 'You must agree to the participant waiver to continue.';
      if (!getFieldValue('signature')) return 'Please type your full name as digital consent.';
    }
    return null;
  }

  function collectRegistration() {
    return {
      fullName: getFieldValue('fullName'),
      dob: getFieldValue('dob'),
      gender: getFieldValue('gender'),
      email: getFieldValue('email'),
      mobile: getFieldValue('mobile'),
      emergencyName: getFieldValue('emergencyName'),
      emergencyRelationship: getFieldValue('emergencyRelationship'),
      emergencyNumber: getFieldValue('emergencyNumber'),
      category: getFieldValue('category'),
      tshirtSize: getFieldValue('tshirtSize'),
      waiverAccepted: getFieldValue('waiverAccepted'),
      signature: getFieldValue('signature'),
      waiverDate: getFieldValue('waiverDate'),
    };
  }

  function renderSummary() {
    const data = collectRegistration();
    const summaryList = document.getElementById('summaryList');
    const feeAmount = document.getElementById('feeAmount');
    const rows = [
      ['Name', data.fullName],
      ['Email', data.email],
      ['Mobile', data.mobile],
      ['Category', data.category],
      ['T-Shirt Size', data.tshirtSize],
    ];
    summaryList.innerHTML = rows
      .map(([k, v]) => `<li><span>${k}</span><span>${escapeHtml(v || '—')}</span></li>`)
      .join('');
    const fee = fees[data.category] || 500;
    feeAmount.textContent = `₹${fee}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setPaying(isPaying) {
    nextBtn.disabled = isPaying;
    backBtn.style.pointerEvents = isPaying ? 'none' : 'auto';
    if (isPaying) {
      nextBtn.textContent = 'Processing…';
    }
  }

  async function startPayment() {
    hideError();
    const registration = collectRegistration();
    const fee = fees[registration.category] || 500;
    setPaying(true);

    let order;
    try {
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: registration.category }),
      });
      order = await res.json();
      if (!res.ok) throw new Error(order.error || 'Could not start payment.');
    } catch (err) {
      setPaying(false);
      showError(err.message || 'Could not start payment. Please try again.');
      return;
    }

    if (!razorpayKeyId) {
      setPaying(false);
      showError('Payments are not yet configured for this event. Please check back soon.');
      return;
    }

    const options = {
      key: razorpayKeyId,
      amount: order.amount,
      currency: order.currency,
      name: 'Unity Run 2026',
      description: `${registration.category} Registration`,
      order_id: order.orderId,
      prefill: {
        name: registration.fullName,
        email: registration.email,
        contact: registration.mobile,
      },
      theme: { color: '#1B2260' },
      handler: function (response) {
        finalizeRegistration(response, registration);
      },
      modal: {
        ondismiss: function () {
          setPaying(false);
        },
      },
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function () {
      setPaying(false);
      showError('Payment failed or was cancelled. Please try again.');
    });
    rzp.open();
  }

  async function finalizeRegistration(paymentResponse, registration) {
    try {
      const res = await fetch('/api/verify-and-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: paymentResponse.razorpay_order_id,
          razorpay_payment_id: paymentResponse.razorpay_payment_id,
          razorpay_signature: paymentResponse.razorpay_signature,
          registration,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration could not be completed.');

      document.getElementById('successBib').textContent = data.registrationId;
      formBodyForm.style.display = 'none';
      formFooter.style.display = 'none';
      successView.style.display = 'block';
    } catch (err) {
      showError(err.message || 'Payment succeeded but registration could not be saved. Please contact the organizers.');
    } finally {
      setPaying(false);
    }
  }

  nextBtn.addEventListener('click', () => {
    const error = validateStep(currentStep);
    if (error) {
      showError(error);
      return;
    }
    hideError();
    if (currentStep < 4) {
      currentStep += 1;
      showStep(currentStep);
    } else {
      startPayment();
    }
  });

  backBtn.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep -= 1;
      showStep(currentStep);
    }
  });

  document.querySelectorAll('.js-open-register').forEach((btn) => {
    btn.addEventListener('click', openModal);
  });
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('closeSuccess').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
})();
