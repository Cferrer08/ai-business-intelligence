"""Stand-in for the Pinecone REST API (control plane describe-index + data plane upsert,
query, delete), used only by the end-to-end tests. Cosine similarity, namespaces and the
$eq metadata filter behave like Pinecone's. Run: python fake_pinecone.py 8766"""
import json
import math
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
KEY = "test-pinecone-key"
STORE: dict[str, dict[str, dict]] = {}  # namespace -> id -> {values, metadata}


def cos(a, b):
    num = sum(x * y for x, y in zip(a, b))
    da = math.sqrt(sum(x * x for x in a)) or 1.0
    db = math.sqrt(sum(y * y for y in b)) or 1.0
    return num / (da * db)


def matches(meta, flt):
    for k, cond in (flt or {}).items():
        if isinstance(cond, dict) and "$eq" in cond and meta.get(k) != cond["$eq"]:
            return False
    return True


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        self.wfile.write(data)

    def _auth(self):
        if self.headers.get("Api-Key") != KEY:
            self._send({"error": "unauthorized"}, 401); return False
        return True

    def do_GET(self):
        if self.path.startswith("/__stats"):
            return self._send({ns: len(v) for ns, v in STORE.items()})
        if not self._auth():
            return
        if self.path.startswith("/indexes/"):
            return self._send({"name": self.path.split("/")[-1], "dimension": 1536, "metric": "cosine", "host": f"http://127.0.0.1:{PORT}"})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        if not self._auth():
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        ns = STORE.setdefault(body.get("namespace", ""), {})
        if self.path == "/vectors/upsert":
            for v in body["vectors"]:
                if len(v["values"]) != 1536:
                    return self._send({"error": "dimension mismatch"}, 400)
                ns[v["id"]] = {"values": v["values"], "metadata": v.get("metadata", {})}
            return self._send({"upsertedCount": len(body["vectors"])})
        if self.path == "/query":
            scored = [(cos(body["vector"], r["values"]), i, r) for i, r in ns.items() if matches(r["metadata"], body.get("filter"))]
            scored.sort(key=lambda t: -t[0])
            return self._send({"matches": [{"id": i, "score": s, "metadata": r["metadata"] if body.get("includeMetadata") else None}
                                           for s, i, r in scored[: body.get("topK", 10)]], "namespace": body.get("namespace", "")})
        if self.path == "/vectors/delete":
            for i in body.get("ids", []):
                ns.pop(i, None)
            return self._send({})
        self._send({"error": "not found"}, 404)


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
