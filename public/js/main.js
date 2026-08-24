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

  const GROUP_OF_CATEGORY = { '10K': 'run', '6K': 'run', '4K': 'walk' };
  // Cached so the bento tiles' progress bars can be redrawn from socket
  // "counts" pushes (frequent) without waiting on a fresh "registration"
  // status fetch (rare — only changes when a group fills or closes).
  let groupCaps = { run: 300, walk: 200 };

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    resetToStep1();
    fetch('api/config')
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
      updatePaymentGate();
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
      if (!getFieldValue('liabilityAccepted')) return 'You must accept the voluntary participation declaration before paying.';
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
      liabilityAccepted: getFieldValue('liabilityAccepted'),
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

  /** Payment fields stay visible but are inert, and Submit is disabled, until
   *  the voluntary-participation declaration is checked. */
  function updatePaymentGate() {
    const accepted = getFieldValue('liabilityAccepted');
    const paymentSection = document.getElementById('paymentSection');
    if (paymentSection) paymentSection.classList.toggle('payment-section-disabled', !accepted);
    if (currentStep === 4) nextBtn.disabled = !accepted;
  }

  /**
   * The 10K/6K run and the 4K walk have separate slot pools, so "full" is a
   * per-group state, not a single site-wide switch. Disables just the pills
   * for a full group, and only shuts down the whole form if every group
   * (or the date) has closed registration entirely.
   */
  function applyRegistrationStatus(status) {
    if (!status || !status.groups) return;

    const { run, walk } = status.groups;
    const closed = status.closedByDate;

    const runCapNote = document.getElementById('runCapNote');
    if (runCapNote && run) runCapNote.textContent = `registered · of ${run.cap}`;
    const walkCapNote = document.getElementById('walkCapNote');
    if (walkCapNote && walk) walkCapNote.textContent = `registered · of ${walk.cap}`;
    if (run && run.cap) groupCaps.run = run.cap;
    if (walk && walk.cap) groupCaps.walk = walk.cap;

    const categoryInputs = {
      '10K': document.getElementById('cat10k'),
      '6K': document.getElementById('cat6k'),
      '4K': document.getElementById('cat4k'),
    };
    Object.entries(categoryInputs).forEach(([category, input]) => {
      if (!input) return;
      const groupStatus = GROUP_OF_CATEGORY[category] === 'walk' ? walk : run;
      const full = closed || Boolean(groupStatus && groupStatus.full);
      input.disabled = full;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        if (!label.dataset.baseText) label.dataset.baseText = label.textContent;
        label.textContent = full ? `${label.dataset.baseText} — FULL` : label.dataset.baseText;
      }
    });

    const placesLeft = document.getElementById('placesLeft');
    if (placesLeft) {
      if (closed) {
        placesLeft.textContent = `Registration closed on ${status.closesOn}.`;
      } else {
        const parts = [`Entries close ${status.closesOn}`];
        if (run && run.count !== null) parts.push(`${Math.max(0, run.cap - run.count)} of ${run.cap} run places left`);
        if (walk && walk.count !== null) parts.push(`${Math.max(0, walk.cap - walk.count)} of ${walk.cap} walk places left`);
        placesLeft.textContent = parts.join(' · ');
      }
    }

    const everythingFull = run && walk && run.full && walk.full;
    if (!closed && !everythingFull) return;

    const message = closed
      ? `Registration closed on ${status.closesOn}.`
      : 'Registration is full — all places have been taken.';
    formBodyForm.style.display = 'none';
    formFooter.style.display = 'none';
    showError(message);
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
      const res = await fetch('api/register', { method: 'POST', body: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration could not be completed.');

      document.getElementById('successBib').textContent = data.registrationId;
      const seq = document.getElementById('successSeq');
      if (seq && data.sequenceNo) {
        seq.textContent = `Your registration number is ${data.sequenceNo}.`;
      }
      formBodyForm.style.display = 'none';
      formFooter.style.display = 'none';
      successView.style.display = 'block';
    } catch (err) {
      // showStep() clears the error banner as part of resetting the step, so it
      // must run before showError() — otherwise the message we're about to set
      // gets wiped immediately and the user never sees why it failed.
      setSubmitting(false);
      showStep(4);
      showError(err.message || 'Registration could not be saved. Please try again.');
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

  document.getElementById('liabilityAccepted').addEventListener('change', () => {
    hideError();
    updatePaymentGate();
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

  // Mobile nav dropdown
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    const closeNav = () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    };
    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
    // Anchor links and the Register button both close the dropdown behind them.
    navLinks.querySelectorAll('a, button').forEach((el) => el.addEventListener('click', closeNav));
    document.addEventListener('click', (e) => {
      if (navLinks.classList.contains('open') && !navLinks.contains(e.target) && e.target !== navToggle) {
        closeNav();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNav();
    });
  }

  // ---------- Live registration counters ----------
  // A per-digit flip: rotate the current digit away, swap the text at the
  // point it's edge-on (so the switch is invisible), then rotate the new
  // digit in from the same edge.
  function flipCellTo(cell, newChar) {
    if (cell.textContent === newChar) return;
    cell.style.transition = 'transform 0.15s linear';
    cell.style.transform = 'rotateX(90deg)';
    setTimeout(() => {
      cell.textContent = newChar;
      cell.style.transition = 'none';
      cell.style.transform = 'rotateX(-90deg)';
      cell.offsetHeight; // force reflow so the next line's transition applies
      requestAnimationFrame(() => {
        cell.style.transition = 'transform 0.15s linear';
        cell.style.transform = 'rotateX(0deg)';
      });
    }, 150);
  }

  function setCounter(group, value) {
    const el = document.querySelector(`.flip-group[data-group="${group}"]`);
    if (!el) return;
    const cells = el.querySelectorAll('.flip-cell');
    const str = String(Math.max(0, value)).padStart(cells.length, '0').slice(-cells.length);
    cells.forEach((cell, i) => flipCellTo(cell, str[i]));

    const bar = document.getElementById(`${group}BarFill`);
    if (bar) {
      const cap = groupCaps[group] || 1;
      bar.style.width = `${Math.min(100, (Math.max(0, value) / cap) * 100)}%`;
    }
  }

  // 10K and 6K share one "Run" counter, 4K stands alone as "Walk" — matches
  // how the slot caps are grouped, so the number on screen is the same one
  // that's actually being checked against a cap.
  function applyCounts(counts) {
    if (!counts) return;
    setCounter('run', (counts['10K'] || 0) + (counts['6K'] || 0));
    setCounter('walk', counts['4K'] || 0);
  }

  // Prime the counters and cap notes on page load — they're in the hero now,
  // visible before anyone opens the registration modal. Socket.IO keeps the
  // counters live after that; cap notes only change if a group fills up or
  // closes, so they just refresh whenever the modal is opened again.
  fetch('api/config')
    .then((r) => r.json())
    .then((cfg) => {
      // Order matters: applyRegistrationStatus caches the real per-group caps
      // that applyCounts needs to size the progress bars correctly.
      applyRegistrationStatus(cfg.registration);
      applyCounts(cfg.counts);
    })
    .catch(() => {});

  if (window.io) {
    const socket = window.io({ path: '/unity-run/socket.io' });
    socket.on('counts', applyCounts);
  }
})();
