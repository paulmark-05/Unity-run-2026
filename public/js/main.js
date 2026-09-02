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
    'SECTION 3 OF 4 · DECLARATION & DISCLAIMER',
    'SECTION 4 OF 4 · REVIEW & PAYMENT',
  ];

  let currentStep = 1;
  let fees = { '6K': 500, '4K': 300 };
  let upiVpa = null;
  let upiPayeeName = 'Unity Run 2026';
  let upiOrgId = '159020';
  let upiMerchantCode = '7800';
  let bankDetails = null;
  let emailVerified = false;
  let verifiedEmail = null;

  const GROUP_OF_CATEGORY = { '6K': 'run', '4K': 'walk' };
  // Cached so the bento tiles' progress bars can be redrawn from socket
  // "counts" pushes (frequent) without waiting on a fresh "registration"
  // status fetch (rare — only changes when a group fills or closes).
  let groupCaps = { run: 500, walk: 300 };

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
      nextBtn.disabled = false;
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

  // Loose match for the name-vs-signature check — case and extra spacing
  // shouldn't fail someone who typed their own name correctly.
  function normalizeName(str) {
    return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function validateStep(n) {
    if (n === 1) {
      if (!getFieldValue('fullName')) return 'Please enter your full name.';
      if (!getFieldValue('dob')) return 'Please enter your date of birth.';
      if (!getFieldValue('gender')) return 'Please select a gender option.';
      if (!getFieldValue('bloodGroup')) return 'Please select your blood group.';
      const email = getFieldValue('email');
      if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email address.';
      if (!emailVerified || verifiedEmail !== email.toLowerCase()) {
        return 'Please verify your email address with the code sent to it.';
      }
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
      if (!getFieldValue('waiverAccepted')) return 'You must agree to the participant disclaimer to continue.';
      if (!getFieldValue('signature')) return 'Please type your full name as digital consent.';
      if (normalizeName(getFieldValue('signature')) !== normalizeName(getFieldValue('fullName'))) {
        return 'Your name and signature do not match. Please type your full name exactly as entered in Step 1.';
      }
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
      bloodGroup: getFieldValue('bloodGroup'),
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
   * The 6K run and the 4K walk have separate slot pools, so "full" is a
   * per-group state, not a single site-wide switch. Disables just the pills
   * for a full group, and only shuts down the whole form if every group
   * (or the date) has closed registration entirely.
   */
  function applyRegistrationStatus(status) {
    if (!status || !status.groups) return;

    const { run, walk } = status.groups;
    const closed = status.closedByDate;

    const runCapNote = document.getElementById('runCapNote');
    if (runCapNote && run) runCapNote.textContent = `seats left · of ${run.cap}`;
    const walkCapNote = document.getElementById('walkCapNote');
    if (walkCapNote && walk) walkCapNote.textContent = `seats left · of ${walk.cap}`;
    if (run && run.cap) groupCaps.run = run.cap;
    if (walk && walk.cap) groupCaps.walk = walk.cap;

    const categoryInputs = {
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
    // This is a merchant UPI ID (registered with a specific orgid/merchant
    // category code at the bank) — a payment request missing those fields
    // opens fine and even reaches the PIN screen, but the bank's backend
    // then rejects it at settlement since it can't route/attribute the
    // payment to the merchant account. The printed QR includes them and
    // works end-to-end, so the tap link needs to mirror it exactly. Only
    // real fix kept from the last attempt: build the query by hand with
    // %20 instead of letting URLSearchParams encode spaces as "+", which
    // some UPI apps' lightweight parsers don't decode back to a space.
    const vpa = (upiVpa || '').trim();
    const payeeName = (upiPayeeName || '').trim();
    const upiEncode = (v) => encodeURIComponent(v);
    const params = [
      'ver=01',
      `pa=${upiEncode(vpa)}`,
      `pn=${upiEncode(payeeName)}`,
      `tn=${upiEncode(`Unity Run 2026 ${category || ''}`.trim())}`,
      `am=${upiEncode(String(amount))}`,
      'cu=INR',
      'mode=00',
      'purpose=00',
      `orgid=${upiEncode(upiOrgId)}`,
      `mc=${upiEncode(upiMerchantCode)}`,
    ].join('&');
    link.href = `upi://pay?${params}`;
    // Display only — lowercase reads friendlier than a shouty all-caps VPA.
    // The actual payment param above keeps the exact configured value.
    vpaText.textContent = vpa.toLowerCase();
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

  // ---------- Email OTP verification ----------
  (function initEmailOtp() {
    const emailInput = document.getElementById('email');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpRow = document.getElementById('otpRow');
    const emailOtpInput = document.getElementById('emailOtp');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const otpStatus = document.getElementById('otpStatus');
    if (!emailInput || !sendOtpBtn) return;

    function setStatus(message, kind) {
      otpStatus.textContent = message;
      otpStatus.className = `otp-status${kind ? ` ${kind}` : ''}`;
    }

    function resetVerification() {
      if (!emailVerified) return;
      emailVerified = false;
      verifiedEmail = null;
      sendOtpBtn.hidden = false;
      otpRow.hidden = true;
      setStatus('', '');
    }

    // Any edit to an already-verified email invalidates that verification —
    // otherwise a runner could verify one address, then swap in another.
    emailInput.addEventListener('input', resetVerification);

    sendOtpBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setStatus('Enter a valid email address first.', 'error');
        return;
      }
      sendOtpBtn.disabled = true;
      sendOtpBtn.textContent = 'Sending…';
      try {
        const res = await fetch('api/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not send the code.');
        otpRow.hidden = false;
        emailOtpInput.value = '';
        emailOtpInput.focus();
        setStatus('Code sent — check your inbox.', '');
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        sendOtpBtn.disabled = false;
        sendOtpBtn.textContent = 'Send Code';
      }
    });

    verifyOtpBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const otp = emailOtpInput.value.trim();
      if (!otp) {
        setStatus('Enter the code from your email.', 'error');
        return;
      }
      verifyOtpBtn.disabled = true;
      try {
        const res = await fetch('api/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Incorrect code.');
        emailVerified = true;
        verifiedEmail = email.toLowerCase();
        otpRow.hidden = true;
        sendOtpBtn.hidden = true;
        setStatus('✓ Email verified', 'success');
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        verifyOtpBtn.disabled = false;
      }
    });
  })();

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

  // Mobile nav — a side drawer with a dimmed backdrop.
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const navOverlay = document.getElementById('navOverlay');
  const navDrawerClose = document.getElementById('navDrawerClose');
  if (navToggle && navLinks) {
    const closeNav = () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      if (navOverlay) navOverlay.classList.remove('open');
    };
    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      if (navOverlay) navOverlay.classList.toggle('open', isOpen);
    });
    if (navDrawerClose) navDrawerClose.addEventListener('click', closeNav);
    if (navOverlay) navOverlay.addEventListener('click', closeNav);
    // Anchor links and the Register button both close the drawer behind them.
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

  // Shows seats *remaining*, counting down — not how many have registered.
  // registered is total sign-ups (any payment status; a slot is held the
  // moment someone registers, same number the cap check enforces against).
  function setCounter(group, registered) {
    const el = document.querySelector(`.flip-group[data-group="${group}"]`);
    if (!el) return;
    const cap = groupCaps[group] || 1;
    const taken = Math.max(0, registered);
    const seatsLeft = Math.max(0, cap - taken);
    const cells = el.querySelectorAll('.flip-cell');
    const str = String(seatsLeft).padStart(cells.length, '0').slice(-cells.length);
    cells.forEach((cell, i) => flipCellTo(cell, str[i]));

    const bar = document.getElementById(`${group}BarFill`);
    if (bar) {
      bar.style.width = `${Math.min(100, (taken / cap) * 100)}%`;
    }
  }

  // The 6K is the "Run" counter, 4K stands alone as "Walk" — matches how the
  // slot caps are grouped, so the number on screen is the same one that's
  // actually being checked against a cap.
  function applyCounts(counts) {
    if (!counts) return;
    setCounter('run', counts['6K'] || 0);
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
    const socket = window.io();
    socket.on('counts', applyCounts);
  }

  // ---------- Photo gallery ----------
  (function initGallery() {
    const yearTabsEl = document.getElementById('galleryYearTabs');
    const carouselEl = document.getElementById('galleryCarousel');
    const emptyEl = document.getElementById('galleryEmpty');
    const frameEl = document.getElementById('carouselFrame');
    const bgEl = document.getElementById('carouselBg');
    const imgEl = document.getElementById('carouselImg');
    const counterEl = document.getElementById('carouselCounter');
    const progressEl = document.getElementById('carouselProgress');
    const thumbsEl = document.getElementById('carouselThumbs');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    if (!yearTabsEl) return;

    const AUTOPLAY_MS = 4500;
    const FADE_MS = 400;
    let galleries = [];
    let activeYear = null;
    let activeIndex = 0;
    let autoplayTimer = null;
    let fadeTimer = null;
    let hovering = false;

    function photosForYear(year) {
      const g = galleries.find((gal) => gal.year === year);
      return g ? g.photos : [];
    }

    function stopProgress() {
      progressEl.style.transition = 'none';
      progressEl.style.width = '0%';
    }

    function runProgress() {
      stopProgress();
      // Force a reflow so the browser registers the 0% width before the
      // transition below starts — otherwise it never animates from 0.
      void progressEl.offsetWidth;
      progressEl.style.transition = `width ${AUTOPLAY_MS}ms linear`;
      progressEl.style.width = '100%';
    }

    function stopAutoplay() {
      if (autoplayTimer) clearInterval(autoplayTimer);
      autoplayTimer = null;
      stopProgress();
    }

    function startAutoplay() {
      stopAutoplay();
      if (hovering) return;
      const photos = photosForYear(activeYear);
      if (photos.length < 2) return;
      runProgress();
      autoplayTimer = setInterval(() => showPhoto(activeIndex + 1), AUTOPLAY_MS);
    }

    // A short crossfade: fade the current photo + its blurred backdrop out,
    // swap the src underneath while invisible, then fade back in. Keeps the
    // transition feeling deliberate instead of a jarring instant swap.
    function showPhoto(index) {
      const photos = photosForYear(activeYear);
      if (!photos.length) return;
      activeIndex = ((index % photos.length) + photos.length) % photos.length;
      const photo = photos[activeIndex];

      if (fadeTimer) clearTimeout(fadeTimer);
      frameEl.classList.add('fading');
      fadeTimer = setTimeout(() => {
        const src = `assets/gallery/${activeYear}/${photo.file}`;
        imgEl.src = src;
        bgEl.src = src;
        imgEl.alt = `Unity Run ${activeYear} photo ${activeIndex + 1}`;
        frameEl.classList.remove('fading');
      }, FADE_MS);

      counterEl.textContent = `${activeIndex + 1} / ${photos.length}`;
      thumbsEl.querySelectorAll('.carousel-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === activeIndex);
      });
    }

    function renderCarousel(year) {
      activeYear = year;
      const photos = photosForYear(year);
      if (!photos.length) {
        carouselEl.hidden = true;
        emptyEl.hidden = false;
        stopAutoplay();
        return;
      }
      carouselEl.hidden = false;
      emptyEl.hidden = true;
      thumbsEl.innerHTML = photos
        .map((p, i) => `<img class="carousel-thumb" src="assets/gallery/${year}/${p.thumb}" alt="" data-index="${i}" />`)
        .join('');
      thumbsEl.querySelectorAll('.carousel-thumb').forEach((t) => {
        t.addEventListener('click', () => {
          showPhoto(Number(t.dataset.index));
          startAutoplay();
        });
      });
      activeIndex = 0;
      const first = photos[0];
      const firstSrc = `assets/gallery/${year}/${first.file}`;
      imgEl.src = firstSrc;
      bgEl.src = firstSrc;
      imgEl.alt = `Unity Run ${year} photo 1`;
      counterEl.textContent = `1 / ${photos.length}`;
      thumbsEl.querySelectorAll('.carousel-thumb').forEach((t, i) => t.classList.toggle('active', i === 0));
      startAutoplay();
    }

    function renderYearTabs() {
      yearTabsEl.innerHTML = galleries
        .map((g, i) => `<button type="button" class="year-tab${i === 0 ? ' active' : ''}" data-year="${g.year}">${g.year}</button>`)
        .join('');
      yearTabsEl.querySelectorAll('.year-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          yearTabsEl.querySelectorAll('.year-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          renderCarousel(btn.dataset.year);
        });
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { showPhoto(activeIndex - 1); startAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { showPhoto(activeIndex + 1); startAutoplay(); });

    if (frameEl) {
      // Hovering pauses autoplay (and hides the countdown) rather than just
      // resetting it, so lingering over a photo never feels like fighting the timer.
      frameEl.addEventListener('mouseenter', () => { hovering = true; stopAutoplay(); });
      frameEl.addEventListener('mouseleave', () => { hovering = false; startAutoplay(); });

      // Left/right arrow keys navigate while the pointer is over the frame —
      // scoped this way so they never fight the registration modal's own
      // inputs elsewhere on the page.
      frameEl.setAttribute('tabindex', '0');
      frameEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { showPhoto(activeIndex - 1); startAutoplay(); }
        if (e.key === 'ArrowRight') { showPhoto(activeIndex + 1); startAutoplay(); }
      });

      // Touch swipe: a horizontal drag past the threshold moves one photo;
      // anything shorter is treated as a tap/scroll and ignored.
      let touchStartX = null;
      frameEl.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
      frameEl.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) { showPhoto(activeIndex + 1); startAutoplay(); }
        else { showPhoto(activeIndex - 1); startAutoplay(); }
      });
    }

    // ---------- Lightbox: full photo, no crop, download/share with a tag ----------
    const lightboxOverlay = document.getElementById('lightboxOverlay');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxTag = document.getElementById('lightboxTag');
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxDownload = document.getElementById('lightboxDownload');
    const lightboxShare = document.getElementById('lightboxShare');

    // Jumps straight to a photo — no crossfade, since the carousel sits
    // hidden behind the lightbox at this point. Keeps the carousel (counter,
    // active thumbnail, current image) in sync so closing the lightbox never
    // shows something different from what was just being viewed.
    function lightboxGoTo(index) {
      const photos = photosForYear(activeYear);
      if (!photos.length) return;
      activeIndex = ((index % photos.length) + photos.length) % photos.length;
      const photo = photos[activeIndex];
      const src = `assets/gallery/${activeYear}/${photo.file}`;
      imgEl.src = src;
      bgEl.src = src;
      imgEl.alt = `Unity Run ${activeYear} photo ${activeIndex + 1}`;
      counterEl.textContent = `${activeIndex + 1} / ${photos.length}`;
      thumbsEl.querySelectorAll('.carousel-thumb').forEach((t, i) => t.classList.toggle('active', i === activeIndex));
      lightboxImg.src = src;
      lightboxImg.alt = imgEl.alt;
      lightboxTag.textContent = `Unity Run ${activeYear}`;
    }

    function openLightbox() {
      hovering = true;
      stopAutoplay();
      lightboxGoTo(activeIndex);
      lightboxOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      lightboxOverlay.classList.remove('open');
      document.body.style.overflow = '';
      hovering = false;
      startAutoplay();
    }

    function loadImageEl(src) {
      return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
      });
    }

    // Draws the current photo onto a canvas with a small "UNITY RUN <year>"
    // label stamped in the bottom-left, so the branding travels with the
    // file wherever it's downloaded or shared to.
    async function buildTaggedImageBlob() {
      const photos = photosForYear(activeYear);
      const photo = photos[activeIndex];
      const src = `assets/gallery/${activeYear}/${photo.file}`;
      const im = await loadImageEl(src);

      const canvas = document.createElement('canvas');
      canvas.width = im.naturalWidth;
      canvas.height = im.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(im, 0, 0);

      const label = `UNITY RUN ${activeYear}`;
      const fontSize = Math.max(18, Math.round(canvas.width * 0.026));
      const letterSpacing = fontSize * 0.12;
      const paddingX = Math.round(fontSize * 0.9);
      const paddingY = Math.round(fontSize * 0.65);
      const margin = Math.round(canvas.width * 0.035);

      ctx.font = `700 ${fontSize}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      let textWidth = 0;
      for (const ch of label) textWidth += ctx.measureText(ch).width + letterSpacing;
      textWidth -= letterSpacing;

      const tagWidth = textWidth + paddingX * 2;
      const tagHeight = fontSize + paddingY * 2;
      const tagX = margin;
      const tagY = canvas.height - margin - tagHeight;

      ctx.fillStyle = '#1B2260';
      ctx.fillRect(tagX, tagY, tagWidth, tagHeight);

      ctx.fillStyle = '#FFFFFF';
      let cursorX = tagX + paddingX;
      const textY = tagY + tagHeight / 2 + fontSize * 0.02;
      for (const ch of label) {
        ctx.fillText(ch, cursorX, textY);
        cursorX += ctx.measureText(ch).width + letterSpacing;
      }

      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    if (imgEl) imgEl.addEventListener('click', openLightbox);
    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxOverlay) {
      lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) closeLightbox();
      });
    }
    if (lightboxPrev) lightboxPrev.addEventListener('click', () => lightboxGoTo(activeIndex - 1));
    if (lightboxNext) lightboxNext.addEventListener('click', () => lightboxGoTo(activeIndex + 1));
    document.addEventListener('keydown', (e) => {
      if (!lightboxOverlay || !lightboxOverlay.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxGoTo(activeIndex - 1);
      if (e.key === 'ArrowRight') lightboxGoTo(activeIndex + 1);
    });

    if (lightboxDownload) {
      lightboxDownload.addEventListener('click', async () => {
        lightboxDownload.disabled = true;
        try {
          const blob = await buildTaggedImageBlob();
          downloadBlob(blob, `unity-run-${activeYear}-${String(activeIndex + 1).padStart(2, '0')}.jpg`);
        } catch (err) {
          console.error('download failed:', err.message);
        } finally {
          lightboxDownload.disabled = false;
        }
      });
    }

    if (lightboxShare) {
      lightboxShare.addEventListener('click', async () => {
        lightboxShare.disabled = true;
        try {
          const blob = await buildTaggedImageBlob();
          const filename = `unity-run-${activeYear}-${String(activeIndex + 1).padStart(2, '0')}.jpg`;
          const file = new File([blob], filename, { type: 'image/jpeg' });
          const shareText = `Unity Run ${activeYear} — Zila Sainik Board, North 24 Parganas`;

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `Unity Run ${activeYear}`, text: shareText });
          } else if (navigator.share) {
            // Browser can share text/links but not files — still better than nothing.
            await navigator.share({ title: `Unity Run ${activeYear}`, text: shareText, url: window.location.href });
          } else {
            // No Web Share API at all (most desktop browsers) — download instead.
            downloadBlob(blob, filename);
          }
        } catch (err) {
          // AbortError just means the user closed the native share sheet.
          if (err.name !== 'AbortError') console.error('share failed:', err.message);
        } finally {
          lightboxShare.disabled = false;
        }
      });
    }

    fetch('api/gallery')
      .then((r) => r.json())
      .then((data) => {
        galleries = data.galleries || [];
        if (!galleries.length) {
          yearTabsEl.hidden = true;
          emptyEl.hidden = false;
          return;
        }
        renderYearTabs();
        renderCarousel(galleries[0].year);
      })
      .catch(() => {
        emptyEl.hidden = false;
      });
  })();

  // ---------- Results ----------
  (function initResults() {
    const yearTabsEl = document.getElementById('resultsYearTabs');
    const bodyEl = document.getElementById('resultsBody');
    if (!yearTabsEl || !bodyEl) return;

    let results = [];
    const RESULT_CATEGORY_LABELS = { '6K': '6K Timed Run' };
    const NOT_PUBLISHED_HTML = '<p class="results-notice">Result will be published after completion of the event.</p>';

    function winnerRow(entry, place) {
      if (!entry) {
        return `<div class="winner-row"><span><span class="place">${place}.</span>—</span></div>`;
      }
      const bib = entry.bib ? ` <span class="sans">(Bib ${escapeHtml(entry.bib)})</span>` : '';
      return `<div class="winner-row"><span><span class="place">${place}.</span>${escapeHtml(entry.name || '—')}${bib}</span><span class="time">${escapeHtml(entry.time || '')}</span></div>`;
    }

    function renderYear(year) {
      const yearData = results.find((r) => r.year === year);
      if (!yearData || !yearData.published) {
        bodyEl.innerHTML = NOT_PUBLISHED_HTML;
        return;
      }

      const sections = Object.entries(yearData.categories).map(([category, data]) => {
        const label = RESULT_CATEGORY_LABELS[category] || category;
        const winners = data.prizeWinners;
        const rows = data.fullResults
          .map(
            (r) =>
              `<tr><td>${r.rank ?? ''}</td><td>${escapeHtml(r.bib || '')}</td><td>${escapeHtml(r.name || '')}</td><td>${escapeHtml(r.gender || '')}</td><td>${escapeHtml(r.time || '')}</td></tr>`
          )
          .join('');

        return `
          <div class="results-category">
            <h3>${label}</h3>
            <div class="winners-grid">
              <div class="winner-group">
                <h4>Male</h4>
                ${winners.male.map((entry, i) => winnerRow(entry, i + 1)).join('')}
              </div>
              <div class="winner-group">
                <h4>Female</h4>
                ${winners.female.map((entry, i) => winnerRow(entry, i + 1)).join('')}
              </div>
            </div>
            <div class="results-table-wrap">
              <table class="results-table">
                <thead><tr><th>Rank</th><th>Bib</th><th>Name</th><th>Gender</th><th>Time</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
      });

      bodyEl.innerHTML = sections.join('') || NOT_PUBLISHED_HTML;
    }

    function renderYearTabs() {
      yearTabsEl.innerHTML = results
        .map((r, i) => `<button type="button" class="year-tab${i === 0 ? ' active' : ''}" data-year="${r.year}">${r.year}</button>`)
        .join('');
      yearTabsEl.querySelectorAll('.year-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          yearTabsEl.querySelectorAll('.year-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          renderYear(btn.dataset.year);
        });
      });
    }

    fetch('api/results')
      .then((r) => r.json())
      .then((data) => {
        results = data.results || [];
        if (!results.length) return;
        renderYearTabs();
        renderYear(results[0].year);
      })
      .catch(() => {
        bodyEl.innerHTML = NOT_PUBLISHED_HTML;
      });
  })();
})();
