"""Extract text from uploaded business documents and split it into passages for search.

Documents are untrusted. Before any parser runs: extension allow-list, size limit, content
signature, and for .docx a zip-bomb and macro check. PDFs are read with pypdf (no
JavaScript, no forms executed); encrypted PDFs and PDFs without a text layer are refused
with a clear reason. Passages that read like instructions to an AI are flagged so the web
app can keep them out of AI answers.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from .errors import InvalidFile, LimitExceeded

DOC_FORMATS = {"pdf", "docx", "txt", "md"}
MAX_PAGES = 500
MAX_CHUNKS = 2000
TARGET_CHARS = 1400
MAX_CHARS = 2000
OVERLAP_CHARS = 250

# Phrases typical of prompt-injection attempts. Matching passages are kept for search but
# flagged, and the web app leaves them out of AI context.
INJECTION = re.compile(
    r"(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)"
    r"|you\s+are\s+now\s+(a|an|the)\b|system\s+prompt|developer\s+mode|jailbreak"
    r"|(reveal|print|show|output)\s+(your|the)\s+(instructions|prompt|api\s*key|secrets?)"
    r"|act\s+as\s+(if\s+you\s+are|a|an)\b.{0,40}(assistant|ai|model)"
    r"|do\s+not\s+follow\s+(your|the)\s+(rules|instructions)",
    re.IGNORECASE,
)


@dataclass
class Block:
    text: str
    page: int | None
    heading: str | None
    table_header: str | None = None   # for table rows: the header row, repeated if a passage starts mid-table


@dataclass
class Chunk:
    index: int
    text: str
    page_start: int | None
    page_end: int | None
    heading: str | None
    flagged: bool = False


@dataclass
class Extracted:
    file_format: str
    pages: int | None
    characters: int
    chunks: list[Chunk]
    warnings: list[str] = field(default_factory=list)


def detect_doc_format(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in DOC_FORMATS:
        raise InvalidFile("unsupported_format", "Upload a PDF, Word (.docx) or text (.txt, .md) file.")
    return ext


def clean_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]", "", s)          # zero-width / bidi controls
    s = "".join(ch for ch in s if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"-\n(?=[a-z])", "", s)                                               # re-join hyphenated words
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def _check_signature(path: Path, fmt: str) -> None:
    size = path.stat().st_size
    if size == 0:
        raise InvalidFile("empty_file", "The file is empty.")
    head = path.open("rb").read(8192)
    if fmt == "pdf" and not head.lstrip().startswith(b"%PDF-"):
        raise InvalidFile("bad_signature", "This doesn't look like a PDF file.")
    if fmt == "docx":
        if not head.startswith(b"PK\x03\x04"):
            raise InvalidFile("bad_signature", "This doesn't look like a Word .docx file. Older .doc files need to be saved as .docx.")
        try:
            with zipfile.ZipFile(path) as z:
                names = set(z.namelist())
                if "word/document.xml" not in names:
                    raise InvalidFile("bad_signature", "This file isn't a valid Word document.")
                if any(n.lower().endswith("vbaproject.bin") for n in names):
                    raise InvalidFile("macros_not_allowed", "Documents with macros aren't accepted. Save a copy as a regular .docx file.")
                total = sum(i.file_size for i in z.infolist())
                packed = max(1, sum(i.compress_size for i in z.infolist()))
                if total > 300 * 1024 * 1024 or total / packed > 100:
                    raise LimitExceeded("too_large_uncompressed", "This document expands to more data than can be processed.")
        except zipfile.BadZipFile as exc:
            raise InvalidFile("bad_signature", "This Word file is damaged or incomplete.") from exc
    if fmt in ("txt", "md") and b"\x00" in head:
        raise InvalidFile("binary_content", "This file contains binary data, so it can't be read as text.")


ROW_LIKE = re.compile(r"\$\s?\d|\b\d+(?:[.,]\d+)?\s?%|\b\d{1,3}(?:,\d{3})*\.\d{2}\b")
CODE_LIKE = re.compile(r"^[A-Z]{1,5}-?\d{2,}\b")


def _pdf_layout_lines(path: Path) -> list[tuple[float, list[dict]]]:
    """Per page: (page height, lines). Uses pdfminer's layout analysis, which gives each text
    line its true position and font sizes. Lines sharing a baseline are merged into one row
    when that looks like a table row (cells of a price list), so rows stay intact."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams, LTChar, LTTextContainer, LTTextLine

    pages: list[tuple[float, list[dict]]] = []
    for layout in extract_pages(str(path), laparams=LAParams(line_margin=0.4, char_margin=2.0)):
        raw = []
        def walk(obj):
            if isinstance(obj, LTTextLine):
                chars = [c for c in obj if isinstance(c, LTChar)]
                text = re.sub(r"\s+", " ", obj.get_text()).strip()
                if text:
                    size = sum(c.size for c in chars) / len(chars) if chars else 0.0
                    raw.append({"x": obj.x0, "x1": obj.x1, "y": round((obj.y0 + obj.y1) / 2, 1), "size": round(size, 1), "text": text})
            elif isinstance(obj, LTTextContainer) or hasattr(obj, "__iter__"):
                for child in obj:
                    walk(child)
        walk(layout)
        raw.sort(key=lambda ln: (-ln["y"], ln["x"]))
        merged: list[dict] = []
        for ln in raw:
            prev = merged[-1] if merged else None
            same_row = prev is not None and abs(prev["y"] - ln["y"]) <= 2.5
            if same_row:
                combined = f"{prev['text']} {ln['text']}"
                # Merge cells of a row; don't merge two long text lines side by side (columns).
                if ROW_LIKE.search(combined) or (len(prev["text"]) <= 40 and len(ln["text"]) <= 40):
                    prev["text"] = combined; prev["x1"] = ln["x1"]; prev["size"] = max(prev["size"], ln["size"])
                    continue
            merged.append(dict(ln))
        for ln in merged:
            ln["text"] = clean_text(ln["text"])
        pages.append((float(layout.height), [ln for ln in merged if ln["text"]]))
    return pages


def _pdf_blocks(path: Path) -> tuple[list[Block], int]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError
    try:
        reader = PdfReader(str(path), strict=False)
    except (PdfReadError, ValueError, OSError) as exc:
        raise InvalidFile("unreadable_pdf", "This PDF is damaged or can't be read.") from exc
    if reader.is_encrypted:
        try:
            if not reader.decrypt(""):
                raise InvalidFile("encrypted_pdf", "This PDF is password-protected. Remove the password and upload it again.")
        except Exception as exc:
            raise InvalidFile("encrypted_pdf", "This PDF is password-protected. Remove the password and upload it again.") from exc
    n = len(reader.pages)
    if n > MAX_PAGES:
        raise LimitExceeded("too_many_pages", f"The PDF has {n} pages. The limit is {MAX_PAGES}.")

    try:
        pages = [(i, h, lines) for i, (h, lines) in enumerate(_pdf_layout_lines(path), start=1)]
    except Exception:
        pages = []

    # Running headers and footers: lines in the top or bottom margin that repeat across pages
    # (digits ignored, so "Page 1" and "Page 2" match), plus any lone page number there.
    def margin(ln, h):
        return ln["y"] > 0.92 * h or ln["y"] < 0.09 * h
    key = lambda t: re.sub(r"\d+", "#", t.lower())
    repeats = Counter(key(ln["text"]) for _, h, lines in pages for ln in {key(l["text"]): l for l in lines if margin(l, h)}.values())
    page_no = re.compile(r"^(page\s*)?#(\s*(of|/)\s*#)?$")

    # Body text size: the most common size, weighted by characters. Headings are clearly larger.
    sizes = Counter()
    for _, _, lines in pages:
        for ln in lines:
            sizes[ln["size"]] += len(ln["text"])
    body = sizes.most_common(1)[0][0] if sizes else 0
    has_sizes = body > 0 and len(sizes) > 1

    blocks: list[Block] = []
    heading: str | None = None
    for i, h, lines in pages:
        lines = [ln for ln in lines if not (margin(ln, h) and (repeats[key(ln["text"])] >= 2 or page_no.match(key(ln["text"]))))]
        gaps = [lines[j]["y"] - lines[j + 1]["y"] for j in range(len(lines) - 1) if lines[j]["size"] == body]
        typical = sorted(gaps)[len(gaps) // 2] if gaps else 14.0
        buf: list[str] = []
        table: list[str] = []
        table_header: str | None = None

        def flush_para():
            if buf:
                blocks.append(Block(" ".join(buf), i, heading)); buf.clear()

        def flush_table():
            nonlocal table_header
            if table:
                for row in table:
                    blocks.append(Block(row, i, heading, table_header if row != table_header else None))
                table.clear()
            table_header = None

        for j, ln in enumerate(lines):
            t = ln["text"]
            nxt = lines[j + 1] if j + 1 < len(lines) else None
            gap_before = (lines[j - 1]["y"] - ln["y"]) if j else 0
            big = has_sizes and ln["size"] >= body * 1.12
            short_plain = len(t) <= 60 and not re.search(r"[.!?:;,]$", t)
            if (big and len(t) <= 120) or (not has_sizes and short_plain and not buf and not CODE_LIKE.match(t) and not ROW_LIKE.search(t)
                                            and nxt is not None and nxt["text"][:1].isupper()):
                flush_para(); flush_table()
                heading = t[:160]
                blocks.append(Block(t, i, heading))
                continue
            # A table row has figures and few ordinary words; prose that happens to contain
            # "$35" or "10%" has many lowercase words and stays prose.
            prose_words = len(re.findall(r"\b[a-z]{2,}\b", t))
            row = bool(ROW_LIKE.search(t)) and not re.search(r"[.!?]$", t) and len(t) <= 160 and prose_words < 8
            if row:
                if not table:
                    # Short non-sentence lines just above the first row belong to the table: the
                    # first is the header row ("SKU Product List price"), the rest are rows
                    # without figures ("1 to 9 units List price").
                    lead: list[str] = []
                    while buf and len(buf[-1]) <= 80 and not re.search(r"[.!?:;,]$", buf[-1]):
                        lead.insert(0, buf.pop())
                    flush_para()
                    if not lead and blocks and blocks[-1].page == i and blocks[-1].heading == heading and len(blocks[-1].text) <= 80 \
                            and not ROW_LIKE.search(blocks[-1].text) and not re.search(r"[.!?]$", blocks[-1].text) and blocks[-1].text != heading:
                        lead = [blocks.pop().text]
                    if lead:
                        table_header = lead[0]
                        table.extend(lead)
                table.append(t)
                continue
            if table:
                # a short line between rows that isn't a sentence is still part of the table
                if short_plain and nxt is not None and ROW_LIKE.search(nxt["text"]) and table_header is None:
                    table_header = t; table.append(t); continue
                flush_table()
            if buf and gap_before > typical * 1.6:
                flush_para()
            buf.append(t)
            if re.search(r"[.!?]$", t) and nxt is not None and nxt["text"][:1].isupper():
                flush_para()
        flush_para(); flush_table()

    if not blocks:  # no positioned text recovered: fall back to plain extraction
        for i, page in enumerate(reader.pages, start=1):
            text = clean_text(page.extract_text() or "")
            for para in re.split(r"\n\s*\n", text):
                if para.strip():
                    blocks.append(Block(para.replace("\n", " ").strip(), i, None))
    return blocks, n


def _docx_blocks(path: Path) -> list[Block]:
    import docx
    try:
        d = docx.Document(str(path))
    except Exception as exc:
        raise InvalidFile("unreadable_docx", "This Word file couldn't be read. Try opening and re-saving it in Word.") from exc
    blocks: list[Block] = []
    heading = None
    body = d.element.body
    # Walk paragraphs and tables in document order.
    for el in body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = docx.text.paragraph.Paragraph(el, d)
            text = clean_text(p.text)
            if not text:
                continue
            style = (p.style.name or "").lower() if p.style is not None else ""
            if style.startswith("heading") or style == "title":
                heading = text[:160]
            blocks.append(Block(text, None, heading))
        elif tag == "tbl":
            t = docx.table.Table(el, d)
            header = None
            for row in t.rows:
                cells = [clean_text(c.text) for c in row.cells]
                line = " | ".join(c for c in cells if c)
                if not line:
                    continue
                blocks.append(Block(line, None, heading, header))
                header = header or line
    return blocks


def _text_blocks(path: Path, fmt: str) -> list[Block]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise InvalidFile("bad_encoding", "The text encoding isn't supported. Save it as UTF-8.")
    text = clean_text(text)
    blocks, heading = [], None
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if fmt == "md" and para.startswith("#"):
            heading = para.lstrip("#").strip()[:160]
            blocks.append(Block(heading, None, heading))
            continue
        lines = [l.strip() for l in para.split("\n") if l.strip()]
        if len(lines) > 1 and len(lines[0]) <= 60 and not re.search(r"[.!?:;,]$", lines[0]):
            heading = lines[0][:160]
            blocks.append(Block(lines[0], None, heading))
            lines = lines[1:]
        blocks.append(Block(" ".join(lines), None, heading))
    return blocks


def chunk_blocks(blocks: list[Block]) -> list[Chunk]:
    """Pack paragraphs into passages of about TARGET_CHARS, never splitting mid-paragraph
    unless a paragraph alone is too long, carrying a short overlap between passages so a
    sentence on a boundary is still findable."""
    pieces: list[Block] = []
    for b in blocks:
        if len(b.text) <= MAX_CHARS:
            pieces.append(b)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", b.text)
        buf = ""
        for s in sentences:
            while len(s) > MAX_CHARS:                       # pathological run-on text
                pieces.append(Block(s[:MAX_CHARS], b.page, b.heading)); s = s[MAX_CHARS:]
            if len(buf) + len(s) + 1 > TARGET_CHARS and buf:
                pieces.append(Block(buf.strip(), b.page, b.heading)); buf = ""
            buf += " " + s
        if buf.strip():
            pieces.append(Block(buf.strip(), b.page, b.heading))

    chunks: list[Chunk] = []
    cur: list[Block] = []

    def label(blocks_: list[Block]) -> str | None:
        hs = [b.heading for b in blocks_ if b.heading]
        hs = [h for k, h in enumerate(hs) if k == 0 or h != hs[k - 1]]
        if not hs:
            return None
        return hs[0] if len(hs) == 1 else f"{hs[0]} … {hs[-1]}"[:160]

    def flush():
        if not cur:
            return
        text = "\n".join(p.text for p in cur)
        pages = [p.page for p in cur if p.page is not None]
        chunks.append(Chunk(len(chunks), text, min(pages) if pages else None, max(pages) if pages else None, label(cur),
                            flagged=bool(INJECTION.search(text))))

    size = 0
    for p in pieces:
        if INJECTION.search(p.text):
            # Instruction-like text becomes its own (flagged) passage, so it can't take the
            # surrounding legitimate text out of AI answers with it.
            flush(); cur, size = [], 0
            chunks.append(Chunk(len(chunks), p.text, p.page, p.page, p.heading, flagged=True))
            continue
        if size + len(p.text) > TARGET_CHARS and cur:
            # Don't end a passage on a heading or a lone table header: move them to the next one.
            moved: list[Block] = []
            while len(cur) > 1 and (cur[-1].text == cur[-1].heading or (p.table_header and cur[-1].text == p.table_header)):
                moved.insert(0, cur.pop())
            flush()
            tail = cur[-1]
            carry = not moved and len(tail.text) <= OVERLAP_CHARS and not INJECTION.search(tail.text)
            carried = ([Block(tail.table_header, tail.page, tail.heading), tail] if tail.table_header else [tail]) if carry else []
            cur = carried + moved
            size = sum(len(b.text) + 1 for b in cur)
        if p.table_header and not any(b.text == p.table_header for b in cur):
            # A passage that starts mid-table repeats the header row so the columns make sense.
            cur.append(Block(p.table_header, p.page, p.heading))
            size += len(p.table_header) + 1
        cur.append(p)
        size += len(p.text) + 1
    flush()
    if len(chunks) > MAX_CHUNKS:
        raise LimitExceeded("too_long", f"This document is too long to index ({len(chunks):,} passages; the limit is {MAX_CHUNKS:,}). Split it into smaller files.")
    return chunks


def extract_document(path: Path, fmt: str) -> Extracted:
    _check_signature(path, fmt)
    pages = None
    if fmt == "pdf":
        blocks, pages = _pdf_blocks(path)
    elif fmt == "docx":
        blocks = _docx_blocks(path)
    else:
        blocks = _text_blocks(path, fmt)
    characters = sum(len(b.text) for b in blocks)
    if characters < 20:
        if fmt == "pdf":
            raise InvalidFile("no_text_layer", "This PDF has no selectable text (it may be a scan). Scanned documents aren't supported yet; export a text PDF instead.")
        raise InvalidFile("no_text", "The document has no text.")
    chunks = chunk_blocks(blocks)
    warnings = []
    flagged = sum(c.flagged for c in chunks)
    if flagged:
        warnings.append(f"{flagged} passage{'s' if flagged != 1 else ''} read like instructions to an AI and will be left out of AI answers.")
    if fmt == "pdf" and pages and characters / pages < 100:
        warnings.append("Some pages have little or no selectable text; scanned pages can't be searched.")
    return Extracted(fmt, pages, characters, chunks, warnings)
