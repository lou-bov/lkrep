const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const EXAMPLE = { firstName: "input[name='firstname']", email: "input[name='email']" };
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get({ hronUrl: DEFAULT_HRON_URL, selectors: {} }).then(({ hronUrl, selectors }) => {
  $("hronUrl").value = hronUrl;
  $("selectors").value = JSON.stringify(selectors, null, 2);
  $("selectors").placeholder = JSON.stringify(EXAMPLE, null, 2);
});

$("save").onclick = async () => {
  let selectors;
  try {
    selectors = JSON.parse($("selectors").value.trim() || "{}");
  } catch (e) {
    $("status").textContent = "Ugyldig JSON: " + e.message;
    return;
  }
  await chrome.storage.sync.set({ hronUrl: $("hronUrl").value.trim() || DEFAULT_HRON_URL, selectors });
  $("status").textContent = "Gemt.";
};
