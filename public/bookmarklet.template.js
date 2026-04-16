// Readable source for the job application auto-fill bookmarklet.
// Build the deployable bookmarklet by running:
//   npm run build:bookmarklet
// This reads APPLICANT_* env vars and writes public/bookmarklet.js.

(function () {
  var applicant = {
    firstName: '__APPLICANT_FIRST_NAME__',
    lastName: '__APPLICANT_LAST_NAME__',
    email: '__APPLICANT_EMAIL__',
    phone: '__APPLICANT_PHONE__',
    linkedin: '__APPLICANT_LINKEDIN__',
    github: '__APPLICANT_GITHUB__',
  };

  function fill(el, value) {
    if (!el || !value || el.value) return false;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function byName(name) {
    return document.querySelector('input[name="' + name + '"],textarea[name="' + name + '"]');
  }

  function byLabel(text) {
    var target = text.toLowerCase();
    for (var lb of document.querySelectorAll('label')) {
      if (!lb.textContent.toLowerCase().includes(target)) continue;
      if (lb.htmlFor) {
        var el = document.getElementById(lb.htmlFor);
        if (el) return el;
      }
      var inp = lb.querySelector('input,textarea,select');
      if (inp) return inp;
      var next = lb.nextElementSibling;
      if (next && (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA')) return next;
    }
    return [...document.querySelectorAll('input,textarea')]
      .find(function (i) { return (i.placeholder || '').toLowerCase().includes(target); }) || null;
  }

  var filled = 0;
  var host = location.hostname;

  if (host.includes('greenhouse.io')) {
    [['first_name', applicant.firstName], ['last_name', applicant.lastName], ['email', applicant.email], ['phone', applicant.phone]]
      .forEach(function (pair) {
        var el = byName(pair[0]) || document.getElementById(pair[0]);
        if (fill(el, pair[1])) filled++;
      });
    if (fill(byLabel('linkedin'), applicant.linkedin)) filled++;
    if (fill(byLabel('github') || byLabel('website'), applicant.github)) filled++;
  } else if (host.includes('ashbyhq.com')) {
    var tryFill = function (label, value) { if (fill(byLabel(label), value)) filled++; };
    tryFill('first name', applicant.firstName);
    tryFill('last name', applicant.lastName);
    if (!byLabel('first name')) tryFill('name', applicant.firstName + ' ' + applicant.lastName);
    tryFill('email', applicant.email);
    tryFill('phone', applicant.phone);
    tryFill('linkedin', applicant.linkedin);
    if (!fill(byLabel('github'), applicant.github)) tryFill('website', applicant.github);
  } else if (host.includes('lever.co')) {
    if (fill(byName('name'), applicant.firstName + ' ' + applicant.lastName)) filled++;
    if (fill(byName('email'), applicant.email)) filled++;
    if (fill(byName('phone'), applicant.phone)) filled++;
    if (fill(byLabel('linkedin'), applicant.linkedin)) filled++;
    if (fill(byLabel('github') || byLabel('website'), applicant.github)) filled++;
  } else {
    alert('Auto-fill: unsupported site (' + host + ')');
    return;
  }

  var banner = document.createElement('div');
  banner.textContent = filled > 0
    ? 'Filled ' + filled + ' fields. Upload resume and review.'
    : 'No empty fields found, already filled?';
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
    background: filled > 0 ? '#6366f1' : '#f59e0b',
    color: 'white', padding: '10px 16px',
    fontFamily: 'system-ui', fontSize: '14px', fontWeight: '600',
    textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  });
  document.body.appendChild(banner);
  setTimeout(function () { banner.remove(); }, 4000);
})();
