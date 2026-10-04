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
  const scrollGuide = document.getElementById('scrollGuide');

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
  let bankDetails = null;
  let emailVerified = false;
  let verifiedEmail = null;

  const GROUP_OF_CATEGORY = { '6K': 'run', '4K': 'walk' };
  // Cached so the bento tiles' progress bars can be redrawn from socket
  // "counts" pushes (frequent) without waiting on a fresh "registration"
  // status fetch (rare — only changes when a group fills or closes).
  let groupCaps = { run: 150, walk: 150 };

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
    scrollGuide.hidden = true;
  }

  function resetToStep1() {
    currentStep = 1;
    hideError();
    successView.style.display = 'none';
    formFooter.style.display = 'flex';
    formBodyForm.style.display = 'block';
    showStep(1);
  }

  // Hides the "scroll down to submit" guide once the submit button is
  // actually on screen — it only makes sense while the runner still has to
  // scroll to find it. `root: modal` because the modal itself scrolls, not
  // the page behind it.
  const scrollGuideObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      scrollGuide.hidden = currentStep !== 4 || entry.isIntersecting;
    },
    { root: modal, threshold: 0.6 }
  );
  scrollGuideObserver.observe(nextBtn);

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
      scrollGuide.hidden = false;
    } else {
      nextBtn.disabled = false;
      nextBtn.append('Continue ');
      nextBtn.append(arrow);
      scrollGuide.hidden = true;
    }
    hideError();
  }

  // Scrolls the field that failed validation into the middle of the modal
  // and flashes a red outline around it, so the runner sees exactly what's
  // wrong instead of having to hunt through the step for a blank box.
  function scrollToField(fieldName) {
    if (!fieldName) return false;
    const el = form.elements[fieldName];
    if (!el) return false;
    const node = el instanceof RadioNodeList ? el[0] : el;
    if (!node) return false;
    const target =
      node.closest('.f-group') ||
      node.closest('.fieldset') ||
      node.closest('.waiver-check') ||
      node;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('field-invalid');
    void target.offsetWidth; // restart the highlight animation on repeat errors
    target.classList.add('field-invalid');
    const clearHighlight = () => target.classList.remove('field-invalid');
    target.addEventListener('input', clearHighlight, { once: true });
    target.addEventListener('change', clearHighlight, { once: true });
    const focusableTypes = ['text', 'email', 'tel', 'date', 'number', ''];
    if (
      typeof node.focus === 'function' &&
      (node.tagName === 'SELECT' || node.tagName === 'TEXTAREA' || focusableTypes.includes(node.type))
    ) {
      node.focus({ preventScroll: true });
    }
    return true;
  }

  // `errorOrMessage` is either a plain string (server-side failures, which
  // aren't tied to one on-screen field) or a { message, field } object from
  // validateStep(). Either way this both shows the banner and scrolls
  // whatever's relevant into view — the banner alone is easy to miss once
  // the runner has scrolled down into a long step.
  function showError(errorOrMessage) {
    const isObj = errorOrMessage && typeof errorOrMessage === 'object';
    const message = isObj ? errorOrMessage.message : errorOrMessage;
    const field = isObj ? errorOrMessage.field : null;
    formError.textContent = message;
    formError.classList.add('show');
    if (!scrollToField(field)) {
      formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  // Returns { message, field } for the first problem found, or null if the
  // step is valid. `field` is a form element name (matches form.elements[]
  // and getFieldValue()) so the caller can scroll to and highlight exactly
  // what needs fixing, instead of just showing a banner the runner has to
  // hunt for.
  function invalid(message, field) {
    return { message, field };
  }

  function validateStep(n) {
    if (n === 1) {
      if (!getFieldValue('fullName')) return invalid('Please enter your full name.', 'fullName');
      if (!getFieldValue('dob')) return invalid('Please enter your date of birth.', 'dob');
      if (!getFieldValue('gender')) return invalid('Please select a gender option.', 'gender');
      if (!getFieldValue('bloodGroup')) return invalid('Please select your blood group.', 'bloodGroup');
      const email = getFieldValue('email');
      if (!/^\S+@\S+\.\S+$/.test(email)) return invalid('Please enter a valid email address.', 'email');
      if (!emailVerified || verifiedEmail !== email.toLowerCase()) {
        return invalid('Please verify your email address with the code sent to it.', 'email');
      }
      const mobile = getFieldValue('mobile');
      if (!/^[0-9+\-\s]{7,15}$/.test(mobile)) return invalid('Please enter a valid mobile number.', 'mobile');
      if (!getFieldValue('emergencyName')) return invalid('Please enter an emergency contact name.', 'emergencyName');
      if (!getFieldValue('emergencyRelationship')) return invalid('Please enter the emergency contact relationship.', 'emergencyRelationship');
      if (!getFieldValue('emergencyNumber')) return invalid('Please enter an emergency contact number.', 'emergencyNumber');
    }
    if (n === 2) {
      if (!getFieldValue('category')) return invalid('Please select a run category.', 'category');
      if (!getFieldValue('tshirtSize')) return invalid('Please select a T-shirt size.', 'tshirtSize');
    }
    if (n === 3) {
      if (!getFieldValue('waiverAccepted')) return invalid('You must agree to the participant disclaimer to continue.', 'waiverAccepted');
      if (!getFieldValue('signature')) return invalid('Please type your full name as digital consent.', 'signature');
      if (normalizeName(getFieldValue('signature')) !== normalizeName(getFieldValue('fullName'))) {
        return invalid('Your name and signature do not match. Please type your full name exactly as entered in Step 1.', 'signature');
      }
    }
    if (n === 4) {
      if (!getFieldValue('liabilityAccepted')) return invalid('You must accept the voluntary participation declaration before paying.', 'liabilityAccepted');
      const method = getFieldValue('paymentMethod');
      if (method === 'Bank Transfer') {
        if (!getFieldValue('payerAccountName')) return invalid('Please enter the account holder name.', 'payerAccountName');
        const accountNumber = getFieldValue('payerAccountNumber');
        if (!accountNumber) return invalid('Please enter the account number you paid from.', 'payerAccountNumber');
        if (!/^\d{6,20}$/.test(accountNumber.replace(/\s/g, ''))) return invalid('That account number looks incorrect — digits only, 6 to 20 of them.', 'payerAccountNumber');
        const ifsc = getFieldValue('payerIfsc');
        if (!ifsc) return invalid('Please enter your bank’s IFSC code.', 'payerIfsc');
        if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(ifsc)) return invalid('That IFSC code looks incorrect — it should look like SBIN0001234.', 'payerIfsc');
        const utr = getFieldValue('bankUtr');
        if (!utr) return invalid('Please enter the UTR / reference number from your transfer.', 'bankUtr');
      } else {
        const upiId = getFieldValue('upiId');
        if (!upiId) return invalid('Please enter the UPI ID you paid from.', 'upiId');
        if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiId)) return invalid('That UPI ID looks incomplete — it should look like name@bank.', 'upiId');
        const ref = getFieldValue('upiTxnRef');
        if (!ref) return invalid('Please enter the UPI transaction ID from your payment confirmation.', 'upiTxnRef');
      }
      const fileInput = document.getElementById('paymentScreenshot');
      if (!fileInput.files || !fileInput.files[0]) return invalid('Please upload a screenshot of your UPI payment.', 'paymentScreenshot');
      if (fileInput.files[0].size > 5 * 1024 * 1024) return invalid('That screenshot is larger than 5 MB. Please upload a smaller image.', 'paymentScreenshot');
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
    const details = document.getElementById('upiPayDetails');
    const vpaText = document.getElementById('upiVpaText');
    if (!details) return;

    if (!upiVpa) {
      details.hidden = true;
      return;
    }
    const category = getFieldValue('category');
    const amount = fees[category] || 500;

    const payeeText = document.getElementById('upiPayeeText');
    if (payeeText) payeeText.textContent = (upiPayeeName || '').trim();
    const amountText = document.getElementById('upiAmountText');
    if (amountText) amountText.textContent = `₹${amount}`;
    // Display only, lowercase reads friendlier than a shouty all-caps VPA —
    // the runner pays this manually from their own UPI app, so there's no
    // payment param to keep in sync with it.
    vpaText.textContent = (upiVpa || '').trim().toLowerCase();
    details.hidden = false;
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
      scrollGuide.hidden = true;
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
      modal.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      submitRegistration();
    }
  });

  backBtn.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep -= 1;
      showStep(currentStep);
      modal.scrollTo({ top: 0, behavior: 'smooth' });
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

  // ---------- Photo + video gallery ----------
  (function initGallery() {
    const yearTabsEl = document.getElementById('galleryYearTabs');
    const carouselEl = document.getElementById('galleryCarousel');
    const emptyEl = document.getElementById('galleryEmpty');
    const frameEl = document.getElementById('carouselFrame');
    const bgEl = document.getElementById('carouselBg');
    const imgEl = document.getElementById('carouselImg');
    const videoEl = document.getElementById('carouselVideo');
    const embedEl = document.getElementById('carouselEmbed');
    const socialEl = document.getElementById('carouselSocial');
    const counterEl = document.getElementById('carouselCounter');
    const progressEl = document.getElementById('carouselProgress');
    const thumbsEl = document.getElementById('carouselThumbs');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    const playBadge = document.getElementById('carouselPlay');
    const externalHint = document.getElementById('carouselExternalHint');
    if (!yearTabsEl) return;

    const AUTOPLAY_MS = 4500;
    const FADE_MS = 300;
    let galleries = [];
    let activeYear = null;
    let activeIndex = 0;
    let autoplayTimer = null;
    let fadeTimer = null;
    let hovering = false;
    let instagramScriptPromise = null;

    function itemsForYear(year) {
      const g = galleries.find((gal) => gal.year === year);
      return g ? (Array.isArray(g.items) ? g.items : (g.photos || [])) : [];
    }

    function itemSrc(year, item) {
      return `assets/gallery/${year}/${item.file}`;
    }

    function itemThumb(item, year) {
      if (item.thumb) {
        if (item.thumb.startsWith('http') || item.thumb.startsWith('/') || item.thumb.startsWith('assets/')) return item.thumb;
        return `assets/gallery/${year}/${item.thumb}`;
      }
      return item.file ? `assets/gallery/${year}/thumb/${item.file}` : '';
    }

    function isImage(item) { return item && (item.type === 'image' || !item.type); }
    function isDriveVideo(item) { return item && item.source === 'drive' && item.type === 'video'; }
    function isExternal(item) { return item && item.source === 'external'; }
    function isInstagram(item) { return isExternal(item) && item.platform === 'Instagram'; }
    function isFacebook(item) { return isExternal(item) && item.platform === 'Facebook'; }
    function isYouTube(item) { return isExternal(item) && (item.platform === 'YouTube' || item.platform === 'YouTube Short'); }

    function stopProgress() {
      if (!progressEl) return;
      progressEl.style.transition = 'none';
      progressEl.style.width = '0%';
    }

    function runProgress() {
      stopProgress();
      if (!progressEl) return;
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
      const items = itemsForYear(activeYear);
      const current = items[activeIndex];
      if (items.length < 2 || isDriveVideo(current) || isExternal(current)) return;
      runProgress();
      autoplayTimer = setInterval(() => showItem(activeIndex + 1), AUTOPLAY_MS);
    }

    function clearStage() {
      if (frameEl) frameEl.classList.remove('is-instagram', 'is-facebook', 'is-youtube');
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.removeAttribute('poster');
        videoEl.load();
        videoEl.hidden = true;
      }
      if (embedEl) {
        embedEl.src = 'about:blank';
        embedEl.hidden = true;
      }
      if (socialEl) {
        socialEl.hidden = true;
        socialEl.innerHTML = '';
      }
      if (imgEl) {
        imgEl.hidden = false;
        imgEl.classList.remove('is-video-slide', 'is-external-slide');
      }
      if (bgEl) bgEl.hidden = false;
      if (playBadge) playBadge.hidden = true;
      if (externalHint) externalHint.hidden = true;
    }

    function setPreview(item, year) {
      const src = isImage(item) ? itemSrc(year, item) : itemThumb(item, year);
      if (imgEl) {
        imgEl.src = src;
        imgEl.alt = item.name || `${item.platform || 'Unity Run'} media`;
      }
      if (bgEl) {
        bgEl.src = src;
        bgEl.alt = '';
      }
    }

    function setExternalButton(item, visible = true) {
      if (!externalHint) return;
      externalHint.href = item.url || '#';
      externalHint.textContent = `View on ${item.platform || 'platform'} ↗`;
      externalHint.hidden = !visible || !item.url;
    }

    function updatePlayBadge(item) {
      const playable = isDriveVideo(item) || (isExternal(item) && !isFacebook(item));
      if (playBadge) playBadge.hidden = !playable;
      if (imgEl) imgEl.classList.toggle('is-video-slide', playable);
      if (imgEl) imgEl.classList.toggle('is-external-slide', isExternal(item));
      if (isExternal(item)) setExternalButton(item, true);
    }

    function loadInstagramScript() {
      if (window.instgrm && window.instgrm.Embeds) return Promise.resolve();
      if (instagramScriptPromise) return instagramScriptPromise;
      instagramScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-instagram-embed]');
        if (existing) {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://www.instagram.com/embed.js';
        script.async = true;
        script.dataset.instagramEmbed = 'true';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Instagram embed script could not be loaded.'));
        document.head.appendChild(script);
      });
      return instagramScriptPromise;
    }

    async function activateInstagram(item) {
      if (!isInstagram(item) || !socialEl) return;
      stopAutoplay();
      if (imgEl) imgEl.hidden = true;
      if (bgEl) bgEl.hidden = true;
      if (playBadge) playBadge.hidden = true;
      if (frameEl) frameEl.classList.add('is-instagram');
      socialEl.hidden = false;
      const permalink = item.permalink || item.url || '';
      socialEl.innerHTML = `<div class="instagram-stage"><blockquote class="instagram-media" data-instgrm-permalink="${escapeHtml(permalink)}" data-instgrm-version="14"><a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">View this post on Instagram</a></blockquote></div>`;
      try {
        await loadInstagramScript();
        if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();
      } catch (_) {
        // The highlighted platform button remains available if embedding is blocked.
      }
      setExternalButton(item, true);
    }

    function activateFacebook(item) {
      if (!isFacebook(item)) return;
      // The supplied /share/v/ URL is currently unavailable. Avoid a broken
      // Facebook iframe and present the official Facebook action prominently.
      stopAutoplay();
      if (frameEl) frameEl.classList.add('is-facebook');
      if (playBadge) playBadge.hidden = true;
      if (imgEl) imgEl.hidden = false;
      if (bgEl) bgEl.hidden = false;
      setExternalButton(item, true);
    }

    function activateYouTube(item) {
      if (!isYouTube(item) || !embedEl) return;
      stopAutoplay();
      if (imgEl) imgEl.hidden = true;
      if (bgEl) bgEl.hidden = true;
      if (frameEl) frameEl.classList.add('is-youtube');
      embedEl.src = item.embedUrl || item.url;
      embedEl.hidden = false;
      if (playBadge) playBadge.hidden = true;
      setExternalButton(item, true);
    }

    function activateExternal(item) {
      if (!isExternal(item)) return;
      if (isFacebook(item)) activateFacebook(item);
      else if (isInstagram(item)) activateInstagram(item);
      else if (isYouTube(item)) activateYouTube(item);
      else setExternalButton(item, true);
    }

    function activateDriveVideo(item, year) {
      if (!isDriveVideo(item) || !videoEl) return;
      stopAutoplay();
      if (imgEl) imgEl.hidden = true;
      if (bgEl) bgEl.hidden = true;
      videoEl.src = itemSrc(year, item);
      videoEl.poster = itemThumb(item, year);
      videoEl.hidden = false;
      videoEl.load();
      videoEl.play().catch(() => {});
      if (playBadge) playBadge.hidden = true;
    }

    function activateCurrentItem() {
      const item = itemsForYear(activeYear)[activeIndex];
      if (isDriveVideo(item)) activateDriveVideo(item, activeYear);
      else if (isExternal(item)) activateExternal(item);
    }

    function showItem(index, immediate = false) {
      const items = itemsForYear(activeYear);
      if (!items.length) return;
      activeIndex = ((index % items.length) + items.length) % items.length;
      const item = items[activeIndex];
      if (fadeTimer) clearTimeout(fadeTimer);
      const apply = () => {
        clearStage();
        setPreview(item, activeYear);
        updatePlayBadge(item);
        counterEl.textContent = `${activeIndex + 1} / ${items.length}`;
        thumbsEl.querySelectorAll('.carousel-thumb').forEach((t, i) => t.classList.toggle('active', i === activeIndex));
        if (frameEl) frameEl.classList.remove('fading');
      };
      if (immediate) apply();
      else {
        if (frameEl) frameEl.classList.add('fading');
        fadeTimer = setTimeout(apply, FADE_MS);
      }
    }

    function renderCarousel(year) {
      activeYear = year;
      const items = itemsForYear(year);
      if (!items.length) {
        carouselEl.hidden = true;
        emptyEl.hidden = false;
        stopAutoplay();
        return;
      }
      carouselEl.hidden = false;
      emptyEl.hidden = true;
      stopAutoplay();
      thumbsEl.innerHTML = items.map((item, i) => {
        const thumb = itemThumb(item, year);
        const mediaClass = isExternal(item) ? ' is-external' : (isDriveVideo(item) ? ' is-video' : '');
        const label = isImage(item) ? `Photo ${i + 1}` : `${item.platform || 'Video'}: ${item.label || 'Play media'}`;
        return `<button type="button" class="carousel-thumb-item${mediaClass}" data-index="${i}" aria-label="${escapeHtml(label)}"><img class="carousel-thumb" src="${escapeHtml(thumb)}" alt="" /></button>`;
      }).join('');
      thumbsEl.querySelectorAll('.carousel-thumb-item').forEach((button) => {
        button.addEventListener('click', () => {
          const i = Number(button.dataset.index);
          showItem(i);
          const item = items[i];
          if (isDriveVideo(item) || isExternal(item)) setTimeout(activateCurrentItem, FADE_MS + 20);
          else startAutoplay();
        });
      });
      activeIndex = 0;
      showItem(0, true);
      startAutoplay();
    }

    function renderYearTabs() {
      yearTabsEl.innerHTML = galleries.map((g, i) =>
        `<button type="button" class="year-tab${i === 0 ? ' active' : ''}" data-year="${escapeHtml(g.year)}">${escapeHtml(g.year)}</button>`
      ).join('');
      yearTabsEl.querySelectorAll('.year-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          yearTabsEl.querySelectorAll('.year-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          renderCarousel(btn.dataset.year);
        });
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { showItem(activeIndex - 1); startAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { showItem(activeIndex + 1); startAutoplay(); });
    if (playBadge) playBadge.addEventListener('click', (e) => { e.preventDefault(); activateCurrentItem(); });
    if (imgEl) imgEl.addEventListener('click', () => {
      const item = itemsForYear(activeYear)[activeIndex];
      if (isDriveVideo(item) || isExternal(item)) activateCurrentItem();
      else openLightbox();
    });

    if (frameEl) {
      frameEl.addEventListener('mouseenter', () => { hovering = true; stopAutoplay(); });
      frameEl.addEventListener('mouseleave', () => { hovering = false; startAutoplay(); });
      frameEl.setAttribute('tabindex', '0');
      frameEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { showItem(activeIndex - 1); startAutoplay(); }
        if (e.key === 'ArrowRight') { showItem(activeIndex + 1); startAutoplay(); }
      });
      let touchStartX = null;
      frameEl.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
      frameEl.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) { showItem(activeIndex + 1); startAutoplay(); }
        else { showItem(activeIndex - 1); startAutoplay(); }
      });
    }

    fetch('api/gallery')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Gallery API returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        galleries = Array.isArray(data.galleries) ? data.galleries : [];
        if (!galleries.length) {
          yearTabsEl.hidden = true;
          carouselEl.hidden = true;
          emptyEl.hidden = false;
          emptyEl.textContent = 'Gallery media is temporarily unavailable. Please check back soon.';
          return;
        }
        yearTabsEl.hidden = false;
        renderYearTabs();
        renderCarousel(galleries[0].year);
      })
      .catch(() => {
        yearTabsEl.hidden = true;
        carouselEl.hidden = true;
        emptyEl.hidden = false;
        emptyEl.textContent = 'Gallery media is temporarily unavailable. Please check back soon.';
      });

    // ---------- Lightbox: photos only ----------
    const lightboxOverlay = document.getElementById('lightboxOverlay');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxTag = document.getElementById('lightboxTag');
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxDownload = document.getElementById('lightboxDownload');
    const lightboxShare = document.getElementById('lightboxShare');

    function nearestImageIndex(fromIndex, direction) {
      const items = itemsForYear(activeYear);
      if (!items.length) return -1;
      let i = fromIndex;
      for (let guard = 0; guard < items.length; guard++) {
        i = ((i + direction) % items.length + items.length) % items.length;
        if (isImage(items[i])) return i;
      }
      return -1;
    }

    function lightboxGoTo(index) {
      const items = itemsForYear(activeYear);
      if (!items.length) return;
      let i = ((index % items.length) + items.length) % items.length;
      if (!isImage(items[i])) {
        const nextImage = nearestImageIndex(i - 1, 1);
        if (nextImage < 0) return;
        i = nextImage;
      }
      activeIndex = i;
      const item = items[i];
      const src = itemSrc(activeYear, item);
      setPreview(item, activeYear);
      if (imgEl) imgEl.src = src;
      if (bgEl) bgEl.src = src;
      if (videoEl) videoEl.hidden = true;
      if (embedEl) embedEl.hidden = true;
      updatePlayBadge(item);
      counterEl.textContent = `${activeIndex + 1} / ${items.length}`;
      thumbsEl.querySelectorAll('.carousel-thumb').forEach((t, n) => t.classList.toggle('active', n === activeIndex));
      lightboxImg.src = src;
      lightboxImg.alt = item.name || `Unity Run ${activeYear} photo ${i + 1}`;
      lightboxTag.textContent = `Unity Run ${activeYear}`;
    }

    function openLightbox() {
      const item = itemsForYear(activeYear)[activeIndex];
      if (!isImage(item)) return;
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

    async function buildTaggedImageBlob() {
      const items = itemsForYear(activeYear);
      const item = items[activeIndex];
      if (!isImage(item)) throw new Error('Only photos can be downloaded');
      const src = itemSrc(activeYear, item);
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
      for (const ch of label) { ctx.fillText(ch, cursorX, textY); cursorX += ctx.measureText(ch).width + letterSpacing; }
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxOverlay) lightboxOverlay.addEventListener('click', (e) => { if (e.target === lightboxOverlay) closeLightbox(); });
    if (lightboxPrev) lightboxPrev.addEventListener('click', () => lightboxGoTo(nearestImageIndex(activeIndex, -1)));
    if (lightboxNext) lightboxNext.addEventListener('click', () => lightboxGoTo(nearestImageIndex(activeIndex, 1)));
    document.addEventListener('keydown', (e) => {
      if (!lightboxOverlay || !lightboxOverlay.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxGoTo(nearestImageIndex(activeIndex, -1));
      if (e.key === 'ArrowRight') lightboxGoTo(nearestImageIndex(activeIndex, 1));
    });

    if (lightboxDownload) {
      lightboxDownload.addEventListener('click', async () => {
        lightboxDownload.disabled = true;
        try {
          const blob = await buildTaggedImageBlob();
          downloadBlob(blob, `unity-run-${activeYear}-${String(activeIndex + 1).padStart(2, '0')}.jpg`);
        } catch (err) { console.error('download failed:', err.message); }
        finally { lightboxDownload.disabled = false; }
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
            await navigator.share({ title: `Unity Run ${activeYear}`, text: shareText, url: window.location.href });
          } else downloadBlob(blob, filename);
        } catch (err) { if (err.name !== 'AbortError') console.error('share failed:', err.message); }
        finally { lightboxShare.disabled = false; }
      });
    }

  })();

  // ---------- Floating "View Gallery & Results" bubble ----------
  // Hides itself once the gallery section is actually on screen — the
  // shortcut has nothing left to do once you've scrolled to it yourself.
  (function initGalleryJumpBubble() {
    const bubble = document.getElementById('galleryJumpBubble');
    const arrowEl = document.getElementById('galleryJumpArrow');
    const target = document.getElementById('photos');
    if (!bubble || !target) return;

    // Once scrolled past the gallery (its top edge is above the viewport),
    // the bubble needs to point back up at it instead of down. A plain
    // scroll listener (rather than folding this into the observer below)
    // is what keeps this correct even after a jump straight there — e.g.
    // a nav-link click from below the gallery, or a page load landing on
    // a URL hash — where the section's intersection ratio never actually
    // crosses the observer's threshold along the way.
    function updateArrowDirection() {
      if (arrowEl) arrowEl.textContent = target.getBoundingClientRect().top < 0 ? '↑' : '↓';
    }
    window.addEventListener('scroll', updateArrowDirection, { passive: true });
    updateArrowDirection();

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) bubble.hidden = entry.isIntersecting;
      },
      { threshold: 0.15 }
    );
    observer.observe(target);
  })();

  // ---------- Results ----------
  (function initResults() {
    const yearTabsEl = document.getElementById('resultsYearTabs');
    const bodyEl = document.getElementById('resultsBody');
    if (!yearTabsEl || !bodyEl) return;

    let results = [];
    const RESULT_CATEGORY_LABELS = { '6K': '6KM Timed Run' };
    const NOT_PUBLISHED_HTML = '<p class="results-notice">Result will be published after completion of the event.</p>';

    function ordinal(rank) {
      const n = Number(rank);
      if (!Number.isFinite(n)) return '';
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      if (n % 10 === 1) return `${n}st`;
      if (n % 10 === 2) return `${n}nd`;
      if (n % 10 === 3) return `${n}rd`;
      return `${n}th`;
    }

    function resultTable(gender, entries) {
      if (!entries.length) return '';

      // Sort by the official position. Stable ordering is preserved for ties,
      // so two runners who both officially finished 1st remain 1st/1st.
      const sorted = [...entries].sort((a, b) => {
        const ar = Number(a.rank);
        const br = Number(b.rank);
        if (!Number.isFinite(ar) && !Number.isFinite(br)) return 0;
        if (!Number.isFinite(ar)) return 1;
        if (!Number.isFinite(br)) return -1;
        return ar - br;
      });

      return `
        <div class="results-gender">
          <div class="results-gender-heading">
            <h4>${escapeHtml(gender)}</h4>
            <span class="results-gender-rule" aria-hidden="true"></span>
          </div>
          <div class="results-table-wrap">
            <table class="results-table">
              <caption class="sr-only">${escapeHtml(gender)} results for the 6KM timed run</caption>
              <thead>
                <tr>
                  <th scope="col" class="results-col-position">Position</th>
                  <th scope="col" class="results-col-bib">BIB No.</th>
                  <th scope="col">Name</th>
                  <th scope="col" class="results-col-time">Timing</th>
                </tr>
              </thead>
              <tbody>
                ${sorted.map((r, i) => `
                  <tr>
                    <td class="results-position">${escapeHtml(ordinal(r.rank))}</td>
                    <td class="results-bib">${escapeHtml(r.bib || '')}</td>
                    <td class="results-name">${escapeHtml(r.name || '')}</td>
                    <td class="results-time">${escapeHtml(r.time || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    function renderYear(year) {
      const yearData = results.find((r) => r.year === year);
      if (!yearData || !yearData.published) {
        bodyEl.innerHTML = NOT_PUBLISHED_HTML;
        return;
      }

      const sections = Object.entries(yearData.categories).map(([category, data]) => {
        const label = RESULT_CATEGORY_LABELS[category] || category;
        const male = data.fullResults.filter((r) => String(r.gender).toLowerCase() === 'male');
        const female = data.fullResults.filter((r) => String(r.gender).toLowerCase() === 'female');
        return `
          <div class="results-category">
            <h3>${escapeHtml(label)}</h3>
            <div class="results-gender-tables">
              ${resultTable('Male', male)}
              ${resultTable('Female', female)}
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
