// Talks to HR-ON with the user's own login, using the same requests HR-ON's
// pages make (job list, per-job applicant search, candidate tags).
const HRON = "https://recruit.hr-on.com/";
const JOBS_TTL_MS = 60 * 60 * 1000;
const INDEX_TTL_MS = 30 * 60 * 1000;

// Runs a request inside an open HR-ON tab (same origin, so the login cookie is
// sent), or from the extension if no HR-ON tab is open.
async function hronRequest(path, { method = "GET", body = null } = {}) {
  const url = HRON + path;
  const run = async (u, m, b) => {
    const headers = { "X-Requested-With": "XMLHttpRequest" };
    if (b) headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    const r = await fetch(u, { method: m, body: b, headers, credentials: "include" });
    return { status: r.status, url: r.url, text: await r.text() };
  };
  const [tab] = await chrome.tabs.query({ url: HRON + "*" });
  let res;
  if (tab) {
    try {
      [{ result: res }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: run, args: [url, method, body] });
    } catch {
      res = null; // tab still loading or not scriptable; fall back below
    }
  }
  if (!res) res = await run(url, method, body);
  if (res.status >= 400) throw new Error(`HR-ON answered ${res.status}`);
  if (/managerlogin/i.test(res.url) || /type=["']password["']/i.test(res.text)) {
    throw new Error("Not logged in to HR-ON. Log in in a tab and try again.");
  }
  return res.text;
}

const parseHtml = (html) => new DOMParser().parseFromString(html, "text/html");
const cleanText = (s) => (s || "").replace(/\s+/g, " ").trim();

// Splits a name into lowercase tokens for comparison.
function nameTokens(name) {
  return cleanText(name).toLowerCase().replace(/[.,]/g, " ").split(" ").filter(Boolean);
}
function sameName(a, b) {
  const x = nameTokens(a);
  const y = nameTokens(b);
  return x.length > 0 && y.length > 0 && x[0] === y[0] && x.at(-1) === y.at(-1);
}

// All (non-archived) job postings: [{ id, title }]. Cached for an hour.
async function hronJobs(force = false) {
  const { hronJobs: cache } = await chrome.storage.local.get("hronJobs");
  if (!force && cache && Date.now() - cache.at < JOBS_TTL_MS && cache.list.length) return cache.list;
  const jobs = new Map();
  for (let p = 0; p < 10; p++) {
    const sess = Date.now();
    const doc = parseHtml(
      await hronRequest(`applications//?&Joblist_p=${p}&Joblist_ajax&sess=${sess}`, { method: "POST", body: `sess=${sess}` })
    );
    let added = 0;
    for (const a of doc.querySelectorAll("a.jobapplies-link, a[href*='jobpostid=']")) {
      const id = (a.getAttribute("href").match(/jobpostid=(\d+)/) || [])[1];
      const title = cleanText(a.closest("tr")?.querySelector(".jobtitle")?.textContent);
      if (id && title && !jobs.has(id)) {
        jobs.set(id, { id, title });
        added++;
      }
    }
    if (!added) break;
  }
  const list = [...jobs.values()];
  if (!list.length) throw new Error("Could not read the job postings from HR-ON.");
  // Also feed the job picker and the job → applicant list shortcuts.
  const { knownJobs = [], jobUrls = {} } = await chrome.storage.local.get(["knownJobs", "jobUrls"]);
  for (const j of list) jobUrls[j.title] = `${HRON}applications/company/?jobpostid=${j.id}`;
  await chrome.storage.local.set({
    hronJobs: { at: Date.now(), list },
    knownJobs: [...new Set([...list.map((j) => j.title), ...knownJobs])],
    jobUrls,
  });
  return list;
}

// Applicant rows on one page of a job's applicant list.
function parseApplicantRows(html) {
  return [...parseHtml(html).querySelectorAll("a.apname[data-cvid]")].map((a) => {
    const tr = a.closest("tr");
    return {
      name: cleanText(a.textContent),
      cvid: a.dataset.cvid,
      appid: a.dataset.applicationid,
      status: cleanText(tr?.querySelector(".statustitle")?.textContent),
      // "7. Sep" + "<div class=year>2026</div>" → "7. Sep 2026"
      date: cleanText([...(tr?.querySelector(".appdate")?.querySelectorAll("div") || [])].map((d) => d.firstChild?.textContent).join(" ")),
    };
  });
}

// Reads a job's applicant list page by page (searching for `term` if given).
// Returns [{ name, cvid, appid, status, date }].
async function hronApplicants(jobId, term = "") {
  const sess = Date.now();
  const path = (s, p) =>
    `applications/company/?jobpostid=${jobId}&list=normal&Applies_s=${encodeURIComponent(s ? "," + s : "")}` +
    `&appdate_from=&appdate_to=&Applies_advsearch=0&sess=${sess}&Applies_p=${p}&Applies_ajax`;
  const rows = new Map();
  try {
    for (let p = 0; p < 50; p++) {
      const page = parseApplicantRows(await hronRequest(path(term, p), { method: "POST", body: `sess=${sess}` }));
      const before = rows.size;
      for (const r of page) if (!rows.has(r.appid)) rows.set(r.appid, r);
      if (rows.size === before || page.length < 20) break;
    }
  } finally {
    // HR-ON may remember the last search and page; reset them so the user's list looks as usual.
    if (term || rows.size >= 20) await hronRequest(path("", 0), { method: "POST", body: `sess=${sess}` }).catch(() => {});
  }
  return [...rows.values()];
}

// Tags on a candidate with their HR-ON ids (tags belong to the CV, so they're
// the same on every application). [{ id, name }]
async function hronTagItems(cvid, appid) {
  const doc = parseHtml(await hronRequest(`view-cv/${cvid}/${appid}/?iframe`));
  return [...doc.querySelectorAll(".tagsEdit a")]
    .map((a) => ({ id: (a.getAttribute("href") || "").replace(/^#/, ""), name: cleanText(a.textContent) }))
    .filter((t) => t.name);
}
async function hronTags(cvid, appid) {
  return (await hronTagItems(cvid, appid)).map((t) => t.name);
}

// Adds the tags the candidate doesn't have yet, the way HR-ON's "Add" button does.
async function hronAddTags(cvid, appid, tags) {
  const before = await hronTags(cvid, appid);
  const has = (t) => before.some((b) => b.toLowerCase() === t.toLowerCase());
  const toAdd = tags.filter((t) => !has(t));
  const refused = {};
  for (const tag of toAdd) {
    // Exactly what HR-ON's own "Add" button sends (cvtags.min.js).
    const body = new URLSearchParams({ cvid, tag, action: "add", json: 1 }).toString();
    const text = await hronRequest("manager/cvtags.php", { method: "POST", body });
    let res = null;
    try {
      res = JSON.parse(text);
    } catch {
      /* checked against the candidate's tags below */
    }
    if (res && res.status !== "OK") refused[tag] = res.status;
  }
  const after = await hronTags(cvid, appid);
  const failed = toAdd.filter((t) => !after.some((a) => a.toLowerCase() === t.toLowerCase()));
  return {
    added: toAdd.filter((t) => !failed.includes(t)),
    skipped: tags.filter(has),
    failed: failed.map((t) => (refused[t] ? `${t} (${refused[t]})` : t)),
    tags: after,
  };
}

// Makes the candidate's tags exactly `wanted`: adds missing ones and removes the
// rest, with the same requests as HR-ON's "Add" button and a tag's "×".
async function hronSetTags(cvid, appid, wanted) {
  const want = (t) => wanted.some((w) => w.toLowerCase() === t.toLowerCase());
  const removed = [];
  const failed = [];
  for (const t of (await hronTagItems(cvid, appid)).filter((t) => !want(t.name))) {
    const body = new URLSearchParams({ cvid, tagid: t.id, action: "delete", json: 1 }).toString();
    await hronRequest("manager/cvtags.php", { method: "POST", body });
    removed.push(t.name);
  }
  const res = await hronAddTags(cvid, appid, wanted);
  const stillThere = removed.filter((r) => res.tags.some((t) => t.toLowerCase() === r.toLowerCase()));
  return {
    added: res.added,
    removed: removed.filter((r) => !stillThere.includes(r)),
    failed: [...res.failed, ...stillThere.map((r) => `${r} (not removed)`), ...failed],
    tags: res.tags,
  };
}

// Runs fn over items with at most `n` at a time.
async function mapLimit(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

// Every applicant on every job posting, cached for 30 minutes, so many people
// can be checked at once. [{ name, cvid, appid, status, date, jobId, job }]
async function hronIndex(force = false) {
  const { hronIndex: cache } = await chrome.storage.local.get("hronIndex");
  if (!force && cache && Date.now() - cache.at < INDEX_TTL_MS) return cache;
  const jobs = await hronJobs(force);
  const perJob = await mapLimit(jobs, 3, async (job) =>
    (await hronApplicants(job.id)).map((r) => ({ ...r, jobId: job.id, job: job.title }))
  );
  const index = { at: Date.now(), jobs: jobs.length, rows: perJob.flat() };
  await chrome.storage.local.set({ hronIndex: index });
  return index;
}

// Looks a person up in the index. Returns [{ ...application }] (no tags).
function hronMatches(index, firstName, lastName) {
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName ? index.rows.filter((r) => sameName(r.name, fullName)) : [];
}

// HR-ON's tag list (what a candidate's Tags field suggests) and status list
// (Received, Sourcing, Screening, …), read from any candidate page; cached for an hour.
// Returns { tags: [names], statuses: [{ id, text }] in HR-ON's order }.
async function hronCandidateLists(index) {
  const { hronLists: cache } = await chrome.storage.local.get("hronLists");
  if (cache && Date.now() - cache.at < JOBS_TTL_MS) return cache;
  const any = index.rows[0];
  if (!any) return { tags: [], statuses: [] };
  const html = await hronRequest(`view-cv/${any.cvid}/${any.appid}/?iframe`);
  const t = html.match(/var tagSuggestions\s*=\s*(\[.*?\]);/s);
  const st = html.match(/var statusEnumInfo\s*=\s*(\{.*?\});/s);
  const statuses = st
    ? Object.values(JSON.parse(st[1]))
        .filter((x) => x.active !== "0")
        .sort((x, y) => Number(x.priority) - Number(y.priority))
        .map((x) => ({ id: String(x.statusid), text: x.text, color: x.color ? `#${x.color}` : "#666666" }))
    : [];
  const lists = { at: Date.now(), tags: t ? JSON.parse(t[1]) : [], statuses };
  await chrome.storage.local.set({ hronLists: lists });
  return lists;
}
const hronTagList = async (index) => (await hronCandidateLists(index)).tags;

// Sets an application's status, with the same request as HR-ON's status dropdown.
async function hronSetStatus(appid, statusid) {
  const body = new URLSearchParams({ action: "setstatus", id: appid, statusid }).toString();
  await hronRequest("manager/jobapplies.php", { method: "POST", body });
}

// Sets the status and checks HR-ON now shows it. Returns the status HR-ON shows,
// and updates the cached index so the list shows it too.
async function hronChangeStatus(match, status, lastName) {
  await hronSetStatus(match.appid, status.id);
  const term = nameTokens(lastName).at(-1) || "";
  const row = (await hronApplicants(match.jobId, term)).find((r) => r.appid === match.appid);
  const shown = row ? row.status : "";
  const { hronIndex: cache } = await chrome.storage.local.get("hronIndex");
  if (cache && shown) {
    for (const r of cache.rows) if (r.appid === match.appid) r.status = shown;
    await chrome.storage.local.set({ hronIndex: cache });
  }
  return shown;
}

// Re-checks a person's applications live in HR-ON (the index can be up to 30
// minutes old). Returns the ones that still exist, with their current status,
// and drops the rest from the stored index.
async function hronVerify(matches, firstName, lastName) {
  const full = `${firstName} ${lastName}`.trim();
  const term = nameTokens(lastName).at(-1) || nameTokens(full).at(-1);
  const live = new Map();
  for (const jobId of new Set(matches.map((m) => m.jobId))) {
    for (const r of await hronApplicants(jobId, term)) if (sameName(r.name, full)) live.set(r.appid, r);
  }
  const kept = matches.filter((m) => live.has(m.appid)).map((m) => ({ ...m, ...live.get(m.appid) }));
  if (kept.length !== matches.length) {
    const gone = new Set(matches.filter((m) => !live.has(m.appid)).map((m) => m.appid));
    const { hronIndex: cache } = await chrome.storage.local.get("hronIndex");
    if (cache) await chrome.storage.local.set({ hronIndex: { ...cache, rows: cache.rows.filter((r) => !gone.has(r.appid)) } });
  }
  return kept;
}

// Uploads a file to a candidate's "Internal documents", with the same form as
// HR-ON's Upload button there. cv = { name, type, data: base64 }.
async function hronUploadDocument(match, cv) {
  const url = `${HRON}attachment.upload.php?varname=${match.cvid}&type=idocument`;
  const send = async (u, cvid, file) => {
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("fieldname", "");
    form.append("varname", cvid);
    form.append("type", "idocument");
    form.append("test", new File([bytes], file.name, { type: file.type || "application/pdf" }));
    const r = await fetch(u, { method: "POST", body: form, credentials: "include" });
    return { status: r.status };
  };
  const [tab] = await chrome.tabs.query({ url: HRON + "*" });
  let res = null;
  if (tab) {
    try {
      [{ result: res }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: send, args: [url, String(match.cvid), cv] });
    } catch {
      res = null;
    }
  }
  if (!res) res = await send(url, String(match.cvid), cv);
  if (res.status >= 400) throw new Error(`HR-ON answered ${res.status}`);
  // Confirm: the file name shows up on the candidate page.
  const page = await hronRequest(`view-cv/${match.cvid}/${match.appid}/?iframe`);
  const stem = cv.name.replace(/\.[^.]+$/, "");
  return page.includes(stem) || page.includes(encodeURIComponent(stem));
}
