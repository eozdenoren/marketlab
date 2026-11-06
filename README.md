# Marketplace Laboratory (single-file edition)

The class and exam version of the Marketplace Laboratory: one HTML file, no
server, no installation. Students open the class link (GitHub Pages) or the
downloaded file; everything is computed in the browser.

* `src/engine.js` — the market engine, a line-by-line port of the Python
  engine in `../app` (`tests/gen_cases.py` + `tests/check_engine.js` compare the
  two on hundreds of random cases; run both after any engine change).
* `src/chart.js` — SVG charts; `src/app.js` — the page (group panel, Laboratory,
  Externalities and Lab book tabs, one lab book section per question with its
  answer box, a remove button per pinned column and a button that sets up the
  market the question starts from; local storage, save queue). The questions
  are `QUESTIONS` at the top of the file and must match `ASSIGNMENT` in
  `../app/scenarios.py` (`../app/tests/test_questions.py` checks it);
  `src/style.css`, `src/index.html`.
* `build.py [--config config.json]` — inlines everything into `docs/index.html`.
  With a config (endpoint + token) pins, notes and answers are sent to the
  class sheet through the Apps Script in `backend/`; without one the page is
  the offline edition.
* `tests/browser_page.py` — Playwright check over `file://` and `http://`.

Links: `?class=<code>` stamps the class; `#state=<base64url JSON>` loads a
recorded experiment (the instructor view's "open on the projector" links).

    python3 tests/gen_cases.py && node tests/check_engine.js
    python3 build.py --config config.json
    python3 tests/browser_page.py /tmp/shots
