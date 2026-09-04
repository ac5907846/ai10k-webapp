/* ============================================================================
   AI in Construction: application logic.

   All data is baked to static JSON at build time (see build_data.py); there is no
   backend. Nothing here recomputes a statistic: every number rendered comes from
   an analysis output, so the site cannot disagree with the manuscript.
   ========================================================================= */
(function () {
  'use strict';

  const C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const DATA = {};

  const SEG_COLOR = {
    'General building contractors': '--c1',
    'Heavy construction': '--c2',
    'Special trade contractors': '--c3',
    'Engineering services': '--c4',
  };
  // Claim colours and textures follow Figure 4 of the manuscript: deployment
  // is solid green, exploration blue diagonal hatch, governance green
  // crosshatch, exposure red dots, residual categories grey.
  const CLAIM_COLOR = {
    DEPLOYMENT: '--c2', EXPLORATION: '--c1', GOVERNANCE: '--c2',
    EXPOSURE: '--risk', OTHER: '--neutral', UNCLEAR: '--neutral', NO_MAJORITY: '--neutral',
  };
  const CLAIM_PAT = {
    DEPLOYMENT: 'solid', EXPLORATION: 'hatch', GOVERNANCE: 'cross',
    EXPOSURE: 'dots', OTHER: 'solid', UNCLEAR: 'solid', NO_MAJORITY: 'solid',
  };

  const pct = (v, d) => v === null || v === undefined ? '·' : (v * 100).toFixed(d === undefined ? 0 : d) + '%';
  const num = (v, d) => {
    if (v === null || v === undefined || isNaN(v)) return '·';
    let t = Number(v).toFixed(d === undefined ? 2 : d);
    return t.replace(/^(-?)0\./, '$1.');        // 0.65 -> .65, keeping the sign
  };
  const money = (v) => {
    if (v === null || v === undefined || isNaN(v)) return '·';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'bn';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'm';
    return '$' + Math.round(v).toLocaleString();
  };
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|\s|\/)\w/g, c => c.toUpperCase());

  // ------------------------------------------------------ links into a filing
  // A text fragment makes the browser scroll to the passage inside the 10-K and
  // highlight it on arrival. The anchors are cut from runs of plain ASCII words:
  // a fragment matches literally, and the typographic quotes and dashes in the
  // filings do not survive text extraction intact. Where the wording cannot be
  // matched the browser simply opens the filing at the top, so this never costs
  // the reader the link itself.
  const ORPHAN = /^(s|re|ve|ll|d|t|m)$/i;      // what an apostrophe leaves behind

  function textFragment(text) {
    const runs = String(text || '').split(/[^A-Za-z0-9 ]+/)
      .map(r => {
        const w = r.split(/\s+/).filter(Boolean);
        // "We're" splits to "We" and "re"; a bare "re" is not a word to the
        // browser's matcher, so an anchor that starts on one never matches
        while (w.length && ORPHAN.test(w[0])) w.shift();
        return w;
      })
      .filter(w => w.length >= 4);
    if (!runs.length) return '';
    const enc = (w) => encodeURIComponent(w.join(' '));
    const first = runs[0], last = runs[runs.length - 1];
    // the end anchor is searched for after the start anchor, so the two must not
    // overlap: with a single clean run short enough for them to collide, anchor
    // on the opening words alone and let the browser highlight those
    const parts = [first === last && first.length < 17
      ? enc(first.slice(0, 10))
      : enc(first.slice(0, 8)) + ',' + enc(last.slice(-8))];
    // a second directive anchored mid-passage. An anchor has to sit inside one
    // HTML block to match, and it is the opening words that a section heading or
    // a page marker most often splits off, so this one catches what that misses.
    const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
    if (longest.length >= 12) {
      const from = Math.max(1, Math.floor(longest.length / 2) - 4);
      parts.push(enc(longest.slice(from, from + 8)));
    }
    return '#:~:text=' + parts.join('&text=');
  }
  const filingLink = (url, text) => url ? esc(url + textFragment(text)) : '';
  const secDoc = (cik, adsh, doc) =>
    'https://www.sec.gov/Archives/edgar/data/' + cik + '/' +
    String(adsh).replace(/-/g, '') + '/' + doc;

  // A verified anchor, baked by build_anchors.py: the wording is cut from the
  // filing's own HTML and then checked by replaying the browser's matching rules
  // over it, so the link is known to land on the sentence rather than believed to.
  // textFragment() above is the fallback for anything not in the file, and the
  // bare URL is the fallback for that.
  const anchorOf = (key) => (DATA.anchors && DATA.anchors[key]) || null;
  const deepLink = (url, key, text) => {
    if (!url) return '';
    const a = anchorOf(key);
    return a ? esc(url + a.f) : filingLink(url, text);
  };
  const clip = (s, n) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, s.lastIndexOf(' ', n)).replace(/[ ,;:]+$/, '') + '…';
  };

  // ---------------------------------------------------------------- theme
  // ---------------------------------------------------------------- routing
  function show(view) {
    // a stale bookmark (e.g. the removed map view) lands on the front page
    if (!$('#view-' + view)) view = 'filings';
    $$('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    // entering the site keeps a clean URL: the hash is only written when the
    // visitor navigates, or already arrived with one
    if ((location.hash || view !== 'filings')
        && location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    C.hideTip();
    window.scrollTo({ top: 0, behavior: 'instant' });
    render(view);
  }

  // ================================================================ overview
  function renderOverview() {
    const H = DATA.headline, S = DATA.series;

    $('#h-filings').textContent = H.filings.n_filings.toLocaleString();
    $('#h-firms').textContent = H.filings.firms;
    $('#h-from').textContent = 'FY' + H.filings.fy_from;
    $('#h-to').textContent = 'FY' + H.filings.fy_to;
    $('#h-kappa').textContent = num(H.validation.kappa_6class, 2);
    $('#h-r2y').textContent = num(H.determinants.r2_year, 2);
    $('#h-r2c').textContent = num(H.determinants.r2_characteristics, 2);
    $('#h-r2s').textContent = num(H.determinants.r2_segment, 2);

    $('#stats').innerHTML = [
      { v: pct(H.adoption.fy2025), k: 'of firms mentioned AI in FY2025<br><small>up from ' +
           pct(H.adoption.fy2014, 1) + ' in FY2014</small>', cls: 'accent' },
      { v: pct(H.claims.pct_deployment, 1),
        k: 'of AI passages claim actual deployment<br><small>' +
           pct(H.claims.pct_deployment_direct, 1) +
           ' in the hand-coded random sample</small>', cls: 'good' },
      // the firm-year mean, not the pooled share of mentions: one firm with a long AI
      // risk factor must not stand for the sector. Pooled, it is 3.8% and 71.3%.
      { v: pct(H.framing.risk_share_post),
        k: "of the average firm-year's located AI mentions sit in Risk Factors" +
           '<br><small>up from ' + pct(H.framing.risk_share_pre) +
           ' before ChatGPT</small>', cls: 'risk' },
      { v: H.claims.firms_claiming_deployment + ' of ' + H.filings.firms,
        k: 'firms have ever claimed to deploy AI<br><small>in twelve years of annual reports</small>', cls: 'risk' },
    ].map(s => `<div class="stat ${s.cls}"><div class="v">${s.v}</div><div class="k">${s.k}</div></div>`).join('');

    // adoption, whole sector plus segments
    C.lineChart($('#c-adoption'), {
      years: S.years, height: 320, ymax: 1, breakAt: 2023,
      yFmt: v => (v * 100).toFixed(0) + '%', yLabel: 'Firms disclosing AI',
      tipFmt: (v, yr) => pct(v, 1) + ' of firms',
      bands: [{ lo: S.adoption_lo, hi: S.adoption_hi, color: '--neutral' }],
      series: [
        ...Object.keys(S.by_segment).map(seg => ({
          name: seg.replace(' contractors', ''), color: SEG_COLOR[seg],
          values: S.years.map(y => {
            const i = S.by_segment[seg].years.indexOf(y);
            return i < 0 ? null : S.by_segment[seg].adoption[i];
          }), width: 1.6, dot: 2.6, opacity: .85,
        })),
        { name: 'All firms', color: '--ink', values: S.adoption, width: 3, dot: 4 },
      ],
    });

    // where the mentions sit
    C.groupedBar($('#c-framing'), {
      height: 290, yLabel: 'AI mentions',
      labels: S.framing.years.filter(y => y >= 2019),
      series: [
        { name: 'Opportunity (Items 1 & 7)', color: '--opportunity', pat: 'hatch',
          values: S.framing.years.map((y, i) => y >= 2019 ? S.framing.item1[i] + S.framing.item7[i] : null).filter(v => v !== null) },
        { name: 'Risk (Item 1A)', color: '--risk', pat: 'dots',
          values: S.framing.years.map((y, i) => y >= 2019 ? S.framing.item1a[i] : null).filter(v => v !== null) },
      ],
    });

    // talk versus action
    const T = S.talk_vs_action;
    const keep = T.years.map((y, i) => y >= 2017 ? i : -1).filter(i => i >= 0);
    C.lineChart($('#c-gap'), {
      years: keep.map(i => T.years[i]), height: 290, ymax: 1, breakAt: 2023,
      yFmt: v => (v * 100).toFixed(0) + '%', yLabel: 'Share of firms',
      tipFmt: v => pct(v, 1),
      series: [
        { name: 'Mentions AI', color: '--c1', values: keep.map(i => T.pct_mentioning[i]) },
        { name: 'Claims to deploy AI', color: '--c3', values: keep.map(i => T.pct_deploying[i]) },
      ],
    });

    // what the language says
    const M = S.claim_mix, MS = M.series;
    const idx = M.years.map((y, i) => y >= 2021 ? i : -1).filter(i => i >= 0);
    C.stackedBar($('#c-claims'), {
      height: 320, yLabel: 'Share of AI passages',
      categories: idx, labels: idx.map(i => 'FY' + M.years[i]),
      counts: idx.map(i => M.n[i]),
      series: [
        { name: 'Deployment', color: '--c2', pat: 'solid', values: idx.map(i => MS.deployment[i]) },
        { name: 'Exploration', color: '--c1', pat: 'hatch', values: idx.map(i => MS.exploration[i]) },
        { name: 'Governance', color: '--c2', pat: 'cross', values: idx.map(i => MS.governance[i]) },
        { name: 'Risk / exposure', color: '--risk', pat: 'dots', values: idx.map(i => MS.exposure[i]) },
        // Residual, not just the OTHER category: passages the three models could not
        // agree a majority on are real passages, and a 100%-stacked bar that stops at
        // 94% silently hides them.
        { name: 'Other / unresolved', color: '--neutral', pat: 'solid',
          values: idx.map(i => Math.max(0, 1 - (MS.deployment[i] + MS.exploration[i] +
                                                MS.governance[i] + MS.exposure[i]))) },
      ],
    });

    // variance decomposition
    const V = DATA.tables.variance;
    const label = {
      'segment only': 'Industry segment only',
      'firm characteristics only': 'Firm characteristics only',
      'firm only': 'Firm identity (105 dummies)',
      'year only': 'Calendar year (11 dummies)',
      'year + characteristics': 'Year + firm characteristics',
      'year + firm': 'Year + firm identity',
    };
    const order = ['segment only', 'firm characteristics only', 'firm only',
                   'year only', 'year + characteristics', 'year + firm'];
    C.barsH($('#c-variance'), {
      labelW: 220, rowH: 30,
      items: order.map(k => {
        const row = V.find(r => r.specification === k) || {};
        const isYear = k.indexOf('year') === 0;
        return { label: label[k], value: row.r2 || 0, display: num(row.r2, 3),
                 color: isYear ? '--accent' : '--neutral',
                 tip: `R² = ${num(row.r2, 3)} · ${row.df_model} parameters` };
      }),
    });
  }

  // ================================================================ filings
  // The landing grid: one cell per firm-year, every cell a link to that 10-K on
  // sec.gov. This is the whole evidence base on one screen, so a reader can see
  // the panel rather than take its description on trust.
  const iState = { q: '', seg: '', ai: false };

  function invLevel(c) {
    if (!c.op) return 'x';                       // filed, outside the operating screen
    if (c.n === 0) return '0';
    if (c.n <= 4) return '1';
    if (c.n <= 14) return '2';
    return '3';
  }

  function renderFilings() {
    const INV = DATA.inventory, H = DATA.headline;
    if (!$('#inv-seg').options.length) {
      INV.segments.forEach(s => $('#inv-seg').add(new Option(s.name, s.name)));
      $('#inv-seg').insertBefore(new Option('All segments', ''), $('#inv-seg').firstChild);
      $('#inv-seg').value = '';
      $('#inv-search').addEventListener('input', e => {
        iState.q = e.target.value.trim().toLowerCase(); drawInventory();
      });
      $('#inv-seg').addEventListener('change', e => { iState.seg = e.target.value; drawInventory(); });
      $('#inv-ai').addEventListener('change', e => { iState.ai = e.target.checked; drawInventory(); });
      $('#inv-grid').addEventListener('mousemove', e => {
        const cell = e.target.closest('[data-tip]');
        if (cell) C.showTip(cell.dataset.tip, e); else C.hideTip();
      });
      $('#inv-grid').addEventListener('mouseleave', () => C.hideTip());
      $('#inv-grid').addEventListener('click', e => {
        const nm = e.target.closest('.inv-name');
        if (!nm) return;
        C.hideTip();
        show('firms');
        openFirm(Number(nm.dataset.cik));
      });
    }
    $('#inv-filings').textContent = num(INV.totals.filings, 0);
    $('#inv-firms').textContent = INV.totals.firms;
    $('#inv-words').textContent = (INV.totals.words / 1e6).toFixed(1) + 'M';
    $('#inv-span').textContent = 'FY' + INV.years[0] + '–' + INV.years[INV.years.length - 1];
    $('#inv-frozen').textContent = String(H.filings.frozen_utc || '').slice(0, 10);
    drawInventory();
  }

  function drawInventory() {
    const INV = DATA.inventory, years = INV.years;
    // A square for a filing that carries AI language opens the 10-K at that
    // sentence rather than at the top of the document. The anchor is not built
    // here: `c.f` is baked by ai_anchors.py, which cuts the wording from the
    // filing's own HTML and then verifies it by replaying the browser's matching
    // rules. Deriving one in the browser from the extracted text cannot be
    // verified, and an anchor that silently fails to match is a link that opens
    // 300 pages of 10-K at page one.
    const head = '<div class="inv-row inv-head"><span></span>' +
      years.map(y => `<span class="yh">'${String(y).slice(2)}</span>`).join('') +
      '<span class="yh">AI</span></div>';

    let shown = 0, cells = 0;
    const body = INV.segments.map(seg => {
      if (iState.seg && seg.name !== iState.seg) return '';
      const firms = seg.firms.filter(f =>
        (!iState.q || f.name.toLowerCase().includes(iState.q) ||
         (f.state || '').toLowerCase() === iState.q) &&
        (!iState.ai || f.mentions > 0));
      if (!firms.length) return '';
      shown += firms.length;
      const rows = firms.map(f => {
        const byYear = {};
        f.cells.forEach(c => byYear[c.fy] = c);
        const cs = years.map(y => {
          const c = byYear[y];
          if (!c) return '<span class="inv-cell blank"></span>';
          cells += 1;
          const lv = invLevel(c);
          const what = !c.op ? 'outside the operating screen that year'
            : c.n === 0 ? 'no AI language'
            : c.n + ' core AI term' + (c.n === 1 ? '' : 's');
          const url = secDoc(f.cik, c.a, c.d);
          const a = anchorOf('f:' + f.cik + ':' + y);
          const tip = `<b>${esc(f.name)}</b>, FY${y}<br>${what}, ` +
            `${num(c.w / 1000, 0)}k words` +
            (a ? `<q>${esc(clip(a.q, 190))}</q>` : '') +
            (c.n > 0 ? '<i>click to review its AI sentences</i>'
                     : '<i>click to open the 10-K on sec.gov</i>');
          return `<a class="inv-cell lv-${lv}" target="_blank" rel="noopener"
             href="${a ? esc(url + a.f) : esc(url)}" data-tip="${esc(tip)}"
             data-cik="${f.cik}" data-fy="${y}" data-n="${c.n}"
             data-name="${esc(f.name)}"
             aria-label="${esc(f.name)} FY${y}, ${esc(what)}"></a>`;
        }).join('');
        return `<div class="inv-row">
          <button class="inv-name" data-cik="${f.cik}" title="See this firm's record">${esc(f.name)}</button>
          ${cs}<span class="inv-tot${f.mentions ? '' : ' zero'}">${f.mentions || '·'}</span>
        </div>`;
      }).join('');
      return `<div class="inv-seg">${esc(seg.name)}
        <span>${firms.length} firm${firms.length === 1 ? '' : 's'}</span></div>${rows}`;
    }).join('');

    $('#inv-grid').innerHTML = head + (body ||
      '<p class="note" style="border:0">No firm matches that search.</p>');
    $('#inv-count').textContent = shown + ' firms, ' + cells + ' filings shown';
  }

  // ================================================================ review panel
  /* Ported from the papers 2-3 sites: click a filing cell with AI language
     and, instead of jumping straight into the 10-K, a panel lists EVERY AI
     sentence of that filing, each with its own verified deep link. Two-tone
     highlight: the sentence sits on its own soft ground, the AI terms pop. */
  const SEC_LABEL = { item1: 'Item 1 · Business', item1a: 'Item 1A · Risk Factors',
    item1b: 'Item 1B', item2: 'Item 2 · Properties', item3: 'Item 3 · Legal',
    item5: 'Item 5 · Market', item7: 'Item 7 · MD&A', item7a: 'Item 7A',
    item8: 'Item 8', item9a: 'Item 9A', full: 'unsegmented', unsegmented: 'unsegmented' };
  const AI_RX = new RegExp(
    ['artificial[\\s-]+intelligence', 'machine[\\s-]+learning',
     'deep[\\s-]+learning', 'neural[\\s-]+network(?:s)?',
     'natural[\\s-]+language[\\s-]+processing', 'computer[\\s-]+vision',
     'predictive[\\s-]+analytics', 'generative[\\s-]*AI',
     'large[\\s-]+language[\\s-]+model(?:s)?', 'foundation[\\s-]+model(?:s)?',
     '\\bLLMs?\\b', '\\bChatGPT\\b', '\\bOpenAI\\b', 'chat\\s?bots?',
     'A\\.I\\.', '\\bAI\\b', '\\bAGI\\b', '\\bNLP\\b',
     '\\bGPT-?[3-5o]?\\b'].join('|'), 'gi');
  const hlKw = (s) => esc(s).replace(AI_RX, m => `<mark class="kw">${m}</mark>`);

  let SENTS = null;
  async function sentencesAll() {
    if (!SENTS) {
      SENTS = await fetch('data/sentences.json')
        .then(r => r.ok ? r.json() : {}).catch(() => ({}));
    }
    return SENTS;
  }
  function closeModal() {
    const m = $('.modal-back');
    if (m) m.remove();
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }

  async function openReview(cell) {
    const cik = cell.dataset.cik, fy = cell.dataset.fy;
    const name = cell.dataset.name, n = cell.dataset.n;
    const docUrl = cell.href.split('#')[0];
    const sents = (await sentencesAll())[`${cik}:${fy}`] || [];
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML =
      `<div class="modal" role="dialog" aria-label="AI sentences in this filing">
        <div class="modal-head">
          <h3>${esc(name)} · FY${fy}</h3>
          <span class="m-meta">${sents.length} AI sentence${sents.length === 1 ? '' : 's'} ·
            ${n} core term hit${n === '1' ? '' : 's'}</span>
          <a class="modal-open" target="_blank" rel="noopener" href="${esc(cell.href)}">Open the 10-K ↗</a>
          <button class="modal-x" aria-label="Close">×</button>
        </div>
        <div class="modal-body">` +
      (sents.length ? sents.map(([sec, s], i) => {
        const a = anchorOf(`s:${cik}:${fy}:${i}`);
        return `<div class="m-sent"><div class="m-txt">${hlKw(s)}</div>
          <div class="m-foot"><span>${SEC_LABEL[sec] || esc(sec)}</span>
          <a target="_blank" rel="noopener" href="${esc(docUrl + (a ? a.f : ''))}">
            open at this sentence${a ? '' : ' (top of document)'} ↗</a></div></div>`;
      }).join('')
        : `<p class="m-note">The ${esc(n)} AI term hit${n === '1' ? '' : 's'} in this
           filing sit inside passages longer than the study's sentence bounds,
           so no clean sentence could be extracted. Open the 10-K to read them
           in place.</p>`) +
      `<p class="m-note">Every link opens the original filing on sec.gov; where a
        verified anchor exists the browser scrolls to the sentence and highlights
        it.</p></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('.modal-x')) closeModal();
    });
    document.addEventListener('keydown', escClose);
  }

  // ================================================================ firms
  const fState = { sort: 'mentions', dir: -1, open: null };

  function renderFirms() {
    const segSel = $('#f-segment'), trajSel = $('#f-traj');
    if (segSel.options.length === 1) {
      [...new Set(DATA.firms.map(f => f.segment))].filter(Boolean).sort()
        .forEach(s => segSel.add(new Option(s, s)));
      [...new Set(DATA.firms.map(f => f.trajectory))].filter(Boolean).sort()
        .forEach(t => trajSel.add(new Option(titleCase(t), t)));
      ['#f-search', '#f-segment', '#f-traj', '#f-deploy']
        .forEach(s => $(s).addEventListener('input', drawFirms));
      $$('#f-table th').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort;
        fState.dir = fState.sort === k ? -fState.dir : (k === 'name' || k === 'segment' ? 1 : -1);
        fState.sort = k; drawFirms();
      }));
    }
    drawFirms();
  }

  function firmRows() {
    const q = $('#f-search').value.trim().toLowerCase();
    const seg = $('#f-segment').value, traj = $('#f-traj').value;
    const depOnly = $('#f-deploy').checked;
    let rows = DATA.firms.filter(f =>
      (!q || f.name.toLowerCase().includes(q) || (f.legal_name || '').toLowerCase().includes(q)) &&
      (!seg || f.segment === seg) && (!traj || f.trajectory === traj) &&
      (!depOnly || f.deploys));
    const k = fState.sort;
    rows.sort((a, b) => {
      let x = a[k], y = b[k];
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === 'string') return fState.dir * x.localeCompare(y);
      return fState.dir * (x - y);
    });
    return rows;
  }

  function drawFirms() {
    const rows = firmRows();
    $('#f-count').textContent = `${rows.length} of ${DATA.firms.length} firms`;
    $$('#f-table th').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === fState.sort);
      th.classList.toggle('asc', th.dataset.sort === fState.sort && fState.dir === 1);
    });
    const maxInt = Math.max(...DATA.firms.map(f => f.intensity || 0));
    $('#f-table tbody').innerHTML = rows.map(f => `
      <tr data-cik="${f.cik}" class="${fState.open === f.cik ? 'open' : ''}">
        <td><span class="seg-dot" style="background:${C.css(SEG_COLOR[f.segment] || '--neutral')}"></span>${esc(f.name)}</td>
        <td>${esc((f.segment || '').replace(' contractors', ''))}</td>
        <td class="num">${money(f.revenue)}</td>
        <td class="num">${f.mentions}</td>
        <td class="num"><div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
          <span>${num(f.intensity)}</span>
          <span class="bar" style="width:52px"><span style="width:${Math.min(100, (f.intensity || 0) / maxInt * 100)}%"></span></span></div></td>
        <td class="num">${f.risk_share === null ? '·' :
          `<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
            <span>${pct(f.risk_share)}</span>
            <span class="bar risky" style="width:52px"><span style="width:${f.risk_share * 100}%"></span></span></div>`}</td>
        <td class="num">${f.first_ai_year || '·'}</td>
        <td class="num"><span class="pill ${f.deploys ? 'yes' : 'no'}">${f.deploys ? 'Yes' : 'No'}</span></td>
      </tr>`).join('');
    $$('#f-table tbody tr').forEach(tr => tr.addEventListener('click', () => openFirm(+tr.dataset.cik)));
    if (fState.open && !rows.some(r => r.cik === fState.open)) { fState.open = null; $('#f-detail').hidden = true; }
  }

  function openFirm(cik) {
    const f = DATA.firms.find(x => x.cik === cik);
    if (!f) return;
    fState.open = cik;
    const ts = f.ts || {};
    const years = ts.fy || [];
    const passages = DATA.passages.filter(p => p.cik === cik)
      .sort((a, b) => b.fy - a.fy || a.claim.localeCompare(b.claim));
    // a year claims deployment when one of its passages was coded DEPLOYMENT
    const deployYears = new Set(passages.filter(p => p.claim === 'DEPLOYMENT').map(p => p.fy));

    const rowsHtml = years.map((y, i) => `
      <tr>
        <td class="num">FY${y}</td>
        <td class="num">${ts.mentions[i]}</td>
        <td class="num">${num(ts.intensity[i])}</td>
        <td class="num">${ts.opp[i]}</td>
        <td class="num">${ts.risk[i]}</td>
        <td class="num">${deployYears.has(y) ? '<span class="pill yes">Yes</span>' : ''}</td>
        <td>${ts.url[i] ? `<a href="${esc(ts.url[i])}" target="_blank" rel="noopener">10-K ↗</a>` : '·'}</td>
      </tr>`).join('');

    $('#f-detail').hidden = false;
    $('#f-detail').innerHTML = `
      <h3>${esc(f.name)}</h3>
      <div class="meta">
        ${esc(f.segment)} · SIC ${f.sic} · ${esc(f.state || 'n/a')} ·
        revenue ${money(f.revenue)} · observed FY${years[0]}–FY${years[years.length - 1]} ·
        <a href="${esc(f.edgar)}" target="_blank" rel="noopener">all filings on EDGAR ↗</a>
      </div>
      <div class="kv">
        <div><div class="k">AI mentions FY2024–25</div><div class="v">${f.mentions}</div></div>
        <div><div class="k">Intensity per 10k words</div><div class="v">${num(f.intensity)}</div></div>
        <div><div class="k">Risk framing</div><div class="v">${pct(f.risk_share)}</div></div>
        <div><div class="k">First mentioned AI</div><div class="v">${f.first_ai_year || 'never'}</div></div>
        <div><div class="k">Claims deployment</div><div class="v">${f.deploys ? 'Yes' : 'No'}</div></div>
      </div>
      <div style="margin:6px 0 18px">${C.spark(ts.intensity || [], { w: 260, h: 40 })}
        <div style="font-size:12px;color:var(--ink-3);margin-top:4px">AI intensity, FY${years[0]}–FY${years[years.length - 1]}</div></div>
      <div class="tablewrap"><table class="data"><thead><tr>
        <th class="num">Year</th><th class="num">Mentions</th><th class="num">Intensity</th>
        <th class="num">Opportunity</th><th class="num">Risk</th><th class="num">Deploys</th><th>Source</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
      ${passages.length ? `<h2 style="margin:24px 0 10px">What ${esc(f.name)} actually wrote (${passages.length})</h2>
        <div class="passages">${passages.slice(0, 40).map(p => passageHtml(p)).join('')}</div>
        ${passages.length > 40 ? `<p class="note">Showing 40 of ${passages.length}. Use the Language tab to see all.</p>` : ''}`
        : '<p class="note">This firm never mentions AI in any annual report in the sample.</p>'}
    `;
    drawFirms();
    $('#f-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ================================================================ language
  const lState = { limit: 40 };

  function passageHtml(p, q) {
    const cls = (p.claim || 'other').toLowerCase();
    const hl = (t) => {
      if (!q) return esc(t);
      return esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
                            '<mark>$1</mark>');
    };
    const agree = p.agree >= 3 ? 'all three models agreed'
      : `models split: ${Object.entries(p.models).filter(([, v]) => v)
            .map(([k, v]) => k + '→' + v).join(', ')}`;
    return `<div class="passage ${cls}">
      <div class="head">
        <span class="firm">${esc(p.firm)}</span>
        <span>FY${p.fy}</span><span>·</span><span>${esc(p.section)}</span>
        <span class="tag ${cls}">${esc(p.claim || '·')}</span>
      </div>
      ${p.before ? `<div class="ctx">…${hl(String(p.before).slice(-150))}</div>` : ''}
      <div class="txt">${hl(p.text)}</div>
      ${p.after ? `<div class="ctx">${hl(String(p.after).slice(0, 150))}…</div>` : ''}
      <div class="foot">
        ${p.application && p.application !== 'NO_APPLICATION'
          ? `<span>Area: <strong>${esc(titleCase(p.application.replace(/_/g, ' ')))}</strong></span>` : ''}
        <span>${agree}</span>
        ${p.url ? `<a href="${deepLink(p.url, 'p:' + p.id, p.text)}" target="_blank" rel="noopener"
            title="Opens the 10-K on sec.gov and scrolls to this passage">Read it in the 10-K ↗</a>` : ''}
      </div></div>`;
  }

  function renderLanguage() {
    const claimSel = $('#l-claim'), secSel = $('#l-section'), yrSel = $('#l-year');
    if (claimSel.options.length === 1) {
      [...new Set(DATA.passages.map(p => p.claim))].filter(Boolean).sort()
        .forEach(c => claimSel.add(new Option(titleCase(c), c)));
      [...new Set(DATA.passages.map(p => p.section))].filter(Boolean).sort()
        .forEach(s => secSel.add(new Option(s, s)));
      [...new Set(DATA.passages.map(p => p.fy))].sort((a, b) => b - a)
        .forEach(y => yrSel.add(new Option('FY' + y, y)));
      ['#l-search', '#l-claim', '#l-section', '#l-year'].forEach(s =>
        $(s).addEventListener('input', () => { lState.limit = 40; drawLanguage(); }));
      $('#l-more').addEventListener('click', () => { lState.limit += 60; drawLanguage(); });
      $('#l-legend').innerHTML = ['DEPLOYMENT', 'EXPLORATION', 'GOVERNANCE', 'EXPOSURE', 'OTHER']
        .map(c => `<span><i class="legend" style="display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;background:${C.swatchCSS(CLAIM_PAT[c], CLAIM_COLOR[c])};box-shadow:inset 0 0 0 1px ${C.css(CLAIM_COLOR[c])}"></i>${titleCase(c)}</span>`)
        .join('');
      $('#l-total').textContent = DATA.passages.length;
    }
    drawLanguage();
  }

  function drawLanguage() {
    const q = $('#l-search').value.trim();
    const cl = $('#l-claim').value, sec = $('#l-section').value, yr = $('#l-year').value;
    const rows = DATA.passages.filter(p =>
      (!q || (p.text + ' ' + p.firm).toLowerCase().includes(q.toLowerCase())) &&
      (!cl || p.claim === cl) && (!sec || p.section === sec) && (!yr || p.fy === +yr));
    $('#l-count').textContent = `${rows.length} passage${rows.length === 1 ? '' : 's'}`;
    $('#l-list').innerHTML = rows.slice(0, lState.limit).map(p => passageHtml(p, q)).join('')
      || '<p class="note">Nothing matches those filters.</p>';
    $('#l-more').hidden = rows.length <= lState.limit;
  }

  // ================================================================ templates
  function renderTemplates() {
    const H = DATA.headline.contagion;
    $('#t-count').textContent = H.templates;
    $('#t-pct').textContent = pct(H.pct_passages_templated, 1);
    $('#t-verbatim').textContent = H.verbatim_pairs;

    const list = DATA.templates.filter(t => t.n_firms >= 2)
      .sort((a, b) => b.n_firms - a.n_firms || b.n_passages - a.n_passages);
    $('#t-list').innerHTML = list.map(t => {
      const firstByFirm = {};
      t.uses.forEach(u => {
        if (!firstByFirm[u.firm] || u.fy < firstByFirm[u.firm].fy) firstByFirm[u.firm] = u;
      });
      const chips = Object.values(firstByFirm).sort((a, b) => a.fy - b.fy || a.firm.localeCompare(b.firm))
        .map(u => `<a class="firmchip"
                      href="${deepLink(u.url, `t:${t.id}:${u.cik}:${u.fy}`, t.text)}" target="_blank"
                      rel="noopener"
                      title="Opens ${esc(u.firm)}'s FY${u.fy} 10-K at this same sentence">
                     <b>${esc(u.firm)}</b><span class="yr">FY${u.fy}</span></a>`).join('');
      return `<div class="template">
        <div class="tmeta">
          <span><strong>${t.n_firms}</strong> firms</span>
          <span>${t.n_passages} filings</span>
          <span>FY${t.first_year}–FY${t.last_year}</span>
          <span>${t.segments.map(s => esc(s.replace(' contractors', ''))).join(', ')}</span>
        </div>
        <blockquote class="q">${esc(t.text)}</blockquote>
        <div class="firms">${chips}</div>
      </div>`;
    }).join('');
  }

  // ================================================================ themes
  // Colour order is positional, following the label order baked in themes.json.
  // The claim dimension mirrors Figure 4 of the manuscript, textures included.
  const DIM_COLOR = {
    claim: ['--c2', '--c1', '--c2', '--risk', '--neutral', '--neutral'],
    risk_type: ['--c1', '--c2', '--c3', '--c4', '--neutral', '--risk',
                '--s2', '--s4', '--s1', '--s3', '--s5', '--line-2'],
    technology: ['--neutral', '--c2', '--c4', '--c1', '--c3', '--risk'],
    actor: ['--c1', '--neutral', '--risk', '--c2', '--c3', '--c4'],
    valence: ['--risk', '--neutral', '--c1'],
    time_frame: ['--c1', '--c2', '--c3'],
  };
  const DIM_PAT = {
    claim: ['solid', 'hatch', 'cross', 'dots', 'solid', 'solid'],
  };

  function renderThemes() {
    const T = DATA.themes, H = DATA.headline;
    $('#th-n').textContent = H.claims.n_passages.toLocaleString();
    $('#th-firms').textContent = H.claims.n_firms;

    // headline tiles: the four numbers that carry the argument
    const tiles = [
      { v: pct(H.claims.pct_deployment, 1), k: 'claim actual deployment',
        s: 'hand-coded random sample: ' + pct(H.claims.pct_deployment_direct, 1) },
      { v: pct(H.claims.pct_exposure, 1), k: 'describe exposure, not action',
        s: 'AI as something happening to the firm' },
      { v: pct(H.claims.technology_mix.UNSPECIFIED_AI, 1), k: 'name no technology',
        s: 'no model, method or product identified' },
      { v: pct(H.claims.valence_mix.NEGATIVE, 1), k: 'are negative in tone',
        s: 'against ' + pct(H.claims.valence_mix.POSITIVE, 1) + ' positive' },
    ];
    $('#th-stats').innerHTML = tiles.map(t =>
      `<div class="stat"><div class="v">${t.v}</div><div class="k">${t.k}</div>
       <div class="s">${t.s}</div></div>`).join('');

    // risk totals, technology and actor: three compact charts sharing one row
    const RL = T.labels.risk_type;
    const rt = T.risk_totals.slice().sort((a, b) => b.n - a.n)
      .filter(r => r.risk_type !== 'NO_RISK');
    C.barsH($('#c-risktot'), {
      w: 430, labelW: 150, rowH: 25,
      items: rt.map(r => ({
        label: RL[r.risk_type.toLowerCase()] || titleCase(r.risk_type.replace(/_/g, ' ')),
        value: r.n, color: '--risk', tip: r.n + ' passages',
      })),
    });

    // technology and actor over time
    const MIN_N = 20;
    stackByYear($('#c-tech'), T.technology.by_year, DIM_COLOR.technology, MIN_N, 430);
    stackByYear($('#c-actor'), T.actor.by_year, DIM_COLOR.actor, MIN_N, 430);

    // the slicer
    const drawDim = () => {
      const dim = $('#th-dim').value, cut = $('#th-cut').value;
      const block = T[dim][cut];
      const cols = DIM_COLOR[dim] || ['--c1', '--c2', '--c3', '--c4', '--neutral'];
      const pats = DIM_PAT[dim];
      const host = $('#c-dim'); host.innerHTML = '';
      const cats = cut === 'by_year' ? block.years.map(y => 'FY' + y) : block.groups;
      const n = block.n || [];
      C.stackedBar(host, {
        categories: cats.map((_, i) => i), labels: cats,
        series: block.keys.map((k, i) => ({
          name: block.labels[i], color: cols[i % cols.length],
          pat: pats ? pats[i % pats.length] : undefined,
          values: block.series[k],
        })),
        counts: n,
      });
      $('#th-note').textContent = n.reduce((a, b) => a + b, 0) + ' passages';
    };
    $('#th-dim').onchange = drawDim;
    $('#th-cut').onchange = drawDim;
    drawDim();

    // reliability
    const DL = { claim: 'What it claims', risk_type: 'Risk theme',
                 technology: 'Technology named', actor: 'Whose AI',
                 time_frame: 'Time frame', valence: 'Tone' };
    const kq = (k) => k >= .61 ? 'yes' : k >= .41 ? 'mid' : 'no';
    const kw = (k) => k >= .61 ? 'substantial' : k >= .41 ? 'moderate' : 'fair or lower';
    $('#th-rel').innerHTML = `<div class="tablewrap"><table class="data"><thead><tr>
      <th>Dimension</th><th class="num">Passages</th><th class="num">All three agree</th>
      <th class="num">Fleiss kappa</th><th>Reading</th></tr></thead><tbody>
      ${T.reliability.map(r => `<tr>
        <td>${esc(DL[r.dimension] || r.dimension)}</td>
        <td class="num">${r.n_compared}</td>
        <td class="num">${pct(r.pct_unanimous, 1)}</td>
        <td class="num">${num(r.fleiss_kappa, 3)}</td>
        <td><span class="pill ${kq(r.fleiss_kappa)}">${kw(r.fleiss_kappa)}</span></td>
      </tr>`).join('')}</tbody></table></div>`;

    const hv = (T.validation || []).filter(v => v.block === 'A_random');
    const mv = hv.find(v => v.model === 'majority vote');
    $('#th-relnote').innerHTML = mv ? `Against a blind human coding of ${mv.n} randomly
      drawn passages, the majority vote agrees ${pct(mv.raw_agreement, 1)} of the time
      (kappa ${num(mv.kappa_6class, 2)}). The disagreement is systematic: the models
      under-call deployment, reading present-tense capability statements as aspiration.
      In the hand-coded random sample, which needs no correction because it is a random
      draw, deployment is ${pct(H.validation.direct_deployment, 1)}
      (95% CI ${pct(H.validation.direct_deployment_ci[0], 1)} to
      ${pct(H.validation.direct_deployment_ci[1], 1)}) against
      ${pct(H.validation.observed_deployment, 1)} from the models. Both are low. Time
      frame is the one dimension the coders do not agree on well enough to carry a
      claim, and it is shown here only for completeness.` : '';
  }

  function stackByYear(host, block, cols, minN, w) {
    host.innerHTML = '';
    const keep = block.years
      .map((y, i) => (!minN || (block.n[i] || 0) >= minN) ? i : -1)
      .filter(i => i >= 0);
    C.stackedBar(host, {
      w,
      categories: keep.map((_, i) => i),
      labels: keep.map(i => 'FY' + block.years[i]),
      series: block.keys.map((k, i) => ({
        name: block.labels[i], color: cols[i % cols.length],
        values: keep.map(j => block.series[k][j]),
      })),
      counts: keep.map(i => block.n[i]),
    });
  }

  // ================================================================ words
  const PERIOD_COLOR = { 'FY2014-2022': '--c2', FY2023: '--c1', FY2024: '--c3', FY2025: '--risk' };

  const TERM_LABEL = { ai_abbrev: 'AI (as an acronym)', generative_ai: 'generative AI',
                       iot_sensor: 'IoT sensor', digital_twin: 'digital twin' };
  const prettyTerm = (t) => TERM_LABEL[t] || t.replace(/_/g, ' ');

  function renderWords() {
    const L = DATA.language;

    $('#w-periods').innerHTML = L.periods.map(p => {
      const st = L.stance_by_period.find(s => s.period === p) || {};
      const terms = (L.distinctive[p] || []).slice(0, 12);
      const zmax = Math.max(...terms.map(t => t.z), 1);
      return `<div class="period">
        <div class="phead" style="color:${C.css(PERIOD_COLOR[p])}">${esc(p)}</div>
        <div class="pgloss">${esc(L.gloss[p] || '')}</div>
        <div class="pterms">${terms.map(t =>
          `<span style="font-size:${(11 + 7 * t.z / zmax).toFixed(1)}px"
             title="${t.count_focal} uses in this period, ${t.count_rest} in the others"
             >${esc(t.term)}</span>`).join('')}</div>
        <div class="pfoot">
          <span><b>${num(st.hedge_to_assert, 2)}</b> hedge / assert</span>
          <span><b>${num(st.mean_words, 0)}</b> words</span>
          <span><b>${pct(st.pct_with_number, 1)}</b> carry a number</span>
          <span><b>${st.n_passages}</b> passages</span>
        </div></div>`;
    }).join('');

    const S = L.stance_by_year;
    const keep = S.years.map((y, i) => S.n[i] >= 5 ? i : -1).filter(i => i >= 0);
    const pick = (arr) => keep.map(i => arr[i]);
    C.lineChart($('#c-stance'), {
      years: pick(S.years), height: 280, yLabel: 'per 100 words',
      series: [
        { name: 'Hedging words', color: '--risk', values: pick(S.hedge) },
        { name: 'Assertive words', color: '--c1', values: pick(S.assert) },
      ],
      breakAt: 2023, yFmt: v => v.toFixed(1),
      tipFmt: (v) => v.toFixed(2) + ' per 100 words',
    });

    C.lineChart($('#c-concrete'), {
      years: pick(S.years), height: 280, yLabel: 'words per passage',
      series: [{ name: 'Mean words per passage', color: '--c4', values: pick(S.mean_words) }],
      breakAt: 2023, yFmt: v => v.toFixed(0),
      tipFmt: (v, yr) => {
        const i = S.years.indexOf(yr);
        return v.toFixed(0) + ' words<br>' + pct(S.pct_number[i], 1) + ' carry a number';
      },
    });

    const d = L.diffusion.slice().sort((a, b) => b.n_passages - a.n_passages).slice(0, 14)
      .sort((a, b) => a.first_year - b.first_year || b.n_passages - a.n_passages);
    C.dotTimeline($('#c-diffusion'), {
      labelW: 170, rowH: 25, xMin: 2013.6, xMax: 2025.6,
      items: d.map(t => ({
        label: prettyTerm(t.term), year: t.first_year, size: t.n_firms,
        color: t.group === 'core' ? '--c1' : '--neutral',
        tip: `${t.n_passages} passages &middot; ${t.n_firms} firms &middot; peak FY${t.peak_year}`,
      })),
    });
    C.legend($('#c-diffusion'), [
      { name: 'Core AI term', color: '--c1' },
      { name: 'Applied or adjacent term', color: '--neutral' },
    ]);
  }

  // ================================================================ method
  function renderMethod() {
    const H = DATA.headline;
    const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
    set('#m-files', H.filings.archive_files.toLocaleString());
    set('#m-mb', H.filings.archive_mb);
    set('#m-frozen', H.filings.frozen_utc.slice(0, 10));
    set('#m-firms', H.filings.firms);
    set('#m-obs', H.filings.operating_filings);
    set('#m-models', H.validation.coders.join(', '));
    const cl = (DATA.themes.reliability || []).find(r => r.dimension === 'claim');
    set('#m-fleiss', num(cl ? cl.fleiss_kappa : null, 3));
    set('#m-ncoded', H.validation.n_coded);
    set('#m-raw', pct(H.validation.raw_agreement, 1));
    set('#m-k6', num(H.validation.kappa_6class, 3));
    set('#m-k2', num(H.validation.kappa_binary, 3));
    set('#m-dephuman', pct(H.validation.corrected_deployment, 1));
  }

  // ---------------------------------------------------------------- boot
  const RENDERED = {};

  function renderStories() {
    if (RENDERED.stories) return;
    const S = DATA.stories, C = Charts;
    $('#s-base').textContent = S.concern.base;
    $('#s-outward').textContent = S.concern.outward;

    const loci = S.concern.loci.slice().sort((a, b) => b.n - a.n);
    C.barsH($('#c-concern'), {
      labelW: 190, rowH: 25,
      items: loci.map(l => ({
        label: l.name, value: l.n,
        color: l.key === 'OWN' ? '--neutral' : '--risk',
        display: l.n + ' (' + (l.share * 100).toFixed(1).replace(/^0/, '') + '%)',
        tip: l.n + ' passages from ' + l.n_firms + ' firms',
      })),
    });
    const qByKey = {};
    S.concern.quotes.forEach(q => qByKey[q.key] = q);
    $('#s-quotes').innerHTML = loci.filter(l => qByKey[l.key]).map(l => {
      const q = qByKey[l.key];
      return `<div class="qcard">
        <div class="qhead">${esc(l.name)}</div>
        <blockquote>&ldquo;${esc(q.quote)}&rdquo;</blockquote>
        <div class="qattr">${esc(q.firm)}, FY${q.fy}
          ${q.url ? `&middot; <a href="${deepLink(q.url, 'p:' + q.pid, q.quote)}" target="_blank"
             rel="noopener" title="Opens the 10-K and scrolls to this passage">in the filing &#8599;</a>` : ''}</div>
      </div>`;
    }).join('');

    const maxN = Math.max(...S.trajectories.firms.flatMap(f =>
      f.years.map(y => Math.max(y.cap, y.risk, y.unseg))));
    // stories.json carries no cik and its display names differ from the ones in
    // passages.json ("Mistras Group" vs "Mistras"), so the join is by hand
    const TRAJ_CIK = { MISTRAS: 1436126, JACOBS: 52988, KBR: 1357615,
                       FLUOR: 1124198, AECOM: 868857, QUANTA: 1050915,
                       KBHOME: 795266, TAYMOR: 1562476 };
    const RISK_SECTIONS = new Set(['Item 1A Risk Factors', 'Item 1B/1C', 'Item 3 Legal']);
    C.trajChart($('#c-traj'), {
      firms: S.trajectories.firms, xMin: 2015, xMax: 2025, max: maxN,
      rule: 2022.55, ruleLabel: 'ChatGPT',
      onDot: (fm, pt) => {
        const box = $('#s-traj-detail');
        const rows = DATA.passages
          .filter(p => p.cik === TRAJ_CIK[fm.key] && p.fy === pt.fy)
          .sort((a, b) => (RISK_SECTIONS.has(a.section) ? 1 : 0) -
                          (RISK_SECTIONS.has(b.section) ? 1 : 0) ||
                          a.section.localeCompare(b.section));
        box.hidden = false;
        box.innerHTML = `
          <div class="traj-detail-head" style="display:flex;align-items:baseline;gap:10px;margin:14px 0 10px">
            <h3 style="margin:0">${esc(fm.name)}, FY${pt.fy}</h3>
            <span style="font-size:13px;color:var(--ink-3)">${rows.length}
              coded passage${rows.length === 1 ? '' : 's'}, capability side first</span>
            <button type="button" id="s-traj-close"
              style="margin-left:auto;border:1px solid var(--line);background:none;color:var(--ink-2);border-radius:5px;padding:2px 10px;cursor:pointer">close</button>
          </div>
          ${rows.length
            ? `<div class="passages">${rows.map(p => passageHtml(p)).join('')}</div>`
            : `<p class="note">No coded passage for this firm-year. The dot's
               tooltip carries the sentence counts; the firm's full record is in
               the Firms view.</p>`}`;
        $('#s-traj-close').addEventListener('click', () => {
          box.hidden = true; box.innerHTML = '';
        });
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    });
    $('#s-milestones').innerHTML = S.trajectories.milestones.map(msn =>
      `<div class="ms"><span class="msy">${esc(msn.firm)} FY${msn.fy}</span>
       ${esc(msn.label)}</div>`).join('');

    $('#s-boundary').innerHTML = S.boundary.map(bc =>
      `<div class="qcard">
        <div class="qhead">${esc(bc.position)}</div>
        <blockquote>&ldquo;${esc(bc.quote)}&rdquo;</blockquote>
        <div class="qattr">${esc(bc.firm)}, FY${bc.fy}
          ${bc.url ? `&middot; <a href="${deepLink(bc.url, 'p:' + bc.pid, bc.quote)}" target="_blank"
             rel="noopener" title="Opens the 10-K and scrolls to this passage">in the filing &#8599;</a>` : ''}</div>
        <p class="qwhy">${esc(bc.reading)}</p>
      </div>`).join('');
  }

  function render(view) {
    const v = view || (location.hash || '#filings').slice(1);
    const fns = { filings: renderFilings, overview: renderOverview,
                  themes: renderThemes, words: renderWords,
                  stories: renderStories,
                  firms: renderFirms, language: renderLanguage,
                  templates: renderTemplates, method: renderMethod };
    // overview redraws every time because its SVGs bake in theme colours
    if (fns[v]) fns[v]();
    RENDERED[v] = true;
  }

  async function boot() {
    const names = ['headline', 'series', 'themes', 'language',
                   'firms', 'passages', 'templates', 'tables', 'stories',
                   'inventory', 'anchors'];
    try {
      const loaded = await Promise.all(names.map(n =>
        fetch(`data/${n}.json`).then(r => {
          if (!r.ok) throw new Error(`${n}.json → HTTP ${r.status}`);
          return r.json();
        })));
      names.forEach((n, i) => DATA[n] = loaded[i]);
    } catch (err) {
      $('#main').innerHTML = `<div class="card"><h2>Could not load the data</h2>
        <p class="sub">${esc(err.message)}</p>
        <p class="note">If you opened this file directly from disk, the browser blocks
        <code>fetch</code> on <code>file://</code> URLs. Serve the folder over HTTP instead:
        <code>python -m http.server</code> in this directory, then open
        <a href="http://localhost:8000">localhost:8000</a>.</p></div>`;
      return;
    }
    $$('#nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); show(g.dataset.goto); }
    });
    addEventListener('hashchange', () => show((location.hash || '#filings').slice(1)));
    // a filing cell with AI language opens the review panel instead of
    // jumping straight into the document (modified clicks pass through)
    $('#inv-grid').addEventListener('click', (e) => {
      const a = e.target.closest('a.inv-cell');
      if (!a || !(+a.dataset.n > 0)) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      C.hideTip();
      openReview(a);
    });
    show((location.hash || '#filings').slice(1));
    // ?review=<cik>:<fy> deep-links straight into a filing's review panel
    const rv = new URLSearchParams(location.search).get('review');
    if (rv) {
      const [cik, fy] = rv.split(':');
      const cell = $(`a.inv-cell[data-cik="${cik}"][data-fy="${fy}"]`);
      if (cell) openReview(cell);
    }
  }

  boot();
})();
