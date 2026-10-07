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
1. Open a candidate profile in LinkedIn Recruiter. Open the contact info if you want the phone number included.
2. Click the extension. The fields are filled from the profile; correct them if needed.
   At the top it shows whether the person is **already in HR-ON**: on which job postings, with what
   status and date, and with which tags. (You need to be logged in to HR-ON.)
3. **Job**: type or pick the HR-ON job posting. Job titles are learned when you open the extension on
   HR-ON's *Job posting overview* or on a job's applicant list.
4. **Tags**: comma-separated. Defaults come from Settings (`Linkedin`).
5. **CV**: click **Fetch: …** to download a CV linked on the profile, or choose a file (PDF or Word).
   If the CV has a phone number and Mobile is empty, it is filled in from the CV.
6. Click **Add and open HR-ON**, or **Add to queue** to collect several candidates.
7. In HR-ON, open the job's applicant list (Job posting overview → click the number under
   *Active applications* / *Total applications*). Once you've done this for a job, the extension
   opens that job's applicant list directly next time.
8. Click the extension and click **Fill form** next to the candidate. It clicks **Create CV** and fills:

   | HR-ON field | Value |
   |---|---|
   | Name | First and last name |
   | Address | LinkedIn profile URL |
   | City / Country | From the LinkedIn location |
   | E-mail | The fixed e-mail from Settings (default `xyz@f5.dk`) |
   | Mobile | From LinkedIn contact info, or from the CV |
   | Attach CV | The CV file |

   Filled fields are outlined in green. Picture, Language, Postal code and Attach application are left as they are.
9. Check the data and click **Save** in HR-ON.
10. Click the extension and click **Add tags**. It finds the saved candidate by name in the job posting
    and adds the tags they don't have yet (the same as typing them in the candidate's Tags field and
    clicking **Add**). Reopen the candidate in HR-ON to see them.
11. Click **Remove** to take the candidate out of the queue.

The extension never saves in HR-ON itself, and it stops if the applicant list is for a different
job than the candidate's.

If the CV isn't attached, use **Download CV** in the queue and upload it under **Attach CV** yourself. If the file picker closes the popup, use **Open queue in a tab**.

## If a field isn't filled
Fields are found by their labels in English and Danish. If one isn't found, open **Settings** and give
a CSS selector for it (right-click the field → Inspect):

```json
{ "mobile": "input[name='mobile']", "tags": "input[name='tags']", "cv": "input[name='cv']" }
```

## How the HR-ON check works
The extension uses the same requests as HR-ON's own pages, with your login: it reads the list of job
postings, searches each one for the person's last name, keeps people whose first and last name match,
and reads their tags. Each search is cleared afterwards so your HR-ON lists aren't left filtered.

## Limitations
- The HR-ON check searches active and draft job postings, not archived ones. It matches by name only,
  so people with the same name show up as matches, and a changed name won't be found.
- LinkedIn changes its HTML often. If name or title are missing, update the selectors in `extract.js`.
- It only reads the profile you have open, on purpose. Bulk scraping LinkedIn breaks LinkedIn's terms of use.
- A CV can only be fetched when the profile links to a file (e.g. one the candidate sent or applied with).
  Otherwise download it and choose the file.
- pdf.js (Apache-2.0) is bundled in `lib/pdfjs` to read phone numbers from PDF CVs.
