"""Bake data/sentences.json for the review panel.

One entry per filing ("cik:fy"), listing EVERY AI sentence of that filing as
[section, sentence] in the order of analysis 01's ai_sentences.csv. That same
order indexes the s:<cik>:<fy>:<i> anchors built by build_anchors.py, so the
two files agree by construction: sentences.json[i] is exactly the sentence
the s:...:i anchor was verified against.

Set AI10K_ANALYSIS to the project's 02_analysis folder when this repo is not
checked out inside the project. Run:  python build_sentences.py
"""
import json
import os
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ANALYSIS = Path(os.environ.get("AI10K_ANALYSIS", HERE.parent / "02_analysis"))
A_FILINGS = "01_filings_and_diffusion (fig 2, fig S3)"


def main():
    s = pd.read_csv(ANALYSIS / A_FILINGS / "outputs" / "ai_sentences.csv")
    out = {}
    for r in s.itertuples():
        out.setdefault(f"{int(r.cik)}:{int(r.fy)}", []).append(
            [r.section, r.sentence])
    dest = HERE / "data" / "sentences.json"
    dest.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False),
                    encoding="utf-8")
    print(f"sentences.json  {dest.stat().st_size / 1024:.1f} KB")
    print(f"  {len(s)} sentences across {len(out)} filings "
          f"(max per filing: {max(len(v) for v in out.values())})")


if __name__ == "__main__":
    main()
