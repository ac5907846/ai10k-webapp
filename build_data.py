"""Bake the analysis outputs into static JSON for the web app.

The app is published to GitHub Pages behind Cloudflare, so there is no backend and no
database: every number the site shows must be a file committed next to it. This script
is the only bridge between 02_analysis/ and the site, and it runs at build time.

Two rules it enforces:

  1. Nothing is recomputed here. Every value is read from an analysis output, so the
     site and the manuscript cannot disagree. If a number looks wrong, it is wrong in
     the analysis, and that is where it gets fixed.
  2. Everything carries its SEC source URL. A reader who does not believe a figure
     should be one click from the original filing on sec.gov.

Usage:  python build_data.py
Output: data/*.json
"""
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ANALYSIS = HERE.parent / "02_analysis"
RAW = HERE.parent / "01_raw_data"
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

# Analysis folders carry their figure numbers in the folder name, so the names are
# spelled out once here and never guessed at.
A_FILINGS = "01_filings_and_diffusion (fig 2, fig S3)"
A_FRAMING = "02_disclosure_framing (fig 3)"
A_FIRMS = "03_firm_profiles (fig S2)"
A_DETERM = "04_determinants"
A_CLAIMS = "05_ai_claim_coding (fig 4, fig 5, fig 9, fig S1)"
A_CONTAGION = "06_disclosure_contagion"
A_LANG = "08_language_over_time"
A_TRAJ = "11_firm_trajectories (fig 10)"

SEGMENTS = ["General building contractors", "Heavy construction",
            "Special trade contractors", "Engineering services"]

SECTION_LABEL = {"item1": "Item 1 Business", "item1a": "Item 1A Risk Factors",
                 "item7": "Item 7 MD&A", "item1b": "Item 1B/1C",
                 "item2": "Item 2 Properties", "item5": "Item 5 Market",
                 "item7a": "Item 7A Market Risk", "unsegmented": "Unsegmented"}


def out(analysis, name):
    return pd.read_csv(ANALYSIS / analysis / "outputs" / name)


def summ(analysis, name="summary.json"):
    return json.loads((ANALYSIS / analysis / "outputs" / name).read_text(encoding="utf-8"))


def clean(o):
    """JSON cannot hold NaN or Inf, and numpy scalars are not serialisable."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else round(float(o), 6)
    if isinstance(o, (np.bool_, bool)):
        return bool(o)
    if o is None:
        return None
    if isinstance(o, str):
        return o
    try:
        return None if pd.isna(o) else o
    except (TypeError, ValueError):
        return o


def write(name, obj):
    path = DATA / name
    path.write_text(json.dumps(clean(obj), separators=(",", ":")), encoding="utf-8")
    print(f"  {name:<20} {path.stat().st_size / 1024:8.1f} KB")


# ---------------------------------------------------------------- pretty names
NAME_FIX = {
    "HORTON D R INC /DE/": "D.R. Horton", "LENNAR CORP /NEW/": "Lennar",
    "PULTEGROUP INC/MI/": "PulteGroup", "JACOBS SOLUTIONS INC.": "Jacobs Solutions",
    "JACOBS ENGINEERING GROUP INC /DE/": "Jacobs Engineering", "KBR, INC.": "KBR",
    "MASTEC INC": "MasTec", "NVR INC": "NVR", "EMCOR GROUP, INC.": "EMCOR",
    "VSE CORP": "VSE", "MYR GROUP INC.": "MYR Group", "LGI HOMES, INC.": "LGI Homes",
    "M/I HOMES, INC.": "M/I Homes", "KB HOME": "KB Home", "TOPBUILD CORP": "TopBuild",
    "IES HOLDINGS, INC.": "IES Holdings", "GEO GROUP INC": "GEO Group",
    "CONNECTM TECHNOLOGY SOLUTIONS, INC.": "ConnectM",
    "SEKISUI HOUSE U.S., INC.": "Sekisui House US",
    "JFB CONSTRUCTION HOLDINGS": "JFB Construction",
    "SOLARMAX TECHNOLOGY, INC.": "SolarMax Technology",
}
_SUF = re.compile(r"[,\s]+(inc|corp|corporation|co|company|holdings|group|ltd|llc|plc)\.?$",
                  re.I)


def pretty(raw):
    if raw in NAME_FIX:
        return NAME_FIX[raw]
    s = re.sub(r"\s*/[A-Z]{2,3}/\s*$", "", str(raw)).strip().title()
    s = s.replace("Usa", "USA").replace("Us ", "US ")
    prev = None
    while prev != s:
        prev, s = s, _SUF.sub("", s).strip(" ,.")
    return s


def by_year(df, prefix_labels, year_col="fy"):
    """Turn a wide `pct_<label>` table into {years, labels, series, n} for the charts."""
    df = df.sort_values(year_col)
    keys = [k for k, _ in prefix_labels if f"pct_{k}" in df.columns]
    return {
        "years": df[year_col].astype(int).tolist(),
        "n": df.n_passages.astype(int).tolist() if "n_passages" in df else [],
        "labels": [lab for k, lab in prefix_labels if f"pct_{k}" in df.columns],
        "keys": keys,
        "series": {k: df[f"pct_{k}"].tolist() for k in keys},
        "counts": {k: df[f"n_{k}"].astype(int).tolist() for k in keys
                   if f"n_{k}" in df.columns},
    }


RISK_LABELS = [("cybersecurity", "Cybersecurity"), ("legal_reg", "Legal / regulatory"),
               ("competitive", "Competitive pressure"), ("data_quality", "Flawed output"),
               ("third_party", "Third-party AI"), ("reputational", "Reputational"),
               ("client_demand", "Client demand"), ("cost_investment", "Cost of investment"),
               ("intellectual_prop", "IP / confidentiality"),
               ("obsolescence", "Obsolescence"), ("workforce", "Workforce"),
               ("no_risk", "No risk named")]
TECH_LABELS = [("unspecified_ai", "Unspecified 'AI'"), ("machine_learning", "Machine learning"),
               ("generative_ai", "Generative AI"), ("data_analytics", "Data analytics"),
               ("robotics", "Robotics / drones"), ("computer_vision", "Computer vision")]
ACTOR_LABELS = [("own_firm", "The firm itself"), ("industry_general", "Industry in general"),
                ("competitors", "Competitors"), ("clients", "Clients / markets"),
                ("vendors", "Vendors"), ("regulators", "Regulators")]
VALENCE_LABELS = [("negative", "Negative"), ("neutral", "Neutral"), ("positive", "Positive")]
TIME_LABELS = [("current", "Current"), ("planned", "Planned"),
               ("hypothetical", "Hypothetical")]
CLAIM_LABELS = [("deployment", "Deployment"), ("exploration", "Exploration"),
                ("governance", "Governance"), ("exposure", "Risk / exposure"),
                ("other", "Other"), ("unclear", "Unclear")]


def main():
    print("Baking site data ...")

    d1, d2, d3 = summ(A_FILINGS), summ(A_FRAMING), summ(A_FIRMS)
    d4, d5 = summ(A_DETERM), summ(A_CLAIMS)
    d6, d8 = summ(A_CONTAGION), summ(A_LANG)
    val = summ(A_CLAIMS, "validation_summary.json")
    manifest = json.loads((RAW / "MANIFEST.json").read_text(encoding="utf-8"))

    # ------------------------------------------------------------ headline
    headline = {
        "filings": {
            "n_filings": d1["filings_total"], "firms_total": d1["firms_total"],
            "operating_filings": d1["operating_filings"], "firms": d1["firms_operating"],
            "fy_from": d1["fy_range"][0], "fy_to": d1["fy_range"][1],
            "frozen_utc": manifest.get("frozen_utc"),
            "archive_files": manifest.get("n_files"),
            "archive_mb": round(manifest.get("total_bytes", 0) / 1e6, 1),
            "segmentation_rate": d1["segmentation_success_rate"],
        },
        "adoption": {"fy2014": d1["adoption_2014"], "fy2022": d1["adoption_2022"],
                     "fy2025": d1["adoption_2025"],
                     "intensity_ratio": d1["intensity_ratio"],
                     "firms_ever": d1["firms_ever_adopting"],
                     "firms_late": d1["firms_first_adopting_2023_or_later"]},
        "intensity": {"fy2022": d1["intensity_2022"], "fy2025": d1["intensity_2025"]},
        "framing": {"risk_share_pre": d2["risk_share_pre_chatgpt"],
                    "risk_share_post": d2["risk_share_post_chatgpt"],
                    "risk_mentions_pre": d2["risk_mentions_pre"],
                    "risk_mentions_post": d2["risk_mentions_post"],
                    "opportunity_mentions_post": d2["opportunity_mentions_post"],
                    "pct_risk_only_2025": d2["pct_risk_only_2025"],
                    "pct_opportunity_only_2025": d2["pct_opportunity_only_2025"],
                    "firm_level_p": d2["primary_test_p"],
                    "paired_p": d2["paired_test_p"]},
        "profiles": {"n_firms": d3["n_firms"], "n_firm_years": d3["n_firm_years"],
                     "trajectories": d3["trajectory_counts"],
                     "top10_intensity": d3["top10_by_revenue_mean_intensity"],
                     "all_intensity": d3["all_firms_mean_intensity"]},
        "claims": {"n_passages": d5["n_passages"], "n_firms": d5["n_firms"],
                   "mix": d5["claim_mix"],
                   "pct_deployment": d5["pct_deployment"],
                   "pct_deployment_direct": val["pct_deployment_direct"],
                   "pct_deployment_direct_ci": val["pct_deployment_direct_ci"],
                   "pct_deployment_corrected": val["pct_deployment_corrected"],
                   "pct_exposure": d5["pct_exposure"],
                   "firms_claiming_deployment": d5["firms_claiming_deployment"],
                   "share_firms_claiming_deployment": d5["share_firms_claiming_deployment"],
                   "technology_mix": d5["technology_mix"],
                   "actor_mix": d5["actor_mix"],
                   "valence_mix": d5["valence_mix"],
                   "top_risk_types": d5["top_risk_types"],
                   "construction_specific_applications": d5["construction_specific_applications"],
                   "generic_applications": d5["generic_applications"]},
        "determinants": {"r2_year": d4["r2_year_only_ai_any"],
                         "r2_characteristics": d4["r2_characteristics_only_ai_any"],
                         "r2_segment": d4["r2_segment_only_ai_any"],
                         "r2_firm": d4["r2_firm_only_ai_any"],
                         "r2_gain": d4["r2_gain_from_characteristics_ai_any"]},
        "contagion": {"templates": d6["n_templates_spanning_2plus_firms"],
                      "pct_passages_templated": d6["pct_passages_in_shared_templates"],
                      "pct_firms_using_template": d6["pct_firms_using_a_shared_template"],
                      "verbatim_pairs": d6["n_verbatim_cross_firm_pairs"],
                      "largest_template_firms": d6["largest_template_n_firms"],
                      "n_passages": d6["n_passages"], "n_firms": d6["n_firms"]},
        "language": {"hedge_to_assert": d8["hedge_to_assert_by_period"],
                     "pct_with_number": d8["pct_with_number_by_period"],
                     "mean_words": d8["mean_words_by_period"],
                     "top_terms_early": d8["top_terms_early"],
                     "top_terms_2025": d8["top_terms_FY2025"]},
        "validation": {"kappa_6class": val["headline_kappa_6class"],
                       "kappa_binary": val["headline_kappa_deployment_binary"],
                       "raw_agreement": val["headline_raw_agreement"],
                       "n_coded": val["n_random_block"],
                       "n_total_coded": val["n_human_coded"],
                       "observed_deployment": val["pct_deployment_observed"],
                       "corrected_deployment": val["pct_deployment_corrected"],
                       "direct_deployment": val["pct_deployment_direct"],
                       "direct_deployment_ci": val["pct_deployment_direct_ci"],
                       "direct_exposure": val["pct_exposure_direct"],
                       "coders": d5["claim_coders"]},
        "built_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    write("headline.json", headline)

    # ------------------------------------------------------------ time series
    y = out(A_FILINGS, "yearly_adoption.csv")
    y = y[y["sample"] == "operating"].sort_values("fy")
    seg = out(A_FILINGS, "by_segment_year.csv")
    cum = out(A_FILINGS, "cumulative_adoption.csv").sort_values("fy")
    claim = out(A_CLAIMS, "claim_by_year.csv").sort_values("fy")
    cov = out(A_CLAIMS, "sample_coverage.csv").sort_values("fy")
    fyl = out(A_FIRMS, "firm_year_long.csv")
    fram = out(A_FRAMING, "framing_yearly.csv").sort_values("fy")
    theme = out(A_CLAIMS, "firm_theme_profile.csv")

    dep_by_year = (out(A_CLAIMS, "coded_passages.csv")
                   .query("is_operating == 1 and claim == 'DEPLOYMENT'")
                   .groupby("fy").cik.nunique())

    series = {
        "years": y.fy.astype(int).tolist(),
        "adoption": y.pct_any_ai.tolist(),
        "adoption_lo": y.pct_any_ai_lo.tolist(),
        "adoption_hi": y.pct_any_ai_hi.tolist(),
        "intensity": y.mean_intensity.tolist(),
        "n_firms": y.n_firms.astype(int).tolist(),
        "cumulative": {"years": cum.fy.astype(int).tolist(),
                       "pct": cum.cum_pct_ever_disclosed.tolist()},
        "by_segment": {s: {"years": seg[seg.sic_band == s].fy.astype(int).tolist(),
                           "adoption": seg[seg.sic_band == s].pct_any_ai.tolist(),
                           "intensity": seg[seg.sic_band == s].mean_intensity.tolist()}
                       for s in SEGMENTS},
        "claim_mix": by_year(claim, CLAIM_LABELS),
        "framing": {"years": fram.fy.astype(int).tolist(),
                    "item1": fram.item1_mentions.astype(int).tolist(),
                    "item7": fram.item7_mentions.astype(int).tolist(),
                    "item1a": fram.item1a_mentions.astype(int).tolist(),
                    "risk_share": fram.risk_share_pooled.tolist(),
                    "pct_risk_only": fram.pct_risk_only.tolist(),
                    "pct_opportunity_only": fram.pct_opportunity_only.tolist(),
                    "pct_both": fram.pct_both.tolist()},
        "talk_vs_action": {
            "years": cov.fy.astype(int).tolist(),
            "n_operating": cov.n_operating.astype(int).tolist(),
            "pct_mentioning": (cov.n_with_ai_passage / cov.n_operating).tolist(),
            "pct_deploying": [float(dep_by_year.get(int(f), 0)) / int(n) if n else 0
                              for f, n in zip(cov.fy, cov.n_operating)]},
    }
    write("series.json", series)

    # ------------------------------------------------------------ themes
    # The thematic coding is the part of the study a reader is most likely to want to
    # slice, so every dimension ships by year, by segment and by 10-K section.
    def dim(stub, labels):
        block = {"by_year": by_year(out(A_CLAIMS, f"{stub}_by_year.csv"), labels)}
        for cut, col in [("by_segment", "sic_band"), ("by_section", "section")]:
            df = out(A_CLAIMS, f"{stub}_{cut}.csv")
            key = col if col in df.columns else df.columns[0]
            block[cut] = {
                "groups": [SECTION_LABEL.get(v, v) for v in df[key].tolist()],
                "n": df.n_passages.astype(int).tolist() if "n_passages" in df else [],
                "keys": [k for k, _ in labels if f"pct_{k}" in df.columns],
                "labels": [lab for k, lab in labels if f"pct_{k}" in df.columns],
                "series": {k: df[f"pct_{k}"].tolist() for k, _ in labels
                           if f"pct_{k}" in df.columns},
            }
        return block

    themes = {
        "claim": dim("claim", CLAIM_LABELS),
        "risk_type": dim("risk_type", RISK_LABELS),
        "technology": dim("technology", TECH_LABELS),
        "actor": dim("actor", ACTOR_LABELS),
        "time_frame": dim("time_frame", TIME_LABELS),
        "valence": dim("valence", VALENCE_LABELS),
        "risk_totals": out(A_CLAIMS, "risk_type_totals.csv").to_dict("records"),
        "applications": out(A_CLAIMS, "application_distribution.csv").to_dict("records"),
        "reliability": out(A_CLAIMS, "reliability_by_dimension.csv").to_dict("records"),
        "validation": out(A_CLAIMS, "validation_agreement.csv").to_dict("records"),
        "confusion": out(A_CLAIMS, "validation_confusion.csv").to_dict("records"),
        "firm_profiles": [{**r, "name": pretty(r["name"])}
                          for r in theme.to_dict("records")],
        "labels": {"risk_type": dict(RISK_LABELS), "technology": dict(TECH_LABELS),
                   "actor": dict(ACTOR_LABELS), "valence": dict(VALENCE_LABELS),
                   "time_frame": dict(TIME_LABELS), "claim": dict(CLAIM_LABELS)},
    }
    write("themes.json", themes)

    # ------------------------------------------------------------ language
    dist = out(A_LANG, "distinctive_terms_by_period.csv")
    stance_y = out(A_LANG, "stance_markers_by_year.csv").sort_values("fy")
    stance_p = out(A_LANG, "stance_markers_by_period.csv")
    diffusion = out(A_LANG, "term_diffusion.csv")
    secmix = out(A_LANG, "section_mix_by_year.csv")

    NOISE = {"keen", "labs", "through", "due", "uses"}
    periods = stance_p.period.tolist()
    language = {
        "periods": periods,
        "gloss": {"FY2014-2022": "technical capability", "FY2023": "security threat",
                  "FY2024": "vendor and liability", "FY2025": "regulatory compliance"},
        "distinctive": {p: dist[(dist.period == p) & (~dist.term.isin(NOISE))]
                              .nlargest(18, "z")[["term", "z", "count_focal", "count_rest"]]
                              .to_dict("records") for p in periods},
        "stance_by_year": {"years": stance_y.fy.astype(int).tolist(),
                           "hedge": stance_y.hedge_per_100w.tolist(),
                           "assert": stance_y.assert_per_100w.tolist(),
                           "ratio": stance_y.hedge_to_assert.tolist(),
                           "mean_words": stance_y.mean_words.tolist(),
                           "pct_number": stance_y.pct_with_number.tolist(),
                           "n": stance_y.n_passages.astype(int).tolist()},
        "stance_by_period": stance_p.to_dict("records"),
        "diffusion": diffusion.dropna(subset=["first_year"]).to_dict("records"),
        "section_mix": secmix.to_dict("records"),
    }
    write("language.json", language)

    # ------------------------------------------------------------ firms
    fm = out(A_FIRMS, "firm_master.csv")
    deploy_by_firm = theme.set_index("cik").claims_deployment.to_dict()
    passages_by_firm = theme.set_index("cik").n_passages.to_dict()

    per_firm_years = {}
    for cik, g in fyl.sort_values("fy").groupby("cik"):
        per_firm_years[int(cik)] = {
            "fy": g.fy.astype(int).tolist(),
            "intensity": g.ai_intensity.round(3).tolist(),
            "mentions": g.ai_core_count.astype(int).tolist(),
            "risk": g.ai_item1a.astype(int).tolist(),
            "opp": (g.ai_item1 + g.ai_item7).astype(int).tolist(),
            "revenue": g.revenue.tolist(),
            "url": g.primary_doc_url.tolist(),
        }
    firms = []
    for r in fm.itertuples():
        firms.append({
            "cik": int(r.cik), "name": pretty(r.name), "legal_name": r.name,
            "segment": r.sic_band, "sic": r.sic, "state": r.state, "city": r.city,
            "revenue": r.max_revenue, "assets": r.max_assets,
            "years": int(r.years_observed),
            "first_ai_year": None if pd.isna(r.first_ai_year) else int(r.first_ai_year),
            "trajectory": r.trajectory,
            "intensity": r.ai_intensity_recent, "mentions": int(r.ai_core_recent),
            "risk_share": r.risk_share_recent,
            "risk": int(r.risk_mentions_recent), "opp": int(r.opportunity_mentions_recent),
            "deploys": int(deploy_by_firm.get(int(r.cik), 0) or 0),
            "n_passages": int(passages_by_firm.get(int(r.cik), 0) or 0),
            "edgar": r.company_edgar_url, "latest_filing": r.latest_filing_url,
            "ts": per_firm_years.get(int(r.cik), {}),
        })
    write("firms.json", firms)

    # ------------------------------------------------------------ passages
    p = pd.read_csv(ANALYSIS / A_CLAIMS / "outputs" / "coded_passages.csv",
                    keep_default_na=False, na_values=[""])
    passages = [{
        "id": r.passage_id, "cik": int(r.cik), "firm": pretty(r["name"]),
        "fy": int(r.fy), "segment": r.sic_band,
        "section": SECTION_LABEL.get(r.section, r.section),
        "operating": int(r.is_operating),
        "claim": r.claim, "application": r.application, "specificity": r.specificity,
        "risk_type": r.risk_type, "technology": r.technology, "actor": r.actor,
        "time_frame": r.time_frame, "valence": r.valence,
        "agree": int(r.claim_n_agree) if str(r.claim_n_agree).strip() else 0,
        "models": {"qwen": r.claim_qwen, "phi4": r.claim_phi4,
                   "ministral": r.claim_ministral},
        "text": r.sentence, "before": r.context_before, "after": r.context_after,
        "url": r.primary_doc_url,
    } for _, r in p.iterrows()]
    write("passages.json", passages)

    # ------------------------------------------------------------ templates
    tpl = out(A_CONTAGION, "templates.csv")
    mem = out(A_CONTAGION, "template_membership.csv")
    templates = []
    for r in tpl.itertuples():
        g = mem[mem.template_id == r.template_id]
        templates.append({
            "id": int(r.template_id), "n_firms": int(r.n_firms),
            "n_passages": int(r.n_passages),
            "first_year": int(r.first_year), "last_year": int(r.last_year),
            "segments": r.segments.split("|") if isinstance(r.segments, str) else [],
            "text": r.exemplar,
            "uses": [{"firm": pretty(u.name), "cik": int(u.cik), "fy": int(u.fy),
                      "section": SECTION_LABEL.get(u.section, u.section),
                      "url": u.primary_doc_url} for u in g.itertuples()],
        })
    templates.sort(key=lambda t: (-t["n_firms"], -t["n_passages"]))
    write("templates.json", templates)


    # ------------------------------------------------------------ stories
    cp = out(A_CLAIMS, "coded_passages.csv")
    ctot = out(A_CLAIMS, "concern_locus_totals.csv")
    cq = out(A_CLAIMS, "concern_quotes.csv").merge(
        cp[["passage_id", "primary_doc_url"]], on="passage_id", how="left")
    LOCUS_NAME = {"THREAT_ACTORS": "Threat actors", "REGULATORS": "Regulators",
                  "COMPETITORS": "Competitors", "VENDORS": "Vendors and providers",
                  "CLIENTS": "Client industries",
                  "CAPITAL_MARKETS": "Capital markets",
                  "OWN": "The reporting firm itself"}
    concern = {
        "base": int(ctot.n.sum()),
        "outward": int(ctot.n.sum()) - int(ctot.loc[ctot.locus == "OWN", "n"].iloc[0]),
        "loci": [{"key": r.locus, "name": LOCUS_NAME[r.locus], "n": int(r.n),
                  "n_firms": int(r.n_firms), "share": float(r.share)}
                 for r in ctot.itertuples()],
        "quotes": [{"key": r.locus, "firm": pretty(r.firm), "fy": int(r.fy),
                    "quote": r.quote, "url": r.primary_doc_url,
                    "pid": r.passage_id}
                   for r in cq.itertuples()],
    }

    traj = out(A_TRAJ, "trajectories.csv")
    ms = out(A_TRAJ, "milestones.csv")
    TRAJ_NAME = {"MISTRAS": ("Mistras Group", "testing services"),
                 "JACOBS": ("Jacobs", "engineering services"),
                 "KBR": ("KBR", "engineering and government services"),
                 "FLUOR": ("Fluor", "engineering and construction"),
                 "AECOM": ("AECOM", "engineering services"),
                 "QUANTA": ("Quanta Services", "infrastructure services"),
                 "KBHOME": ("KB Home", "homebuilding"),
                 "TAYMOR": ("Taylor Morrison", "homebuilding")}
    TRAJ_ORDER = ["MISTRAS", "JACOBS", "KBR", "FLUOR", "AECOM", "QUANTA",
                  "KBHOME", "TAYMOR"]
    trajectories = {
        "firms": [{"key": k, "name": TRAJ_NAME[k][0], "sub": TRAJ_NAME[k][1],
                   "years": [{"fy": int(r.fy), "cap": int(r.n_cap),
                              "risk": int(r.n_risk), "unseg": int(r.n_unsegmented)}
                             for r in traj[traj.firm == k].sort_values("fy").itertuples()]}
                  for k in TRAJ_ORDER],
        "milestones": [{"key": r.firm, "firm": TRAJ_NAME[r.firm][0],
                        "fy": int(r.fy), "side": r.side,
                        "label": " ".join(str(r.label).split())}
                       for r in ms.itertuples()],
    }

    def boundary_row(firm_kw, fy, kw, start, position, reading):
        hit = cp[cp.name.str.contains(firm_kw, case=False) & (cp.fy == fy)
                 & cp.sentence.str.contains(kw, case=False, regex=False)]
        r = hit.iloc[0]
        q = " ".join(str(r.sentence).split())
        if start and start in q:
            q = q[q.index(start):]
        if len(q) > 300:
            q = q[:297].rsplit(" ", 1)[0] + " ..."
        return {"firm": pretty(r["name"]), "fy": int(fy), "position": position,
                "quote": q, "reading": reading, "url": r.primary_doc_url,
                "pid": r.passage_id}

    boundary = [
        boundary_row("SOLARMAX", 2024, "does not use and is not dependent",
                     "Our business", "States that it does not use AI",
                     "The panel's only negative disclosure, filed two years "
                     "running. When non-use itself is disclosed, the expectation "
                     "to address AI has become general."),
        boundary_row("JFB", 2025, "combine with XTEND", None,
                     "Exits construction for AI",
                     "The outermost strategic response: an all-stock combination "
                     "with an AI robotics company, after which the firm is to be "
                     "renamed XTEND AI Robotics."),
        boundary_row("CONNECTM", 2025, "30 gigabytes", None,
                     "Smallest firm, most quantified claims",
                     "Most of the sector's numerical AI claims come from one "
                     "micro-cap. Claim specificity does not scale with firm size."),
        boundary_row("ARGAN", 2024, "DeepSeek", None,
                     "Names a specific AI model",
                     "The only filing that names a frontier model, and the stated "
                     "concern is AI efficiency moderating electricity demand."),
        boundary_row("MISTRAS", 2025, "market participants", None,
                     "Attends to readers' AI",
                     "The disclosure considers how AI tools will read the "
                     "disclosure itself, extending the imagined audience of the "
                     "10-K to machines."),
        boundary_row("LENNAR", 2025, "future of employment", None,
                     "Routes AI through housing demand",
                     "One of only two passages linking AI to employment, and the "
                     "channel is customer confidence rather than the firm's own "
                     "workforce."),
    ]
    write("stories.json", {"concern": concern, "trajectories": trajectories,
                           "boundary": boundary})

    # ------------------------------------------------------------ inventory
    # One cell per firm-year for the landing grid. EDGAR URLs are rebuilt in the
    # browser from the accession number and the primary document filename, which
    # keeps this file about half the size of one carrying the URLs in full.
    pan = out(A_FILINGS, "panel_all_filings.csv")
    pan = pan[pan.cik.isin(set(pan[pan.is_operating == 1].cik))].copy()
    pan["doc"] = pan.primary_doc_url.str.rsplit("/", n=1).str[-1]
    pan["pname"] = pan.name.map(pretty)

    inv_segments = []
    for seg in SEGMENTS:
        block = pan[pan.sic_band == seg]
        if block.empty:
            continue
        firms_out = []
        for cik, g in block.groupby("cik"):
            g = g.sort_values("fy")
            ops = g[g.is_operating == 1]
            firms_out.append({
                "cik": int(cik), "name": g.pname.iloc[-1],
                "state": None if pd.isna(g.state.iloc[-1]) else g.state.iloc[-1],
                "filings": int(len(ops)), "words": int(ops.n_words.sum()),
                "mentions": int(ops.ai_core_count.sum()),
                "first_ai": (None if ops[ops.ai_core_count > 0].empty
                             else int(ops[ops.ai_core_count > 0].fy.min())),
                "cells": [{"fy": int(r.fy), "n": int(r.ai_core_count),
                           "op": int(r.is_operating), "w": int(r.n_words),
                           "a": r.adsh, "d": r.doc} for r in g.itertuples()],
            })
        firms_out.sort(key=lambda f: f["name"].upper())
        inv_segments.append({"name": seg, "firms": firms_out})

    write("inventory.json", {
        "years": list(range(int(pan.fy.min()), int(pan.fy.max()) + 1)),
        "segments": inv_segments,
        "totals": {"filings": int((pan.is_operating == 1).sum()),
                   "firms": int(pan[pan.is_operating == 1].cik.nunique()),
                   "words": int(pan.loc[pan.is_operating == 1, "n_words"].sum()),
                   "excluded": int((pan.is_operating == 0).sum())},
    })

    # ------------------------------------------------------------ tables
    write("tables.json", {
        "leaders": out(A_FIRMS, "table_leaders.csv")
                     .assign(name=lambda d: d.name.map(pretty)).to_dict("records"),
        "silent": out(A_FIRMS, "table_silent_giants.csv")
                    .assign(name=lambda d: d.name.map(pretty)).to_dict("records"),
        "trajectories": out(A_FIRMS, "trajectory_classes.csv").to_dict("records"),
        "variance": out(A_DETERM, "variance_decomposition.csv").to_dict("records"),
        "regression": out(A_DETERM, "reg_main.csv").to_dict("records"),
        "logit": out(A_DETERM, "reg_logit.csv").to_dict("records"),
        "framing_tests": out(A_FRAMING, "framing_tests_by_unit.csv").to_dict("records"),
        "within_vs_cross": out(A_CONTAGION, "within_vs_cross.csv").to_dict("records"),
        "connectivity": out(A_CONTAGION, "firm_connectivity.csv")
                          .assign(firm=lambda d: d["firm"].map(pretty))
                          .to_dict("records"),
        "terms": out(A_FILINGS, "term_frequency_year.csv")
                   .groupby(["term", "group"], as_index=False)
                   .agg(total_hits=("total_hits", "sum"),
                        n_firms=("n_firms_using", "max"))
                   .sort_values("total_hits", ascending=False).to_dict("records"),
    })

    total = sum(f.stat().st_size for f in DATA.glob("*.json"))
    print(f"\nDone. {len(list(DATA.glob('*.json')))} files, {total / 1024:.0f} KB total")


if __name__ == "__main__":
    main()
