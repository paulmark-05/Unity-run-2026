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
  let fees = { '10K': 500, '6K': 500, '4K': 350 };
  let upiVpa = null;
  let upiPayeeName = 'Unity Run 2026';
  let upiOrgId = '159020';
  let upiMerchantCode = '7800';
  let bankDetails = null;

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
        bankDetails = cfg.bankDetails || null;
        applyRegistrationStatus(cfg.registration);
        renderUpiDetails();
        renderBankDetails();
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
      renderBankDetails();
      showPaymentBlocks();
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
      const method = getFieldValue('paymentMethod');
      if (method === 'Bank Transfer') {
        if (!getFieldValue('payerAccountName')) return 'Please enter the account holder name.';
        const accountNumber = getFieldValue('payerAccountNumber');
        if (!accountNumber) return 'Please enter the account number you paid from.';
        if (!/^\d{6,20}$/.test(accountNumber.replace(/\s/g, ''))) return 'That account number looks incorrect — digits only, 6 to 20 of them.';
        const ifsc = getFieldValue('payerIfsc');
        if (!ifsc) return 'Please enter your bank’s IFSC code.';
        if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(ifsc)) return 'That IFSC code looks incorrect — it should look like SBIN0001234.';
        const utr = getFieldValue('bankUtr');
        if (!utr) return 'Please enter the UTR / reference number from your transfer.';
        if (!/^[A-Za-z0-9]{6,30}$/.test(utr)) return 'That UTR looks incorrect — letters and numbers only, 6 to 30 characters.';
      } else {
        const upiId = getFieldValue('upiId');
        if (!upiId) return 'Please enter the UPI ID you paid from.';
        if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiId)) return 'That UPI ID looks incomplete — it should look like name@bank.';
        const ref = getFieldValue('upiTxnRef');
        if (!ref) return 'Please enter the UPI transaction ID from your payment confirmation.';
        if (!/^[A-Za-z0-9]{6,30}$/.test(ref)) return 'That transaction ID looks incorrect — letters and numbers only, 6 to 30 characters.';
      }
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
      paymentMethod: getFieldValue('paymentMethod'),
      upiId: getFieldValue('upiId'),
      upiTxnRef: getFieldValue('upiTxnRef'),
      payerAccountName: getFieldValue('payerAccountName'),
      payerAccountNumber: getFieldValue('payerAccountNumber'),
      payerIfsc: getFieldValue('payerIfsc'),
      bankUtr: getFieldValue('bankUtr'),
    };
  }

  function renderBankDetails() {
    const container = document.getElementById('bankDetails');
    if (!container) return;

    // With nothing configured yet, show every field as "to be confirmed" rather
    // than an empty box. Once some are filled in, show only those.
    const configured = bankDetails && Object.values(bankDetails).some((v) => v);
    const rows = [
      ['Account name', bankDetails && bankDetails.accountName],
      ['Account number', bankDetails && bankDetails.accountNumber],
      ['IFSC code', bankDetails && bankDetails.ifsc],
      ['Bank', bankDetails && bankDetails.bankName],
      ['Branch', bankDetails && bankDetails.branch],
    ].filter(([, value]) => value || !configured);

    container.innerHTML = rows
      .map(([label, value]) => {
        const shown = value
          ? escapeHtml(value)
          : '<span class="missing">to be confirmed</span>';
        return `<dt>${label}</dt><dd>${shown}</dd>`;
      })
      .join('');
  }

  function showPaymentBlocks() {
    const method = getFieldValue('paymentMethod') || 'UPI';
    document.getElementById('upiBlock').hidden = method !== 'UPI';
    document.getElementById('bankBlock').hidden = method !== 'Bank Transfer';
  }

  /** Closes the form when the field is full or the entry window has passed. */
  function applyRegistrationStatus(status) {
    if (!status) return;

    const placesLeft = document.getElementById('placesLeft');
    if (placesLeft && status.count !== null && status.open) {
      const remaining = Math.max(0, status.cap - status.count);
      placesLeft.textContent = `Entries close ${status.closesOn} · ${remaining} of ${status.cap} places left`;
    }

    if (status.open) return;

    const message = status.closedByCap
      ? `Registration is full — all ${status.cap} places have been taken.`
      : `Registration closed on ${status.closesOn}.`;

    formBodyForm.style.display = 'none';
    formFooter.style.display = 'none';
    showError(message);
    if (placesLeft) placesLeft.textContent = message;
    document.querySelectorAll('.js-open-register').forEach((btn) => {
      btn.disabled = true;
      btn.title = message;
    });
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
    const amount = fees[category] || 500;

    // Each fee has its own QR with that amount pre-filled.
    const qrImage = document.querySelector('.upi-qr img');
    if (qrImage) qrImage.src = `assets/upi-qr-${amount}.png`;
    const qrAmount = document.getElementById('upiQrAmount');
    if (qrAmount) qrAmount.textContent = `₹${amount}`;
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
    const fee = fees[data.category] || 500;
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
      const seq = document.getElementById('successSeq');
      if (seq && data.sequenceNo) {
        seq.textContent = `You are participant no. ${data.sequenceNo} of 300.`;
      }
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

  document.getElementById('paymentMethod').addEventListener('change', () => {
    hideError();
    showPaymentBlocks();
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
