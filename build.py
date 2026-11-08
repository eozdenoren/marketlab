"""Build the single-file pages: python3 build.py [--config config.json] [--out docs/index.html]
    docs/index.html       the class page (students)
    docs/instructor.html  the instructor page, next to it
    docs/calculator.html  the exam calculator: the class page in calculator mode (no record, nothing stored)
The config is inlined as window.MARKETLAB_CONFIG, but only the keys each page needs: the class page gets the endpoint
and the page token, the instructor page the endpoint and the students' address (app_url). The admin token in
config.json is never inlined (everyone who opens a page can read it). With no config the pages run offline (the exam
edition of the class page; the instructor page then only says it needs an endpoint). --out names the class page; the
instructor page goes into the same folder."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
PAGES = {   # output name: (shell, extra style sheets, scripts in order, config keys that may go in)
    "index.html": ("index.html", [], ("engine.js", "chart.js", "book.js", "questions.js", "app.js"), ("endpoint", "token")),
    "instructor.html": ("instructor.html", ["instructor.css"], ("engine.js", "book.js", "questions.js", "qr.js", "instructor.js"), ("endpoint", "app_url")),
    # the exam calculator: the class page's code in calculator mode; no endpoint, no token, nothing stored
    "calculator.html": ("calculator.html", [], ("engine.js", "chart.js", "book.js", "questions.js", "app.js"), ()),
}
FIXED = {"calculator.html": {"calculator": True}}


def build(shell, styles, scripts, cfg):
    html = open(os.path.join(SRC, shell), encoding="utf-8").read()
    css = "".join(open(os.path.join(SRC, s), encoding="utf-8").read() + "\n" for s in ["style.css"] + styles)
    js = "".join("<script>\n%s\n</script>\n" % open(os.path.join(SRC, s), encoding="utf-8").read() for s in scripts)
    config = "<script>window.MARKETLAB_CONFIG = %s;</script>" % json.dumps(cfg)
    return html.replace("<!--STYLE-->", "<style>\n" + css + "</style>").replace("<!--CONFIG-->", config).replace("<!--SCRIPTS-->", js)


def main():
    cfg_path = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else None
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(HERE, "docs", "index.html")
    cfg_all = json.load(open(cfg_path)) if cfg_path else {}
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    for name, (shell, styles, scripts, keys) in PAGES.items():
        cfg = {k: cfg_all[k] for k in keys if k in cfg_all}
        cfg.update(FIXED.get(name, {}))
        html = build(shell, styles, scripts, cfg)
        admin = cfg_all.get("admin_token")
        assert not admin or admin not in html, "the admin token must never be in a page"
        out = out_path if name == "index.html" else os.path.join(out_dir, name)
        open(out, "w", encoding="utf-8").write(html)
        print("wrote %s (%.0f KB, endpoint %s)" % (out, len(html) / 1024, "set" if cfg.get("endpoint") else "none: offline edition"))


if __name__ == "__main__":
    main()
