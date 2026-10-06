const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const EXAMPLE = { firstName: "input[name='firstname']", job: "select[name='job_id']", cv: "input[name='cv']" };
const $ = (id) => document.getElementById(id);

chrome.storage.sync
  .get({ hronUrl: DEFAULT_HRON_URL, defaultTags: "LinkedIn", selectors: {} })
  .then(({ hronUrl, defaultTags, selectors }) => {
    $("hronUrl").value = hronUrl;
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
    selectors,
  });
  $("status").textContent = "Saved.";
};
