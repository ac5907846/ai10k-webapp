"""Verify every deep link on the site against the filing it points into.

The site does not merely link to a 10-K, it links *into* it: a scroll-to-text
fragment, `<url>#:~:text=<opening words>,<closing words>`, makes the browser open
the filing at the quoted sentence and highlight it on arrival. This script writes
those fragments, and writes only the ones it has proved will fire.

Four link surfaces, all of them handled here:

    f:<cik>:<fy>              a square on the landing grid, at that filing's first
                              AI sentence
    p:<passage_id>            a coded passage, on the Passages view and behind the
                              quotations on Stories
    t:<id>:<cik>:<fy>         one firm's use of a shared disclosure template

Why it cannot be done in the browser
------------------------------------
`build_data.py` bakes the site's numbers out of the analysis outputs, and those
come from the plain text extracted into `01_raw_data`. The browser searches the
filing HTML, and the two are not the same string. Four differences each cost a
measurable number of links:

1. **Extraction is lossy in both directions.** It inserts a space at every tag
   boundary and replaces the typographic quotes and dashes, so wording that reads
   identically can differ character for character from what the browser looks for.
2. **A match may not cross a block boundary.** The browser searches one block box
   at a time, and eight consecutive words of extracted text routinely straddle two
   `<div>`s, where they can never be found.
3. **The browser stops at the first match in the document.** Wording that also
   appears in the contents page or a running header opens the filing at the wrong
   paragraph, which to a reader is worse than not scrolling at all.
4. **A private-use glyph is invisible to the matcher.** A bullet typed in a word
   processor reaches filing HTML as U+F0B7, a Wingdings character that renders as
   a bullet and sits at the front of exactly the list items a 10-K puts its AI
   disclosure in. Real bullets, U+2022, match perfectly well.

So every anchor is cut from a single block of the filing's own HTML and then
verified by replaying the browser's matching rules over that same HTML. An anchor
that does not verify is not written: the site then links to the filing unanchored,
and the reader loses the scroll but never the document.

The filing HTML is cached under ~/.cache, deliberately outside the project folder,
so several hundred megabytes of markup never sync to OneDrive, and `01_raw_data`
is never touched.

Run:  python build_anchors.py            # fetch what is missing, then build
      python build_anchors.py --offline  # build from the cache only, no network
      python build_anchors.py --refresh  # re-download every document first
Output: data/anchors.json
"""
import gzip
import json
import re
import sys
import time
import warnings
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests
from bs4 import BeautifulSoup, NavigableString, Tag, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

HERE = Path(__file__).resolve().parent
ANALYSIS = HERE.parent / "02_analysis"
DATA = HERE / "data"
CACHE = Path.home() / ".cache" / "ai_in_construction" / "filing_html"

A_FILINGS = "01_filings_and_diffusion (fig 2, fig S3)"
A_CLAIMS = "05_ai_claim_coding (fig 4, fig 5, fig 9, fig S1)"
A_CONTAGION = "06_disclosure_contagion"

# SEC fair access: a descriptive User-Agent and no more than 10 requests a second.
USER_AGENT = "FGCU Construction AI Research (zulablewis@gmail.com)"
RATE_SLEEP = 0.15


def out(analysis, name):
    return pd.read_csv(ANALYSIS / analysis / "outputs" / name)


# ============================================================================
# THE AI LEXICON
# ============================================================================
# The same boundary-guarded, case-sensitive patterns the analysis counts with, so
# a link can never land on wording the study would not have counted. Copied rather
# than imported for the same reason every analysis folder carries its own lib.py:
# this script has to keep working when a folder is moved or archived.
CORE = {
    "artificial_intelligence": r"artificial[\s\-]+intelligence",
    "ai_abbrev":               r"(?<![A-Za-z0-9])A\.?I\.?(?![A-Za-z0-9])",
    "machine_learning":        r"machine[\s\-]+learning",
    "deep_learning":           r"deep[\s\-]+learning",
    "neural_network":          r"neural[\s\-]+net(work)?s?",
    "generative_ai":           r"generative[\s\-]+(a\.?i\.?|artificial intelligence)",
    "large_language_model":    r"large[\s\-]+language[\s\-]+model|\bLLMs?\b|\bGPT[\s\-]?\d?\b|chatgpt",
    "nlp":                     r"natural[\s\-]+language[\s\-]+processing",
    "computer_vision":         r"computer[\s\-]+vision|image[\s\-]+recognition",
}
ANY_CORE = re.compile("|".join(f"(?:{p})" for p in CORE.values()), re.I)
SENT_SPLIT = re.compile(r"(?<=[\.\?\!])\s+(?=[A-Z\"'(“])")


# ============================================================================
# THE FILING AS THE BROWSER SEES IT
# ============================================================================
_WS = re.compile(r"\s+")
_WORDCH = re.compile("[0-9A-Za-z\u00c0-\u024f]")
# Zero-width and soft-hyphen characters: in the markup, invisible to the
# reader, and skipped by the matcher, so they must not reach an anchor.
_INVISIBLE = dict.fromkeys(
    map(ord, "\u200b\u200c\u200d\u2060\ufeff\u00ad"), None)

# Elements that open a new block box. A text-fragment match never spans one.
BLOCK = {"address", "article", "aside", "blockquote", "body", "br", "caption",
         "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption",
         "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
         "hgroup", "hr", "html", "li", "main", "nav", "ol", "option", "p", "pre",
         "section", "table", "tbody", "td", "textarea", "tfoot", "th", "thead",
         "tr", "ul"}
DROP = {"script", "style", "head", "title", "noscript"}
HIDDEN = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.I)
PRIVATE_USE = re.compile("[\ue000-\uf8ff\U000f0000-\U0010fffd]")


def normalise(s):
    """Collapse whitespace the way the matcher does. &nbsp; is a space to it."""
    s = str(s).replace("\u00a0", " ").translate(_INVISIBLE)
    return _WS.sub(" ", s).strip()


def fold(s):
    return normalise(s).lower()


def block_texts(html):
    """The filing's text one block at a time, hidden subtrees dropped, in order."""
    soup = BeautifulSoup(html, "lxml")
    for t in list(soup.find_all(True)):
        if not t.name:
            continue
        if t.name in DROP:
            t.decompose()
            continue
        if ":" in t.name and t.name.split(":")[-1] == "header":
            t.decompose()          # the inline-XBRL header is never rendered
            continue
        style = t.get("style") or ""
        if not isinstance(style, str):
            style = " ".join(style)
        if HIDDEN.search(style) or t.has_attr("hidden"):
            t.decompose()

    blocks, cur = [], []

    def flush():
        if cur:
            t = normalise("".join(cur))
            if t:
                blocks.append(t)
            cur.clear()

    def walk(node):
        for ch in node.children:
            if isinstance(ch, NavigableString):
                cur.append(str(ch))
            elif isinstance(ch, Tag):
                if ch.name in BLOCK:
                    flush()
                    walk(ch)
                    flush()
                else:
                    walk(ch)

    walk(soup)
    flush()
    return blocks


def find_bounded(hay, needle, start=0):
    """First occurrence with a word boundary at both ends, or -1. Both arguments
    must already be folded."""
    n = len(needle)
    if not n:
        return -1
    i = hay.find(needle, start)
    while i != -1:
        if i == 0 or not _WORDCH.match(hay[i - 1]):
            j = i + n
            if j >= len(hay) or not _WORDCH.match(hay[j]):
                return i
        i = hay.find(needle, i + 1)
    return -1


def resolve(folded, start_term, end_term=None):
    """Replay the browser: which block does this directive actually land on?

    The start term is searched from the top of the document; the end term is then
    searched from the end of that match onwards. If either fails so does the whole
    directive, as the specification requires. Returns a block index, or -1.
    """
    s = fold(start_term)
    e = fold(end_term) if end_term is not None else None
    for bi, b in enumerate(folded):
        at = find_bounded(b, s)
        if at == -1:
            continue
        if e is None:
            return bi
        if find_bounded(b, e, at + len(s)) != -1:
            return bi
        if any(find_bounded(b2, e) != -1 for b2 in folded[bi + 1:]):
            return bi
        return -1                  # start found, end never follows it
    return -1


def directive(start_term, end_term=None):
    # `-`, `,` and `&` are the fragment syntax's own delimiters and have to be
    # escaped inside a term even though a URL would otherwise carry them.
    enc = lambda t: quote(normalise(t), safe="").replace("-", "%2D")
    return "#:~:text=" + (enc(start_term) if end_term is None
                          else enc(start_term) + "," + enc(end_term))


# ============================================================================
# CHOOSING WHAT TO HIGHLIGHT
# ============================================================================
# The study's own passage bounds, so the site can never land on wording the
# analysis would not have counted.
MIN_LEN, MAX_LEN = 40, 1500
LONG_SENTENCE = 600      # beyond this, break the run-on into its clauses
CLAUSE_SPLIT = re.compile("(?<=[;•])\\s+")
WORD = re.compile(r"[A-Za-z0-9]+")


def sentences(text):
    out_ = []
    for s in SENT_SPLIT.split(text):
        s = s.strip()
        if not s:
            continue
        # A forward-looking-statements paragraph runs to thousands of characters
        # as one semicolon-separated list. Highlighting all of it buries the AI
        # wording the reader came for, so such a sentence is split at its clauses.
        if len(s) > LONG_SENTENCE:
            out_.extend(x.strip() for x in CLAUSE_SPLIT.split(s) if x.strip())
        else:
            out_.append(s)
    return out_


def words_of(s):
    return {w.lower() for w in WORD.findall(str(s))}


def overlap(a, s):
    b = words_of(s)
    return len(a & b) / max(1, len(a | b)) if b else 0.0


def matchable(sent):
    """The longest run of the sentence a browser can actually search for.

    Anything the matcher cannot find must stay out of an anchor, so the anchor is
    cut from the longest stretch carrying no private-use glyph. For the usual case,
    a bullet at the very front, that is the whole sentence minus the bullet.
    """
    if not PRIVATE_USE.search(sent):
        return sent
    return max(PRIVATE_USE.split(sent), key=len).strip()


def ordered_passages(blocks, want, ai_only):
    """Every sentence in the filing that could be the one wanted, best first.

    Best is the one closest to the wording the analysis recorded; the rest follow
    in document order, which is what gives an anchor to the few filings whose
    wording did not survive extraction in a comparable form.
    """
    w = words_of(want) if isinstance(want, str) and want else set()
    scored = []
    for bi, b in enumerate(blocks):
        if ai_only and not ANY_CORE.search(b):
            continue
        for s in sentences(b):
            if ai_only and not ANY_CORE.search(s):
                continue
            if MIN_LEN <= len(s) <= MAX_LEN:
                scored.append((-(overlap(w, s) if w else 0.0), bi, s))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [(bi, s) for _, bi, s in scored]


def head_tail(sent, n):
    ws = sent.split(" ")
    if len(ws) < 2 * n + 1:        # the two anchors would otherwise overlap, and
        return None                # the end anchor is searched for after the start
    return " ".join(ws[:n]), " ".join(ws[-n:])


def candidates(sent):
    """Directives to try for one sentence, best first: (start, end or None, kind).

    A start/end range highlights the whole sentence, which is what a reader wants
    to see. The single-term forms are the fallbacks: for a sentence too short to
    carry two non-overlapping anchors, and for an opening that also appears in a
    heading somewhere above it.
    """
    sent = matchable(sent)
    out_, ws = [], sent.split(" ")
    for n in (12, 9, 7, 5, 4):
        ht = head_tail(sent, n)
        if ht:
            out_.append((ht[0], ht[1], f"range{n}"))
    if len(sent) <= 420:
        out_.append((sent, None, "whole"))
    m = ANY_CORE.search(sent)
    if m:                                          # a window around the AI term
        left = len(WORD.findall(sent[:m.start()]))
        for span in (14, 10, 7):
            frag = " ".join(ws[max(0, left - span // 2):][:span])
            if len(frag.split(" ")) >= 4:
                out_.append((frag, None, f"around{span}"))
    for n in (16, 12, 9, 6):
        if len(ws) >= n:
            out_.append((" ".join(ws[:n]), None, f"head{n}"))
    seen, uniq = set(), []
    for c in out_:
        k = (c[0].lower(), (c[1] or "").lower())
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    return uniq


def anchor_for(blocks, folded, want, ai_only):
    """Return (fragment, quote, kind, n_matches). fragment is None when nothing
    verified, and the site then links to the filing unanchored."""
    passages = ordered_passages(blocks, want, ai_only)
    if not passages:
        return None, None, "no-passage", 0
    for bi, sent in passages:
        # A 10-K often repeats a sentence, typically once in the business overview
        # and again in MD&A. The browser stops at the first copy, and the first
        # copy is the same sentence, so aim at it rather than calling it ambiguous.
        fs = fold(sent)
        for i in range(bi + 1):
            if fs in folded[i]:
                bi = i
                break
        for start, end, kind in candidates(sent):
            if PRIVATE_USE.search(start + (end or "")):
                continue           # the matcher cannot find these; see PRIVATE_USE
            if resolve(folded, start, end) == bi:
                s = fold(start)
                hits = sum(find_bounded(b, s) != -1 for b in folded)
                return directive(start, end), matchable(sent), kind, hits
    return None, matchable(passages[0][1]), "unverifiable", 0


# ============================================================================
# WHAT THE SITE LINKS TO
# ============================================================================
def collect_requests():
    """Every deep link the site needs, as (key, cik, fy, adsh, url, quote, ai_only)."""
    panel = out(A_FILINGS, "panel_all_filings.csv")
    doc = {(int(r.cik), int(r.fy)): (r.adsh, r.primary_doc_url)
           for r in panel.itertuples()}

    req = []

    # 1. the landing grid: the first AI sentence of every filing that has one
    sents = out(A_FILINGS, "ai_sentences.csv")
    first = {}
    for r in sents.itertuples():
        first.setdefault((int(r.cik), int(r.fy)), r.sentence)
    for r in panel[panel.ai_core_count > 0].itertuples():
        k = (int(r.cik), int(r.fy))
        req.append((f"f:{k[0]}:{k[1]}", k[0], k[1], r.adsh, r.primary_doc_url,
                    first.get(k), True))

    # 2. every coded passage: the Passages view, and the quotations on Stories
    cp = out(A_CLAIMS, "coded_passages.csv")
    for r in cp.itertuples():
        req.append((f"p:{r.passage_id}", int(r.cik), int(r.fy), r.adsh,
                    r.primary_doc_url, r.sentence, False))

    # 3. each firm's use of a shared template, anchored on that firm's own wording
    mem = out(A_CONTAGION, "template_membership.csv")
    for r in mem.itertuples():
        k = (int(r.cik), int(r.fy))
        adsh, url = doc.get(k, (None, r.primary_doc_url))
        req.append((f"t:{int(r.template_id)}:{k[0]}:{k[1]}", k[0], k[1], adsh,
                    url, r.sentence, False))

    seen, uniq = set(), []
    for r in req:
        if r[0] not in seen:
            seen.add(r[0])
            uniq.append(r)
    return uniq


# ============================================================================
# THE DOCUMENTS
# ============================================================================
def cache_path(cik, fy, adsh):
    return CACHE / f"{int(cik)}_{int(fy)}_{adsh}.html.gz"


def fetch_missing(filings, refresh=False):
    """filings: {(cik, fy, adsh): url}"""
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(k, u) for k, u in filings.items()
            if refresh or not cache_path(*k).exists()
            or cache_path(*k).stat().st_size < 1000]
    if not todo:
        print(f"  every document already cached in {CACHE}")
        return 0
    print(f"  downloading {len(todo)} of {len(filings)} documents to {CACHE}",
          flush=True)
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"})
    failed = 0
    for i, (k, url) in enumerate(todo, 1):
        try:
            resp = s.get(url, timeout=240)
            resp.raise_for_status()
            with gzip.open(cache_path(*k), "wb") as fh:
                fh.write(resp.content)
        except Exception as e:                                    # noqa: BLE001
            failed += 1
            print(f"    FAILED {k}: {type(e).__name__} {e}", flush=True)
        time.sleep(RATE_SLEEP)
        if i % 25 == 0:
            print(f"    [{i}/{len(todo)}]", flush=True)
    return failed


def main():
    offline = "--offline" in sys.argv
    refresh = "--refresh" in sys.argv

    req = collect_requests()
    filings = {}
    for key, cik, fy, adsh, url, quote_, ai_only in req:
        if adsh and isinstance(url, str):
            filings[(int(cik), int(fy), adsh)] = url
    print(f"Deep links to verify: {len(req)} across {len(filings)} filings")
    for prefix, label in (("f:", "landing grid"), ("p:", "coded passages"),
                          ("t:", "template uses")):
        print(f"    {label:<16} {sum(k.startswith(prefix) for k, *_ in req)}")

    if not offline:
        fetch_missing(filings, refresh=refresh)

    by_filing = {}
    for r in req:
        by_filing.setdefault((int(r[1]), int(r[2]), r[3]), []).append(r)

    anchors, rows, t0 = {}, [], time.time()
    for i, (key3, group) in enumerate(sorted(by_filing.items(),
                                             key=lambda kv: str(kv[0])), 1):
        p = cache_path(*key3) if key3[2] else None
        blocks = folded = None
        if p is not None and p.exists():
            with gzip.open(p, "rb") as fh:
                blocks = block_texts(fh.read())
            folded = [fold(b) for b in blocks]
        for key, cik, fy, adsh, url, want, ai_only in group:
            if folded is None:
                rows.append({"key": key, "cik": cik, "fy": fy, "kind": "no-document",
                             "verified": 0, "n_matches": 0})
                continue
            frag, quote_, kind, hits = anchor_for(blocks, folded, want, ai_only)
            if frag:
                anchors[key] = {"f": frag, "q": quote_}
            # How close is the wording we anchored on to the wording the analysis
            # recorded? A link that verifies but sits on a different sentence is
            # the one failure this script could otherwise hide, so it is reported.
            ov = (overlap(words_of(want), quote_)
                  if isinstance(want, str) and want and quote_ else None)
            rows.append({"key": key, "cik": cik, "fy": fy, "kind": kind,
                         "verified": int(frag is not None), "n_matches": hits,
                         "overlap": ov})
        if i % 25 == 0:
            print(f"    {i}/{len(by_filing)} filings  ({time.time() - t0:.0f}s)",
                  flush=True)

    DATA.mkdir(exist_ok=True)
    path = DATA / "anchors.json"
    path.write_text(json.dumps(anchors, separators=(",", ":")), encoding="utf-8")

    d = pd.DataFrame(rows)
    ok = int(d.verified.sum())
    print(f"\n  anchors.json     {path.stat().st_size / 1024:.1f} KB")
    print(f"  verified         : {ok} / {len(d)}")
    for prefix, label in (("f:", "landing grid"), ("p:", "coded passages"),
                          ("t:", "template uses")):
        g = d[d.key.str.startswith(prefix)]
        print(f"    {label:<16} {int(g.verified.sum())} / {len(g)}")
    print(f"  unique in document: {int((d.n_matches == 1).sum())} "
          f"(the rest are the same sentence repeated in the filing)")
    print("\nBy anchor kind:")
    print(d.kind.value_counts().to_string())
    if ok < len(d):
        print("\nNo anchor for:")
        print(d[d.verified == 0][["key", "cik", "fy", "kind"]].to_string(index=False))


if __name__ == "__main__":
    main()
