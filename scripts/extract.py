#!/usr/bin/env python3
"""Extract SA_S92A-FCP.pdf into data/fcp.json and inline it in index.html.

Run: python3 scripts/extract.py
- Pages 1-114: procedures (sections 1.1 .. 5.11)
- Pages 115-118: figures -> figures/fig1..4.png (cropped renders)
- Page 119: header form (dropped on request)
- Pages 120-122: checklist index (front page)
"""
import json, os, re, subprocess, sys
import pdfplumber
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "SA_S92A-FCP.pdf")
PROC_PAGES = range(1, 115)          # 1-based, inclusive of 114
FIG_PAGES = {115: 1, 116: 2, 117: 3, 118: 4}
INDEX_PAGES = (120, 121, 122)

# Glyphs the PDF draws from pi fonts
FONT_MAP = {"GreekwithMathPi": {"6": "±"}, "NewswithCommPi": {"9": "″"}}

HEAD_RE = re.compile(r"^(\d+\.\d+(?:\.\d+)*)\s+(.+)$")
CHAP_RE = re.compile(r"^(\d)\.0\s+(.+)$")
LABEL_RE = [
    (1, re.compile(r"^(\d{1,2})\.\s+(.*)$")),
    (2, re.compile(r"^([a-z])\.\s+(.*)$")),
    (3, re.compile(r"^\((\d{1,2})\)\s+(.*)$")),
    (4, re.compile(r"^\(([a-z])\)\s+(.*)$")),
]
ADMON = ("WARNING", "CAUTION", "NOTE")
COL_GAP = 9          # pt; wider gaps than this split a line into table cells
# Steps where the PDF lacks the dot after the label ("a Verify ...", "5 Repeat ...")
LOOSE_RE = [(2, re.compile(r"^([a-z])\s+([A-Z][a-z]+\b.*)$")), (1, re.compile(r"^(\d{1,2})\s+([A-Z][a-z]+\b.*)$"))]
# Fractions are typeset as small digits around a fraction slash: "1" "⁄" "2" (6 pt) -> "½"
VULGAR = {"1⁄2": "½", "1⁄4": "¼", "3⁄4": "¾"}
# Known typos in the PDF, corrected on request (André): (section, wrong, right)
ERRATA = [("4.1", "agreement with the PDFs.", "agreement with the PFDs.")]
LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl"}


def fix_char(c):
    for key, m in FONT_MAP.items():
        if key in c["fontname"] and c["text"] in m:
            return m[c["text"]]
    return c["text"]


def page_lines(page):
    """Group chars into lines. Returns list of dicts: top, x0, bold, text, cells[(x0,text)]."""
    # skip running header (doc number) and footer (dates, page number)
    chars = [c for c in page.chars if 50 < c["top"] < 735 and c["text"].strip()]
    rows = []
    for c in sorted(chars, key=lambda c: c["top"]):
        for r in rows:
            if abs(r["top"] - c["top"]) <= 4 or (abs(r["bottom"] - c["bottom"]) <= 2):
                r["chars"].append(c)
                break
        else:
            rows.append({"top": c["top"], "bottom": c["bottom"], "chars": [c]})
    out = []
    for r in sorted(rows, key=lambda r: r["top"]):
        cs = sorted(r["chars"], key=lambda c: c["x0"])
        # main font = font of the majority of chars (ignoring pi/symbol fonts)
        fonts = [c["fontname"].split("+")[-1] for c in cs if "Pi" not in c["fontname"] and "Symbol" not in c["fontname"]]
        size = max(c["size"] for c in cs)
        cells, cur, prev = [], "", None
        cx = cs[0]["x0"]
        for c in cs:
            if prev is not None:
                gap = c["x0"] - prev["x1"]
                if gap > COL_GAP:
                    cells.append((cx, prev["x1"], cur)); cur = ""; cx = c["x0"]
                elif gap > 0.12 * size:
                    cur += " "
            ch = fix_char(c)
            if ch.isdigit() and c["size"] < 0.8 * size:
                ch = "\x01" + ch + "\x02"     # small (fraction) digit
            cur += ch
            prev = c
        cells.append((cx, prev["x1"], cur))
        cells = [(x0, x1, re.sub(r"\s+", " ", fractions(t)).strip()) for x0, x1, t in cells]
        text = " ".join(t for _, _, t in cells)
        top_font = fonts[0] if fonts else ""
        out.append({
            "top": min(c["top"] for c in cs), "x0": cs[0]["x0"],
            "bold": "Bold" in top_font, "font": top_font, "size": size,
            "text": text, "cells": cells,
        })
    return out


def fractions(t):
    t = re.sub(r"\x01(\d)\x02⁄\x01(\d)\x02", lambda m: VULGAR.get(m.group(1) + "⁄" + m.group(2), m.group(0)), t)
    return t.replace("\x01", "").replace("\x02", "")


def tidy(t):
    for k, v in LIGATURES.items():
        t = t.replace(k, v)
    t = re.sub(r"\s+", " ", t).strip()
    t = t.replace(" ,", ",").replace("( ", "(").replace(" )", ")")
    t = re.sub(r"\s*→\s*", "→", t)
    return t


def join(a, b):
    # hyphenated line break: "consump-" + "tion" -> "consumption"
    if (re.search(r"[a-z]-$", a) and re.match(r"^[a-z]", b)) or (re.search(r"[A-Z]{2}-$", a) and re.match(r"^[A-Z]{3}", b)):
        return a[:-1] + b
    return a + " " + b


def parse_procedures(pdf):
    chapters, sections = {}, []
    sec = None          # current section dict
    cur = None          # current open block (for continuation)
    chap = None
    last_top = None
    admon = None        # {"x": body x0}
    last_step, step_pos, last_n1 = None, (0, 0), 0
    p_pos = {}          # id(p block) -> (page, x0), for nested list items

    def target():
        return sec["blocks"] if sec is not None else chapters[chap]["blocks"]

    for pn in PROC_PAGES:
        page = pdf.pages[pn - 1]
        lines = page_lines(page)
        new_page = True
        for ln in lines:
            text = tidy(ln["text"])
            if not text:
                continue
            gap = 999 if (last_top is None or new_page) else ln["top"] - last_top
            last_top = ln["top"]
            m = CHAP_RE.match(text)
            if m and ln["bold"]:
                chap = m.group(1)
                chapters[chap] = {"id": chap, "title": m.group(2).strip(), "blocks": []}
                sec = None; cur = None; admon = None; new_page = False
                continue
            m = HEAD_RE.match(text)
            if m and ln["bold"] and "Times-Bold" in ln["font"]:
                num, title = m.group(1), m.group(2).strip()
                if num.count(".") == 1:
                    sec = {"id": num, "chapter": chap, "title": title, "page": pn, "blocks": []}
                    sections.append(sec)
                    last_step, last_n1 = None, 0
                else:
                    sec["blocks"].append({"t": "h", "id": num, "text": title})
                cur = None; admon = None; new_page = False
                continue
            if text in ADMON:
                cur = {"t": text.lower(), "text": ""}
                target().append(cur)
                admon = {"x": None}
                new_page = False
                continue
            # admonition body
            if admon is not None and cur is not None and cur["t"] in ("warning", "caution", "note"):
                lab = any(r.match(text) for _, r in LABEL_RE)
                if admon["x"] is None and not lab:
                    admon["x"] = ln["x0"]; cur["text"] = text; new_page = False
                    continue
                inside = admon["x"] is not None and ln["x0"] >= admon["x"] - 4
                if len(ln["cells"]) == 1 and ((gap < 18 and (inside or not lab)) or (new_page and not lab and not cur["text"].endswith("."))):
                    cur["text"] = join(cur["text"], text); new_page = False
                    continue
                admon = None; cur = None
            # step labels
            hit = None
            for lvl, rx in LABEL_RE:
                mm = rx.match(text)
                if mm:
                    hit = (lvl, mm.group(1), mm.group(2)); break
            if not hit and last_step is not None and gap > 18:
                for lvl, rx in LOOSE_RE:
                    mm = rx.match(text)
                    if mm and (lvl == 2 or int(mm.group(1)) == last_n1 + 1):
                        hit = (lvl, mm.group(1), mm.group(2)); break
            if hit and len(ln["cells"]) <= 1 + (" " not in ln["cells"][0][2]):
                lvl, n, body = hit
                cur = {"t": "step", "lvl": lvl, "n": n, "text": body}
                last_step = cur; step_pos = (pn, ln["x0"])
                if lvl == 1:
                    last_n1 = int(n)
                target().append(cur)
                new_page = False
                continue
            # table rows (several wide-spaced cells, or a single cell tight under a table row)
            tb = target()
            in_table = tb and tb[-1]["t"] == "table" and (gap < 16 or (new_page and len(ln["cells"]) >= 2))
            if len(ln["cells"]) >= 2 or in_table:
                if in_table or (tb and tb[-1]["t"] == "table" and gap < 45):
                    tb[-1]["rows"].append((pn, ln["cells"]))
                else:
                    tb.append({"t": "table", "rows": [(pn, ln["cells"])]})
                cur = None; new_page = False
                continue
            # continuation of previous text block
            open_end = cur is not None and (re.search(r"[a-z,]$", cur["text"]) if cur["t"] == "p" else not re.search(r"[.:]$", cur["text"]))
            # a wrapped step line starts just right of the step label; other indents are new paragraphs
            aligned = cur is None or cur["t"] != "step" or new_page or step_pos[1] + 4 < ln["x0"] < step_pos[1] + 24
            if cur is not None and cur["t"] in ("step", "p") and aligned and (gap < 18 or (new_page and open_end)):
                cur["text"] = join(cur["text"], text); new_page = False
                continue
            cur = {"t": "p", "text": text}
            tb = target()
            if tb and tb[-1]["t"] == "p" and "lvl" in tb[-1]:
                cur["lvl"] = tb[-1]["lvl"]
                # nested list items (2.25: AFCS 1/AFCS 2 under AFCS): indent relative to the item above on the same page
                ppn, px = p_pos[id(tb[-1])]
                if ppn == pn and ln["x0"] > px + 6:
                    cur["lvl"] += 1
                elif ppn == pn and ln["x0"] < px - 6:
                    for b in reversed(tb):
                        if b["t"] != "p" or "lvl" not in b:
                            cur["lvl"] = max(tb[-1]["lvl"] - 1, 1); break
                        bpn, bx = p_pos[id(b)]
                        if bpn == pn and abs(bx - ln["x0"]) <= 6:
                            cur["lvl"] = b["lvl"]; break
            elif last_step is not None and tb and last_step in tb:
                same = step_pos[0] == pn
                cur["lvl"] = last_step["lvl"] + (1 if (not same or ln["x0"] > step_pos[1] + 5) else 0)
            target().append(cur)
            p_pos[id(cur)] = (pn, ln["x0"])
            new_page = False

    # normalise tables: map cells to column indices by x position
    def fix_tables(blocks):
        for b in blocks:
            if b["t"] != "table":
                continue
            # a table may continue on the next page, where margins differ: align on each page's left edge
            left = {}
            for pn, row in b["rows"]:
                left[pn] = min(left.get(pn, 1e9), row[0][0])
            b["rows"] = [[(x0 - left[pn], x1 - left[pn], t) for x0, x1, t in row] for pn, row in b["rows"]]
            # columns = merged x-intervals of all cells
            cols = []
            for x0, x1, _ in sorted(c for row in b["rows"] for c in row):
                if cols and x0 <= cols[-1][1] + 3:
                    cols[-1][1] = max(cols[-1][1], x1)
                else:
                    cols.append([x0, x1])
            rows = []
            for row in b["rows"]:
                r = [""] * len(cols)
                for x0, x1, t in row:
                    i = next(i for i, c in enumerate(cols) if c[0] <= x0 + 0.5 and x0 <= c[1])
                    r[i] = (r[i] + " " + t).strip()
                rows.append(r)
            b["rows"] = rows
    for sec_id, wrong, right in ERRATA:
        sec = next(s for s in sections if s["id"] == sec_id)
        hits = [b for b in sec["blocks"] if wrong in b.get("text", "")]
        if len(hits) != 1:
            sys.exit("erratum not found exactly once in %s: %r" % (sec_id, wrong))
        hits[0]["text"] = hits[0]["text"].replace(wrong, right)
    for s in sections:
        fix_tables(s["blocks"])
    for c in chapters.values():
        fix_tables(c["blocks"])
    return chapters, sections


def parse_index():
    """Front page list from pages 120-122."""
    txt = subprocess.run(["pdftotext", "-layout", "-f", str(INDEX_PAGES[0]), "-l", str(INDEX_PAGES[-1]), PDF, "-"],
                         capture_output=True, text=True, check=True).stdout
    chapters, cur, last = [], None, None
    for raw in txt.splitlines():
        line = raw.strip()
        m = re.match(r"^(\d)\.0\s+(.+)$", line)
        if m:
            cur = {"id": m.group(1), "title": m.group(2).strip(), "items": []}
            chapters.append(cur); continue
        m = re.match(r"^(\d\.\d+)\s+(.+?)\s*(_{2,})?$", line)
        if m and cur is not None:
            last = {"id": m.group(1), "title": m.group(2).strip(), "sign": bool(m.group(3))}
            cur["items"].append(last); continue
        if last is not None and last["id"] == "4.2" and re.match(r"^[A-Z][A-Z0-9 %]+$", line):
            last.setdefault("fields", []).append(line)
    return chapters


def render_figures():
    os.makedirs(os.path.join(ROOT, "figures"), exist_ok=True)
    for pn, n in FIG_PAGES.items():
        base = os.path.join(ROOT, "figures", "fig%d" % n)
        # crop away header/logo/footer: points 612x792 -> keep y 95..725
        dpi = 170
        s = dpi / 72.0
        subprocess.run(["pdftoppm", "-f", str(pn), "-l", str(pn), "-r", str(dpi), "-gray", "-png", "-singlefile",
                        "-x", str(int(30 * s)), "-y", str(int(95 * s)), "-W", str(int(552 * s)), "-H", str(int(630 * s)),
                        PDF, base], check=True)
        Image.open(base + ".png").convert("L").save(base + ".png", optimize=True)


def render_pages():
    """Original PDF pages for "View in PDF": pages/pNNN.png, 150 dpi, 16 colours (keeps the red annunciators)."""
    out = os.path.join(ROOT, "pages")
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "tmp")
    subprocess.run(["pdftoppm", "-f", str(PROC_PAGES[0]), "-l", str(PROC_PAGES[-1]), "-r", "150", "-png", PDF, tmp], check=True)
    for pn in PROC_PAGES:
        src = "%s-%03d.png" % (tmp, pn)
        Image.open(src).convert("RGB").quantize(16).save(os.path.join(out, "p%03d.png" % pn), optimize=True)
        os.remove(src)


def page_labels():
    """Printed page number per PDF page (footer, e.g. "1-59")."""
    labels = {}
    for pn in PROC_PAGES:
        t = subprocess.run(["pdftotext", "-layout", "-f", str(pn), "-l", str(pn), PDF, "-"], capture_output=True, text=True).stdout
        m = re.findall(r"\b(1-\d{1,3})\b", t.strip().splitlines()[-1] if t.strip() else "")
        labels[pn] = m[-1] if m else ""
    return labels


def main():
    pdf = pdfplumber.open(PDF)
    chapters, sections = parse_procedures(pdf)
    index = parse_index()
    ids = [s["id"] for s in sections]
    for ch in index:
        for it in ch["items"]:
            if it["id"] not in ids:
                sys.exit("index item %s has no section" % it["id"])
    # page range per section: from its first page to the page where the next section starts
    for i, sec in enumerate(sections):
        end = sections[i + 1]["page"] if i + 1 < len(sections) else PROC_PAGES[-1]
        sec["pages"] = [sec["page"], max(sec["page"], end)]
    figs = []
    for pn, n in FIG_PAGES.items():
        t = subprocess.run(["pdftotext", "-f", str(pn), "-l", str(pn), PDF, "-"], capture_output=True, text=True).stdout
        m = re.search(r"Figure %d\.\s*(.+)" % n, t)
        figs.append({"n": n, "title": m.group(1).strip() if m else "Figure %d" % n, "src": "figures/fig%d.png" % n})
    data = {
        "doc": "SA S92A-FCP-000",
        "title": "S-92A Flight Check Procedures Checklist",
        "rev": "Revised: October 18, 2013",
        "index": index,
        "chapters": {k: {"title": v["title"], "blocks": v["blocks"]} for k, v in chapters.items()},
        "sections": sections,
        "figures": figs,
        "pageLabels": page_labels(),
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "fcp.json"), "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    if "--no-figures" not in sys.argv:
        render_figures()
    if "--no-pages" not in sys.argv:
        render_pages()
    # inline into index.html
    html_path = os.path.join(ROOT, "index.html")
    if os.path.exists(html_path):
        html = open(html_path, encoding="utf-8").read()
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        new, k = re.subn(r'(<script id="fcp-data" type="application/json">)(.*?)(</script>)',
                         lambda m: m.group(1) + blob + m.group(3), html, flags=re.S)
        if k != 1:
            sys.exit("fcp-data block not found in index.html")
        open(html_path, "w", encoding="utf-8").write(new)
    print("sections: %d, blocks: %d" % (len(sections), sum(len(s["blocks"]) for s in sections)))


if __name__ == "__main__":
    main()
