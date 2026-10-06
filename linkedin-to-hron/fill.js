// Functions in this file are injected into the HR-ON tab via
// chrome.scripting.executeScript, so each must be self-contained.

// Lists the jobs offered by any job/position dropdown on the current HR-ON page.
function scanHrOnJobs(customSelectors) {
  const JOB = /job|stilling|opslag|position|vacanc|rekruttering|sag\b|project|projekt/i;
  const describe = (el) => {
    const bits = [el.name, el.id, el.getAttribute("aria-label")];
    const lbl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) bits.push(lbl.textContent);
    else {
      const prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
      if (prev && prev.textContent.length < 60) bits.push(prev.textContent);
    }
    return bits.filter(Boolean).join(" | ");
  };
  const custom = customSelectors?.job && document.querySelector(customSelectors.job);
  const selects = custom ? [custom] : [...document.querySelectorAll("select")].filter((s) => JOB.test(describe(s)));
  const jobs = new Set();
  for (const s of selects) {
    for (const o of s.options) {
      const t = o.textContent.replace(/\s+/g, " ").trim();
      if (o.value && t && !/^(-+|vælg.*|choose.*|select.*)$/i.test(t)) jobs.add(t);
    }
  }
  return [...jobs];
}

// Fills the HR-ON "create candidate" form. Runs in the page's MAIN world so it can
// notify jQuery widgets (select2/chosen/tagsinput) that HR-ON may use.
function fillHrOnForm(candidate, cv, customSelectors) {
  const PATTERNS = {
    firstName: /fornavn|first.?name|given.?name/i,
    lastName: /efternavn|last.?name|surname|family.?name/i,
    email: /e-?mail/i,
    phone: /telefon|mobil|phone|tlf/i,
    linkedinUrl: /linkedin/i,
    headline: /titel|job.?title|headline|nuværende stilling|current.?position/i,
    company: /virksomhed|firma|company|employer|arbejdsgiver/i,
    location: /\bby\b|city|location|lokation|bopæl/i,
    notes: /note|kommentar|comment|beskrivelse|description/i,
    tags: /tag|mærk|nøgleord|keyword|label/i,
    job: /job|stilling|opslag|position|vacanc|rekruttering|sag\b|project|projekt/i,
  };
  const FULL_NAME = /^\s*(fulde\s+)?navn\s*$|full.?name|^\s*name\s*$/i;
  const CV_FILE = /\bcv\b|resum|curriculum/i;
  const DOC_FILE = /ansøgning|application|attachment|bilag|dokument|document|fil\b|file|upload/i;
  const IMAGE_FILE = /billede|foto|photo|image|picture|avatar/i;
  const $q = window.jQuery;

  const describe = (el) => {
    const bits = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("accept")];
    const lbl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const wrap = el.closest("label");
    if (lbl) bits.push(lbl.textContent);
    if (wrap) bits.push(wrap.textContent);
    // Without a real label, use the text just before the field (table/div based forms).
    if (!lbl && !wrap) {
      const prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
      if (prev && prev.textContent.length < 60) bits.push(prev.textContent);
    }
    return bits.filter(Boolean).join(" | ");
  };
  const isTextField = (el) =>
    !el.disabled &&
    !el.readOnly &&
    !/^(hidden|password|submit|button|checkbox|radio|file|image|reset)$/i.test(el.type || "") &&
    el.offsetParent !== null;
  const mark = (el) => {
    const visible = el.offsetParent ? el : el.nextElementSibling || el.parentElement;
    if (visible) visible.style.outline = "2px solid #2e7d32";
  };
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    fire(el, "input");
    fire(el, "change");
    mark(el);
  };
  const notifyWidgets = (el) => {
    fire(el, "change");
    if ($q) $q(el).trigger("change").trigger("chosen:updated");
    mark(el);
  };
  const pressEnter = (el) => {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
  };

  const textFields = [...document.querySelectorAll("input, textarea")].filter(isTextField);
  const selects = [...document.querySelectorAll("select")].filter((s) => !s.disabled);
  const used = new Set();
  const filled = [];
  const missing = [];

  const find = (key, pool) => {
    const sel = customSelectors && customSelectors[key];
    const custom = sel && document.querySelector(sel);
    if (custom) return custom;
    return pool.find((f) => !used.has(f) && PATTERNS[key].test(describe(f)));
  };

  const placeText = (key, value) => {
    if (!value) return;
    const el = find(key, textFields);
    if (el) {
      used.add(el);
      setValue(el, value);
      filled.push(key);
    } else missing.push(key);
  };

  // --- Job ---
  const placeJob = (job) => {
    if (!job) return;
    const el = find("job", selects);
    if (!el || el.tagName !== "SELECT") return missing.push("job");
    const want = job.trim().toLowerCase();
    const opts = [...el.options];
    const text = (o) => o.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    const opt = opts.find((o) => text(o) === want) || opts.find((o) => text(o).includes(want));
    if (!opt) return missing.push(`job ("${job}" not in list)`);
    used.add(el);
    el.value = opt.value;
    opt.selected = true;
    notifyWidgets(el);
    filled.push("job");
  };

  // --- Tags ---
  const placeTags = (tags) => {
    if (!tags.length) return;
    const el = find("tags", [...selects, ...textFields]);
    if (!el) return missing.push("tags");
    used.add(el);
    if (el.tagName === "SELECT") {
      for (const tag of tags) {
        let opt = [...el.options].find((o) => o.textContent.trim().toLowerCase() === tag.toLowerCase());
        if (!opt) {
          opt = new Option(tag, tag, true, true);
          el.add(opt);
        }
        opt.selected = true;
      }
      notifyWidgets(el);
    } else if ($q && $q.fn && $q.fn.tagsinput && $q(el).data("tagsinput")) {
      for (const tag of tags) $q(el).tagsinput("add", tag);
      mark(el);
    } else {
      // Tag widgets usually turn text + Enter into a chip and clear the input.
      // If the input isn't cleared, it's a plain field: use a comma-separated list.
      setValue(el, tags[0]);
      pressEnter(el);
      if (el.value === tags[0]) {
        setValue(el, tags.join(", "));
      } else {
        for (const tag of tags.slice(1)) {
          setValue(el, tag);
          pressEnter(el);
        }
      }
    }
    filled.push("tags");
  };

  // --- CV ---
  const placeCv = (cv) => {
    if (!cv || !cv.data) return;
    const bytes = Uint8Array.from(atob(cv.data), (c) => c.charCodeAt(0));
    const file = new File([bytes], cv.name, { type: cv.type || "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);

    const custom = customSelectors?.cv && document.querySelector(customSelectors.cv);
    const inputs = [...document.querySelectorAll("input[type=file]")].filter(
      (i) => !i.disabled && !IMAGE_FILE.test(describe(i)) && !/^image\//.test(i.accept || "")
    );
    const input =
      custom ||
      inputs.find((i) => CV_FILE.test(describe(i))) ||
      inputs.find((i) => DOC_FILE.test(describe(i))) ||
      inputs[0];
    if (input) {
      input.files = dt.files;
      fire(input, "input");
      fire(input, "change");
      mark(input);
      return filled.push(`cv (${cv.name})`);
    }
    // Fallback: drag-and-drop upload area.
    const zone = document.querySelector(".dropzone, [class*='dropzone'], [class*='upload'], [class*='Upload']");
    if (zone) {
      for (const type of ["dragenter", "dragover", "drop"]) {
        zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
      mark(zone);
      return filled.push(`cv (${cv.name}, dropped)`);
    }
    missing.push("cv");
  };

  for (const key of ["firstName", "lastName", "email", "phone", "linkedinUrl", "headline", "company", "location"]) {
    placeText(key, candidate[key]);
  }

  // Fall back to a single full-name field if there are no separate name fields.
  if (missing.includes("firstName")) {
    const full = textFields.find((f) => !used.has(f) && FULL_NAME.test(describe(f)));
    if (full) {
      used.add(full);
      setValue(full, `${candidate.firstName} ${candidate.lastName}`.trim());
      filled.push("fullName");
      for (const k of ["firstName", "lastName"]) if (missing.includes(k)) missing.splice(missing.indexOf(k), 1);
    }
  }

  placeJob(candidate.job);
  placeTags((candidate.tags || "").split(",").map((t) => t.trim()).filter(Boolean));
  placeCv(cv);

  // Notes collect everything that may not have a dedicated field.
  placeText(
    "notes",
    [
      candidate.notes,
      candidate.headline && `Title: ${candidate.headline}`,
      candidate.company && `Company: ${candidate.company}`,
      candidate.location && `Location: ${candidate.location}`,
      candidate.linkedinUrl && `LinkedIn: ${candidate.linkedinUrl}`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:12px 14px;" +
    "font:13px/1.4 system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;" +
    (filled.length ? "background:#e8f5e9;color:#1b5e20;" : "background:#ffebee;color:#b71c1c;");
  banner.textContent = filled.length
    ? `LinkedIn → HR-ON: filled ${filled.join(", ")}. Review and click Save.` +
      (missing.length ? ` Not found: ${missing.join(", ")}.` : "")
    : "LinkedIn → HR-ON: no candidate fields found. Are you logged in and on the 'Create candidate' page?";
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 15000);

  return { filled, missing };
}
