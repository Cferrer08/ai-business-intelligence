"""Render a business report to PDF with ReportLab.

The web app sends fully computed content (text with numbers already filled in from engine
facts, chart series and tables); this module only lays it out. Charts are drawn with
ReportLab's own vector graphics, so the PDF has crisp charts and selectable text.
"""
from __future__ import annotations

import io
from typing import Literal
from xml.sax.saxutils import escape

from pydantic import BaseModel, Field
from reportlab.graphics.charts.barcharts import HorizontalBarChart, VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

PALETTE = ["#1D5FBF", "#C2410C", "#0F766E", "#7C3AED", "#B45309", "#475569"]
INK, MUTED, LINE, UP, DOWN = "#16202E", "#6B7685", "#D7DDE4", "#1E7A4F", "#B42318"


class ChartSeries(BaseModel):
    name: str = Field(max_length=120)
    values: list[float | None] = Field(max_length=400)


class Chart(BaseModel):
    type: Literal["line", "bar", "hbar", "diverging"]
    labels: list[str] = Field(max_length=400)
    series: list[ChartSeries] = Field(min_length=1, max_length=6)


class TableData(BaseModel):
    columns: list[str] = Field(max_length=12)
    rows: list[list[str]] = Field(max_length=200)


class Kpi(BaseModel):
    label: str = Field(max_length=120)
    value: str = Field(max_length=60)
    change: str | None = Field(default=None, max_length=80)
    direction: Literal["up", "down", "flat"] | None = None


class Section(BaseModel):
    title: str = Field(max_length=160)
    paragraphs: list[str] = Field(default_factory=list, max_length=12)
    bullets: list[str] = Field(default_factory=list, max_length=12)
    kpis: list[Kpi] = Field(default_factory=list, max_length=8)
    chart: Chart | None = None
    table: TableData | None = None
    notes: list[str] = Field(default_factory=list, max_length=8)


class ReportPayload(BaseModel):
    title: str = Field(max_length=200)
    subtitle: str = Field(default="", max_length=300)
    summary: list[str] = Field(default_factory=list, max_length=10)
    risks: list[str] = Field(default_factory=list, max_length=10)
    actions: list[str] = Field(default_factory=list, max_length=10)
    actions_note: str | None = Field(default=None, max_length=300)
    sections: list[Section] = Field(default_factory=list, max_length=20)
    skipped: list[str] = Field(default_factory=list, max_length=20)
    footer: str = Field(default="", max_length=200)


styles = getSampleStyleSheet()
TITLE = ParagraphStyle("T", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.HexColor(INK), alignment=0, spaceAfter=4)
SUB = ParagraphStyle("Sub", parent=styles["BodyText"], fontSize=10, textColor=colors.HexColor(MUTED), spaceAfter=14)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=colors.HexColor(INK), spaceBefore=14, spaceAfter=6)
BODY = ParagraphStyle("B", parent=styles["BodyText"], fontSize=10.2, leading=14.5, textColor=colors.HexColor(INK), spaceAfter=5)
NOTE = ParagraphStyle("N", parent=BODY, fontSize=8.8, leading=12, textColor=colors.HexColor(MUTED))
LABEL = ParagraphStyle("L", parent=BODY, fontSize=8.8, textColor=colors.HexColor(MUTED), spaceAfter=0)
VALUE = ParagraphStyle("V", parent=BODY, fontName="Helvetica-Bold", fontSize=15, leading=18, spaceAfter=0)


def p(text: str, style=BODY) -> Paragraph:
    return Paragraph(escape(text), style)


def bullets(items: list[str]) -> ListFlowable:
    return ListFlowable([ListItem(p(t), leftIndent=12, value="circle") for t in items], bulletType="bullet", start="•", leftIndent=12, bulletFontSize=8)


def kpi_table(kpis: list[Kpi], width: float) -> Table:
    cells = []
    for k in kpis:
        tone = {"up": UP, "down": DOWN}.get(k.direction or "", MUTED)
        parts = [p(k.label, LABEL), p(k.value, VALUE)]
        if k.change:
            parts.append(Paragraph(f'<font color="{tone}">{escape(k.change)}</font>', LABEL))
        cells.append(parts)
    per_row = min(4, len(cells)) or 1
    rows = [cells[i:i + per_row] for i in range(0, len(cells), per_row)]
    rows[-1] += [""] * (per_row - len(rows[-1]))
    t = Table(rows, colWidths=[width / per_row] * per_row)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(LINE)), ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor(LINE)),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
    return t


def _compact(v: float) -> str:
    a = abs(v)
    if a >= 1e6:
        return f"{v / 1e6:.1f}M"
    if a >= 1e3:
        return f"{v / 1e3:.1f}K"
    return f"{v:.0f}" if float(v).is_integer() else f"{v:.1f}"


def chart_drawing(c: Chart, width: float) -> Drawing:
    height = 190 if c.type != "hbar" else max(120, 18 * len(c.labels) + 40)
    d = Drawing(width, height)
    data = [[(v if v is not None else 0) for v in s.values] for s in c.series]
    all_vals = [v for row in data for v in row] or [0]
    lo, hi = min(0, min(all_vals)), max(0, max(all_vals))
    if hi == lo:
        hi = lo + 1
    if c.type == "line":
        ch = HorizontalLineChart()
        ch.joinedLines = 1
        for i in range(len(data)):
            ch.lines[i].strokeColor = colors.HexColor(PALETTE[i % len(PALETTE)])
            ch.lines[i].strokeWidth = 1.8
    elif c.type == "hbar":
        ch = HorizontalBarChart()
        ch.bars.strokeColor = None
        for i in range(len(data)):
            ch.bars[i].fillColor = colors.HexColor(PALETTE[i % len(PALETTE)])
    else:
        ch = VerticalBarChart()
        ch.bars.strokeColor = None
        for i in range(len(data)):
            ch.bars[i].fillColor = colors.HexColor(PALETTE[i % len(PALETTE)])
        if c.type == "diverging":
            for j, v in enumerate(data[0]):
                ch.bars[(0, j)].fillColor = colors.HexColor(UP if v >= 0 else DOWN)
    ch.x, ch.y = (110 if c.type == "hbar" else 45), 35
    ch.width, ch.height = width - ch.x - 15, height - 60
    ch.data = data
    axis_cat, axis_val = (ch.categoryAxis, ch.valueAxis)
    n = len(c.labels)
    step = max(1, n // 8) if c.type == "line" else 1
    axis_cat.categoryNames = [lbl[:16] if (i % step == 0) else "" for i, lbl in enumerate(c.labels)]
    axis_cat.labels.fontName = "Helvetica"
    axis_cat.labels.fontSize = 7
    axis_cat.labels.fillColor = colors.HexColor(MUTED)
    if c.type in ("bar", "diverging") and n > 6:
        axis_cat.labels.angle, axis_cat.labels.boxAnchor = 30, "ne"
    axis_val.valueMin, axis_val.valueMax = lo * 1.08, hi * 1.08
    axis_val.labels.fontName = "Helvetica"
    axis_val.labels.fontSize = 7
    axis_val.labels.fillColor = colors.HexColor(MUTED)
    axis_val.labelTextFormat = _compact
    axis_val.gridStrokeColor = colors.HexColor("#E3E8EE")
    axis_val.visibleGrid = 1
    d.add(ch)
    if len(c.series) > 1:
        lg = Legend()
        lg.x, lg.y, lg.fontSize, lg.alignment = ch.x, height - 8, 7.5, "right"
        lg.columnMaximum, lg.dx, lg.dy = 1, 8, 8
        lg.colorNamePairs = [(colors.HexColor(PALETTE[i % len(PALETTE)]), s.name[:30]) for i, s in enumerate(c.series)]
        lg.deltax = 90
        d.add(lg)
    return d


def data_table(t: TableData, width: float) -> Table:
    rows = [[p(col, LABEL) for col in t.columns]] + [[Paragraph(escape(cell), NOTE if len(t.columns) > 5 else BODY) for cell in r] for r in t.rows]
    tbl = Table(rows, colWidths=[width / len(t.columns)] * len(t.columns), repeatRows=1)
    tbl.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(LINE)), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F4F7")),
                             ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    return tbl


def render_report(payload: ReportPayload) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.85 * inch, rightMargin=0.85 * inch, topMargin=0.8 * inch, bottomMargin=0.85 * inch,
                            title=payload.title, author="InsightAI")
    width = letter[0] - doc.leftMargin - doc.rightMargin
    story = [p(payload.title, TITLE), p(payload.subtitle, SUB)]
    if payload.summary:
        story += [p("Executive summary", H2), bullets(payload.summary)]
    for sec in payload.sections:
        block = [p(sec.title, H2)]
        block += [p(t) for t in sec.paragraphs]
        if sec.kpis:
            block += [kpi_table(sec.kpis, width), Spacer(1, 6)]
        if sec.bullets:
            block.append(bullets(sec.bullets))
        if sec.chart and sec.chart.labels:
            block.append(chart_drawing(sec.chart, width))
        story.append(KeepTogether(block))
        if sec.table and sec.table.rows:
            story += [Spacer(1, 4), data_table(sec.table, width)]
        story += [p(n, NOTE) for n in sec.notes]
    if payload.risks:
        story += [p("Key risks", H2), bullets(payload.risks)]
    if payload.actions or payload.actions_note:
        story.append(p("Recommended actions", H2))
        if payload.actions:
            story += [p("Suggestions written by AI from the figures above, not calculations.", NOTE), bullets(payload.actions)]
        if payload.actions_note:
            story.append(p(payload.actions_note, NOTE))
    if payload.skipped:
        story += [p("Not included", H2), bullets(payload.skipped)]

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.8)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(doc.leftMargin, 0.55 * inch, payload.footer[:120])
        canvas.drawRightString(letter[0] - doc.rightMargin, 0.55 * inch, f"Page {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
