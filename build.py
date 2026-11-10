"""Build the single-file pages: python3 build.py [--config config.json] [--out docs/index.html]
    docs/index.html               the class page (students)
    docs/instructor.html          the instructor page, next to it
    docs/calculator.html          the exam calculator: the class page in calculator mode (no record, nothing stored)
    docs/pricing.html             the Pricing Laboratory (students), on its own script ("pricing" in the config)
    docs/pricing_instructor.html  its instructor page
The config is inlined as window.MARKETLAB_CONFIG (window.PRICINGLAB_CONFIG for the pricing pages), but only the keys
each page needs: a class page gets its endpoint, its page token and the class list; an instructor page its endpoint
and the students' address (app_url). The pricing pages read their endpoint and tokens from the "pricing" object of
the config. No admin token is ever inlined (everyone who opens a page can read it). With no config the pages run
offline (the exam edition of the class page; an instructor page then only says it needs an endpoint). --out names the
class page; the other pages go into the same folder."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
PAGES = {   # output name: (shell, extra style sheets, scripts in order, config keys that may go in, config section, global)
    # "classes": this term's class codes; a class page signs groups in only under one of them (none listed: any code)
    "index.html": ("index.html", [], ("engine.js", "chart.js", "book.js", "questions.js", "app.js"), ("endpoint", "token", "classes"), "", "MARKETLAB_CONFIG"),
    "instructor.html": ("instructor.html", ["instructor.css"], ("engine.js", "book.js", "questions.js", "qr.js", "instructor.js"), ("endpoint", "app_url"), "", "MARKETLAB_CONFIG"),
    # the exam calculator: the class page's code in calculator mode; no endpoint, no token, nothing stored
    "calculator.html": ("calculator.html", [], ("engine.js", "chart.js", "book.js", "questions.js", "app.js"), (), "", "MARKETLAB_CONFIG"),
    "pricing.html": ("pricing.html", ["pricing.css"], ("pricing_core.js", "pricing_questions.js", "mocha_data.js", "pricing.js"), ("endpoint", "token", "classes"), "pricing", "PRICINGLAB_CONFIG"),
    "pricing_instructor.html": ("pricing_instructor.html", ["instructor.css", "pricing.css"], ("pricing_core.js", "pricing_questions.js", "qr.js", "pricing_instructor.js"), ("endpoint", "app_url", "classes"), "pricing", "PRICINGLAB_CONFIG"),
}
FIXED = {"calculator.html": {"calculator": True}}
SHARED = ("classes", "app_url")   # top-level keys that every section's pages may use


def build(shell, styles, scripts, cfg, global_name):
    html = open(os.path.join(SRC, shell), encoding="utf-8").read()
    css = "".join(open(os.path.join(SRC, s), encoding="utf-8").read() + "\n" for s in ["style.css"] + styles)
    js = "".join("<script>\n%s\n</script>\n" % open(os.path.join(SRC, s), encoding="utf-8").read() for s in scripts)
    config = "<script>window.%s = %s;</script>" % (global_name, json.dumps(cfg))
    return html.replace("<!--STYLE-->", "<style>\n" + css + "</style>").replace("<!--CONFIG-->", config).replace("<!--SCRIPTS-->", js)


def main():
    cfg_path = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else None
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(HERE, "docs", "index.html")
    cfg_all = json.load(open(cfg_path)) if cfg_path else {}
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    secrets = [v for v in (cfg_all.get("admin_token"), (cfg_all.get("pricing") or {}).get("admin_token")) if v]
    for name, (shell, styles, scripts, keys, section, global_name) in PAGES.items():
        source = (cfg_all.get(section) or {}) if section else cfg_all
        cfg = {k: source[k] for k in keys if k in source}
        for k in keys:
            if k in SHARED and k not in cfg and k in cfg_all:
                cfg[k] = cfg_all[k]
        cfg.update(FIXED.get(name, {}))
        html = build(shell, styles, scripts, cfg, global_name)
        for s in secrets:
            assert s not in html, "an admin token must never be in a page (%s)" % name
        out = out_path if name == "index.html" else os.path.join(out_dir, name)
        open(out, "w", encoding="utf-8").write(html)
        print("wrote %s (%.0f KB, endpoint %s)" % (out, len(html) / 1024, "set" if cfg.get("endpoint") else "none: offline edition"))


if __name__ == "__main__":
    main()
