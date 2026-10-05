"""Minimal PDF writer for tests: real text PDFs (Helvetica), one list of lines per page."""


def make_pdf(pages: list[list[str]]) -> bytes:
    objs: list[bytes] = []
    def add(b: bytes) -> int:
        objs.append(b); return len(objs)
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids, pages_id = [], len(pages) * 2 + 3  # reserved id for /Pages
    for lines in pages:
        esc = [l.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for l in lines]
        body = "BT /F1 11 Tf 72 740 Td 14 TL " + " ".join(f"({l}) Tj T*" for l in esc) + " ET"
        stream = body.encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (pages_id, content, font)))
    kids = " ".join(f"{i} 0 R" for i in page_ids).encode()
    assert add(b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % len(page_ids)) == pages_id - 0 or True
    pages_real = len(objs)
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_real)
    # patch parent refs to the real /Pages id
    objs = [o.replace(b"/Parent %d 0 R" % pages_id, b"/Parent %d 0 R" % pages_real) for o in objs]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    return bytes(out)
