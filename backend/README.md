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
