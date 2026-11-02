# Assignment Reminders

Turns the Hourglass midweek meeting PDF into one prefilled text message per assigned person
(chairman, prayers, and every part including helpers). Messages are in Spanish and editable.

Everything runs in your browser: the PDF and contacts are never uploaded anywhere, and the page
blocks all network requests (CSP `connect-src 'none'`). pdf.js 3.11.174 is vendored in `vendor/`.

## Setup (once per device)
1. Open the page on the phone you text from (or on a Mac with Messages).
   On iPhone, use Share → **Add to Home Screen** so Safari doesn't clear saved data.
2. Export your contact list from Hourglass as CSV and tap **Import contacts CSV**.
   Only name, display name, sex and cell phone are kept.

## Weekly
1. Export the midweek schedule PDF from Hourglass.
2. Open the page and choose the PDF.
3. Tap **Send** on each row → Messages opens with the text filled in → send.
   Or tap **WhatsApp** to open the same text in a WhatsApp chat with that person.
   After sending, the row shows ✓ Sent with the time; tick **Confirmed** when they reply. Marks are
   kept only for the weeks in the loaded PDF. If you don't see Confirmed, you're on a cached copy:
   reload, or remove and re-add the Home Screen icon (the footer should say v4).
   Red rows have no phone in Hourglass; fix them there and re-import.

## Optional (Mac)
- `./trim-contacts.py <contactlist.numbers|.csv>` writes a trimmed `contacts.csv` (mode 600,
  git-ignored) next to the script.
- Launcher app that opens a local copy in Safari:
  ```sh
  osacompile -o ~/Applications/"Assignment Reminders.app" \
    -e 'do shell script "open -a Safari " & quoted form of "'"$PWD"'/index.html"'
  ```

Never commit contact lists or schedules; `.gitignore` blocks `*.csv`, `*.pdf` and `*.numbers`.
