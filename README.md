# Marketplace Laboratory (single-file edition)

The class and exam version of the Marketplace Laboratory: two HTML files, no
server, no installation. Students open the class link (GitHub Pages) or the
downloaded file; the instructor opens `instructor.html` next to it; everything
is computed in the browser and the only moving part is the Apps Script attached
to the class Google Sheet (`backend/`).

* `src/engine.js` — the market engine, a line-by-line port of the Python
  engine in `../app` (`tests/gen_cases.py` + `tests/check_engine.js` compare the
  two on hundreds of random cases; run both after any engine change).
* `src/questions.js` — the lab-book sections (the twelve questions and "Your
  own experiments"), shared by both pages; must match `ASSIGNMENT` in
  `../app/scenarios.py` (`../app/tests/test_questions.py` checks it).
* `src/book.js` — the lab-book table (pinned columns beside their baselines,
  with each value's change), shared by both pages.
* `src/chart.js` — SVG charts; `src/app.js` — the class page (group panel,
  Laboratory, Externalities and Lab book tabs, local storage, save queue;
  `?projector=1` is projector mode: no group, pins allowed, nothing sent;
  `calculator: true` in the config is the exam calculator: Laboratory and
  Externalities only, nothing stored, with `src/calculator.html` as the shell
  and its own text on how exam notation becomes rows); `src/style.css`,
  `src/index.html`.
* `src/qr.js` — QR codes for the class link (`tests/check_qr.py` compares the
  modules with segno's); `src/instructor.js`, `src/instructor.html`,
  `src/instructor.css` — the instructor page: sign in with the instructor
  password (or the admin token), then Overview, By experiment and One group
  over the class record, the set-up panel (class link and QR, new classes,
  registered groups and reset) and the projector button.
* `build.py [--config config.json] [--out path]` — inlines everything into
  `docs/index.html` and `docs/instructor.html`. Each page gets only the config
  keys it needs (the class page: endpoint and page token; the instructor page:
  endpoint and `app_url`); the admin token is never inlined. Without a config
  the class page is the offline edition and the instructor page says it needs
  an endpoint.
* `tests/browser_page.py` — Playwright check of the class page over `file://`
  and `http://`; `tests/browser_instructor.py` — the instructor page and
  projector mode against an in-memory copy of the script's rules.

Links: `?class=<code>` stamps the class; `#state=<base64url JSON>` loads a
recorded experiment; `&projector=1` is projector mode (the instructor page's
links carry both).

    python3 tests/gen_cases.py && node tests/check_engine.js
    python3 tests/check_qr.py
    python3 build.py --config config.json
    python3 tests/browser_page.py /tmp/shots
    python3 tests/browser_instructor.py /tmp/shots_instructor
