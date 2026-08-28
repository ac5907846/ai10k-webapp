# Web app: AI in Construction

A static site presenting the study: the diffusion result, the firm-level record, every
coded passage, and the disclosure-template finding. Built for GitHub Pages behind a
Cloudflare custom domain.

## Running it locally

`fetch` is blocked on `file://` URLs, so opening `index.html` by double-clicking will
show a load error with instructions. Serve the folder instead:

```bash
cd 04_web_app
python -m http.server 8765
# then open http://localhost:8765
```

## Rebuilding the data

```bash
python build_data.py
```

Reads `02_analysis/*/outputs/` and writes `data/*.json` (~1.7 MB total). Run it after any
analysis re-run, then commit the `data/` folder, it is the site's entire backend.

There is a second build step, kept separate because it is the one thing here that needs
the network:

```bash
python build_anchors.py         # writes data/anchors.json
```

It re-reads the filing HTML from EDGAR (cached under `~/.cache`, outside the project) and
writes a verified scroll-to-text anchor for every deep link on the site. Re-run it when
the panel or the coded passages change.

`build_data.py` **never recomputes a statistic**. Every value is copied from an analysis
output, so the site and the manuscript cannot disagree. If a number here looks wrong, it
is wrong in the analysis, and that is where to fix it.

## Deploying

The site is plain HTML, CSS, JS and JSON with no build step and no dependencies.

1. Push this folder to a repository (or a `docs/` folder in one).
2. Settings → Pages → deploy from that branch/folder.
3. Point the Cloudflare CNAME at `<user>.github.io` and set the custom domain in Pages.

Fonts load from Google Fonts; everything else is local. If you would rather have no
external requests at all, drop the two `<link>` tags in `index.html`, the CSS already
falls back to system fonts.

## Structure

```
index.html          markup and copy for all nine views
css/style.css       design tokens, components. Light mode only.
js/charts.js        SVG chart engine (line, stacked bar, grouped bar, barsH, sparkline)
js/app.js           routing, views, search, firm lookup
data/*.json         baked at build time
build_data.py       the numbers: the only bridge from 02_analysis to this folder
build_anchors.py    the links: a verified deep link into the filing behind every quotation
```

### Why hand-rolled charts

No build step, no CDN, and, most importantly, the manuscript figures use a specific
colour palette validated for colour-vision deficiency and print contrast
(`02_analysis/common/validate_palette.py`). A charting library's defaults would quietly
override it, and the site would stop matching the paper. The charts read their colours
from CSS custom properties, so the paper palette is defined in exactly one place.

## The nine views

In nav order, which follows the paper's argument: the evidence base, the headline
findings, what the language claims, the mechanism, how the writing changed, the
full-read findings, then the reference views and the method. There is no map view:
the paper reads geography narrowly (headquarters is corporate domicile, not
construction activity), and a state-level AI map would invite exactly the reading
the paper declines to make.

| View | What it does |
|---|---|
| **Filings** | the landing grid: one cell per firm-year across FY2014-2025, coloured by how much AI language that annual report carries, every cell a link to the 10-K on sec.gov |
| **Overview** | headline statistics, diffusion curve, framing, talk-vs-action gap, variance decomposition |
| **Themes** | the seven-dimension LLM coding: risk themes, technologies, actors, sliceable by section, segment and year |
| **Templates** | the shared-wording finding: which firms use identical sentences, and when each first filed them |
| **Words** | distinctive vocabulary by period, section and segment, with hedging statistics |
| **Stories** | the full-read findings: whose AI the risk language attends to, eight firm trajectories FY2015-2025, and the six boundary firm-years quoted verbatim |
| **Firms** | all 106 firms, sortable and filterable; click through to a year-by-year record and every source filing |
| **Language** | all 692 coded passages, full-text searchable, filterable by claim type, section and year |
| **Method** | how it was measured, what validation changed, and what the study cannot tell you |

## Every number links to its source

`firms.json` and `passages.json` carry the EDGAR document URL for each observation, and
the UI surfaces it everywhere: the landing grid, firm rows, passage cards, template
chips. A reader who doubts a figure is one click from the original filing on sec.gov.
That is the point of using disclosure data, and the site would be much weaker without it.

`inventory.json` stores the accession number and the primary document filename rather
than the URL, and `secDoc()` in `app.js` rebuilds the address. All 719 filings follow
`/Archives/edgar/data/<cik>/<accession without dashes>/<document>` with no exceptions,
and the file is about half the size for it. The text fragment to append to that address
comes from `anchors.json`, which also carries the sentence it lands on, so the grid can
show it on hover and a reader can see what they are about to open.

### Every quotation opens the filing at the sentence

The site does not merely link to a 10-K, it links *into* it, using a
[text fragment](https://wicg.github.io/scroll-to-text-fragment/): `#:~:text=<opening
words>,<closing words>` makes the browser scroll to that wording and highlight it on
arrival. Supported in Chrome, Edge, Safari 16.1+ and Firefox 131+; older browsers ignore
the fragment and open the document at the top, so this never costs the reader the link.

**Every one of those anchors is pre-verified, not built in the browser.** `build_anchors.py`
writes `data/anchors.json`, keyed so each link surface can find its own:

| Key | Surface |
|---|---|
| `f:<cik>:<fy>` | a square on the landing grid, at that filing's first AI sentence |
| `p:<passage_id>` | a coded passage, on Passages and behind the quotations on Stories |
| `t:<id>:<cik>:<fy>` | one firm's use of a shared disclosure template |

**924 anchors, 924 verified**, covering all 899 links the site actually renders. The
script re-reads the filing HTML from EDGAR, cuts the anchor from the document's own
characters, and then verifies it by replaying the browser's matching rules over that same
HTML. An anchor that does not verify is not written, and the link falls back to
`textFragment()` in `app.js` and then to the bare URL: the reader loses the scroll, never
the document.

Verifying matters because four properties of the matcher are invisible until a link
silently opens 300 pages of 10-K at page one:

- **an anchor cut from the extracted text is not an anchor cut from the document.** The
  frozen archive holds text stripped out of the HTML, which inserts a space at every tag
  boundary and mangles the typographic quotes and dashes;
- **a match may not cross a block boundary.** The browser searches one block box at a
  time, and eight consecutive words of extracted text routinely straddle two `<div>`s;
- **the browser stops at the first match in the document.** Wording that also appears in
  the contents page or a running header lands the reader in the wrong place;
- **a private-use glyph is invisible to the matcher.** A word-processor bullet reaches
  filing HTML as U+F0B7, a Wingdings character that renders as a bullet and sits at the
  front of exactly the list items a 10-K puts its AI disclosure in. Real bullets, U+2022,
  match perfectly well.

The verification is a model of the browser, so it was checked against one: **58 links
were clicked in Chrome across all four surfaces**, and the scroll position and highlight
read back from the live page. That is how the private-use rule was found, the replay
having passed an anchor Chrome would not match. With it, all 58 land on the sentence the
site quotes. The sample deliberately covers every unusual character any anchor carries
(® ™ – — ‑ ' " •), the two oldest HTML generations in the panel, and each link that was
broken before.

For the record, the same replay over the landing grid *before* it had verified anchors:
of 148 AI squares, 126 landed on AI wording, 13 landed somewhere unrelated and 9 opened
at page one. The 13 were the worst case, because a link that opens the right document at
the wrong paragraph looks like the site inventing a claim.

## Verifying a change

There is no test runner, but three checks catch most breakage:

```bash
node --check js/app.js && node --check js/charts.js && echo "syntax ok"
python -c "import json,glob; [json.load(open(f,encoding='utf-8')) for f in glob.glob('data/*.json')]; print('json ok')"
python build_anchors.py --offline      # re-verifies every deep link from the cached HTML
```

`build_anchors.py --offline` is the important one after any change to the passages or the
panel: it prints `verified: N / N` and names every link it could not anchor. It needs no
network once the filing HTML is cached.

Two failures throw no error and simply produce something wrong:

- an array-length mismatch between a chart's labels and its values, which draws the wrong
  thing. When changing a chart, check the series lengths against the axis explicitly;
- a deep link whose wording no longer matches the filing, which opens the 10-K at page one
  or, worse, at the wrong paragraph. That is what `build_anchors.py` exists to prevent, so
  never hand-edit `data/anchors.json`, and never widen the anchor rules without re-running
  the verification.
