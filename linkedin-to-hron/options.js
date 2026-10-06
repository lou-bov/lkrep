const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const EXAMPLE = { mobile: "input[name='mobile']", tags: "input[name='tags']", cv: "input[name='cv']" };
const $ = (id) => document.getElementById(id);

chrome.storage.sync
  .get({ hronUrl: DEFAULT_HRON_URL, defaultTags: "LinkedIn", fixedEmail: "xyz@f5.dk", selectors: {} })
  .then(({ hronUrl, defaultTags, fixedEmail, selectors }) => {
    $("hronUrl").value = hronUrl;
    $("fixedEmail").value = fixedEmail;
    $("defaultTags").value = defaultTags;
    $("selectors").value = JSON.stringify(selectors, null, 2);
    $("selectors").placeholder = JSON.stringify(EXAMPLE, null, 2);
  });

$("save").onclick = async () => {
  let selectors;
  try {
    selectors = JSON.parse($("selectors").value.trim() || "{}");
  } catch (e) {
    $("status").textContent = "Invalid JSON: " + e.message;
    return;
  }
  await chrome.storage.sync.set({
    hronUrl: $("hronUrl").value.trim() || DEFAULT_HRON_URL,
    defaultTags: $("defaultTags").value.trim(),
    fixedEmail: $("fixedEmail").value.trim(),
    selectors,
  });
  $("status").textContent = "Saved.";
};
