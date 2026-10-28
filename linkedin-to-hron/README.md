# LinkedIn Recruiter → HR-ON

Browser extension for **Microsoft Edge** and **Google Chrome** that adds people from LinkedIn
Recruiter to HR-ON Recruit (`https://recruit.hr-on.com`): name, LinkedIn link, location, e-mail,
mobile, CV, job posting and tags. It also shows whether someone is already in HR-ON.
It runs in your own browser with your own logins, so no API keys or passwords are needed.

## Installation
**Edge**
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (bottom left).
3. Click **Load unpacked** and choose the `linkedin-to-hron` folder.
4. Click the puzzle icon in the toolbar and pin "LinkedIn Recruiter → HR-ON".

**Chrome**: the same steps, starting at `chrome://extensions`.

After updating the files, click **Reload** on the extension's card (or remove it and load it again),
then reload the LinkedIn tab. The version is shown in the popup's title.

## Usage
Log in to HR-ON in a tab and keep it open.

**One person**
1. In LinkedIn Recruiter, click the person (in a list, or open their profile), then click the extension.
2. The popup shows the person and whether they are in HR-ON:
   - **New**: choose the **job posting**, pick **tags** (HR-ON's own tags, or type a new one), drop or
     choose a **CV** (or click **Fetch CV** when the profile links one). The mobile number is read from
     the CV. Name, e-mail (`xyz@f5.dk` unless you type another), mobile, title, location and LinkedIn
     link are under **Details**.
   - **Already in HR-ON**: their applications with an **Open CV** link each. Their HR-ON tags are
     marked ✓; change them and click **Save tag changes to HR-ON**.
3. Click **Add to HR-ON**. A small window opens and shows the progress: it opens the job's applicant
   list in your HR-ON tab, clicks **Create CV**, fills the form, clicks **Save**, then adds the tags.
   You can keep working on LinkedIn while it runs; keep the small window open.

**Many people**
On a list page (pipeline, project, search results) the popup lists everyone on the page (it scrolls
the page itself to load up to 50), each marked **New** or **In HR-ON**. Tick people (or **Select all
new**), choose the job posting and tags at the bottom, and click **Add N to HR-ON**. People already in
HR-ON are skipped. For the next page of results, go to it in LinkedIn and open the extension again.

## What goes where in HR-ON

| HR-ON field (Create CV) | Value |
|---|---|
| Name | First and last name |
| Address | LinkedIn profile link |
| City / Country | From the LinkedIn location |
| E-mail | `xyz@f5.dk` (Settings), unless you typed another address |
| Mobile | From the CV, or LinkedIn contact info |
| Attach CV | The CV file |
| Tags (after saving) | The chosen tags |

Picture, Language, Postal code, Phone and Attach application are left empty.

## How the HR-ON check works
The extension uses the same requests as HR-ON's own pages, with your login. It reads the applicant
list of every job posting once and keeps it for 30 minutes (**Check again** reloads it). People match
when first and last name match. Tags are read from and saved with the same requests as the Tags field
on a candidate in HR-ON.

## If a field isn't filled
Fields are found by their labels in English and Danish. If one isn't found, open **Settings** (the
gear icon) and give a CSS selector for it (right-click the field in HR-ON → Inspect), e.g.
`{ "mobile": "input[name='mobile']", "cv": "input[name='cv']" }`.

## Limitations
- The HR-ON check covers active and draft job postings, not archived ones, and matches by name only.
- People added from a list page get their Recruiter profile link (only colleagues with Recruiter
  access can open it), no mobile and no CV. Open the person's profile first to get those.
- LinkedIn changes its HTML often. If names or titles are missing, the selectors in `extract.js`
  need updating.
- It only reads pages you have open, on purpose. Bulk scraping LinkedIn breaks LinkedIn's terms of use.
- pdf.js (Apache-2.0) is bundled in `lib/pdfjs` to read phone numbers from PDF CVs.
