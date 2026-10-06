// Injected into the active LinkedIn tab via chrome.scripting.executeScript.
// Must be self-contained: it is serialized and run in the page.
// LinkedIn changes its markup often, so every field tries several selectors.
function extractLinkedInProfile() {
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const first = (selectors) => {
    for (const s of selectors) {
      const v = text(document.querySelector(s));
      if (v) return v;
    }
    return "";
  };

  const fullName = first([
    "[data-test-row-lockup-full-name]",
    "[data-live-test-row-lockup-full-name]",
    ".artdeco-entity-lockup__title",
    "main h1",
    "h1",
  ]);

  const headline = first([
    "[data-test-row-lockup-headline]",
    "[data-live-test-row-lockup-headline]",
    ".artdeco-entity-lockup__subtitle",
    ".text-body-medium.break-words",
  ]);

  const place = first([
    "[data-test-row-lockup-location]",
    "[data-live-test-row-lockup-location]",
    ".artdeco-entity-lockup__caption",
    ".text-body-small.inline.t-black--light.break-words",
  ]);

  const company = first([
    "[data-test-current-position] [data-test-position-entity-company-name]",
    "[data-test-position-entity-company-name]",
    "[data-test-current-employer]",
    "[data-field='experience_company_logo'] span[aria-hidden='true']",
  ]);

  const mailto = document.querySelector("a[href^='mailto:']");
  const email =
    (mailto && mailto.getAttribute("href").replace(/^mailto:/, "").split("?")[0]) ||
    first(["[data-test-contact-email-address]"]) ||
    "";

  const tel = document.querySelector("a[href^='tel:']");
  const phone =
    (tel && tel.getAttribute("href").replace(/^tel:/, "")) ||
    first(["[data-test-contact-phone]"]) ||
    "";

  // Prefer the candidate's public profile URL over the Recruiter URL.
  let linkedinUrl = "";
  const pub = [...document.querySelectorAll("a[href*='linkedin.com/in/']")].find(
    (a) => !/\/in\/me\/?$/.test(a.href)
  );
  if (pub) linkedinUrl = pub.href.split("?")[0];
  else if (/linkedin\.com\/in\//.test(window.location.href)) linkedinUrl = window.location.href.split("?")[0];
  else linkedinUrl = window.location.href;

  const parts = fullName.split(" ").filter(Boolean);
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
    headline,
    company,
    location: place,
    email: email.trim(),
    phone: phone.trim(),
    linkedinUrl,
    notes: "",
  };
}
