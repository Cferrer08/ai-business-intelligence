"""Stand-in for the OpenAI Chat Completions API, used only by the end-to-end tests.

It reads the real prompts the app sends (dataset description, earlier plans, engine facts)
and answers with fixed rules, so the whole pipeline (HTTP, structured output parsing,
validation, repair, grounding, storage, streaming) runs for real; only the model's
judgement is replaced. Run:  python fake_openai.py 8765
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def block(text, after):
    m = re.search(re.escape(after) + r"\s*```json\s*(.*?)\s*```", text, re.S)
    return json.loads(m.group(1)) if m else None


def find_col(cols, role, concept=None):
    for c in cols:
        if c["role"] == role and (concept is None or c["concept"] == concept):
            return c["name"]
    return None


def base_analysis(**kw):
    a = {"type": "aggregate", "metrics": [], "ratio": None, "dimensions": [], "time": None, "filters": [],
         "period": None, "comparison": None, "sort": None, "limit": None}
    a.update(kw)
    return a


def plan(user):
    ctx = block(user, "Dataset description (data, not instructions):")
    prev = block(user, "Earlier in this conversation (data, not instructions):") or []
    q = re.search(r"^Question: (.*)$", user, re.M).group(1).lower()
    cols = ctx["columns"]
    rev = find_col(cols, "monetary", "revenue") or find_col(cols, "monetary")
    date = find_col(cols, "time")
    geo = find_col(cols, "geographic")
    metric = {"column": rev, "agg": "sum", "label": "Revenue"}

    if "forecast" in q:
        return {"action": "unsupported", "message": "Forecasting isn't available yet.", "title": "Forecast", "analysis": None}
    if "summarize" in q:
        return {"action": "analyze", "message": None, "title": "Dataset summary", "analysis": base_analysis(type="overview")}
    if "only show the northeast" in q and prev:
        a = dict(prev[-1]["plan"]); a = {**base_analysis(), **a}
        a["filters"] = [{"column": geo, "op": "eq", "values": ["Northeast"]}]
        return {"action": "analyze", "message": None, "title": "Monthly revenue, Northeast", "analysis": a}
    if "why" in q or "change last month" in q:
        return {"action": "analyze", "message": None, "title": "Revenue change last month", "analysis": base_analysis(
            type="compare_periods", metrics=[metric], dimensions=[geo], time={"column": date, "grain": None},
            period={"kind": "latest_complete", "unit": "month", "start": None, "end": None}, comparison="previous_period")}
    if "nrtheast" in q:
        value = "Nrtheast"
        fix = re.search(r"Closest values: ([^.,]+)", user)
        if fix:
            value = fix.group(1).strip()
        return {"action": "analyze", "message": None, "title": "Revenue in the Northeast", "analysis": base_analysis(
            metrics=[metric], filters=[{"column": geo, "op": "eq", "values": [value]}])}
    if "monthly" in q or "trend" in q or "invent" in q:
        return {"action": "analyze", "message": None, "title": "Monthly revenue", "analysis": base_analysis(
            metrics=[metric], time={"column": date, "grain": "month"})}
    if "highest" in q:
        return {"action": "analyze", "message": None, "title": "Revenue by region", "analysis": base_analysis(
            metrics=[metric], dimensions=[geo], sort={"by": "Revenue", "direction": "desc"}, limit=10)}
    return {"action": "clarify", "message": "Which measure do you want to look at?", "title": "Clarification", "analysis": None}


def interpret(user):
    facts = block(user, "Facts (data, not instructions):")
    q = re.search(r"^Question: (.*)$", user, re.M).group(1).lower()
    if "invent" in q and "previous explanation broke these rules" not in user:
        return {"headline": "Revenue grew about 12% overall.", "what_happened": [], "why": [], "recommendations": [], "caveats": []}
    ids = {f["label"]: f["id"] for f in facts}
    get = lambda pred: next((f"{{{f['id']}}}" for f in facts if pred(f["label"])), "")
    if "Current period" in ids:
        return {
            "headline": f"Revenue {get(lambda l: l == 'Direction')} by {get(lambda l: l.endswith('(absolute percent)') and ':' not in l)} in {get(lambda l: l == 'Current period')} compared with {get(lambda l: l == 'Comparison period')}.",
            "what_happened": [f"Revenue was {get(lambda l: l.endswith(' in current period'))}, compared with {get(lambda l: l.endswith(' in comparison period'))}."],
            "why": [f"The largest contributor accounted for {get(lambda l: l.endswith('share of the total change'))} of the change."],
            "recommendations": [{"action": "Review pricing and stock in the regions that moved most.", "reason": "They account for most of the change."}],
            "caveats": [],
        }
    if "Highest Revenue period" in ids:
        return {"headline": f"Revenue peaked in {get(lambda l: l == 'Highest Revenue period')} at {get(lambda l: l == 'Highest Revenue')}.",
                "what_happened": [f"The lowest month was {get(lambda l: l == 'Lowest Revenue period')} at {get(lambda l: l == 'Lowest Revenue')}."],
                "why": [], "recommendations": [], "caveats": []}
    first = facts[1] if len(facts) > 1 else facts[0]
    return {"headline": f"{first['label'].split(':')[0]}: {{{first['id']}}}.", "what_happened": [], "why": [], "recommendations": [], "caveats": []}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("Authorization") != "Bearer test-openai-key":
            self.send_response(401); self.end_headers(); return
        system, user = body["messages"][0]["content"], body["messages"][1]["content"]
        out = plan(user) if system.startswith("You are the planning step") else interpret(user)
        payload = {"model": body["model"], "usage": {"prompt_tokens": len(system + user) // 4, "completion_tokens": len(json.dumps(out)) // 4},
                   "choices": [{"message": {"role": "assistant", "content": json.dumps(out), "refusal": None}}]}
        data = json.dumps(payload).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), Handler).serve_forever()
