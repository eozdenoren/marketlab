# Class record endpoint (Google Apps Script)

The class page saves every pin, note and answer by POSTing to a Google Apps
Script web app attached to the class Google Sheet. Groups register their own
PIN the first time a group number is used in a class (tab `groups`); the
instructor page signs in with the instructor password (or the admin token) to
read every record, list and reset groups and create classes. Five minutes to
set up, once; after a code change: Deploy > Manage deployments > edit > New
version.

1. Open the Google Sheet that holds the `findings` tab (create a new sheet if
   there is none yet).
2. Extensions > Apps Script. Delete the sample code, paste `Code.local.gs`
   (the private copy with the real tokens, not in git) rather than `Code.gs`;
   or set `TOKEN` and `ADMIN_TOKEN` yourself and put the same values in
   `config.json` and `app/.streamlit/secrets.toml`.
3. **The instructor password** is not in the code: in the Apps Script editor
   open Project settings (the gear), scroll to Script properties, add the
   property `INSTRUCTOR_PASSWORD` with the password as its value, save. Change
   it there whenever you like; no redeployment needed. Without the property
   only the admin token signs in. Ten wrong passwords within fifteen minutes
   lock the password out for fifteen minutes (`LOCK_AFTER`, `LOCK_MINUTES`);
   the admin token is never locked.
4. Deploy > New deployment > type "Web app". Execute as: **Me**. Who has access:
   **Anyone**. Deploy, authorise when asked, and copy the web app URL
   (it ends in `/exec`).
5. Put the URL, the page token and the students' address in `config.json`
   next to `build.py` (the admin token may sit there too; it is never built in):

       {"endpoint": "https://script.google.com/macros/s/.../exec", "token": "...",
        "admin_token": "...", "app_url": "https://eozdenoren.github.io/marketlab"}

   then `python3 build.py --config config.json` and publish `docs/`.

Without a config the build is the offline edition: nothing is sent anywhere.

To test the endpoint from a terminal:

    curl -s -X POST -H 'Content-Type: text/plain' --data '{"token":"...","records":[{"ts":1,"group":"Group 0","question":"test","finding":"hello","state":{"class":"TEST"}}]}' 'https://script.google.com/macros/s/.../exec'
    curl -s 'https://script.google.com/macros/s/.../exec?token=...&class=TEST&group=Group%200'
    curl -s 'https://script.google.com/macros/s/.../exec?token=<instructor password>&action=groups&class=TEST'

Changing the code later: Deploy > Manage deployments > edit > new version.
The URL stays the same.

## The Pricing Laboratory's script (`Pricing.gs`)

The Pricing Laboratory (`docs/pricing.html`) has a script and a Google Sheet
of its own, so that the Marketplace record above is never redeployed while an
assignment runs on it. Groups sign in with the number and PIN they registered
in the Marketplace Laboratory: the pricing script reads the `groups` tab of
that sheet. Set-up, once:

1. Create a new Google Sheet (say "Pricing Laboratory"). Extensions > Apps
   Script, delete the sample code, paste `Pricing.local.gs` (the private copy
   with the real tokens, not in git; `Pricing.gs` is the template).
2. Project settings > Script properties, two properties:
   `INSTRUCTOR_PASSWORD` (the password the pricing instructor page signs in
   with; it can be the same as the Marketplace one) and `MARKETLAB_SHEET`
   (the URL, or the ID, of the Marketplace Laboratory's Google Sheet, the one
   with the `findings` and `groups` tabs).
3. Deploy > New deployment > Web app, Execute as **Me**, Who has access
   **Anyone**; authorise (the script asks for access to your spreadsheets:
   it reads the Marketplace sheet's `groups` tab); copy the URL ending in
   `/exec`.
4. Put the URL under `pricing` in `config.json` (the tokens are already there,
   the same values as in `Pricing.local.gs`):

       "pricing": {"endpoint": "https://script.google.com/macros/s/.../exec", "token": "...", "admin_token": "..."}

   then `python3 build.py --config config.json` and publish `docs/`.

Tabs the script creates in its sheet: `records` (lab-book records; unused
since the pricing pages lost their lab book on 14 November 2026), `groups`
(groups registered on the pricing page, when a number is not in the
Marketplace sheet), `challenge` (one row per class: phase and settings),
`flights` (each team's flights: the seats it chose to sell, the fare they
sold at, the profit). The instructor page sets the challenge up and moves it
through its phases; the student pages poll `?action=challenge` every few
seconds while the Challenge tab is open.

To test:

    node tests/check_pricing_backend.js      # the script in a node vm against fake sheets
    python3 tests/browser_pricing.py         # the pages in a browser against the script served by node
