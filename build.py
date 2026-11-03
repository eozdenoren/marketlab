"""Build the single-file page: python3 build.py [--config config.json] -> docs/index.html (served by GitHub Pages)
The config (endpoint, token, app name) is inlined as window.MARKETLAB_CONFIG; with no
config the page runs offline (the exam edition)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
cfg_path = None
if "--config" in sys.argv:
    cfg_path = sys.argv[sys.argv.index("--config") + 1]
out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
cfg = json.load(open(cfg_path)) if cfg_path else {}
html = open(os.path.join(SRC, "index.html")).read()
style = "<style>\n" + open(os.path.join(SRC, "style.css")).read() + "\n</style>"
scripts = ""
for name in ("engine.js", "chart.js", "app.js"):
    scripts += "<script>\n" + open(os.path.join(SRC, name)).read() + "\n</script>\n"
config = "<script>window.MARKETLAB_CONFIG = %s;</script>" % json.dumps(cfg)
html = html.replace("<!--STYLE-->", style).replace("<!--CONFIG-->", config).replace("<!--SCRIPTS-->", scripts)
out = out_path or os.path.join(HERE, "docs", "index.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w").write(html)
print("wrote %s (%.0f KB, endpoint %s)" % (out, len(html) / 1024, "set" if cfg.get("endpoint") else "none: offline edition"))
