#!/usr/bin/env python3
"""Static server for the arcade that refuses to be cached.

    python3 arcade/serve.py ~/Documents/claude 8777

`python3 -m http.server` is fine for looking at the room and a trap for tuning
a machine. It sends no Cache-Control, so the browser applies heuristic freshness
and serves `src/machines/*.js` from cache — and cache-busting the HTML does not
help, because the modules it imports are the same URLs either way. The failure
mode is the worst kind: the page runs the previous build and every number you
take off it looks plausible.

no-store removes the class, but only if it is set BEFORE the first fetch. If a
module is already cached from an earlier server, change the PORT — a different
origin is a different cache key, and it is the only lever that cannot fail.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8777
    print(f"serving {root} on http://127.0.0.1:{port}/  (no-store)")
    ThreadingHTTPServer(("127.0.0.1", port),
                        partial(NoStore, directory=root)).serve_forever()
