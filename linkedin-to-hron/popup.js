const FIELDS = ["firstName", "lastName", "email", "phone", "headline", "company", "location", "linkedinUrl", "notes"];
const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t);

const getQueue = async () => (await chrome.storage.local.get({ queue: [] })).queue;
const setQueue = (queue) => chrome.storage.local.set({ queue });
const getSettings = () => chrome.storage.sync.get({ hronUrl: DEFAULT_HRON_URL, selectors: {} });

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function readForm() {
  const c = {};
  for (const f of FIELDS) c[f] = $(f).value.trim();
  return c;
}

async function addToQueue() {
  const c = readForm();
  if (!c.firstName && !c.lastName) {
    msg("Mangler navn.");
    return false;
  }
  const queue = await getQueue();
  const dup = queue.some((q) => q.linkedinUrl && q.linkedinUrl === c.linkedinUrl);
  if (!dup) queue.push({ ...c, addedAt: Date.now() });
  await setQueue(queue);
  msg(dup ? "Kandidaten er allerede i køen." : `Tilføjet. ${queue.length} i køen.`);
  return true;
}

async function initLinkedIn(tab) {
  $("linkedin").classList.remove("hidden");
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLinkedInProfile,
    });
    for (const f of FIELDS) $(f).value = result[f] || "";
    if (!result.email) msg("Ingen e-mail fundet. Åbn kontaktinfo på profilen, eller udfyld den selv.");
  } catch (e) {
    msg("Kunne ikke læse profilen: " + e.message);
  }
  $("add").onclick = addToQueue;
  $("addAndOpen").onclick = async () => {
    if (!(await addToQueue())) return;
    const { hronUrl } = await getSettings();
    const [existing] = await chrome.tabs.query({ url: "https://recruit.hr-on.com/*" });
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: hronUrl });
    }
  };
}

async function renderQueue(tab) {
  const queue = await getQueue();
  const box = $("queue");
  box.innerHTML = "";
  if (!queue.length) {
    box.textContent = "Køen er tom. Tilføj kandidater fra LinkedIn Recruiter.";
    return;
  }
  queue.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    const name = document.createElement("span");
    name.textContent = `${c.firstName} ${c.lastName}`.trim() + (c.company ? ` (${c.company})` : "");
    const fill = document.createElement("button");
    fill.textContent = "Udfyld";
    fill.onclick = async () => {
      const { selectors } = await getSettings();
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillHrOnForm,
        args: [c, selectors],
      });
      if (result.filled.length) {
        msg(`Udfyldt: ${result.filled.join(", ")}. Gem i HR-ON, og fjern så kandidaten fra køen.`);
      } else {
        msg("Fandt ingen felter. Er du på siden 'Opret kandidat'?");
      }
    };
    const del = document.createElement("button");
    del.textContent = "Fjern";
    del.className = "secondary";
    del.onclick = async () => {
      const q = await getQueue();
      q.splice(i, 1);
      await setQueue(q);
      renderQueue(tab);
    };
    row.append(name, fill, del);
    box.appendChild(row);
  });
}

(async () => {
  const tab = await activeTab();
  const url = tab?.url || "";
  if (/^https:\/\/www\.linkedin\.com\/(talent|in)\//.test(url)) {
    await initLinkedIn(tab);
  } else if (/^https:\/\/recruit\.hr-on\.com\//.test(url)) {
    $("hron").classList.remove("hidden");
    await renderQueue(tab);
  } else {
    $("other").classList.remove("hidden");
    $("queueCount").textContent = `${(await getQueue()).length} kandidat(er) i køen.`;
  }
})();
