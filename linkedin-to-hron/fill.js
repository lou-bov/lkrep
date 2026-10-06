// Injected into the HR-ON tab via chrome.scripting.executeScript.
// Must be self-contained. Finds form fields either by a custom CSS selector
// (from the options page) or by matching labels/names in Danish and English.
function fillHrOnForm(candidate, customSelectors) {
  const PATTERNS = {
    firstName: /fornavn|first.?name|given.?name/i,
    lastName: /efternavn|last.?name|surname|family.?name/i,
    email: /e-?mail/i,
    phone: /telefon|mobil|phone|tlf/i,
    linkedinUrl: /linkedin/i,
    headline: /titel|stilling|job.?title|position|headline/i,
    company: /virksomhed|firma|company|employer|arbejdsgiver/i,
    location: /\bby\b|city|location|lokation|bopæl/i,
    notes: /note|kommentar|comment|beskrivelse|description/i,
  };
  const FULL_NAME = /^\s*(fulde\s+)?navn\s*$|full.?name|^\s*name\s*$/i;

  const isUsable = (el) =>
    !el.disabled &&
    !el.readOnly &&
    !/^(hidden|password|submit|button|checkbox|radio|file|image|reset)$/i.test(el.type || "") &&
    el.offsetParent !== null;

  const describe = (el) => {
    const bits = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")];
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) bits.push(lbl.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) bits.push(wrap.textContent);
    // Text directly before the field (common in table/div based forms).
    const prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
    if (prev && prev.textContent.length < 60) bits.push(prev.textContent);
    return bits.filter(Boolean).join(" | ");
  };

  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #2e7d32";
  };

  const fields = [...document.querySelectorAll("input, textarea")].filter(isUsable);
  const used = new Set();
  const filled = [];
  const missing = [];

  const place = (key, value) => {
    if (!value) return;
    let el = null;
    const sel = customSelectors && customSelectors[key];
    if (sel) el = document.querySelector(sel);
    if (!el) el = fields.find((f) => !used.has(f) && PATTERNS[key]?.test(describe(f)));
    if (el) {
      used.add(el);
      setValue(el, value);
      filled.push(key);
    } else {
      missing.push(key);
    }
  };

  // Notes collects everything that may not have a dedicated field.
  const noteLines = [
    candidate.notes,
    candidate.headline && `Titel: ${candidate.headline}`,
    candidate.company && `Virksomhed: ${candidate.company}`,
    candidate.location && `Lokation: ${candidate.location}`,
    candidate.linkedinUrl && `LinkedIn: ${candidate.linkedinUrl}`,
  ].filter(Boolean);

  for (const key of ["firstName", "lastName", "email", "phone", "linkedinUrl", "headline", "company", "location"]) {
    place(key, candidate[key]);
  }

  // Fall back to a single full-name field if separate name fields don't exist.
  if (missing.includes("firstName")) {
    const full = fields.find((f) => !used.has(f) && FULL_NAME.test(describe(f)));
    if (full) {
      used.add(full);
      setValue(full, `${candidate.firstName} ${candidate.lastName}`.trim());
      filled.push("fullName");
      missing.splice(missing.indexOf("firstName"), 1);
      if (missing.includes("lastName")) missing.splice(missing.indexOf("lastName"), 1);
    }
  }

  place("notes", noteLines.join("\n"));

  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:360px;padding:12px 14px;" +
    "font:13px/1.4 system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
    (filled.length ? "background:#e8f5e9;color:#1b5e20;" : "background:#ffebee;color:#b71c1c;");
  banner.textContent = filled.length
    ? `LinkedIn → HR-ON: udfyldt ${filled.length} felt(er). Tjek data og klik Gem.` +
      (missing.length ? ` Ikke fundet: ${missing.join(", ")}.` : "")
    : "LinkedIn → HR-ON: fandt ingen kandidatfelter. Er du logget ind og på 'Opret kandidat'-siden?";
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 12000);

  return { filled, missing };
}
