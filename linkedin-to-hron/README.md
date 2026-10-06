# LinkedIn Recruiter → HR-ON

Browser extension for **Microsoft Edge** and **Google Chrome** that creates candidates from
LinkedIn Recruiter in HR-ON Recruit (`https://recruit.hr-on.com`): contact details, job, tags and CV.
It runs in your own browser with your own logins, so no API keys or passwords are needed.

## Installation
**Edge**
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (bottom left).
3. Click **Load unpacked** and choose the `linkedin-to-hron` folder.
4. Click the puzzle icon in the toolbar and pin "LinkedIn → HR-ON".

**Chrome**: the same steps, starting at `chrome://extensions`.

After updating the files, click **Reload** on the extension's card.

## Usage
1. Open a candidate profile in LinkedIn Recruiter. Open the contact info if you want email and phone included.
2. Click the extension. The fields are filled from the profile; correct them if needed.
3. **Job**: type or pick the HR-ON job. The list is learned automatically the first time you open
   the extension on an HR-ON page that has a job dropdown.
4. **Tags**: comma-separated. Defaults come from Settings.
5. **CV**: click **Fetch: …** to download a CV/attachment linked on the profile, or choose a file
   (e.g. a CV the candidate sent you, or LinkedIn's "More → Save to PDF").
6. Click **Add and open HR-ON**, or **Add to queue** to collect several candidates.
7. Log in to HR-ON and open the page for creating a candidate.
8. Click the extension and click **Fill form** next to the candidate. Filled fields are outlined in green.
9. Check the data, click **Save** in HR-ON, then **Remove** the candidate from the queue.

The extension never saves in HR-ON itself; you always approve each candidate.

If the file picker closes the popup, use **Open queue in a tab** and attach the CV there.

## If a field isn't filled
Fields are found by their labels in Danish and English (e.g. "Fornavn"/"First name", "Stilling"/"Job",
"Tags", "CV"). If one isn't found, open **Settings** and give a CSS selector for it:

```json
{ "firstName": "input[name='firstname']", "job": "select[name='job_id']", "cv": "input[name='cv']" }
```

## Limitations
- LinkedIn changes its HTML often. If name or title are missing, update the selectors in `extract.js`.
- It only reads the profile you have open, on purpose. Bulk scraping LinkedIn breaks LinkedIn's terms of use.
- A CV can only be fetched when the profile links to a file (e.g. one the candidate sent or applied with).
  Otherwise download it and choose the file.
- If HR-ON creates the candidate first and adds job/tags/CV on a later page, run **Fill form** again on that page.
