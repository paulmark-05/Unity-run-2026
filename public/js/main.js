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
  let fees = { '3K': 499, '5K': 499, '10K': 499 };
  let upiVpa = null;
  let upiPayeeName = 'Unity Run 2026';
  let upiOrgId = '159020';
  let upiMerchantCode = '7800';

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    resetToStep1();
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.fees) fees = cfg.fees;
        upiVpa = cfg.upiVpa;
        if (cfg.upiPayeeName) upiPayeeName = cfg.upiPayeeName;
        if (cfg.upiOrgId) upiOrgId = cfg.upiOrgId;
        if (cfg.upiMerchantCode) upiMerchantCode = cfg.upiMerchantCode;
        renderUpiDetails();
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
      nextBtn.append('Submit Registration ');
      nextBtn.append(arrow);
      renderSummary();
      renderUpiDetails();
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
    if (n === 4) {
      const upiId = getFieldValue('upiId');
      if (!upiId) return 'Please enter the UPI ID you paid from.';
      if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiId)) return 'That UPI ID looks incomplete — it should look like name@bank.';
      const fileInput = document.getElementById('paymentScreenshot');
      if (!fileInput.files || !fileInput.files[0]) return 'Please upload a screenshot of your UPI payment.';
      if (fileInput.files[0].size > 5 * 1024 * 1024) return 'That screenshot is larger than 5 MB. Please upload a smaller image.';
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
      upiId: getFieldValue('upiId'),
    };
  }

  function renderUpiDetails() {
    const link = document.getElementById('upiLink');
    const vpaLine = document.getElementById('upiVpaLine');
    const vpaText = document.getElementById('upiVpaText');
    if (!link) return;

    if (!upiVpa) {
      link.removeAttribute('href');
      vpaLine.hidden = true;
      return;
    }
    const category = getFieldValue('category');
    const amount = fees[category] || 499;
    // Mirrors the bank QR's parameters so UPI apps treat it as the same merchant.
    const params = new URLSearchParams({
      ver: '01',
      pa: upiVpa,
      pn: upiPayeeName,
      tn: `Unity Run 2026 ${category || ''}`.trim(),
      am: String(amount),
      cu: 'INR',
      mode: '00',
      purpose: '00',
      orgid: upiOrgId,
      mc: upiMerchantCode,
    });
    link.href = `upi://pay?${params.toString()}`;
    vpaText.textContent = upiVpa;
    vpaLine.hidden = false;
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
    const fee = fees[data.category] || 499;
    feeAmount.textContent = `₹${fee}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setSubmitting(isSubmitting) {
    nextBtn.disabled = isSubmitting;
    backBtn.style.pointerEvents = isSubmitting ? 'none' : 'auto';
    if (isSubmitting) {
      nextBtn.textContent = 'Submitting…';
    }
  }

  async function submitRegistration() {
    hideError();
    setSubmitting(true);

    const registration = collectRegistration();
    const payload = new FormData();
    Object.entries(registration).forEach(([key, value]) => {
      payload.append(key, value);
    });
    payload.append('paymentScreenshot', document.getElementById('paymentScreenshot').files[0]);

    try {
      const res = await fetch('/api/register', { method: 'POST', body: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration could not be completed.');

      document.getElementById('successBib').textContent = data.registrationId;
      formBodyForm.style.display = 'none';
      formFooter.style.display = 'none';
      successView.style.display = 'block';
    } catch (err) {
      showError(err.message || 'Registration could not be saved. Please try again.');
      setSubmitting(false);
      showStep(4);
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
      submitRegistration();
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
