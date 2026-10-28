// Injected into the LinkedIn tab as a file (chrome.scripting.executeScript with
// files: ["extract.js"]); the popup then calls these functions in the page.
// LinkedIn changes its markup often, so every field tries several selectors.

// `var`, not `const`: this file is injected again each time the popup opens.
var LI_NAME = "[data-test-row-lockup-full-name], [data-live-test-row-lockup-full-name]";

function liText(el) {
  // Also drops leading separators, e.g. "· Copenhagen, Denmark".
  const t = el ? el.textContent.replace(/\s+/g, " ").trim().replace(/^[·•|–-]\s*/, "") : "";
  return /^[-–—·|\s]*$/.test(t) ? "" : t; // "--" means empty on LinkedIn
}

function liFirst(root, selectors) {
  for (const s of selectors) {
    const v = liText(root.querySelector(s));
    if (v) return v;
  }
  return "";
}

function liSplitName(fullName) {
  const parts = fullName.split(" ").filter(Boolean);
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

// Current title and company from the "Experience" lines, e.g.
// "Erhvervsjurist at LB Forsikring · 2026 – Present", or from a headline "Title @ Company".
function liCurrentJob(lines, headline) {
  const AT = /^(.+?)\s+(?:at|hos|@|på)\s+(.+?)(?:\s+·\s+.*)?$/i;
  const start = lines.findIndex((l) => /^(experience|erfaring)$/i.test(l));
  const exp = (start >= 0 ? lines.slice(start + 1, start + 8) : []).filter((l) => !/similar skills|lignende/i.test(l));
  const current = exp.find((l) => AT.test(l) && /present|nu\b|nuværende|today/i.test(l)) || exp.find((l) => AT.test(l));
  const m = (current && current.match(AT)) || (headline && headline.match(/^(.+?)\s+(?:@|at|hos)\s+(.+)$/i));
  return m ? { title: m[1].trim(), company: m[2].trim() } : { title: "", company: "" };
}

// The person shown in a profile view (or the first person on the page).
function extractLinkedInProfile() {
  // A Recruiter profile opens over the list; prefer the profile panel if there is one.
  const panel =
    document.querySelector("[data-test-profile-container], .profile__internal-container, [class*='profile-container']") || document;
  const fullName = liFirst(panel, [LI_NAME, ".artdeco-entity-lockup__title", "main h1", "h1"]);
  const headline = liFirst(panel, [
    "[data-test-row-lockup-headline]",
    "[data-live-test-row-lockup-headline]",
    ".artdeco-entity-lockup__subtitle",
    ".text-body-medium.break-words",
  ]);
  const place = liFirst(panel, [
    "[data-test-row-lockup-location]",
    "[data-live-test-row-lockup-location]",
    ".artdeco-entity-lockup__caption",
    ".text-body-small.inline.t-black--light.break-words",
  ]);
  const job = liCurrentJob((panel.innerText || document.body.innerText).split("\n").map((l) => l.trim()).filter(Boolean), headline);
  const company =
    liFirst(panel, [
      "[data-test-current-position] [data-test-position-entity-company-name]",
      "[data-test-position-entity-company-name]",
      "[data-test-current-employer]",
      "[data-field='experience_company_logo'] span[aria-hidden='true']",
    ]) || job.company;

  const mailto = panel.querySelector("a[href^='mailto:']");
  const email =
    (mailto && mailto.getAttribute("href").replace(/^mailto:/, "").split("?")[0]) ||
    liFirst(panel, ["[data-test-contact-email-address]"]);

  const tel = panel.querySelector("a[href^='tel:']");
  const phone = (tel && tel.getAttribute("href").replace(/^tel:/, "")) || liFirst(panel, ["[data-test-contact-phone]"]);

  // Prefer the candidate's public profile URL over the Recruiter URL.
  let linkedinUrl = "";
  const pub = [...panel.querySelectorAll("a[href*='linkedin.com/in/']")].find((a) => !/\/in\/me\/?$/.test(a.href));
  if (pub) linkedinUrl = pub.href.split("?")[0];
  else linkedinUrl = window.location.href.split("?")[0];

  // Resume/attachment links (e.g. CVs candidates sent via InMail or applied with).
  const seen = new Set();
  const cvLinks = [...panel.querySelectorAll("a[href]")]
    .filter((a) => {
      const href = a.href;
      if (!/^https?:/.test(href) || /linkedin\.com\/in\//.test(href) || seen.has(href)) return false;
      const hay = `${href} ${a.textContent} ${a.getAttribute("download") || ""} ${a.getAttribute("aria-label") || ""}`;
      const ok = a.hasAttribute("download") || /resume|résumé|\bcv\b|curriculum|attachment|\.pdf\b|\.docx?\b/i.test(hay);
      if (ok) seen.add(href);
      return ok;
    })
    .slice(0, 5)
    .map((a) => ({ href: a.href, text: (liText(a) || a.getAttribute("aria-label") || a.href).slice(0, 60) }));

  return {
    ...liSplitName(fullName),
    headline: job.title || headline,
    company,
    location: place,
    email: (email || "").trim(),
    phone: (phone || "").trim(),
    linkedinUrl,
    notes: "",
    cvLinks,
  };
}

// One person's card on a list page, from their name element.
function liPersonFromName(nameEl) {
  // The card is the largest wrapper that holds only this one person.
  let card = nameEl;
  while (card.parentElement && card.parentElement !== document.body && card.parentElement.querySelectorAll(LI_NAME).length === 1) {
    card = card.parentElement;
  }
  const fullName = liText(nameEl);
  const link =
    nameEl.closest("a[href]") ||
    nameEl.querySelector("a[href]") ||
    card.querySelector("a[href*='/talent/'][href*='profile'], a[data-test-link-to-profile-link], a[href*='linkedin.com/in/']");
  const headline = liFirst(card, ["[data-test-row-lockup-headline]", "[data-live-test-row-lockup-headline]"]);
  const lines = (card.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const job = liCurrentJob(lines, headline);
  return {
    ...liSplitName(fullName),
    headline: job.title || headline,
    company: job.company,
    location: liFirst(card, ["[data-test-row-lockup-location]", "[data-live-test-row-lockup-location]"]),
    email: "",
    phone: "",
    linkedinUrl: link ? link.href.split("?")[0] : "",
    notes: "",
  };
}

// Everyone on a Recruiter list page (pipeline, project, search results).
// Returns { people, total } where total is the "N results" count if shown.
function extractLinkedInList() {
  const people = [];
  const seen = new Set();
  for (const nameEl of document.querySelectorAll(LI_NAME)) {
    const p = liPersonFromName(nameEl);
    const key = p.linkedinUrl || `${p.firstName} ${p.lastName}`;
    if (!p.firstName || seen.has(key)) continue;
    seen.add(key);
    people.push(p);
  }
  const m = document.body.innerText.match(/(\d[\d.,]*)\s+(results|resultater|kandidater|candidates)\b/i);
  return { people, total: m ? Number(m[1].replace(/[.,]/g, "")) : null };
}

// LinkedIn only renders people as you scroll. Scrolls through the list to load
// everyone on this page (up to `want`), then scrolls back. Returns how many are loaded.
async function liLoadAll(want) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = () => document.querySelectorAll(LI_NAME).length;
  const names = document.querySelectorAll(LI_NAME);
  if (!names.length) return 0;
  // The list may scroll inside its own panel rather than the window.
  let scroller = names[names.length - 1].parentElement;
  while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  const target = scroller && scroller !== document.body ? scroller : document.scrollingElement;
  const start = target.scrollTop;
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && count() < want && still < 4; i++) {
    const all = document.querySelectorAll(LI_NAME);
    all[all.length - 1].scrollIntoView({ block: "center" });
    target.scrollTop += target.clientHeight * 0.8;
    await sleep(350);
    still = count() === last ? still + 1 : 0;
    last = count();
  }
  target.scrollTop = start;
  return count();
}

// Remembers the last person clicked on the LinkedIn page, so the popup opens on them.
if (!window.__liHronClicks) {
  window.__liHronClicks = true;
  document.addEventListener(
    "click",
    (ev) => {
      for (let n = ev.target; n && n !== document.body; n = n.parentElement) {
        if (!n.querySelectorAll) continue;
        const nameEl = n.matches(LI_NAME) ? n : n.querySelectorAll(LI_NAME).length === 1 ? n.querySelector(LI_NAME) : null;
        if (nameEl) {
          chrome.storage.local.set({ liLastClicked: { person: liPersonFromName(nameEl), at: Date.now() } });
          return;
        }
        if (n.querySelectorAll(LI_NAME).length > 1) return; // clicked outside any one person
      }
    },
    true
  );
}

// Remembers details from profiles you open (mobile, public LinkedIn link, CV
// links), so people added in bulk from a list get them too. Recruiter changes
// pages without reloading, so watch the address for a profile id.
async function liSaveProfile(id) {
  const p = extractLinkedInProfile();
  if (!p.firstName) return;
  const { liProfiles = {} } = await chrome.storage.local.get("liProfiles");
  liProfiles[id] = {
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    publicUrl: /linkedin\.com\/in\//.test(p.linkedinUrl) ? p.linkedinUrl : "",
    cvLinks: p.cvLinks,
    at: Date.now(),
  };
  // Keep the newest 500.
  const keys = Object.keys(liProfiles).sort((a, b) => liProfiles[b].at - liProfiles[a].at);
  for (const k of keys.slice(500)) delete liProfiles[k];
  await chrome.storage.local.set({ liProfiles });
}
if (!window.__liHronProfiles) {
  window.__liHronProfiles = true;
  let lastId = "";
  setInterval(() => {
    const id = (location.href.match(/\/profile\/([^/?#]+)/) || [])[1];
    if (!id || id === lastId) return;
    lastId = id;
    // Read once the profile has rendered, and again for contact details that load later.
    for (const delay of [2000, 6000]) setTimeout(() => liSaveProfile(id).catch(() => {}), delay);
  }, 1000);
}
