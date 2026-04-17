'use strict';

// Builds the standalone JS bundle served at /job-bookmarklet.js. Loaded by
// the bookmarklet on the ATS page; autofills standard fields plus any stored
// answers from the prep payload.
function buildJobBookmarkletScript(payload) {
  const data = JSON.stringify(payload);
  return `'use strict';
(function() {
  var payload = ${data};
  var profile = payload.profile || {};
  var questions = Array.isArray(payload.questions) ? payload.questions : [];
  var answers = payload.answers || {};
  var totalFilled = 0;
  var skipped = [];

  function normalize(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function showBanner(message, tone) {
    var node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      right: '12px',
      zIndex: '2147483647',
      padding: '12px 16px',
      borderRadius: '10px',
      background: tone === 'warn' ? '#7c2d12' : '#111827',
      color: '#f9fafb',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '700',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
    });
    document.body.appendChild(node);
    setTimeout(function() { node.remove(); }, 4200);
  }

  function setNativeValue(el, value) {
    if (!el || value == null || value === '') return false;
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }

  function findByName(name) {
    if (!name) return null;
    return document.querySelector('[name="' + cssEscape(name) + '"], textarea[name="' + cssEscape(name) + '"], select[name="' + cssEscape(name) + '"]');
  }

  function labelTargets() {
    return Array.from(document.querySelectorAll('label')).map(function(label) {
      var text = normalize(label.textContent);
      if (!text) return null;
      var target = null;
      if (label.htmlFor) target = document.getElementById(label.htmlFor);
      if (!target) target = label.querySelector('input, textarea, select');
      if (!target) {
        var next = label.nextElementSibling;
        if (next && /^(INPUT|TEXTAREA|SELECT)$/.test(next.tagName)) target = next;
      }
      if (!target) return null;
      return { text: text, el: target };
    }).filter(Boolean);
  }

  function findByLabel(label) {
    var target = normalize(label);
    if (!target) return null;
    var exact = labelTargets().find(function(entry) { return entry.text === target; });
    if (exact) return exact.el;
    var partial = labelTargets().find(function(entry) { return entry.text.indexOf(target) >= 0 || target.indexOf(entry.text) >= 0; });
    if (partial) return partial.el;
    return Array.from(document.querySelectorAll('input, textarea, select')).find(function(el) {
      return normalize(el.placeholder).indexOf(target) >= 0;
    }) || null;
  }

  function pickOption(select, rawValue) {
    if (!select || rawValue == null || rawValue === '') return false;
    var wanted = normalize(rawValue);
    var options = Array.from(select.options || []);
    var exact = options.find(function(option) { return normalize(option.textContent) === wanted || normalize(option.value) === wanted; });
    var partial = exact || options.find(function(option) {
      var text = normalize(option.textContent);
      var value = normalize(option.value);
      return text.indexOf(wanted) >= 0 || wanted.indexOf(text) >= 0 || value.indexOf(wanted) >= 0 || wanted.indexOf(value) >= 0;
    });
    if (!partial) return false;
    return setNativeValue(select, partial.value);
  }

  function matchChoice(inputs, wanted) {
    var target = normalize(wanted);
    return inputs.find(function(input) {
      var parts = [];
      parts.push(input.value || '');
      if (input.id) {
        var linkedLabel = document.querySelector('label[for="' + cssEscape(input.id) + '"]');
        if (linkedLabel) parts.push(linkedLabel.textContent || '');
      }
      var parentLabel = input.closest('label');
      if (parentLabel) parts.push(parentLabel.textContent || '');
      var nearby = input.parentElement && input.parentElement.textContent;
      if (nearby) parts.push(nearby);
      var hay = normalize(parts.join(' '));
      return hay === target || hay.indexOf(target) >= 0 || target.indexOf(hay) >= 0;
    }) || null;
  }

  function setChoiceGroup(name, values, type) {
    var wanted = Array.isArray(values) ? values : [values];
    var inputs = Array.from(document.querySelectorAll('input[name="' + cssEscape(name) + '"]')).filter(function(input) {
      return input.type === type;
    });
    if (!inputs.length) return 0;
    var changed = 0;
    wanted.forEach(function(value) {
      var match = matchChoice(inputs, value);
      if (!match) return;
      if (!match.checked) {
        match.click();
        changed += 1;
      }
    });
    return changed;
  }

  function fillStandard() {
    var filled = 0;
    var fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    var pairs = [
      ['first_name', profile.firstName],
      ['last_name', profile.lastName],
      ['name', fullName],
      ['full_name', fullName],
      ['email', profile.email],
      ['phone', profile.phone],
      ['location', profile.location]
    ];
    pairs.forEach(function(pair) {
      var el = findByName(pair[0]);
      if (el && !el.value && setNativeValue(el, pair[1])) filled += 1;
    });
    [
      ['linkedin', profile.linkedin],
      ['github', profile.github],
      ['website', profile.github]
    ].forEach(function(pair) {
      var el = findByLabel(pair[0]);
      if (el && !el.value && setNativeValue(el, pair[1])) filled += 1;
    });
    return filled;
  }

  totalFilled += fillStandard();

  questions.forEach(function(field) {
    var value = answers[field.name];
    if (value == null || value === '') return;
    var el = findByName(field.name) || findByLabel(field.label);

    if (el && el.tagName === 'SELECT') {
      if (pickOption(el, Array.isArray(value) ? value[0] : value)) totalFilled += 1;
      else skipped.push(field.label);
      return;
    }

    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      if (el.type === 'radio') {
        var radioCount = setChoiceGroup(field.name, value, 'radio');
        if (radioCount) totalFilled += radioCount;
        else skipped.push(field.label);
        return;
      }
      if (el.type === 'checkbox' || field.type === 'multi_select') {
        var boxCount = setChoiceGroup(field.name, value, 'checkbox');
        if (boxCount) totalFilled += boxCount;
        else skipped.push(field.label);
        return;
      }
      if (setNativeValue(el, Array.isArray(value) ? value.join(', ') : value)) {
        totalFilled += 1;
      } else {
        skipped.push(field.label);
      }
      return;
    }

    if (field.type === 'select') {
      skipped.push(field.label);
      return;
    }

    var radioCount = setChoiceGroup(field.name, value, 'radio');
    var boxCount = setChoiceGroup(field.name, value, 'checkbox');
    if (radioCount || boxCount) totalFilled += radioCount + boxCount;
    else skipped.push(field.label);
  });

  if (!questions.length) {
    showBanner('No custom answers stored for this job. Standard fields only.', 'warn');
    return;
  }

  if (!totalFilled) {
    showBanner('No fields matched. Open the prep page and copy answers manually.', 'warn');
    return;
  }

  var suffix = skipped.length ? ' Skipped: ' + skipped.slice(0, 4).join(', ') + (skipped.length > 4 ? '…' : '') : '';
  showBanner('Filled ' + totalFilled + ' field' + (totalFilled === 1 ? '' : 's') + '.' + suffix, skipped.length ? 'warn' : 'ok');
}());`;
}

module.exports = { buildJobBookmarkletScript };
