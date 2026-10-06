import io

from pypdf import PdfReader

from app.report_pdf import ReportPayload, render_report


def payload(**kw):
    base = {
        "title": "Sales business report, August 2026", "subtitle": "Dataset: sales. Generated Oct 6, 2026.",
        "summary": ["Revenue decreased by 8.0% in August 2026 compared with July 2026.", "Northeast accounted for most of the decline."],
        "risks": ["Northeast revenue was 66% below its expected level."], "actions": ["Review Northeast discount approvals."],
        "sections": [
            {"title": "Key figures", "kpis": [{"label": "Revenue", "value": "4,892.50", "change": "▼ 8.0% vs July 2026", "direction": "down"},
                                              {"label": "Orders", "value": "34", "change": "■ 0.0%", "direction": "flat"}]},
            {"title": "Revenue by month", "paragraphs": ["Revenue peaked in March 2026 at 5,512.50."],
             "chart": {"type": "line", "labels": ["Jan 2026", "Feb 2026", "Mar 2026"], "series": [{"name": "Revenue", "values": [5316.5, 5414.5, 5512.5]}]},
             "table": {"columns": ["Month", "Revenue"], "rows": [["Jan 2026", "5,316.50"], ["Feb 2026", "5,414.50"], ["Mar 2026", "5,512.50"]]}},
            {"title": "What drove the change", "chart": {"type": "diverging", "labels": ["Northeast", "West"], "series": [{"name": "Change", "values": [-742.5, 269.5]}]}},
            {"title": "Revenue by region", "chart": {"type": "hbar", "labels": ["South", "West"], "series": [{"name": "Revenue", "values": [14000, 12000]}]}},
        ],
        "skipped": ["Customer segments: no customer id column."], "footer": "InsightAI · Sales business report",
    }
    base.update(kw)
    return ReportPayload.model_validate(base)


def test_report_pdf_has_all_sections_as_text():
    pdf = render_report(payload())
    assert pdf[:5] == b"%PDF-"
    text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    for expected in ["Sales business report, August 2026", "Executive summary", "Key figures", "4,892.50", "Revenue by month",
                     "Key risks", "Recommended actions", "not calculations", "Not included", "no customer id column", "Page 1"]:
        assert expected in text, expected


def test_untrusted_text_is_escaped():
    pdf = render_report(payload(title="<b>Injected</b> & <script>", summary=["5 < 6 & 7 > 3"]))
    text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert "<b>Injected</b> & <script>" in text and "5 < 6 & 7 > 3" in text


def test_long_report_paginates():
    rows = [[f"Product {i}", f"{i * 10:,}"] for i in range(150)]
    pdf = render_report(payload(sections=[{"title": "Products", "table": {"columns": ["Product", "Revenue"], "rows": rows}}]))
    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 3
