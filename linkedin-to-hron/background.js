// Opens a candidate in HR-ON. Runs here, not in the popup, because the popup
// closes as soon as the HR-ON tab comes to the front.
const HRON = "https://recruit.hr-on.com/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTab(tabId) {
  await sleep(300);
  for (let i = 0; i < 60; i++) {
    if ((await chrome.tabs.get(tabId)).status === "complete") break;
    await sleep(250);
  }
  await sleep(700);
}

// HR-ON opens a candidate only from its applicant list (clicking the name opens
// the candidate window), so: open the job's list and click the candidate.
async function openCandidate(m) {
  const listUrl = `${HRON}applications/company/?jobpostid=${m.jobId}`;
  const [existing] = await chrome.tabs.query({ url: `${HRON}*` });
  const tab = existing ? await chrome.tabs.update(existing.id, { active: true, url: listUrl }) : await chrome.tabs.create({ url: listUrl });
  await chrome.windows.update(tab.windowId, { focused: true });
  await waitForTab(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [String(m.cvid), String(m.appid)],
    func: (cvid, appid) => {
      let a = document.querySelector(`a.apname[data-applicationid="${appid}"]`);
      if (!a) {
        // Not on the first page of the list: add a link like HR-ON's own and click it.
        a = Object.assign(document.createElement("a"), { className: "apname showModal", href: `view-cv/${cvid}/${appid}/#applications` });
        a.dataset.applicationid = appid;
        a.dataset.cvid = cvid;
        a.dataset.opts = '{"width": "97%", "title": ""}';
        a.style.display = "none";
        (document.querySelector("table") || document.body).appendChild(a);
      }
      a.click();
    },
  });
  await sleep(1500);
  const [{ result: opened }] = await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => !!document.querySelector("iframe[src*='view-cv']") })
    .catch(() => [{ result: false }]);
  // Fallback: HR-ON's candidate page on its own.
  if (!opened) await chrome.tabs.update(tab.id, { url: `${HRON}view-cv/${m.cvid}/${m.appid}/?iframe` });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openCandidate") openCandidate(msg.match);
});
