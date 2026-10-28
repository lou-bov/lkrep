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
   On a **list page** (pipeline, project, search results) the extension lists everyone on the page,
   and starts on the person you last clicked on the LinkedIn page (or whose profile is open).
   each marked **New** or **In HR-ON: <job>**. Click a name to load that person into the form, or tick
   several (or click **Select all new**) and click **Add selected to queue** to add them all with the
   job and tags in the form. The extension scrolls through the page itself to load everyone on it
   (LinkedIn shows up to 50 per page); for the next page of results, go to it and open the extension again.
   At the top it shows whether the person is **already in HR-ON**: on which job postings, with what
   status and date, and with which tags, with an **Open CV** link for each. (You need to be logged in
   to HR-ON.) If they are already there, the main button becomes **Open CV in HR-ON** and opens their
   newest application instead of adding them again; **Add to queue** still adds them for another job.
3. **Job**: type or pick the HR-ON job posting. Job titles are learned when you open the extension on
   HR-ON's *Job posting overview* or on a job's applicant list.
4. **Tags**: click HR-ON's existing tags under the field to add or remove them, or type new ones
   (comma-separated). New people start with the defaults from Settings (`Linkedin`). For someone
   already in HR-ON, the field shows their current HR-ON tags (marked ✓); change them and click
   **Save tags to HR-ON** to add and remove tags there.
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
   | E-mail | `xyz@f5.dk` (Settings), unless you typed another address for this candidate |
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
The extension uses the same requests as HR-ON's own pages, with your login. It reads the applicant
list of every job posting once and keeps it for 30 minutes (click **Check again** to reload it), so a
whole page of people can be checked at once. People match when first and last name match; their tags
are read from the candidate page. Adding tags uses the same request as HR-ON's own **Add** button.

## Limitations
- People added from a list page get their Recruiter profile link (only people with Recruiter access
  can open it), no e-mail, mobile or CV. Open the person's profile and add them from there to get those.
- The HR-ON check searches active and draft job postings, not archived ones. It matches by name only,
  so people with the same name show up as matches, and a changed name won't be found.
- LinkedIn changes its HTML often. If name or title are missing, update the selectors in `extract.js`.
- It only reads the profile you have open, on purpose. Bulk scraping LinkedIn breaks LinkedIn's terms of use.
- A CV can only be fetched when the profile links to a file (e.g. one the candidate sent or applied with).
  Otherwise download it and choose the file.
- pdf.js (Apache-2.0) is bundled in `lib/pdfjs` to read phone numbers from PDF CVs.
