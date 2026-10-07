// Talks to HR-ON with the user's own login, using the same requests HR-ON's
// pages make (job list, per-job applicant search, candidate tags).
const HRON = "https://recruit.hr-on.com/";
const JOBS_TTL_MS = 60 * 60 * 1000;

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

// Searches one job's applicants. Returns [{ name, cvid, appid, status, date }].
async function hronSearchJob(jobId, term) {
  const sess = Date.now();
  const path = (s, p) =>
    `applications/company/?jobpostid=${jobId}&Applies_s=${encodeURIComponent(s ? "," + s : "")}` +
    `&appdate_from=&appdate_to=&Applies_advsearch=0&sess=${sess}&Applies_p=${p}&Applies_ajax`;
  const rows = new Map();
  try {
    for (let p = 0; p < 5; p++) {
      const doc = parseHtml(await hronRequest(path(term, p), { method: "POST", body: `sess=${sess}` }));
      const links = [...doc.querySelectorAll("a.apname[data-cvid]")];
      let added = 0;
      for (const a of links) {
        if (rows.has(a.dataset.applicationid)) continue;
        const tr = a.closest("tr");
        rows.set(a.dataset.applicationid, {
          name: cleanText(a.textContent),
          cvid: a.dataset.cvid,
          appid: a.dataset.applicationid,
          status: cleanText(tr?.querySelector(".statustitle")?.textContent),
          // "7. Sep" + "<div class=year>2026</div>" → "7. Sep 2026"
          date: cleanText([...(tr?.querySelector(".appdate")?.querySelectorAll("div") || [])].map((d) => d.firstChild?.textContent).join(" ")),
        });
        added++;
      }
      if (!added || links.length < 20) break;
    }
  } finally {
    // HR-ON may remember the last search; clear it so the user's list isn't left filtered.
    await hronRequest(path("", 0), { method: "POST", body: `sess=${sess}` }).catch(() => {});
  }
  return [...rows.values()];
}

// Tags on a candidate (tags belong to the CV, so they're the same on every application).
async function hronTags(cvid, appid) {
  const doc = parseHtml(await hronRequest(`view-cv/${cvid}/${appid}/?iframe`));
  return [...doc.querySelectorAll(".tagsEdit a")].map((a) => cleanText(a.textContent)).filter(Boolean);
}

// Adds the tags the candidate doesn't have yet, the way HR-ON's "Add" button does.
async function hronAddTags(cvid, appid, tags) {
  const before = await hronTags(cvid, appid);
  const has = (t) => before.some((b) => b.toLowerCase() === t.toLowerCase());
  const toAdd = tags.filter((t) => !has(t));
  for (const tag of toAdd) {
    const body = new URLSearchParams({ action: "add", cvid, tag }).toString();
    await hronRequest("manager/cvtags.php?iframe=1", { method: "POST", body });
  }
  const after = await hronTags(cvid, appid);
  const failed = toAdd.filter((t) => !after.some((a) => a.toLowerCase() === t.toLowerCase()));
  return { added: toAdd.filter((t) => !failed.includes(t)), skipped: tags.filter(has), failed, tags: after };
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

// Finds a person across all job postings by name.
// Returns { jobsSearched, matches: [{ jobId, job, name, cvid, appid, status, date, tags }] }.
async function hronFindPerson(firstName, lastName, onlyJobId = null) {
  const fullName = `${firstName} ${lastName}`.trim();
  const term = nameTokens(lastName).at(-1) || nameTokens(fullName).at(-1);
  if (!term) return { jobsSearched: 0, matches: [] };
  let jobs = await hronJobs();
  if (onlyJobId) jobs = jobs.filter((j) => j.id === onlyJobId);
  const perJob = await mapLimit(jobs, 3, async (job) =>
    (await hronSearchJob(job.id, term))
      .filter((r) => sameName(r.name, fullName))
      .map((r) => ({ ...r, jobId: job.id, job: job.title }))
  );
  const matches = perJob.flat();
  const tagsByCv = {};
  for (const m of matches) {
    if (!(m.cvid in tagsByCv)) tagsByCv[m.cvid] = await hronTags(m.cvid, m.appid).catch(() => null);
    m.tags = tagsByCv[m.cvid];
  }
  return { jobsSearched: jobs.length, matches };
}
