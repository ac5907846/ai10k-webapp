/* ============================================================================
   Minimal SVG chart engine.

   Hand-rolled rather than pulled from a CDN for three reasons: the site is
   published to GitHub Pages with no build step, a charting library would be the
   single largest asset on the page, and the manuscript figures use a specific
   validated palette that a library's defaults would quietly override.

   Every chart reads its colours from CSS custom properties, so light and dark
   themes are handled in one place and the site cannot drift from the paper.
   ========================================================================= */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined)
      e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- tooltip
  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip';
                  document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(html, ev) {
    const t = tip(); t.innerHTML = html; t.classList.add('on');
    const r = t.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y < 8) y = ev.clientY + 18;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('on'); }
  function hoverable(node, html) {
    node.addEventListener('mousemove', (e) => showTip(html, e));
    node.addEventListener('mouseleave', hideTip);
  }

  // ---------------------------------------------------------------- helpers
  const fmtPct = (v, d) => (v * 100).toFixed(d === undefined ? 0 : d) + '%';
  const fmtNum = (v, d) => Number(v).toFixed(d === undefined ? 2 : d);

  // ------------------------------------------------- paper-figure textures
  /* The manuscript figures draw categorical areas as pastel fills with a
     texture (diagonal hatch, dots, crosshatch) and a dark outline, so the
     chart survives greyscale print and colour-vision deficiency. The same
     treatment here keeps the site visually continuous with the paper. */
  function tint(color, k) {           // keep k of the hue, blend rest to white
    const h = color.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return color;
    const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
      .map(v => Math.round(255 - (255 - v) * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  let patN = 0;
  function patternFill(svg, kind, colorVar) {
    const color = css(colorVar);
    if (!kind || kind === 'solid') return tint(color, .34);
    let defs = svg.querySelector('defs') || el('defs', {}, svg);
    const id = 'pat' + (++patN);
    const p = el('pattern', { id, width: 6, height: 6,
                              patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: 6, height: 6, fill: tint(color, .16) }, p);
    if (kind === 'hatch') {
      p.setAttribute('patternTransform', 'rotate(45)');
      el('line', { x1: 1, y1: 0, x2: 1, y2: 6, stroke: color,
                   'stroke-width': 1.6 }, p);
    } else if (kind === 'cross') {
      el('path', { d: 'M0 0 L6 6 M6 0 L0 6', stroke: color,
                   'stroke-width': .9, fill: 'none' }, p);
    } else if (kind === 'dots') {
      el('circle', { cx: 1.6, cy: 1.6, r: 1.1, fill: color }, p);
      el('circle', { cx: 4.6, cy: 4.6, r: 1.1, fill: color }, p);
    }
    return `url(#${id})`;
  }
  // the same texture as a CSS background, for legend chips and tag swatches
  function swatchCSS(kind, colorVar) {
    const c = css(colorVar), t = tint(c, .16);
    if (!kind || kind === 'solid') return tint(c, .5);
    if (kind === 'hatch')
      return `repeating-linear-gradient(45deg,${t},${t} 2px,${c} 2px,${c} 3.5px)`;
    if (kind === 'dots')
      return `radial-gradient(${c} 30%,${t} 34%) 0 0/4.5px 4.5px`;
    if (kind === 'cross')
      return `repeating-linear-gradient(45deg,transparent,transparent 2.2px,${c} 2.2px,${c} 3.2px),` +
             `repeating-linear-gradient(-45deg,${t},${t} 2.2px,${c} 2.2px,${c} 3.2px)`;
    return tint(c, .5);
  }
  function niceTicks(min, max, n) {
    const span = max - min || 1;
    const raw = span / (n || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || mag * 10;
    const out = []; let v = Math.ceil(min / step) * step;
    while (v <= max + 1e-9) { out.push(+v.toFixed(10)); v += step; }
    return out;
  }

  function frame(host, w, h, m) {
    host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%',
                            role: 'img', preserveAspectRatio: 'xMidYMid meet' }, host);
    return { svg, w, h, m, iw: w - m.l - m.r, ih: h - m.t - m.b };
  }

  function axes(f, xs, ys, opts) {
    const o = opts || {};
    const { svg, m, iw, ih } = f;
    ys.forEach(t => {
      const y = o.yScale(t);
      el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, class: 'grid-line' }, svg);
      el('text', { x: m.l - 8, y: y + 4, class: 'ax-txt', 'text-anchor': 'end' }, svg)
        .textContent = o.yFmt ? o.yFmt(t) : t;
    });
    el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, class: 'ax-line' }, svg);
    xs.forEach(t => {
      el('text', { x: o.xScale(t), y: m.t + ih + 17, class: 'ax-txt',
                   'text-anchor': 'middle' }, svg).textContent = o.xFmt ? o.xFmt(t) : t;
    });
    if (o.yLabel)
      el('text', { x: 12, y: m.t + ih / 2, class: 'ax-lab', 'text-anchor': 'middle',
                   transform: `rotate(-90 12 ${m.t + ih / 2})` }, svg).textContent = o.yLabel;
  }

  /* Marks the ChatGPT break. Every time series here turns at the same moment and
     a chart that does not say so invites the reader to infer a trend. */
  function breakLine(f, x, label) {
    const { svg, m, ih } = f;
    el('line', { x1: x, x2: x, y1: m.t, y2: m.t + ih, class: 'brk-line' }, svg);
    const g = el('text', { x: x - 6, y: m.t + 12, class: 'brk-txt', 'text-anchor': 'end' }, svg);
    (label || ['ChatGPT', 'Nov 2022']).forEach((line, i) => {
      el('tspan', { x: x - 6, dy: i ? 12 : 0 }, g).textContent = line;
    });
  }

  // ================================================================ line chart
  function lineChart(host, cfg) {
    const w = 780, h = cfg.height || 300;
    const m = { t: 18, r: 18, b: 34, l: 52 };
    const f = frame(host, w, h, m);
    const years = cfg.years;
    const allY = cfg.series.flatMap(s => s.values.filter(v => v !== null));
    const ymax = cfg.ymax !== undefined ? cfg.ymax : Math.max(...allY) * 1.12;
    const ymin = cfg.ymin || 0;
    const xScale = (yr) => m.l + (years.indexOf(yr) / (years.length - 1)) * f.iw;
    const yScale = (v) => m.t + f.ih - ((v - ymin) / (ymax - ymin)) * f.ih;
    axes(f, years.filter((_, i) => i % (cfg.everyX || 1) === 0),
         niceTicks(ymin, ymax, 5), { xScale, yScale, yFmt: cfg.yFmt, yLabel: cfg.yLabel });

    if (cfg.breakAt) breakLine(f, xScale(cfg.breakAt) - (f.iw / (years.length - 1)) / 2);

    (cfg.bands || []).forEach(b => {
      const pts = years.map((yr, i) => `${xScale(yr)},${yScale(b.lo[i])}`)
        .concat(years.map((yr, i) => `${xScale(yr)},${yScale(b.hi[i])}`).reverse());
      el('polygon', { points: pts.join(' '), fill: css(b.color), opacity: .15 }, f.svg);
    });

    cfg.series.forEach(s => {
      const pts = years.map((yr, i) => s.values[i] === null ? null : `${xScale(yr)},${yScale(s.values[i])}`)
                       .filter(Boolean).join(' ');
      el('polyline', { points: pts, fill: 'none', stroke: css(s.color),
                       'stroke-width': s.width || 2.4, 'stroke-linejoin': 'round',
                       'stroke-linecap': 'round', opacity: s.opacity || 1 }, f.svg);
      years.forEach((yr, i) => {
        if (s.values[i] === null) return;
        const c = el('circle', { cx: xScale(yr), cy: yScale(s.values[i]),
                                 r: s.dot || 3.6, fill: css(s.color),
                                 stroke: css('--surface'), 'stroke-width': 1.4 }, f.svg);
        hoverable(c, `<b>${s.name}</b> · FY${yr}<br>${cfg.tipFmt ? cfg.tipFmt(s.values[i], yr, s) : s.values[i]}`);
      });
    });
    if (cfg.series.length > 1) legend(host, cfg.series.map(s => ({ name: s.name, color: s.color })));
  }

  // ================================================================ stacked bars
  function stackedBar(host, cfg) {
    const w = cfg.w || 780, h = cfg.height || 300;
    const m = { t: 18, r: 18, b: 42, l: 52 };
    const f = frame(host, w, h, m);
    const cats = cfg.categories;
    const bw = Math.min(58, (f.iw / cats.length) * 0.62);
    const xScale = (i) => m.l + (i + 0.5) * (f.iw / cats.length);
    const yScale = (v) => m.t + f.ih - v * f.ih;
    axes(f, cats.map((_, i) => i), [0, .25, .5, .75, 1],
         { xScale: (i) => xScale(i), yScale, yFmt: v => fmtPct(v),
           xFmt: (i) => cfg.labels[i], yLabel: cfg.yLabel });

    // one fill per series, resolved once: a pastel tint or a figure texture
    const fills = cfg.series.map(s => patternFill(f.svg, s.pat, s.color));
    cats.forEach((_, i) => {
      let acc = 0;
      cfg.series.forEach((s, si) => {
        const v = s.values[i]; if (!v) { return; }
        const y0 = yScale(acc + v), y1 = yScale(acc);
        const r = el('rect', { x: xScale(i) - bw / 2, y: y0, width: bw,
                               height: Math.max(1, y1 - y0), fill: fills[si],
                               stroke: css('--ink-2'), 'stroke-width': .8 }, f.svg);
        hoverable(r, `<b>${s.name}</b><br>${cfg.labels[i]} · ${fmtPct(v, 1)}` +
                     (cfg.counts ? `<br>${Math.round(v * cfg.counts[i])} of ${cfg.counts[i]} passages` : ''));
        acc += v;
      });
      if (cfg.counts)
        el('text', { x: xScale(i), y: m.t + f.ih + 32, class: 'ax-txt',
                     'text-anchor': 'middle' }, f.svg).textContent = 'n=' + cfg.counts[i];
    });
    legend(host, cfg.series.map(s => ({ name: s.name, color: s.color,
                                        pat: s.pat || 'solid' })));
  }

  // ================================================================ grouped bars
  function groupedBar(host, cfg) {
    const w = 780, h = cfg.height || 300;
    const m = { t: 18, r: 18, b: 38, l: 52 };
    const f = frame(host, w, h, m);
    const n = cfg.labels.length, k = cfg.series.length;
    const slot = f.iw / n, bw = Math.min(22, (slot * 0.72) / k);
    const ymax = Math.max(...cfg.series.flatMap(s => s.values)) * 1.12 || 1;
    const xScale = (i) => m.l + (i + 0.5) * slot;
    const yScale = (v) => m.t + f.ih - (v / ymax) * f.ih;
    axes(f, cfg.labels.map((_, i) => i), niceTicks(0, ymax, 5),
         { xScale, yScale, xFmt: (i) => cfg.labels[i], yLabel: cfg.yLabel });
    const gfills = cfg.series.map(s => patternFill(f.svg, s.pat, s.color));
    cfg.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = xScale(i) - (k * bw) / 2 + si * bw;
        const r = el('rect', { x: x + 1, y: yScale(v), width: bw - 2,
                               height: Math.max(0, m.t + f.ih - yScale(v)),
                               fill: gfills[si], stroke: css(s.color),
                               'stroke-width': 1.1, rx: 1.5 }, f.svg);
        hoverable(r, `<b>${s.name}</b><br>FY${cfg.labels[i]} · ${v}`);
      });
    });
    legend(host, cfg.series.map(s => ({ name: s.name, color: s.color,
                                        pat: s.pat || 'solid' })));
  }

  // ================================================================ horizontal bars
  function barsH(host, cfg) {
    const rowH = cfg.rowH || 26;
    const w = cfg.w || 780, h = cfg.items.length * rowH + 34;
    const m = { t: 8, r: 46, b: 26, l: cfg.labelW || 210 };
    const f = frame(host, w, h, m);
    const max = Math.max(...cfg.items.map(d => d.value)) || 1;
    cfg.items.forEach((d, i) => {
      const y = m.t + i * rowH;
      el('text', { x: m.l - 10, y: y + rowH / 2 + 4, class: 'ax-txt',
                   'text-anchor': 'end' }, f.svg).textContent = d.label;
      const bw = (d.value / max) * f.iw;
      const col = css(d.color || '--accent');
      const r = el('rect', { x: m.l, y: y + 4, width: Math.max(bw, 1), height: rowH - 10,
                             fill: tint(col, .55), stroke: col,
                             'stroke-width': 1.1, rx: 2 }, f.svg);
      hoverable(r, `<b>${d.label}</b><br>${d.tip || d.value}`);
      el('text', { x: m.l + bw + 7, y: y + rowH / 2 + 4, class: 'val-txt' }, f.svg)
        .textContent = d.display !== undefined ? d.display : d.value;
    });
    if (cfg.legend) legend(host, cfg.legend);
  }

  // ================================================================ sparkline
  function spark(values, opts) {
    const o = opts || {}, w = o.w || 130, h = o.h || 30;
    const max = Math.max(...values, o.min || 0.001);
    const step = w / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="overflow:visible">
      <polyline points="${pts}" fill="none" stroke="${css(o.color || '--accent')}"
        stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // ================================================================ dot timeline
  /* When each term entered use: a dot at the first year, a rule running to the
     present, dot area carrying how many firms picked it up. */
  function dotTimeline(host, cfg) {
    const rowH = cfg.rowH || 24;
    const w = 780, h = cfg.items.length * rowH + 44;
    const m = { t: 10, r: 22, b: 32, l: cfg.labelW || 150 };
    const f = frame(host, w, h, m);
    const x0 = cfg.xMin, x1 = cfg.xMax;
    const xScale = (v) => m.l + ((v - x0) / (x1 - x0)) * f.iw;
    const maxN = Math.max(...cfg.items.map(d => d.size)) || 1;

    for (let yr = Math.ceil(x0); yr <= x1; yr++) {
      if ((yr - Math.ceil(x0)) % 2) continue;
      el('line', { x1: xScale(yr), y1: m.t, x2: xScale(yr), y2: m.t + f.ih,
                   stroke: css('--line'), 'stroke-width': 1 }, f.svg);
      el('text', { x: xScale(yr), y: m.t + f.ih + 18, class: 'ax-txt',
                   'text-anchor': 'middle' }, f.svg).textContent = yr;
    }
    cfg.items.forEach((d, i) => {
      const y = m.t + i * rowH + rowH / 2;
      el('text', { x: m.l - 10, y: y + 4, class: 'ax-txt', 'text-anchor': 'end' },
         f.svg).textContent = d.label;
      el('line', { x1: xScale(d.year), y1: y, x2: xScale(x1), y2: y,
                   stroke: css('--line-2'), 'stroke-width': 1.4 }, f.svg);
      const c = el('circle', { cx: xScale(d.year), cy: y,
                               r: 4 + 6 * Math.sqrt(d.size / maxN),
                               fill: css(d.color || '--accent'),
                               stroke: css('--surface'), 'stroke-width': 1.4 }, f.svg);
      hoverable(c, `<b>${d.label}</b><br>first seen FY${d.year}<br>${d.tip || ''}`);
    });
  }

  function legend(host, items) {
    const d = document.createElement('div');
    d.className = 'legend';
    d.innerHTML = items.map(i => {
      const bg = i.pat ? swatchCSS(i.pat, i.color) : css(i.color);
      const edge = i.pat ? `;box-shadow:inset 0 0 0 1px ${css(i.color)}` : '';
      return `<span><i style="background:${bg}${edge}"></i>${i.name}</span>`;
    }).join('');
    host.appendChild(d);
  }


  function trajChart(host, cfg) {
    const rowH = cfg.rowH || 54;
    const w = 780, h = cfg.firms.length * rowH + 46;
    const m = { t: 16, r: 14, b: 30, l: cfg.labelW || 128 };
    const f = frame(host, w, h, m);
    const x0 = cfg.xMin, x1 = cfg.xMax;
    const xS = (v) => m.l + ((v - x0) / (x1 - x0)) * f.iw;
    const maxN = cfg.max || 1;
    for (let yr = x0; yr <= x1; yr++) {
      if ((yr - x0) % 2) continue;
      el('text', { x: xS(yr), y: h - 10, class: 'ax-txt',
                   'text-anchor': 'middle' }, f.svg).textContent = yr;
    }
    if (cfg.rule) {
      el('line', { x1: xS(cfg.rule), y1: m.t - 6, x2: xS(cfg.rule),
                   y2: m.t + f.ih, stroke: css('--line'),
                   'stroke-width': 1.2 }, f.svg);
      el('text', { x: xS(cfg.rule), y: m.t - 8, class: 'ax-txt',
                   'text-anchor': 'middle' }, f.svg)
        .textContent = cfg.ruleLabel || '';
    }
    cfg.firms.forEach((fm, i) => {
      const y = m.t + i * rowH + rowH / 2;
      el('line', { x1: xS(x0) - 6, y1: y, x2: xS(x1) + 6, y2: y,
                   stroke: css('--line-2'), 'stroke-width': 1.2 }, f.svg);
      const nm = el('text', { x: m.l - 12, y: y - 2, class: 'ax-txt',
                              'text-anchor': 'end',
                              style: 'font-weight:600' }, f.svg);
      nm.textContent = fm.name;
      const sb = el('text', { x: m.l - 12, y: y + 12, class: 'ax-txt',
                              'text-anchor': 'end',
                              style: 'font-size:9.5px' }, f.svg);
      sb.textContent = fm.sub;
      fm.years.forEach(pt => {
        const tipTxt = '<b>' + fm.name + ' FY' + pt.fy + '</b><br>' +
          (pt.unseg ? pt.unseg + ' AI sentences (whole filing)'
                    : pt.cap + ' capability-side, ' + pt.risk + ' risk-side') +
          (cfg.onDot ? '<i>click to read the passages</i>' : '');
        const dot = (d) => {
          hoverable(d, tipTxt);
          if (cfg.onDot) {
            d.style.cursor = 'pointer';
            d.addEventListener('click', () => cfg.onDot(fm, pt));
          }
        };
        if (!pt.cap && !pt.risk && !pt.unseg) {
          el('line', { x1: xS(pt.fy), y1: y - 4, x2: xS(pt.fy), y2: y + 4,
                       stroke: css('--ink-3'), 'stroke-width': 1.4 }, f.svg);
          return;
        }
        if (pt.cap) {
          const r = 3 + 9 * Math.sqrt(pt.cap / maxN);
          dot(el('circle', { cx: xS(pt.fy), cy: y - 9, r: r,
                             fill: css('--opportunity'),
                             stroke: css('--surface'),
                             'stroke-width': 1.2 }, f.svg));
        }
        if (pt.risk) {
          const r = 3 + 9 * Math.sqrt(pt.risk / maxN);
          dot(el('circle', { cx: xS(pt.fy), cy: y + 9, r: r,
                             fill: css('--risk'),
                             stroke: css('--surface'),
                             'stroke-width': 1.2 }, f.svg));
        }
        if (pt.unseg) {
          const r = 3 + 9 * Math.sqrt(pt.unseg / maxN);
          dot(el('rect', { x: xS(pt.fy) - r, y: y - r,
                           width: 2 * r, height: 2 * r,
                           transform: 'rotate(45 ' + xS(pt.fy) + ' ' + y + ')',
                           fill: css('--neutral'),
                           stroke: css('--surface'),
                           'stroke-width': 1.2 }, f.svg));
        }
      });
    });
    legend(host, [
      { name: 'Capability side (Items 1, 2, 5, 7)', color: '--opportunity' },
      { name: 'Risk side (Items 1A, 1B, 3)', color: '--risk' },
      { name: 'Filing not segmented (whole-filing count)', color: '--neutral' },
    ]);
  }

  global.Charts = { lineChart, stackedBar, groupedBar, barsH, spark,
                    dotTimeline, trajChart, legend, fmtPct, fmtNum, css,
                    tint, swatchCSS, showTip, hideTip };
})(window);
