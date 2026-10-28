const FIELDS = ["firstName", "lastName", "email", "phone", "headline", "company", "location", "linkedinUrl", "job", "tags", "notes"];
const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const MAX_CV_BYTES = 15 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t);

const getQueue = async () => (await chrome.storage.local.get({ queue: [] })).queue;
const setQueue = (queue) => chrome.storage.local.set({ queue });
const getCv = async (id) => (await chrome.storage.local.get(`cv:${id}`))[`cv:${id}`] || null;
const setCv = (id, cv) => chrome.storage.local.set({ [`cv:${id}`]: cv });
const getSettings = () =>
  chrome.storage.sync.get({ hronUrl: DEFAULT_HRON_URL, defaultTags: "Linkedin", fixedEmail: "xyz@f5.dk", selectors: {} });
const getKnownJobs = async () => (await chrome.storage.local.get({ knownJobs: [] })).knownJobs;
const getJobUrls = async () => (await chrome.storage.local.get({ jobUrls: {} })).jobUrls;

// Finds a phone number in the CV; returns "" if none or the file can't be read.
async function phoneFromCv(cv) {
  try {
    return findPhone(await cvText(cv));
  } catch (e) {
    console.warn("Could not read CV text", e);
    return "";
  }
}

let pendingCv = null; // CV picked/fetched in the LinkedIn view, saved when the candidate is added.

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fileToCv(file) {
  if (file.size > MAX_CV_BYTES) throw new Error("File is larger than 15 MB.");
  return { name: file.name, type: file.type || "application/pdf", data: toBase64(await file.arrayBuffer()) };
}

function filenameFrom(res, url, fallback) {
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) return decodeURIComponent(m[1]);
  const last = new URL(url).pathname.split("/").pop();
  if (/\.(pdf|docx?|rtf|odt|txt)$/i.test(last)) return decodeURIComponent(last);
  const ext = /word/.test(res.headers.get("content-type") || "") ? "docx" : "pdf";
  return `${fallback}.${ext}`;
}

// Downloads a CV using the user's LinkedIn session. Tries from the extension
// first (no CORS limits), then from inside the LinkedIn tab.
async function fetchCv(url, tabId, fallbackName) {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_CV_BYTES) throw new Error("File is larger than 15 MB.");
    return { name: filenameFrom(res, url, fallbackName), type: res.headers.get("content-type")?.split(";")[0] || "application/pdf", data: toBase64(buf) };
  } catch (e) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [url],
      func: async (u) => {
        const r = await fetch(u, { credentials: "include" });
        if (!r.ok) return { error: `HTTP ${r.status}` };
        const blob = await r.blob();
        const data = await new Promise((ok) => {
          const fr = new FileReader();
          fr.onload = () => ok(fr.result.split(",")[1]);
          fr.readAsDataURL(blob);
        });
        return { type: blob.type, data, cd: r.headers.get("content-disposition") || "" };
      },
    });
    if (!result || result.error) throw new Error(result?.error || e.message);
    const m = result.cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    return { name: m ? decodeURIComponent(m[1]) : `${fallbackName}.pdf`, type: result.type || "application/pdf", data: result.data };
  }
}

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
    msg("Name is missing.");
    return false;
  }
  const queue = await getQueue();
  const existing = queue.find((q) => q.linkedinUrl && q.linkedinUrl === c.linkedinUrl);
  const item = existing || { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  Object.assign(item, c, { addedAt: Date.now() });
  if (pendingCv) {
    await setCv(item.id, pendingCv);
    item.cvName = pendingCv.name;
  }
  if (!existing) queue.push(item);
  await setQueue(queue);
  msg(existing ? "Candidate updated in the queue." : `Added. ${queue.length} in the queue.`);
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// HR-ON's applicant index is loaded once per popup and shared by everything that needs it.
let indexPromise = null;
function getIndex(force = false) {
  if (force || !indexPromise) indexPromise = hronIndex(force);
  return indexPromise;
}
let refreshBadges = () => {};

// Shows whether the person already exists in HR-ON: which job postings, status and tags.
async function checkHrOn(firstName, lastName, force = false) {
  const box = $("hronCheck");
  box.className = "check";
  box.textContent = "Checking HR-ON… (the first check takes a few seconds)";
  if (!firstName && !lastName) return (box.textContent = "");
  try {
    const index = await getIndex(force);
    const matches = hronMatches(index, firstName, lastName);
    box.textContent = "";
    if (!matches.length) {
      box.className = "check none";
      box.append(`Not in HR-ON (checked ${index.rows.length} applications on ${index.jobs} job postings).`);
    } else {
      box.className = "check found";
      box.append(el("b", { textContent: `Already in HR-ON (${matches.length} application${matches.length > 1 ? "s" : ""})` }));
      const tagsByCv = {};
      for (const m of matches) {
        const row = el("div", { className: "match" });
        row.append(
          el("a", { href: `${HRON}applications/company/?jobpostid=${m.jobId}`, target: "_blank", textContent: m.job }),
          ` — ${m.status || "?"}, ${m.date}`
        );
        const tagLine = el("div", { className: "meta", textContent: "Tags: …" });
        row.append(tagLine);
        box.append(row);
        tagsByCv[m.cvid] ??= hronTags(m.cvid, m.appid).catch(() => null);
        tagsByCv[m.cvid].then((t) => (tagLine.textContent = `Tags: ${t == null ? "could not read" : t.join(", ") || "none"}`));
      }
    }
  } catch (e) {
    box.className = "check none";
    box.textContent = `Could not check HR-ON: ${e.message}`;
  }
  const again = el("a", { href: "#", textContent: "Check again" });
  again.onclick = (ev) => {
    ev.preventDefault();
    checkHrOn($("firstName").value.trim(), $("lastName").value.trim(), true).then(() => refreshBadges());
  };
  box.append(" ", again);
}

// Puts one person into the form and checks them in HR-ON.
function loadPerson(p) {
  for (const f of ["firstName", "lastName", "email", "phone", "headline", "company", "location", "linkedinUrl"]) $(f).value = p[f] || "";
  pendingCv = null;
  $("cvStatus").textContent = "";
  $("cvFile").value = "";
  return checkHrOn(p.firstName, p.lastName);
}

// List pages (pipeline, project, search): everyone on the page, with their HR-ON status.
function showPeople({ people, total }) {
  const box = $("people");
  box.classList.remove("hidden");
  const more = total && total > people.length ? ` (${total} in total; go to the next results page for more)` : "";
  box.append(el("b", { textContent: `${people.length} people on this page${more}.` }));
  box.append(el("div", { className: "meta", textContent: "Click a name to edit and add one person, or tick several and add them all to the queue." }));
  const list = el("div", { className: "people-list" });
  const rows = people.map((p) => {
    const row = el("div", { className: "person" });
    const chk = el("input", { type: "checkbox" });
    const name = el("a", { href: "#", textContent: `${p.firstName} ${p.lastName}`.trim() });
    name.onclick = (ev) => {
      ev.preventDefault();
      list.querySelectorAll(".person").forEach((r) => r.classList.remove("current"));
      row.classList.add("current");
      loadPerson(p);
    };
    const badge = el("span", { className: "badge", textContent: "…" });
    const sub = el("div", { className: "meta", textContent: [p.headline, p.company].filter(Boolean).join(" · ") });
    const text = el("div", { className: "who" });
    text.append(name, " ", badge, sub);
    row.append(chk, text);
    list.append(row);
    return { p, row, chk, badge };
  });
  rows[0]?.row.classList.add("current");
  box.append(list);

  refreshBadges = async () => {
    try {
      const index = await getIndex();
      for (const r of rows) {
        const m = hronMatches(index, r.p.firstName, r.p.lastName);
        r.isNew = !m.length;
        r.badge.className = `badge ${m.length ? "in" : "new"}`;
        r.badge.textContent = m.length ? `In HR-ON: ${[...new Set(m.map((x) => x.job))].join(", ")}` : "New";
      }
    } catch (e) {
      rows.forEach((r) => (r.badge.textContent = ""));
    }
  };
  refreshBadges();

  const selectNew = el("button", { className: "small secondary", textContent: "Select all new" });
  selectNew.onclick = () => rows.forEach((r) => (r.chk.checked = !!r.isNew));
  const addSel = el("button", { className: "small", textContent: "Add selected to queue" });
  addSel.onclick = async () => {
    const chosen = rows.filter((r) => r.chk.checked).map((r) => r.p);
    if (!chosen.length) return msg("Tick the people to add first.");
    const queue = await getQueue();
    let added = 0;
    for (const p of chosen) {
      const dup = queue.some((q) => (p.linkedinUrl && q.linkedinUrl === p.linkedinUrl) || sameName(`${q.firstName} ${q.lastName}`, `${p.firstName} ${p.lastName}`));
      if (dup) continue;
      queue.push({ ...p, job: $("job").value.trim(), tags: $("tags").value.trim(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: Date.now() });
      added++;
    }
    await setQueue(queue);
    msg(`Added ${added} to the queue` + (added < chosen.length ? ` (${chosen.length - added} already there)` : "") + `, with the job and tags below. ${queue.length} in the queue.`);
  };
  box.append(el("div", { className: "row-buttons" }));
  box.lastChild.append(selectNew, addSel);
}

// HR-ON's existing tags as chips under the Tags field; click to add or remove one.
async function showTagPicker() {
  const box = $("tagPicker");
  let tags = [];
  try {
    tags = await hronTagList(await getIndex());
  } catch {
    return; // HR-ON not reachable; the text field still works
  }
  const current = () => $("tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const chips = tags.map((tag) => {
    const chip = el("button", { type: "button", className: "chip", textContent: tag });
    chip.onclick = () => {
      const list = current();
      const i = list.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
      if (i >= 0) list.splice(i, 1);
      else list.push(tag);
      $("tags").value = list.join(", ");
      sync();
    };
    return chip;
  });
  const sync = () => {
    const list = current().map((t) => t.toLowerCase());
    chips.forEach((c) => c.classList.toggle("on", list.includes(c.textContent.toLowerCase())));
  };
  $("tags").addEventListener("input", sync);
  box.replaceChildren(...chips);
  sync();
}

async function initLinkedIn(tab) {
  $("linkedin").classList.remove("hidden");
  const { defaultTags } = await getSettings();
  $("tags").value = defaultTags;
  for (const job of await getKnownJobs()) {
    const o = document.createElement("option");
    o.value = job;
    $("jobList").appendChild(o);
  }
  const { lastJob } = await chrome.storage.local.get({ lastJob: "" });
  $("job").value = lastJob;
  $("job").onchange = () => chrome.storage.local.set({ lastJob: $("job").value.trim() });

  let profile = {};
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    const onProfile = /\/profile\/|linkedin\.com\/in\//.test(tab.url);
    let page = { people: [] };
    const readList = async () => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => extractLinkedInList() }))[0].result;
    if (!onProfile) page = await readList();
    if (page.people.length > 1 && (!page.total || page.total > page.people.length)) {
      // Load everyone on this results page (LinkedIn shows up to 50 per page).
      msg("Loading everyone on this page…");
      const want = Math.min(page.total || 50, 50);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (n) => liLoadAll(n), args: [want] });
      page = await readList();
      msg("");
    }
    if (page.people.length > 1) {
      showPeople(page);
      profile = page.people[0];
    } else {
      [{ result: profile }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => extractLinkedInProfile() });
      if (!profile.email) msg("No email found. Open the profile's contact info, or type it in.");
    }
  } catch (e) {
    msg("Could not read the page: " + e.message);
  }
  showTagPicker();
  loadPerson(profile).then(async () => {
    // The check loads HR-ON's job list; offer it in the job picker.
    const have = new Set([...$("jobList").options].map((o) => o.value));
    for (const job of await getKnownJobs()) if (!have.has(job)) $("jobList").append(el("option", { value: job }));
  });

  const baseName = () => `${$("firstName").value}_${$("lastName").value}_CV`.replace(/\s+/g, "_");
  const showCv = async () => {
    $("cvStatus").textContent = pendingCv ? `Attached: ${pendingCv.name}` : "";
    if (!pendingCv) return;
    const phone = await phoneFromCv(pendingCv);
    if (phone && !$("phone").value.trim()) {
      $("phone").value = phone;
      $("cvStatus").textContent += ` · mobile from CV: ${phone}`;
    } else if (phone && phone !== $("phone").value.replace(/[^\d+]/g, "")) {
      $("cvStatus").textContent += ` · CV also has: ${phone}`;
    }
  };
  const links = profile.cvLinks || [];
  if (!links.length) {
    $("cvLinks").innerHTML =
      '<div class="msg" style="margin-top:0">No CV link found on this page. Choose a file instead (e.g. a CV the candidate sent, or LinkedIn "Save to PDF").</div>';
  }
  for (const link of links) {
    const b = document.createElement("button");
    b.className = "small secondary";
    b.textContent = `Fetch: ${link.text}`;
    b.title = link.href;
    b.onclick = async () => {
      msg("Downloading CV…");
      try {
        pendingCv = await fetchCv(link.href, tab.id, baseName());
        showCv();
        msg("");
      } catch (e) {
        msg("Could not download the CV: " + e.message + ". Download it yourself and choose the file.");
      }
    };
    $("cvLinks").appendChild(b);
  }
  $("cvFile").onchange = async () => {
    const file = $("cvFile").files[0];
    if (!file) return;
    try {
      pendingCv = await fileToCv(file);
      showCv();
    } catch (e) {
      msg(e.message);
    }
  };

  $("add").onclick = addToQueue;
  $("addAndOpen").onclick = async () => {
    if (!(await addToQueue())) return;
    // Go straight to the job's applicant list if we've seen it before.
    const { hronUrl } = await getSettings();
    const jobUrl = (await getJobUrls())[$("job").value.trim()];
    const [existing] = await chrome.tabs.query({ url: "https://recruit.hr-on.com/*" });
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true, ...(jobUrl ? { url: jobUrl } : {}) });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: jobUrl || hronUrl });
    }
  };
}

// Fills the Create CV form, which HR-ON may show in a frame: try every frame,
// and if no form is open yet, click "Create CV" and wait for it.
async function fillInHrOn(tabId, c) {
  const settings = await getSettings();
  const cv = await getCv(c.id);

  await chrome.scripting.executeScript({ target: { tabId }, files: ["fill.js"] });
  const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => scanHrOnPage() });
  if (c.job && page.currentJob) {
    const a = c.job.toLowerCase();
    const b = page.currentJob.toLowerCase();
    if (!a.includes(b) && !b.includes(a)) {
      return { error: `This page is for "${page.currentJob}", but the candidate is for "${c.job}". Open that job's applicant list, or change the job in the queue.` };
    }
  }

  const tryFill = async () => {
    const target = { tabId, allFrames: true };
    await chrome.scripting.executeScript({ target, world: "MAIN", files: ["fill.js"] });
    const results = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: (cand, file, s) => fillHrOnForm(cand, file, s),
      args: [c, cv, settings],
    });
    return results.map((r) => r.result).find((r) => r && !r.notHere);
  };
  let result = await tryFill();
  if (result) return result;
  const [{ result: clicked }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => clickCreateCv() });
  if (!clicked) return { error: "Open the job's applicant list in HR-ON (the page with the 'Create CV' button) first." };
  for (let i = 0; i < 20 && !result; i++) {
    await sleep(400);
    result = await tryFill();
  }
  return result || { error: "Clicked 'Create CV', but couldn't find the form. Open it yourself and click Fill form again." };
}

// Finds the saved candidate in their job posting (or all postings) and adds the tags.
async function addTagsInHrOn(c, tags) {
  let jobId = null;
  if (c.job) {
    const job = (await hronJobs()).find((j) => j.title.toLowerCase() === c.job.toLowerCase());
    jobId = job ? job.id : null;
  }
  const { matches } = await hronFindPerson(c.firstName, c.lastName, jobId);
  const name = `${c.firstName} ${c.lastName}`.trim();
  if (!matches.length) {
    return { error: `Couldn't find ${name} in ${jobId ? `"${c.job}"` : "HR-ON"}. Save the candidate in HR-ON first.` };
  }
  const people = [...new Set(matches.map((m) => m.cvid))];
  if (people.length > 1) {
    return { error: `Found ${people.length} different people called ${name}${jobId ? "" : ". Set the job in the queue and try again"}.` };
  }
  return hronAddTags(matches[0].cvid, matches[0].appid, tags);
}

async function renderQueue(hronTab) {
  $("queueSection").classList.remove("hidden");
  const queue = await getQueue();
  const box = $("queue");
  box.innerHTML = "";
  if (!queue.length) {
    box.textContent = "The queue is empty. Add candidates from LinkedIn Recruiter.";
    return;
  }
  const jobs = await getKnownJobs();
  queue.forEach((c) => {
    const row = document.createElement("div");
    row.className = "item";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `${c.firstName} ${c.lastName}`.trim() + (c.company ? ` (${c.company})` : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `CV: ${c.cvName || "none"} · Mobile: ${c.phone || "none"}` + (c.tagged ? " · Tags added ✓" : "");

    // Job and tags can be adjusted here, e.g. once the HR-ON job list is known.
    const job = document.createElement("input");
    job.value = c.job || "";
    job.placeholder = "Job";
    job.setAttribute("list", "queueJobs");
    const tags = document.createElement("input");
    tags.value = c.tags || "";
    tags.placeholder = "Tags (comma-separated)";
    const save = async () => {
      const q = await getQueue();
      const it = q.find((x) => x.id === c.id);
      if (!it) return;
      it.job = c.job = job.value.trim();
      it.tags = c.tags = tags.value.trim();
      await setQueue(q);
    };
    job.onchange = save;
    tags.onchange = save;

    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".pdf,.doc,.docx,.rtf,.txt,.odt";
    file.onchange = async () => {
      if (!file.files[0]) return;
      try {
        const cv = await fileToCv(file.files[0]);
        await setCv(c.id, cv);
        const phone = c.phone ? "" : await phoneFromCv(cv);
        const q = await getQueue();
        const it = q.find((x) => x.id === c.id);
        if (it) {
          it.cvName = c.cvName = cv.name;
          if (phone) it.phone = c.phone = phone;
        }
        await setQueue(q);
        meta.textContent = `CV: ${cv.name}` + (phone ? ` · mobile from CV: ${phone}` : "");
      } catch (e) {
        msg(e.message);
      }
    };

    const buttons = document.createElement("div");
    if (hronTab) {
      const fill = document.createElement("button");
      fill.className = "small";
      fill.textContent = "Fill form";
      fill.onclick = async () => {
        await save();
        try {
          const result = await fillInHrOn(hronTab.id, c);
          if (result.error) return msg(result.error);
          msg(
            result.filled.length
              ? `Filled: ${result.filled.join(", ")}.` +
                  (result.missing.length ? ` Not found: ${result.missing.join(", ")}.` : "") +
                  " Click Save in HR-ON, then Add tags."
              : "No fields found in the Create CV form."
          );
        } catch (e) {
          msg("Could not fill the form: " + e.message);
        }
      };
      buttons.appendChild(fill);
    }
    // Step 2, after saving in HR-ON: find the candidate in the job and add the tags.
    const tagBtn = document.createElement("button");
    tagBtn.className = "small";
    tagBtn.textContent = "Add tags";
    tagBtn.onclick = async () => {
      await save();
      const list = (c.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (!list.length) return msg("No tags to add.");
      msg("Finding the candidate in HR-ON…");
      try {
        const res = await addTagsInHrOn(c, list);
        if (res.error) return msg(res.error);
        const parts = [];
        if (res.added.length) parts.push(`Added: ${res.added.join(", ")}.`);
        if (res.skipped.length) parts.push(`Already there: ${res.skipped.join(", ")}.`);
        if (res.failed.length) parts.push(`HR-ON did not accept: ${res.failed.join(", ")}.`);
        msg(parts.join(" ") + " Reopen the candidate in HR-ON to see them.");
        if (!res.failed.length) {
          const q = await getQueue();
          const it = q.find((x) => x.id === c.id);
          if (it) it.tagged = c.tagged = true;
          await setQueue(q);
          meta.textContent += " · Tags added ✓";
        }
      } catch (e) {
        msg("Could not add tags: " + e.message);
      }
    };
    buttons.appendChild(tagBtn);
    if (c.cvName) {
      // For uploading by hand if the CV didn't attach.
      const dl = document.createElement("button");
      dl.className = "small secondary";
      dl.textContent = "Download CV";
      dl.onclick = async () => {
        const cv = await getCv(c.id);
        if (!cv) return msg("CV not found.");
        const url = URL.createObjectURL(new Blob([base64ToBytes(cv.data)], { type: cv.type }));
        Object.assign(document.createElement("a"), { href: url, download: cv.name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      };
      buttons.appendChild(dl);
    }
    const del = document.createElement("button");
    del.className = "small secondary";
    del.textContent = "Remove";
    del.onclick = async () => {
      await setQueue((await getQueue()).filter((x) => x.id !== c.id));
      await chrome.storage.local.remove(`cv:${c.id}`);
      renderQueue(hronTab);
    };
    buttons.appendChild(del);

    row.append(name, meta, job, tags, file, buttons);
    box.appendChild(row);
  });
  const dl = document.createElement("datalist");
  dl.id = "queueJobs";
  for (const j of jobs) dl.appendChild(Object.assign(document.createElement("option"), { value: j }));
  box.appendChild(dl);
}

(async () => {
  if (new URLSearchParams(location.search).get("view") === "queue") {
    // Full-tab view: safe for file pickers, which can close the popup on some systems.
    document.body.classList.add("page");
    await renderQueue(null);
    return;
  }
  const tab = await activeTab();
  const url = tab?.url || "";
  if (/^https:\/\/www\.linkedin\.com\/(talent|in)\//.test(url)) {
    await initLinkedIn(tab);
  } else if (/^https:\/\/recruit\.hr-on\.com\//.test(url)) {
    $("hron").classList.remove("hidden");
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fill.js"] });
      const [{ result: info }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => scanHrOnPage() });
      const known = new Set(await getKnownJobs());
      info.jobs.forEach((j) => known.add(j));
      if (info.currentJob) {
        known.add(info.currentJob);
        const jobUrls = await getJobUrls();
        jobUrls[info.currentJob] = info.url;
        await chrome.storage.local.set({ jobUrls });
        $("currentJob").textContent = `Current job: ${info.currentJob}`;
      }
      await chrome.storage.local.set({ knownJobs: [...known] });
    } catch {
      /* page not scriptable yet; ignore */
    }
    await renderQueue(tab);
  } else {
    $("other").classList.remove("hidden");
    await renderQueue(null);
  }
})();
