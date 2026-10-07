// Injected into the HR-ON tab as a file (chrome.scripting.executeScript with
// files: ["fill.js"]); the popup then calls these functions in the page.

// Reads which job the current HR-ON page belongs to, and any job titles listed on it.
function scanHrOnPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  let currentJob = "";
  const heading = [...document.querySelectorAll("h1, h2, h3, h4, div, span, p")].find((el) =>
    /^(applicants for the position of|ansøgere til stillingen)\s*:/i.test(clean(el.textContent)) && el.children.length < 4
  );
  if (heading) {
    currentJob = clean(heading.textContent)
      .replace(/^[^:]*:\s*/, "")
      .replace(/\(\s*(select another|vælg en anden).*$/i, "")
      .trim();
  }

  // Job posting overview: read the "Job title" column.
  const jobs = new Set();
  for (const table of document.querySelectorAll("table")) {
    const heads = [...table.querySelectorAll("th")];
    const col = heads.findIndex((th) => /^(job ?title|jobtitel|stillingsbetegnelse|titel)$/i.test(clean(th.textContent)));
    if (col < 0) continue;
    for (const row of table.querySelectorAll("tbody tr")) {
      const t = clean(row.children[col]?.textContent);
      if (t) jobs.add(t);
    }
  }
  return { currentJob, jobs: [...jobs], url: location.href };
}

// Fills HR-ON's "Create CV" form (opened from a job's applicant list).
// Runs in the page's MAIN world so it can notify jQuery widgets HR-ON may use.
async function fillHrOnForm(candidate, cv, settings) {
  const selectors = settings.selectors || {};
  const $q = window.jQuery;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const CONTROLS = "input:not([type=hidden]), select, textarea";

  // --- Right job? ---
  const page = scanHrOnPage();
  if (candidate.job && page.currentJob) {
    const a = candidate.job.toLowerCase();
    const b = page.currentJob.toLowerCase();
    if (!a.includes(b) && !b.includes(a)) {
      return {
        error: `This page is for "${page.currentJob}", but the candidate is for "${candidate.job}". Open that job's applicant list, or change the job in the queue.`,
      };
    }
  }

  // --- Make sure the Create CV form is open ---
  const formRoot = () => {
    const dialogs = [...document.querySelectorAll("[role=dialog], .modal, [class*='modal'], [class*='Modal'], [class*='dialog']")]
      .filter((d) => isVisible(d) && d.querySelector(CONTROLS));
    return dialogs.find((d) => /create cv|opret cv/i.test(d.textContent)) || null;
  };
  if (!formRoot()) {
    const btn = [...document.querySelectorAll("button, a, [role=button]")].find((b) =>
      /^\+?\s*(create cv|opret cv)$/i.test(clean(b.textContent))
    );
    if (!btn) return { error: "Open a job's applicant list in HR-ON (the page with the 'Create CV' button) first." };
    btn.click();
    for (let i = 0; i < 30 && !formRoot(); i++) await sleep(200);
    if (!formRoot()) return { error: "Clicked 'Create CV', but the form didn't open. Open it yourself and try again." };
    await sleep(300);
  }
  const root = formRoot();

  // --- Field lookup by label ---
  const labelOf = (el) => {
    const lbl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return clean(lbl.textContent);
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent);
    // The nearest wrapper that holds only this one control is its form group.
    let a = el.parentElement;
    for (let i = 0; i < 4 && a && a !== root; i++, a = a.parentElement) {
      if (a.querySelectorAll(CONTROLS).length > 1) break;
      // Leave out the control's own text (e.g. a dropdown's option names).
      const t = clean((a.innerText || a.textContent).replace(el.innerText || el.textContent || "", ""));
      if (t && t.length < 120) return t;
    }
    return clean(el.getAttribute("aria-label") || el.placeholder || el.name || "");
  };
  // First line of the label, without "*" and ":" (e.g. "Name*" → "name").
  const labelKey = (el) => {
    const l = labelOf(el);
    const lbl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const first = lbl ? l : l.split(/(?=Accepted|Maximum)/)[0];
    return first.replace(/[*:]/g, "").trim().toLowerCase();
  };
  const controls = [...root.querySelectorAll(CONTROLS)].filter((el) => !el.disabled);
  const used = new Set();
  const find = (key, test, kinds = ["INPUT", "TEXTAREA"]) => {
    const custom = selectors[key] && document.querySelector(selectors[key]);
    if (custom) return custom;
    return controls.find(
      (el) => !used.has(el) && kinds.includes(el.tagName) && el.type !== "file" && test(labelKey(el), el)
    );
  };

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const mark = (el) => {
    const v = isVisible(el) ? el : el.nextElementSibling || el.parentElement;
    if (v) v.style.outline = "2px solid #2e7d32";
  };
  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    fire(el, "input");
    fire(el, "change");
    fire(el, "blur");
    mark(el);
  };
  const filled = [];
  const missing = [];
  const put = (key, value, test) => {
    if (!value) return;
    const el = find(key, test);
    if (!el) return missing.push(key);
    used.add(el);
    setValue(el, value);
    filled.push(key);
  };

  // --- Values ---
  const fullName = `${candidate.firstName} ${candidate.lastName}`.trim();
  const COUNTRIES = [
    ["denmark", "danmark"], ["sweden", "sverige"], ["norway", "norge"], ["germany", "tyskland", "deutschland"],
    ["finland"], ["iceland", "island"], ["united kingdom", "storbritannien", "england", "uk"],
    ["netherlands", "holland", "nederland", "nederlandene"], ["poland", "polen"], ["spain", "spanien"],
    ["france", "frankrig"], ["united states", "usa", "forenede stater"],
  ];
  const locParts = (candidate.location || "").split(",").map((s) => s.trim()).filter(Boolean);
  const countryList = locParts.length ? COUNTRIES.find((l) => l.includes(locParts.at(-1).toLowerCase())) : null;
  const cityPart = countryList && locParts.length === 1 ? "" : locParts[0] || "";
  const city = cityPart.replace(/^greater\s+|\s+(area|metropolitan area|region|og omegn)$/gi, "");

  // --- Text fields ---
  const nameField = find("name", (l) => /^(full |fulde )?(name|navn)$/.test(l));
  if (nameField) {
    used.add(nameField);
    setValue(nameField, fullName);
    filled.push("name");
  } else {
    put("firstName", candidate.firstName, (l) => /^(first ?name|fornavn)$/.test(l));
    put("lastName", candidate.lastName, (l) => /^(last ?name|surname|efternavn)$/.test(l));
  }
  put("address", candidate.linkedinUrl, (l) => /^(address|adresse)$/.test(l) || /linkedin/.test(l));
  put("city", city, (l) => /^(city|by)$/.test(l));
  put("email", settings.fixedEmail || candidate.email, (l, el) => /^e-?mail$/.test(l) || el.type === "email");
  if (candidate.phone) {
    const mobile = find("mobile", (l) => /^(mobile|mobil|mobilnummer|mobile phone|mobiltelefon)$/.test(l));
    const target = mobile || find("phone", (l) => /^(phone|telefon|tlf|telephone)$/.test(l));
    if (target) {
      used.add(target);
      setValue(target, candidate.phone);
      filled.push(mobile ? "mobile" : "phone");
    } else missing.push("mobile");
  }
  const notesField = find("notes", (l) => /^(notes?|noter|comments?|kommentar|description|beskrivelse)$/.test(l), ["TEXTAREA"]);
  if (notesField) {
    used.add(notesField);
    setValue(
      notesField,
      [candidate.notes, candidate.headline && `Title: ${candidate.headline}`, candidate.company && `Company: ${candidate.company}`, candidate.linkedinUrl && `LinkedIn: ${candidate.linkedinUrl}`]
        .filter(Boolean)
        .join("\n")
    );
    filled.push("notes");
  }

  // --- Country (select) ---
  if (countryList) {
    const sel = find("country", (l) => /^(country|land)$/.test(l), ["SELECT"]);
    const opt = sel && [...sel.options].find((o) => countryList.includes(clean(o.textContent).toLowerCase()));
    if (opt) {
      used.add(sel);
      sel.value = opt.value;
      fire(sel, "change");
      if ($q) $q(sel).trigger("change").trigger("chosen:updated");
      mark(sel);
      filled.push("country");
    } else missing.push("country");
  }

  // --- Tags ---
  const tags = (candidate.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length) {
    const el = find("tags", (l) => /^(tags?|mærker|nøgleord|keywords?|labels?)$/.test(l), ["INPUT", "SELECT"]);
    if (!el) missing.push("tags (the Create CV form has no tag field; add them after saving)");
    else {
      used.add(el);
      if (el.tagName === "SELECT") {
        for (const tag of tags) {
          let opt = [...el.options].find((o) => clean(o.textContent).toLowerCase() === tag.toLowerCase());
          if (!opt) el.add((opt = new Option(tag, tag, true, true)));
          opt.selected = true;
        }
        fire(el, "change");
        if ($q) $q(el).trigger("change");
        mark(el);
      } else {
        const enter = () =>
          ["keydown", "keypress", "keyup"].forEach((t) =>
            el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }))
          );
        setValue(el, tags[0]);
        enter();
        if (el.value === tags[0]) setValue(el, tags.join(", "));
        else for (const t of tags.slice(1)) (setValue(el, t), enter());
      }
      filled.push("tags");
    }
  }

  // --- CV file: into "Attach CV", never "Picture" or "Attach application" ---
  if (cv && cv.data) {
    const CV = /\b(attach |vedhæft )?cv\b|resum|curriculum/i;
    const OTHER = /picture|billede|foto|photo|image|avatar|application|ansøgning/i;
    // Text of the largest wrapper around `el` that contains no other upload.
    const groupText = (el, sel) => {
      let text = "";
      for (let a = el.parentElement, i = 0; a && a !== root.parentElement && i < 6; a = a.parentElement, i++) {
        if (a.querySelectorAll(sel).length > 1) break;
        text = clean(a.innerText || a.textContent);
      }
      return text;
    };
    const isCvGroup = (t) => CV.test(t.split(/upload|accepted/i)[0]) && !OTHER.test(t.split(/upload|accepted/i)[0]);

    let input = selectors.cv && document.querySelector(selectors.cv);
    if (!input) {
      input = [...root.querySelectorAll("input[type=file]")].find((i) => !i.disabled && isCvGroup(groupText(i, "input[type=file]")));
    }
    if (!input) {
      // Upload widgets (e.g. plupload) often put the real file field elsewhere,
      // positioned over the "Upload" button. Find the CV button and the field over it.
      const buttons = [...root.querySelectorAll("button, a, label, [role=button], div, span")].filter(
        (b) => /^(upload|vælg fil|choose file|browse)$/i.test(clean(b.textContent)) && !b.querySelector("button")
      );
      const btn = buttons.find((b) => isCvGroup(groupText(b, "button, a, label, [role=button]")));
      if (btn) {
        const r = btn.getBoundingClientRect();
        const overlaps = (el) => {
          const q = el.getBoundingClientRect();
          return q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
        };
        input = btn.querySelector("input[type=file]") ||
          [...document.querySelectorAll("input[type=file]")].find((i) => overlaps(i) || (i.parentElement && overlaps(i.parentElement)));
      }
    }
    if (input) {
      const bytes = Uint8Array.from(atob(cv.data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], cv.name, { type: cv.type || "application/pdf" }));
      input.files = dt.files;
      fire(input, "input");
      fire(input, "change");
      mark(input.closest("div") || input);
      filled.push(`CV (${cv.name})`);
    } else missing.push("CV (use Download CV in the queue and upload it under Attach CV)");
  }

  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:12px 14px;" +
    "font:13px/1.4 system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;" +
    (filled.length ? "background:#e8f5e9;color:#1b5e20;" : "background:#ffebee;color:#b71c1c;");
  banner.textContent = filled.length
    ? `LinkedIn → HR-ON: filled ${filled.join(", ")}. Review and click Save.` +
      (missing.length ? ` Not filled: ${missing.join(", ")}.` : "")
    : "LinkedIn → HR-ON: no fields found in the Create CV form.";
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 15000);

  return { filled, missing, job: page.currentJob };
}
