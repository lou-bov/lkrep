// LinkedIn → HR-ON popup. Three views:
// - on LinkedIn: the people on the page (if several) and one person's screen;
// - the run window (popup.html?view=run): adds people to HR-ON one by one;
// - anywhere else: a hint.
const DEFAULT_HRON_URL = "https://recruit.hr-on.com/managerlogin.php";
const MAX_CV_BYTES = 15 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);
const msg = (t) => ($("msg").textContent = t || "");
const fullName = (p) => `${p.firstName || ""} ${p.lastName || ""}`.trim();
const initials = (p) => ((p.firstName || " ")[0] + (p.lastName || " ")[0]).trim().toUpperCase() || "?";
const personKey = (p) => p.linkedinUrl || fullName(p);
const splitTags = (s) => (s || "").split(",").map((t) => t.trim()).filter(Boolean);
const hasTag = (list, t) => list.some((x) => x.toLowerCase() === t.toLowerCase());

const getSettings = () =>
  chrome.storage.sync.get({ hronUrl: DEFAULT_HRON_URL, defaultTags: "Linkedin", fixedEmail: "xyz@f5.dk", selectors: {} });

// ---------- CV files ----------

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

// Downloads a CV using the user's LinkedIn session: from the extension first
// (no CORS limits), then from inside the LinkedIn tab.
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

// Finds a phone number in the CV; "" if none or the file can't be read.
async function phoneFromCv(cv) {
  try {
    return findPhone(await cvText(cv));
  } catch {
    return "";
  }
}

// ---------- HR-ON data shared by the views ----------

let indexPromise = null;
let hronInfoText = "";
const setInfo = (t) => ($("hronInfo").textContent = hronInfoText = t);
function getIndex(force = false) {
  if (force || !indexPromise) {
    indexPromise = hronIndex(force);
    indexPromise
      .then((ix) => setInfo(`HR-ON: ${ix.jobs} jobs · ${ix.rows.length} applications`))
      .catch((e) => setInfo(/logged in/i.test(e.message) ? "HR-ON: not logged in" : "HR-ON: not reachable"));
  }
  return indexPromise;
}
// Opens the candidate in HR-ON (done by the background script; see background.js).
const openCandidate = (m) => chrome.runtime.sendMessage({ type: "openCandidate", match: { cvid: m.cvid, appid: m.appid, jobId: m.jobId } });
const cvLink = (m) => {
  const a = el("a", { href: "#", textContent: "Open CV" });
  a.onclick = (ev) => {
    ev.preventDefault();
    openCandidate(m);
  };
  return a;
};
// The person's HR-ON applications, newest first.
const matchesIn = (index, p) => hronMatches(index, p.firstName, p.lastName).sort((a, b) => Number(b.appid) - Number(a.appid));

// Stage icons: Screening = an active process has started;
// Manager Review Needed / Interview N = we are in contact with the person.
const stageOf = (status) => (/screening/i.test(status) ? "process" : /manager review|interview/i.test(status) ? "contact" : null);
// The most important stage across the person's applications: in contact, then screening.
function personStage(matches) {
  const withStage = (matches || []).map((m) => ({ m, kind: stageOf(m.status) })).filter((x) => x.kind);
  return withStage.find((x) => x.kind === "contact") || withStage.find((x) => x.kind === "process") || null;
}
const BUBBLE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>';
function stageIcon(kind, m) {
  const icon = el("span", { className: `stage ${kind}` });
  if (kind === "process") icon.textContent = "!";
  else icon.innerHTML = BUBBLE_SVG;
  icon.title = kind === "process" ? `In screening — an active process has started (${m.job})` : `In contact — ${m.status} (${m.job})`;
  return icon;
}

// ---------- LinkedIn view ----------

const S = {
  tab: null,
  settings: null,
  people: [], // everyone on the LinkedIn page
  total: null,
  checked: new Set(), // indexes ticked for "Add N to HR-ON"
  edited: new Map(), // personKey → the person as edited on their screen
  cur: null, // the person on the person screen
  jobs: [],
  allTags: [],
  statuses: [], // HR-ON's statuses: [{ id, text }]
  lastJobId: "",
  lastStatusId: "0", // "0" = Received
};

// A person as the person screen edits them (kept while the popup is open).
function workingCopy(p) {
  const key = personKey(p);
  if (!S.edited.has(key)) {
    S.edited.set(key, {
      ...p,
      email: S.settings.fixedEmail,
      tags: splitTags(S.settings.defaultTags),
      jobId: S.lastJobId,
      statusId: S.lastStatusId,
      cv: null,
      matches: null, // null = still checking HR-ON
      savedTags: null, // their tags in HR-ON, if they're there
      error: "",
    });
  }
  return S.edited.get(key);
}

function fillJobSelect(select, value) {
  select.replaceChildren(
    el("option", { value: "", textContent: S.jobs.length ? "Choose job posting…" : "Loading job postings…" }),
    ...S.jobs.map((j) => el("option", { value: j.id, textContent: j.title }))
  );
  select.value = S.jobs.some((j) => j.id === value) ? value : "";
}

function fillStatusSelect(select, value) {
  const list = S.statuses.length ? S.statuses : [{ id: "0", text: "Received" }];
  select.replaceChildren(...list.map((x) => el("option", { value: x.id, textContent: x.text })));
  select.value = list.some((x) => x.id === value) ? value : list[0].id;
}

function rememberStatus(id) {
  S.lastStatusId = id;
  chrome.storage.local.set({ lastStatusId: id });
}

function rememberJob(id) {
  S.lastJobId = id;
  chrome.storage.local.set({ lastJobId: id });
}

// ----- list screen -----

function renderList() {
  show("listScreen");
  show("personScreen", false);
  const n = S.people.length;
  $("listTitle").textContent = `${n} people on this page`;
  $("listSub").textContent = S.total && S.total > n ? `${S.total} in total · go to LinkedIn's next page for more` : "";
  fillJobSelect($("bulkJob"), S.lastJobId);
  fillStatusSelect($("bulkStatus"), $("bulkStatus").value || S.lastStatusId);
  if (!$("bulkTags").value) $("bulkTags").value = S.settings.defaultTags;

  const box = $("people");
  box.replaceChildren();
  S.people.forEach((p, i) => {
    const copy = workingCopy(p);
    const inHron = copy.matches && copy.matches.length > 0;
    const chk = el("input", { type: "checkbox", checked: S.checked.has(i) });
    chk.setAttribute("aria-label", `Select ${fullName(p)}`);
    const badge = el("span", {
      className: `badge ${copy.matches == null ? "" : inHron ? "in" : "new"}`,
      textContent: copy.matches == null ? "…" : inHron ? "In HR-ON" : "New",
    });
    const btn = el(
      "button",
      { className: "row-btn", onclick: () => openPerson(i) },
      el("span", { className: `avatar ${inHron ? "in" : ""}`, textContent: initials(p) }),
      el(
        "span",
        { className: "who" },
        el("span", { className: "name", textContent: fullName(p) }),
        el("span", { className: "line", textContent: [p.headline, p.company].filter(Boolean).join(" · ") })
      ),
      ...(personStage(copy.matches) ? [stageIcon(personStage(copy.matches).kind, personStage(copy.matches).m)] : []),
      badge
    );
    const row = el("div", { className: `row ${S.checked.has(i) ? "checked" : ""}` }, chk, btn);
    chk.onchange = () => {
      chk.checked ? S.checked.add(i) : S.checked.delete(i);
      row.classList.toggle("checked", chk.checked);
      updateBulkButton();
    };
    box.append(row);
  });
  updateBulkButton();
}

function updateBulkButton() {
  const n = S.checked.size;
  const b = $("addMany");
  b.disabled = !n || !$("bulkJob").value;
  b.textContent = !n ? "Tick people to add them in one go" : !$("bulkJob").value ? "Choose a job posting first" : `Add ${n} to HR-ON`;
}

const onScreen = (id) => !$(id).classList.contains("hidden");

// Fills in New / In HR-ON for everyone once the HR-ON index is loaded.
async function markPeople() {
  try {
    const index = await getIndex();
    for (const p of S.people) {
      const copy = workingCopy(p);
      if (copy.matches == null) copy.matches = matchesIn(index, copy);
    }
  } catch (e) {
    for (const p of S.people) workingCopy(p).error = e.message;
  }
  if (onScreen("listScreen")) renderList();
  if (S.cur && onScreen("personScreen")) {
    renderPerson();
    const c = S.cur;
    verifyPerson(c).then(() => loadSavedTags(c));
  }
}

// ----- person screen -----

function openPerson(i) {
  S.cur = workingCopy(S.people[i]);
  show("listScreen", false);
  show("personScreen");
  show("back", S.people.length > 1);
  $("details").open = false;
  msg("");
  renderPerson();
  const c = S.cur;
  verifyPerson(c).then(() => loadSavedTags(c));
  // Next time the popup opens, start on this person.
  chrome.storage.local.set({ liLastClicked: { person: S.people[i], at: Date.now() } });
}

// The index can be up to 30 minutes old: confirm the person's applications live in HR-ON.
async function verifyPerson(c) {
  if (c.verified || !c.matches || !c.matches.length) return;
  try {
    c.matches = await hronVerify(c.matches, c.firstName, c.lastName);
  } catch {
    /* keep what the index says */
  }
  c.verified = true;
  if (S.cur === c) renderPerson();
}

// For someone already in HR-ON: their current tags go into the tag picker.
async function loadSavedTags(c) {
  if (c.savedTags || !c.matches || !c.matches.length) return;
  try {
    const names = await hronTags(c.matches[0].cvid, c.matches[0].appid);
    c.savedTags = names;
    c.tags = [...names];
  } catch {
    c.savedTags = null;
  }
  if (S.cur === c) renderPerson();
}

function renderPerson() {
  const c = S.cur;
  // Still checking: no index yet, or the index says "in HR-ON" and the live check isn't back.
  const pending = !c.error && (c.matches == null || (c.matches.length > 0 && !c.verified));
  const inHron = !pending && !!(c.matches && c.matches.length);
  $("pAvatar").className = `avatar big ${inHron ? "in" : ""}`;
  $("pAvatar").textContent = initials(c);
  $("pName").textContent = fullName(c) || "—";
  $("pLine").textContent = [c.headline, c.company].filter(Boolean).join(" · ");
  $("pPlace").textContent = c.location || "";
  for (const f of ["firstName", "lastName", "email", "phone", "headline", "company", "location", "linkedinUrl"]) {
    if (document.activeElement !== $(f)) $(f).value = c[f] || "";
  }
  $("sumEmail").textContent = c.email || "none";

  // HR-ON status
  const st = $("status");
  st.replaceChildren();
  if (c.error) {
    st.className = "status";
    st.append(`Could not check HR-ON: ${c.error}`);
  } else if (pending) {
    st.className = "status";
    st.append("Checking HR-ON… (the first check takes a few seconds)");
  } else if (!inHron) {
    st.className = "status new";
    const line = el("span", { textContent: "New — not in HR-ON" });
    st.append(line);
    getIndex()
      .then((ix) => (line.textContent = `New — not in HR-ON (checked ${ix.rows.length} applications on ${ix.jobs} jobs)`))
      .catch(() => {});
  } else {
    st.className = "status in";
    st.append(el("b", { textContent: `Already in HR-ON · ${c.matches.length} application${c.matches.length > 1 ? "s" : ""}` }));
    const stage = personStage(c.matches);
    if (stage) {
      const text =
        stage.kind === "process"
          ? `Active process — in Screening (${stage.m.job}). Check with the recruiter before contacting.`
          : `In contact — ${stage.m.status} (${stage.m.job}). We are talking to this person now.`;
      st.append(el("div", { className: `stage-line ${stage.kind}` }, stageIcon(stage.kind, stage.m), el("span", { textContent: text })));
    }
    for (const m of c.matches) {
      const kind = stageOf(m.status);
      st.append(
        el(
          "div",
          { className: "app" },
          el("span", { textContent: `${m.job} — ${m.status || "?"}, ${m.date}` }),
          cvLink(m)
        )
      );
      if (kind) st.lastChild.firstChild.prepend(stageIcon(kind, m), " ");
    }
  }
  if (!pending || c.error) {
    const again = el("a", { href: "#", className: "again", textContent: "Check again" });
    again.onclick = (ev) => {
      ev.preventDefault();
      for (const p of S.edited.values()) Object.assign(p, { matches: null, verified: false, savedTags: null, error: "", editingTags: false, tagNote: "" });
      renderPerson();
      getIndex(true);
      markPeople();
    };
    st.append(again);
  }

  // Job and status (new people only)
  show("jobField", !inHron);
  fillJobSelect($("job"), c.jobId);
  show("statusField", !inHron);
  fillStatusSelect($("statusSel"), c.statusId);

  // Tags: new people pick from all tags. Someone already in HR-ON shows only their
  // own tags; "Edit tags" opens the full list with Save / Cancel.
  const saved = c.savedTags || [];
  const editing = inHron && !!c.editingTags;
  const readOnly = inHron && !editing;
  $("tagHint").textContent = c.tagNote || (!inHron ? "Click to add or remove" : editing ? "Click to add or remove · ✓ = in HR-ON now" : c.savedTags == null ? "Loading…" : "On the candidate in HR-ON");
  let names = readOnly ? saved : [...S.allTags];
  if (!readOnly) for (const t of [...saved, ...c.tags]) if (!hasTag(names, t)) names.push(t);
  $("chips").replaceChildren(
    ...names.map((t) => {
      const chip = el("button", { className: "chip", textContent: t });
      if (readOnly) {
        chip.classList.add("on");
        chip.disabled = true;
        chip.style.cursor = "default";
        return chip;
      }
      chip.classList.toggle("on", hasTag(c.tags, t));
      chip.classList.toggle("saved", editing && hasTag(saved, t));
      chip.onclick = () => {
        c.tags = hasTag(c.tags, t) ? c.tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...c.tags, t];
        renderPerson();
      };
      return chip;
    })
  );
  show("noTags", readOnly && c.savedTags != null && !saved.length);
  show("newTagRow", !readOnly);
  show("editTags", readOnly && c.savedTags != null);
  show("tagActions", editing);
  const changed = saved.length !== c.tags.length || saved.some((t) => !hasTag(c.tags, t));
  $("saveTags").disabled = !changed;
  $("saveTags").textContent = changed ? "Save tags to HR-ON" : "No changes";

  // CV (new people only)
  show("cvField", !inHron);
  $("drop").classList.toggle("has", !!c.cv);
  $("dropText").textContent = c.cv
    ? `${c.cv.name}${c.cvPhone ? ` · mobile found: ${c.cvPhone}` : ""} — click to change`
    : "Drop the CV here, or click to choose a file";
  $("cvLinks").replaceChildren(
    ...(c.cvLinks || []).map((link) =>
      el("button", {
        className: "secondary",
        textContent: `Fetch CV: ${link.text}`,
        title: link.href,
        onclick: async () => {
          msg("Downloading CV…");
          try {
            await setCv(c, await fetchCv(link.href, S.tab.id, `${fullName(c)}_CV`.replace(/\s+/g, "_")));
            msg("");
          } catch (e) {
            msg(`Could not download the CV (${e.message}). Download it yourself and drop it here.`);
          }
        },
      })
    )
  );

  // Main button
  const primary = $("primary");
  primary.classList.toggle("add", !inHron);
  if (inHron) {
    primary.disabled = false;
    primary.textContent = "Open CV in HR-ON";
  } else {
    primary.disabled = pending || !c.jobId || !fullName(c);
    primary.textContent = pending ? "Checking HR-ON…" : !c.jobId ? "Choose a job posting first" : "Add to HR-ON";
  }
}

async function setCv(c, cv) {
  c.cv = cv;
  c.cvPhone = await phoneFromCv(cv);
  if (c.cvPhone && !c.phone) c.phone = c.cvPhone;
  if (S.cur === c) renderPerson();
}

// ----- start: read the LinkedIn page -----

async function initLinkedIn(tab) {
  S.tab = tab;
  S.settings = await getSettings();
  ({ lastJobId: S.lastJobId, lastStatusId: S.lastStatusId } = await chrome.storage.local.get({ lastJobId: "", lastStatusId: "0" }));
  getIndex();
  hronJobs()
    .then((jobs) => {
      S.jobs = jobs;
      if (onScreen("listScreen")) {
        fillJobSelect($("bulkJob"), $("bulkJob").value || S.lastJobId);
        updateBulkButton();
      }
      if (S.cur) renderPerson();
    })
    .catch(() => {});
  getIndex()
    .then((ix) => hronCandidateLists(ix))
    .then((lists) => {
      S.allTags = lists.tags;
      S.statuses = lists.statuses;
      if (onScreen("listScreen")) fillStatusSelect($("bulkStatus"), $("bulkStatus").value || S.lastStatusId);
      if (S.cur) renderPerson();
    })
    .catch(() => {});

  const run = async (func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))[0].result;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
  let page = await run(() => extractLinkedInList());
  if (page.people.length > 1 && (!page.total || page.total > page.people.length)) {
    // LinkedIn draws people as you scroll: load everyone on this results page (up to 50).
    $("hronInfo").textContent = "Loading everyone on the page…";
    await run((n) => liLoadAll(n), [Math.min(page.total || 50, 50)]);
    page = await run(() => extractLinkedInList());
    $("hronInfo").textContent = hronInfoText;
  }
  // An open profile has extra details: mobile, CV links, public profile link.
  const open = await run(() => extractLinkedInProfile());
  const same = (p, q) => q && ((p.linkedinUrl && p.linkedinUrl === q.linkedinUrl) || sameName(fullName(p), fullName(q)));

  if (page.people.length > 1) {
    S.people = page.people;
    S.total = page.total;
    // Start on the person last clicked on LinkedIn, or whose profile is open.
    const { liLastClicked: last } = await chrome.storage.local.get("liLastClicked");
    const profileId = (tab.url.match(/\/profile\/([^/?#]+)/) || [])[1];
    let i = last && Date.now() - last.at < 30 * 60 * 1000 ? S.people.findIndex((p) => same(p, last.person)) : -1;
    if (i < 0 && profileId) i = S.people.findIndex((p) => p.linkedinUrl.includes(profileId));
    const target = S.people[i];
    if (target && same(target, open)) {
      Object.assign(target, { phone: open.phone || target.phone, cvLinks: open.cvLinks });
      if (/linkedin\.com\/in\//.test(open.linkedinUrl)) target.linkedinUrl = open.linkedinUrl;
    }
    if (i >= 0) openPerson(i);
    else renderList();
  } else {
    S.people = [open];
    openPerson(0);
  }
  markPeople();
}

function wireLinkedInControls() {
  $("back").onclick = () => {
    S.cur = null;
    renderList();
  };
  $("selectNew").onclick = () => {
    S.people.forEach((p, i) => {
      const m = workingCopy(p).matches;
      if (m && !m.length) S.checked.add(i);
    });
    renderList();
  };
  $("bulkJob").onchange = () => {
    rememberJob($("bulkJob").value);
    updateBulkButton();
  };
  $("bulkStatus").onchange = () => rememberStatus($("bulkStatus").value);
  $("addMany").onclick = () => {
    const tags = splitTags($("bulkTags").value);
    const statusId = $("bulkStatus").value;
    startRun([...S.checked].map((i) => ({ ...workingCopy(S.people[i]), jobId: $("bulkJob").value, statusId, tags })));
  };
  for (const f of ["firstName", "lastName", "email", "phone", "headline", "company", "location", "linkedinUrl"]) {
    $(f).oninput = () => {
      S.cur[f] = $(f).value.trim();
      renderPerson();
    };
  }
  $("statusSel").onchange = () => {
    S.cur.statusId = $("statusSel").value;
    rememberStatus(S.cur.statusId);
  };
  $("job").onchange = () => {
    S.cur.jobId = $("job").value;
    rememberJob(S.cur.jobId);
    renderPerson();
  };
  const addTag = () => {
    const t = $("newTag").value.trim();
    if (t && !hasTag(S.cur.tags, t)) S.cur.tags.push(t);
    $("newTag").value = "";
    renderPerson();
  };
  $("addTag").onclick = addTag;
  $("newTag").onkeydown = (e) => e.key === "Enter" && addTag();
  $("editTags").onclick = () => {
    Object.assign(S.cur, { editingTags: true, tagNote: "" });
    renderPerson();
  };
  $("cancelTags").onclick = () => {
    Object.assign(S.cur, { editingTags: false, tags: [...(S.cur.savedTags || [])] });
    renderPerson();
  };
  $("saveTags").onclick = async () => {
    const c = S.cur;
    $("saveTags").disabled = true;
    $("saveTags").textContent = "Saving…";
    try {
      const res = await hronSetTags(c.matches[0].cvid, c.matches[0].appid, c.tags);
      c.savedTags = res.tags;
      c.tags = [...res.tags];
      c.editingTags = false;
      c.tagNote = res.failed.length ? "" : "Saved in HR-ON ✓";
      const parts = [];
      if (res.added.length) parts.push(`Added: ${res.added.join(", ")}.`);
      if (res.removed.length) parts.push(`Removed: ${res.removed.join(", ")}.`);
      if (res.failed.length) parts.push(`HR-ON did not accept: ${res.failed.join(", ")}.`);
      msg(parts.join(" ") || "No changes.");
    } catch (e) {
      msg(`Could not save tags: ${e.message}`);
    }
    renderPerson();
  };
  // CV: click to choose a file, or drop one
  const takeFile = async (file) => {
    if (!file) return;
    try {
      await setCv(S.cur, await fileToCv(file));
    } catch (e) {
      msg(e.message);
    }
  };
  $("drop").onclick = () => $("cvFile").click();
  $("cvFile").onchange = () => takeFile($("cvFile").files[0]);
  $("drop").ondragover = (e) => {
    e.preventDefault();
    $("drop").classList.add("over");
  };
  $("drop").ondragleave = () => $("drop").classList.remove("over");
  $("drop").ondrop = (e) => {
    e.preventDefault();
    $("drop").classList.remove("over");
    takeFile(e.dataTransfer.files[0]);
  };
  $("primary").onclick = () => {
    const c = S.cur;
    if (c.matches && c.matches.length) return openCandidate(c.matches[0]);
    startRun([c]);
  };
}

// Hands the people to the run window, which keeps going when this popup closes.
async function startRun(people) {
  const items = people.map((c) => ({
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email || S.settings.fixedEmail,
    phone: c.phone || "",
    headline: c.headline || "",
    company: c.company || "",
    location: c.location || "",
    linkedinUrl: c.linkedinUrl || "",
    jobId: c.jobId,
    job: (S.jobs.find((j) => j.id === c.jobId) || {}).title || "",
    statusId: c.statusId || "0",
    status: (S.statuses.find((x) => x.id === (c.statusId || "0")) || { text: "Received" }).text,
    tags: c.tags,
    cv: c.cv,
  }));
  await chrome.storage.local.set({ run: { items, windowId: S.tab.windowId, at: Date.now() } });
  await chrome.windows.create({ url: chrome.runtime.getURL("popup.html?view=run"), type: "popup", width: 440, height: 640 });
  window.close();
}

// ---------- run window: add people to HR-ON one by one ----------

const R = { stop: false };

// Fills the Create CV form, which HR-ON may show in a frame: try every frame,
// and if no form is open yet, click "Create CV" and wait for it.
async function fillInHrOn(tabId, c, cv, settings) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["fill.js"] });
  const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => scanHrOnPage() });
  if (c.job && page.currentJob) {
    const a = c.job.toLowerCase();
    const b = page.currentJob.toLowerCase();
    if (!a.includes(b) && !b.includes(a)) return { error: `HR-ON opened "${page.currentJob}" instead of "${c.job}".` };
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
  if (!clicked) return { error: "Couldn't find the 'Create CV' button on the job's applicant list." };
  for (let i = 0; i < 20 && !result; i++) {
    await sleep(400);
    result = await tryFill();
  }
  return result || { error: "Clicked 'Create CV', but the form didn't open." };
}

// True if `func` returns true in any frame of the tab.
async function anyFrame(tabId, func) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", files: ["fill.js"] });
  const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func });
  return res.some((r) => r.result);
}

async function waitForTab(tabId) {
  await sleep(300); // right after a navigation the tab can still report the old page as complete
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") break;
    await sleep(250);
  }
  await sleep(700); // let HR-ON's scripts set up the page
}

// The HR-ON tab to work in: an open one, else a new background tab.
async function hronTab(windowId, url) {
  const [existing] = await chrome.tabs.query({ url: `${HRON}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { url });
    return existing.id;
  }
  const created = await chrome.tabs.create({ url, active: false, ...(windowId ? { windowId } : {}) });
  return created.id;
}

// Adds one person. Calls step(text) as it goes; returns { done, skip, error, warn, match }.
async function addOne(item, windowId, settings, step) {
  const index = await getIndex();
  const known = matchesIn(index, item);
  if (known.length && (await hronVerify(known, item.firstName, item.lastName)).length) return { skip: "Already in HR-ON" };

  step("Opening the job in HR-ON…");
  const tabId = await hronTab(windowId, `${HRON}applications/company/?jobpostid=${item.jobId}`);
  await waitForTab(tabId);

  step("Filling Create CV…");
  const filled = await fillInHrOn(tabId, item, item.cv, settings);
  if (filled.error) return { error: filled.error };
  if (!filled.filled.some((f) => /name/i.test(f)) || !filled.filled.includes("email")) {
    return { error: `Couldn't fill HR-ON's required fields (filled: ${filled.filled.join(", ") || "nothing"}).` };
  }

  step("Saving…");
  await sleep(500);
  const [{ result: clickedTop }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => hronClickSave() });
  if (!clickedTop && !(await anyFrame(tabId, () => hronClickSave()))) {
    return { error: "Couldn't find the Save button. The form is filled in HR-ON — click Save there." };
  }
  let open = true;
  for (let i = 0; i < 30 && open; i++) {
    await sleep(500);
    open = await anyFrame(tabId, () => hronHasCreateCvForm()).catch(() => false);
  }
  if (open) return { error: "HR-ON didn't save. Check the form in HR-ON (a required field?)." };

  step("Adding tags…");
  const term = nameTokens(item.lastName).at(-1) || nameTokens(fullName(item)).at(-1);
  let match = null;
  for (let i = 0; i < 5 && !match; i++) {
    const rows = (await hronApplicants(item.jobId, term)).filter((r) => sameName(r.name, fullName(item)));
    match = rows.sort((a, b) => Number(b.appid) - Number(a.appid))[0] || null;
    if (match) match = { ...match, jobId: item.jobId };
    if (!match) await sleep(1500);
  }
  if (!match) return { done: true, warn: "Saved, but couldn't find them in the job to set the status and tags." };
  if (item.statusId && item.statusId !== "0") {
    step(`Setting status: ${item.status}…`);
    await hronSetStatus(match.appid, item.statusId);
    const now = (await hronApplicants(item.jobId, term)).find((r) => r.appid === match.appid);
    if (!now || now.status.toLowerCase() !== item.status.toLowerCase()) {
      return { done: true, match, warn: `Saved, but HR-ON shows status "${now ? now.status : "?"}" instead of "${item.status}".` };
    }
    step("Adding tags…");
  }
  if (item.tags.length) {
    const res = await hronAddTags(match.cvid, match.appid, item.tags);
    if (res.failed.length) return { done: true, match, warn: `Saved. HR-ON did not accept tags: ${res.failed.join(", ")}` };
  }
  return { done: true, match };
}

async function runMain() {
  document.body.classList.add("window");
  show("runScreen");
  const { run } = await chrome.storage.local.get("run");
  if (!run || !run.items.length) {
    $("runTitle").textContent = "Nothing to add";
    $("runSub").textContent = "";
    $("runButton").textContent = "Close";
    $("runButton").onclick = () => window.close();
    return;
  }
  await chrome.storage.local.remove("run");
  const settings = await getSettings();
  const items = run.items;
  const rows = items.map((it, k) => {
    const dot = el("span", { className: "dot", textContent: String(k + 1) });
    const text = el("span", { className: "text", textContent: "Waiting" });
    const link = el("a", { href: "#", target: "_blank", textContent: "Open CV", className: "hidden" });
    link.style.cssText = "font-size:12px;white-space:nowrap";
    const who = el("span", {}, el("b", { textContent: fullName(it) }), text);
    who.style.cssText = "flex:1;min-width:0";
    $("steps").append(el("div", { className: "step" }, dot, who, link));
    return { dot, text, link };
  });
  $("runButton").onclick = () => {
    R.stop = true;
    $("runButton").disabled = true;
    $("runButton").textContent = "Stopping after this person…";
  };

  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (let k = 0; k < items.length && !R.stop; k++) {
    const r = rows[k];
    r.dot.className = "dot busy";
    r.dot.textContent = "…";
    $("runTitle").textContent = `Adding to HR-ON… ${k + 1} of ${items.length}`;
    let res;
    try {
      res = await addOne(items[k], run.windowId, settings, (t) => (r.text.textContent = t));
    } catch (e) {
      res = { error: e.message };
    }
    if (res.skip) {
      skipped++;
      r.dot.className = "dot skip";
      r.dot.textContent = "–";
      r.text.textContent = `Skipped — ${res.skip[0].toLowerCase()}${res.skip.slice(1)}`;
    } else if (res.error) {
      failed++;
      r.dot.className = "dot fail";
      r.dot.textContent = "!";
      r.text.textContent = res.error;
      r.text.classList.add("fail-text");
    } else {
      added++;
      r.dot.className = "dot done";
      r.dot.textContent = "✓";
      r.text.textContent = res.warn || `Added · ${items[k].status} · tags: ${items[k].tags.join(", ") || "none"}`;
      if (res.match) {
        r.link.onclick = (ev) => {
          ev.preventDefault();
          openCandidate(res.match);
        };
        r.link.classList.remove("hidden");
      }
    }
    $("bar").firstElementChild.style.width = `${Math.round(((k + 1) / items.length) * 100)}%`;
  }
  // The HR-ON check must see the new people next time.
  await chrome.storage.local.remove("hronIndex");
  $("bar").classList.add("done");
  $("runTitle").textContent = items.length > 1 ? `Done: ${added} added to HR-ON` : added ? "Added to HR-ON" : "Not added";
  const notes = [];
  if (skipped) notes.push(`${skipped} skipped (already in HR-ON)`);
  if (failed) notes.push(`${failed} not added — see below`);
  const left = items.length - added - skipped - failed;
  if (left) notes.push(`stopped before ${left} more`);
  $("runSub").textContent = notes.join(" · ") || "Job, status, e-mail, mobile, LinkedIn link, CV and tags are saved.";
  $("runButton").disabled = false;
  $("runButton").textContent = "Close";
  $("runButton").onclick = () => window.close();
}

// ---------- start ----------

(async () => {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  $("openSettings").onclick = () => chrome.runtime.openOptionsPage();
  if (new URLSearchParams(location.search).get("view") === "run") return runMain();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (/^https:\/\/www\.linkedin\.com\/(talent|in)\//.test(tab?.url || "")) {
    wireLinkedInControls();
    try {
      await initLinkedIn(tab);
    } catch (e) {
      show("other");
      $("other").firstElementChild.textContent = `Could not read the LinkedIn page: ${e.message}`;
    }
  } else {
    show("other");
    getIndex();
  }
})();
