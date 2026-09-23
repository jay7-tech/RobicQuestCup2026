#!/usr/bin/env python3
"""
Rebuilds the merged, publishable HTML page (dist/final_app.html) from the
source template (app.html), the JS logic (app.js), and the three data
files under data/.

Usage:
    python3 build.py

This never modifies roster_all.json / data_notes.json / team_logos.json —
it only reads them and substitutes them into the HTML template.
"""
import json, pathlib

ROOT = pathlib.Path(__file__).parent

html = (ROOT / "app.html").read_text(encoding="utf-8")
js = (ROOT / "app.js").read_text(encoding="utf-8")
roster_json = (ROOT / "data" / "roster_all.json").read_text(encoding="utf-8")
notes_json = (ROOT / "data" / "data_notes.json").read_text(encoding="utf-8")
logos_json = (ROOT / "data" / "team_logos.json").read_text(encoding="utf-8")

# sanity check the data files are valid JSON before baking them in
json.loads(roster_json)
json.loads(notes_json)
json.loads(logos_json)

out = (
    html.replace("__ROSTER_JSON__", roster_json)
        .replace("__NOTES_JSON__", notes_json)
        .replace("__LOGOS_JSON__", logos_json)
)
out = out.replace(
    "<script>\nwindow.__APP_JS_PLACEHOLDER__ = true;\n</script>",
    "<script>\n" + js + "\n</script>",
)

dist = ROOT / "dist"
dist.mkdir(exist_ok=True)
(dist / "final_app.html").write_text(out, encoding="utf-8")
print(f"Wrote {dist / 'final_app.html'} ({len(out):,} bytes)")
