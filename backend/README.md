# Class record endpoint (Google Apps Script)

The page saves every pin, note and answer by POSTing to a Google Apps Script
web app attached to the class Google Sheet. Groups register their own PIN the
first time a group number is used in a class (tab `groups`); the instructor view
uses the admin token to list groups, reset one, and read every record. Five
minutes to set up, once; after a code change: Deploy > Manage deployments >
edit > New version.

1. Open the Google Sheet that holds the `findings` tab (the same sheet the
   Streamlit instructor view reads; create a new sheet if there is none yet).
2. Extensions > Apps Script. Delete the sample code, paste `Code.gs`.
3. Paste `Code.local.gs` (the private copy with the real tokens) rather than
   `Code.gs`; or set `TOKEN` and `ADMIN_TOKEN` yourself and put the same values
   in `config.json` and `app/.streamlit/secrets.toml`.
4. Deploy > New deployment > type "Web app". Execute as: **Me**. Who has access:
   **Anyone**. Deploy, authorise when asked, and copy the web app URL
   (it ends in `/exec`).
5. Put the URL and the token in `config.json` next to `build.py`:

       {"endpoint": "https://script.google.com/macros/s/.../exec", "token": "..."}

   then `python3 build.py --config config.json` and publish `docs/index.html`.

Without a config the build is the offline edition: nothing is sent anywhere.

To test the endpoint from a terminal:

    curl -s -X POST -H 'Content-Type: text/plain' --data '{"token":"...","records":[{"ts":1,"group":"Group 0","question":"test","finding":"hello","state":{"class":"TEST"}}]}' 'https://script.google.com/macros/s/.../exec'
    curl -s 'https://script.google.com/macros/s/.../exec?token=...&class=TEST&group=Group%200'

Changing the code later: Deploy > Manage deployments > edit > new version.
The URL stays the same.
