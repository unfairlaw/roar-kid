"""Test collector server: serves the repo root and accepts the harness's
results POST, so the DSP tests can run headlessly.

    python3 tests/serve.py [port]          # from the repo root
    google-chrome --headless=new --no-sandbox \
        --autoplay-policy=no-user-gesture-required \
        http://127.0.0.1:8471/tests/test.html
    # results land in tests/results.json when the page finishes

--autoplay-policy is required by T7 (real A/V sync), which plays an
unmuted <video> element with no user gesture; harmless for the other tests.

Plain `python3 -m http.server` works too for interactive runs — the POST
then 501s harmlessly and results stay on the page.
"""

import http.server
import json
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8471
OUT = Path(__file__).parent / "results.json"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/__results":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        OUT.write_bytes(body)
        results = json.loads(body)
        passed = sum(1 for r in results if r["ok"])
        print(f"results: {passed}/{len(results)} passed -> {OUT}", flush=True)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
