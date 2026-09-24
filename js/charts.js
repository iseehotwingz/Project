/* ---------------------------------------------------------------------------
   Hand-rolled inline SVG charts. No libraries, no network.

   Design notes:
   - Colours come from CSS custom properties, so both themes are honoured and
     the toggle needs no redraw logic beyond a re-render.
   - Profit/loss is a DIVERGING encoding. The green/red pair is validated for
     colour-vision deficiency (deutan dE 24.8 dark / 12.0 light), and sign is
     *always* carried by a second channel too: position relative to the zero
     baseline, plus signed direct labels. Colour never carries it alone.
   - Marks follow the house spec: 2px lines, 4px rounded data-ends, >=8px hit
     targets, a 2px surface gap between adjacent bars, recessive grid.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var U = root.Util;
  var Charts = {};

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function svgRoot(w, h) {
    var s = el('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img'
    });
    return s;
  }

  function title(node, text) {
    node.appendChild(el('title', {}, text));
    return node;
  }

  function empty(host, msg) {
    host.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'chart-empty';
    d.textContent = msg || 'No data yet';
    host.appendChild(d);
  }

  /** Nice axis bounds + step for a numeric range. */
  function niceScale(min, max, ticks) {
    ticks = ticks || 4;
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var raw = span / ticks;
    var mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    return {
      min: Math.floor(min / step) * step,
      max: Math.ceil(max / step) * step,
      step: step
    };
  }

  /** Compact number, sign first: -4.1k. */
  function shortMoney(n) {
    var a = Math.abs(n);
    var s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    if (a >= 100) return s + a.toFixed(0);
    return s + a.toFixed(a < 10 ? 1 : 0);
  }

  /* ------------------------------------------------------------------ *
   * Equity curve — single series, so no legend box; the panel title
   * names it. Crosshair + tooltip on hover.
   * ------------------------------------------------------------------ */
  Charts.equityCurve = function (host, points, opts) {
    opts = opts || {};
    var fmt = opts.format || shortMoney;
    var value = opts.value || function (p) { return p.equity; };

    if (!points || points.length < 2) return empty(host, 'Close a trade to start the curve');

    var W = 720, H = 260;
    var P = { t: 14, r: 16, b: 26, l: 54 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;

    var vals = points.map(function (p) { return value(p); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var sc = niceScale(lo, hi, 4);
    var base = opts.baseline !== undefined ? opts.baseline : value(points[0]);

    var x = function (i) { return P.l + (i / (points.length - 1)) * iw; };
    var y = function (v) { return P.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih; };

    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', 'Equity curve over ' + (points.length - 1) + ' closed trades');

    // Recessive gridlines + axis labels.
    for (var g = sc.min; g <= sc.max + 1e-9; g += sc.step) {
      var gy = y(g);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: W - P.r, y2: gy, class: 'grid-line' }));
      svg.appendChild(el('text', {
        x: P.l - 8, y: gy + 3.5, 'text-anchor': 'end', class: 'axis-label'
      }, fmt(g)));
    }

    // Baseline (starting equity) so "above water" is a position, not a colour.
    if (base >= sc.min && base <= sc.max) {
      svg.appendChild(el('line', {
        x1: P.l, y1: y(base), x2: W - P.r, y2: y(base), class: 'zero-line'
      }));
    }

    var lineColor = 'var(--accent)';
    var last = value(points[points.length - 1]);
    if (last > base) lineColor = 'var(--win)';
    else if (last < base) lineColor = 'var(--loss)';

    // Area fill under the curve, clipped to the baseline.
    var areaD = 'M' + x(0) + ',' + y(value(points[0]));
    for (var i = 1; i < points.length; i++) areaD += 'L' + x(i) + ',' + y(value(points[i]));
    var lineD = areaD;
    areaD += 'L' + x(points.length - 1) + ',' + y(Math.max(sc.min, Math.min(sc.max, base))) +
             'L' + x(0) + ',' + y(Math.max(sc.min, Math.min(sc.max, base))) + 'Z';

    var gradId = 'eqgrad_' + Math.random().toString(36).slice(2, 7);
    var defs = el('defs');
    var lg = el('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(el('stop', { offset: '0%', 'stop-color': lineColor, 'stop-opacity': .28 }));
    lg.appendChild(el('stop', { offset: '100%', 'stop-color': lineColor, 'stop-opacity': .02 }));
    defs.appendChild(lg);
    svg.appendChild(defs);

    svg.appendChild(el('path', { d: areaD, fill: 'url(#' + gradId + ')', stroke: 'none' }));
    svg.appendChild(el('path', {
      d: lineD, fill: 'none', stroke: lineColor, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    // End marker (>=8px) with a 2px surface ring.
    var lx = x(points.length - 1), ly = y(last);
    svg.appendChild(el('circle', { cx: lx, cy: ly, r: 5, fill: lineColor,
      stroke: 'var(--bg-elev)', 'stroke-width': 2 }));

    // Direct label on the final value only — never a number on every point.
    svg.appendChild(el('text', {
      x: lx - 6, y: ly - 11, 'text-anchor': 'end', class: 'axis-label',
      style: 'font-weight:700;fill:' + lineColor
    }, fmt(last)));

    // Hover layer: invisible wide bands + crosshair.
    var cross = el('g', { style: 'opacity:0' });
    var vline = el('line', { y1: P.t, y2: P.t + ih, stroke: 'var(--text-faint)',
      'stroke-width': 1, 'stroke-dasharray': '3 3' });
    var dot = el('circle', { r: 4.5, fill: lineColor, stroke: 'var(--bg-elev)', 'stroke-width': 2 });
    cross.appendChild(vline); cross.appendChild(dot);
    svg.appendChild(cross);

    var tip = el('g', { style: 'opacity:0; pointer-events:none' });
    var tipBg = el('rect', { rx: 6, fill: 'var(--bg-elev-2)', stroke: 'var(--border)',
      'stroke-width': 1, height: 34 });
    var tipL1 = el('text', { class: 'axis-label', style: 'fill:var(--text);font-weight:700' });
    var tipL2 = el('text', { class: 'axis-label' });
    tip.appendChild(tipBg); tip.appendChild(tipL1); tip.appendChild(tipL2);
    svg.appendChild(tip);

    var bandW = iw / (points.length - 1);
    for (var b = 0; b < points.length; b++) {
      (function (idx) {
        var hit = el('rect', {
          x: x(idx) - bandW / 2, y: P.t, width: Math.max(bandW, 8), height: ih,
          fill: 'transparent', style: 'cursor:crosshair'
        });
        hit.addEventListener('mouseenter', function () {
          var p = points[idx], v = value(p);
          cross.style.opacity = 1;
          vline.setAttribute('x1', x(idx)); vline.setAttribute('x2', x(idx));
          dot.setAttribute('cx', x(idx)); dot.setAttribute('cy', y(v));

          var l1 = fmt(v);
          var l2 = p.trade
            ? p.trade.symbol + '  ' + (p.trade.netPnl > 0 ? '+' : '') + shortMoney(p.trade.netPnl)
            : 'Start';
          if (p.t) l2 += '  ·  ' + U.fmtDate(p.t);
          tipL1.textContent = l1; tipL2.textContent = l2;
          var w = Math.max(l1.length, l2.length) * 6.0 + 18;
          var tx = U.clamp(x(idx) + 12, P.l, W - P.r - w);
          var ty = U.clamp(y(v) - 42, P.t, P.t + ih - 38);
          tipBg.setAttribute('x', tx); tipBg.setAttribute('y', ty); tipBg.setAttribute('width', w);
          tipL1.setAttribute('x', tx + 9); tipL1.setAttribute('y', ty + 14);
          tipL2.setAttribute('x', tx + 9); tipL2.setAttribute('y', ty + 27);
          tip.style.opacity = 1;
        });
        hit.addEventListener('mouseleave', function () {
          cross.style.opacity = 0; tip.style.opacity = 0;
        });
        svg.appendChild(hit);
      })(b);
    }

    // Time axis: first and last only, to stay recessive.
    var firstT = points[1] && points[1].t, lastT = points[points.length - 1].t;
    if (firstT) svg.appendChild(el('text', { x: P.l, y: H - 8, class: 'axis-label' }, U.fmtDate(firstT)));
    if (lastT) svg.appendChild(el('text', { x: W - P.r, y: H - 8, 'text-anchor': 'end', class: 'axis-label' }, U.fmtDate(lastT)));

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /* ------------------------------------------------------------------ *
   * Diverging bar chart around a zero baseline.
   * Sign is encoded by side-of-baseline first, colour second.
   * ------------------------------------------------------------------ */
  Charts.divergingBars = function (host, items, opts) {
    opts = opts || {};
    var fmt = opts.format || shortMoney;
    if (!items || !items.length) return empty(host, opts.emptyMsg || 'No data yet');

    var W = 360, H = 220;
    var P = { t: 12, r: 10, b: 30, l: 46 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;

    var vals = items.map(function (d) { return d.value; });
    var lo = Math.min(0, Math.min.apply(null, vals));
    var hi = Math.max(0, Math.max.apply(null, vals));
    var sc = niceScale(lo, hi, 3);

    var n = items.length;
    var slot = iw / n;
    var GAP = 2;                                  // 2px surface gap between bars
    var bw = Math.max(3, Math.min(42, slot - GAP));
    var y = function (v) { return P.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih; };
    var zeroY = y(0);

    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', opts.ariaLabel || 'Bar chart');

    for (var g = sc.min; g <= sc.max + 1e-9; g += sc.step) {
      var gy = y(g);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: W - P.r, y2: gy,
        class: Math.abs(g) < 1e-9 ? 'zero-line' : 'grid-line' }));
      svg.appendChild(el('text', { x: P.l - 7, y: gy + 3.5, 'text-anchor': 'end',
        class: 'axis-label' }, fmt(g)));
    }

    items.forEach(function (d, i) {
      var cx = P.l + slot * i + slot / 2;
      var v = d.value;
      var top = v >= 0 ? y(v) : zeroY;
      var h = Math.abs(y(v) - zeroY);
      var color = v > 0 ? 'var(--win)' : (v < 0 ? 'var(--loss)' : 'var(--text-faint)');

      // 4px rounded data-end, square against the baseline: the rect is drawn
      // with a full radius then the baseline corners are covered.
      var g2 = el('g', { class: 'hoverable' });
      g2.appendChild(el('rect', {
        x: cx - bw / 2, y: top, width: bw, height: Math.max(h, 1.5),
        rx: Math.min(4, bw / 2), fill: color
      }));
      if (h > 4) {
        g2.appendChild(el('rect', {
          x: cx - bw / 2, y: v >= 0 ? zeroY - 4 : zeroY, width: bw, height: 4, fill: color
        }));
      }
      title(g2, d.label + ': ' + (v > 0 ? '+' : '') + fmt(v) +
                (d.sub ? '  (' + d.sub + ')' : ''));
      svg.appendChild(g2);

      // x labels, thinned out so they never collide.
      var every = Math.ceil(n / 8);
      if (i % every === 0 || n <= 8) {
        svg.appendChild(el('text', {
          x: cx, y: H - 14, 'text-anchor': 'middle', class: 'axis-label'
        }, d.short || d.label));
      }
    });

    // Signed direct labels when the series is small enough to stay legible.
    if (n <= 8) {
      items.forEach(function (d, i) {
        var cx = P.l + slot * i + slot / 2;
        var v = d.value;
        svg.appendChild(el('text', {
          x: cx, y: v >= 0 ? y(v) - 6 : y(v) + 13, 'text-anchor': 'middle',
          class: 'axis-label', style: 'font-weight:600'
        }, (v > 0 ? '+' : '') + fmt(v)));
      });
    }

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /* ------------------------------------------------------------------ *
   * Win / loss / breakeven split: one stacked bar + an always-present
   * legend with counts, so identity never rests on colour.
   * ------------------------------------------------------------------ */
  Charts.winLossSplit = function (host, stats) {
    var total = stats.wins + stats.losses + stats.breakeven;
    if (!total) return empty(host, 'No closed trades yet');

    var W = 360, H = 200;
    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', 'Win/loss split: ' + stats.wins + ' wins, ' +
      stats.losses + ' losses, ' + stats.breakeven + ' breakeven');

    var segs = [
      { label: 'Wins', n: stats.wins, color: 'var(--win)' },
      { label: 'Losses', n: stats.losses, color: 'var(--loss)' },
      { label: 'Breakeven', n: stats.breakeven, color: 'var(--text-faint)' }
    ].filter(function (s) { return s.n > 0; });

    var barX = 20, barY = 26, barW = W - 40, barH = 30, GAP = 2;
    var cursor = barX;
    segs.forEach(function (s, i) {
      var w = (s.n / total) * barW - (i < segs.length - 1 ? GAP : 0);
      var g = el('g', { class: 'hoverable' });
      g.appendChild(el('rect', {
        x: cursor, y: barY, width: Math.max(w, 1), height: barH,
        rx: 4, fill: s.color
      }));
      title(g, s.label + ': ' + s.n + ' (' + ((s.n / total) * 100).toFixed(1) + '%)');
      svg.appendChild(g);
      if (w > 34) {
        svg.appendChild(el('text', {
          x: cursor + w / 2, y: barY + barH / 2 + 4, 'text-anchor': 'middle',
          class: 'axis-label',
          style: 'fill:var(--bg);font-weight:700;font-size:11px'
        }, s.n));
      }
      cursor += w + GAP;
    });

    svg.appendChild(el('text', {
      x: barX, y: 18, class: 'axis-label'
    }, total + ' closed trades'));

    // Legend — always present for >= 2 series.
    var ly = barY + barH + 26;
    segs.forEach(function (s) {
      var row = el('g');
      row.appendChild(el('rect', { x: barX, y: ly - 8, width: 10, height: 10, rx: 3, fill: s.color }));
      row.appendChild(el('text', { x: barX + 16, y: ly + 1, class: 'axis-label',
        style: 'fill:var(--text)' }, s.label));
      row.appendChild(el('text', { x: barX + 150, y: ly + 1, 'text-anchor': 'end',
        class: 'axis-label' }, s.n + '  ·  ' + ((s.n / total) * 100).toFixed(1) + '%'));
      svg.appendChild(row);
      ly += 18;
    });

    // Headline figures beside the legend.
    var stack = [
      ['Win rate', stats.winRate === null ? '—' : stats.winRate.toFixed(1) + '%'],
      ['Profit factor', stats.profitFactor === null ? '—'
        : (stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2))],
      ['Payoff ratio', stats.payoffRatio === null ? '—' : stats.payoffRatio.toFixed(2)]
    ];
    var sy = barY + barH + 26;
    stack.forEach(function (row) {
      svg.appendChild(el('text', { x: W - 20, y: sy + 1, 'text-anchor': 'end',
        class: 'axis-label', style: 'fill:var(--text);font-weight:700' }, row[1]));
      svg.appendChild(el('text', { x: W - 20, y: sy + 13, 'text-anchor': 'end',
        class: 'axis-label' }, row[0]));
      sy += 32;
    });

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /* ------------------------------------------------------------------ *
   * Underwater / drawdown area — always <= 0, so it reads as depth.
   * ------------------------------------------------------------------ */
  Charts.drawdown = function (host, points, opts) {
    opts = opts || {};
    var fmt = opts.format || shortMoney;
    if (!points || points.length < 2) return empty(host, 'No closed trades yet');

    var W = 360, H = 200;
    var P = { t: 14, r: 12, b: 22, l: 48 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;

    var dds = points.map(function (p) { return p.drawdown; });
    var worst = Math.min.apply(null, dds);
    if (worst >= 0) worst = -1;
    var sc = niceScale(worst, 0, 3);

    var x = function (i) { return P.l + (i / (points.length - 1)) * iw; };
    var y = function (v) { return P.t + ((v - sc.max) / (sc.min - sc.max)) * ih; };

    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', 'Drawdown from peak equity');

    for (var g = sc.min; g <= sc.max + 1e-9; g += sc.step) {
      var gy = y(g);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: W - P.r, y2: gy,
        class: Math.abs(g) < 1e-9 ? 'zero-line' : 'grid-line' }));
      svg.appendChild(el('text', { x: P.l - 7, y: gy + 3.5, 'text-anchor': 'end',
        class: 'axis-label' }, fmt(g)));
    }

    var d = 'M' + x(0) + ',' + y(0);
    points.forEach(function (p, i) { d += 'L' + x(i) + ',' + y(p.drawdown); });
    d += 'L' + x(points.length - 1) + ',' + y(0) + 'Z';

    svg.appendChild(el('path', { d: d, fill: 'var(--loss)', 'fill-opacity': .22,
      stroke: 'var(--loss)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    var wi = dds.indexOf(worst);
    if (wi >= 0) {
      svg.appendChild(el('circle', { cx: x(wi), cy: y(worst), r: 4.5, fill: 'var(--loss)',
        stroke: 'var(--bg-elev)', 'stroke-width': 2 }));
      svg.appendChild(el('text', {
        x: U.clamp(x(wi), P.l + 26, W - P.r - 26), y: y(worst) + 15,
        'text-anchor': 'middle', class: 'axis-label',
        style: 'font-weight:700;fill:var(--loss-ink)'
      }, 'max ' + fmt(worst)));
    }

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /* ------------------------------------------------------------------ *
   * Histogram — categorical buckets, coloured by sign of the bucket.
   * ------------------------------------------------------------------ */
  Charts.histogram = function (host, buckets, opts) {
    opts = opts || {};
    if (!buckets || !buckets.length) return empty(host, opts.emptyMsg || 'No data yet');
    var maxN = Math.max.apply(null, buckets.map(function (b) { return b.count; }));
    if (!maxN) return empty(host, opts.emptyMsg || 'No data yet');

    var W = 360, H = 224;
    var P = { t: 14, r: 10, b: 58, l: 28 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var slot = iw / buckets.length;
    var GAP = 2;
    var bw = Math.max(3, slot - GAP);

    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', opts.ariaLabel || 'Distribution');

    buckets.forEach(function (b, i) {
      var h = (b.count / maxN) * ih;
      var cx = P.l + slot * i;
      var color = opts.colorFor ? opts.colorFor(b, i) : 'var(--accent)';
      var g = el('g', { class: 'hoverable' });
      g.appendChild(el('rect', {
        x: cx + GAP / 2, y: P.t + ih - h, width: bw, height: Math.max(h, 1.5),
        rx: Math.min(4, bw / 2), fill: color
      }));
      if (h > 4) {
        g.appendChild(el('rect', { x: cx + GAP / 2, y: P.t + ih - 4, width: bw, height: 4, fill: color }));
      }
      title(g, b.label + ': ' + b.count + ' trade' + (b.count === 1 ? '' : 's'));
      svg.appendChild(g);

      if (b.count > 0) {
        svg.appendChild(el('text', { x: cx + slot / 2, y: P.t + ih - h - 5,
          'text-anchor': 'middle', class: 'axis-label' }, b.count));
      }
      var everyLabel = buckets.length > 9 ? 2 : 1;
      if (i % everyLabel === 0) {
        var lxp = cx + slot / 2, lyp = P.t + ih + 13;
        svg.appendChild(el('text', {
          x: lxp, y: lyp, 'text-anchor': 'end', class: 'axis-label',
          transform: 'rotate(-45 ' + lxp + ' ' + lyp + ')'
        }, b.label));
      }
    });

    svg.appendChild(el('line', { x1: P.l, y1: P.t + ih, x2: W - P.r, y2: P.t + ih,
      class: 'zero-line' }));

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /* ------------------------------------------------------------------ *
   * Scatter: holding time (log-ish x) against net P&L.
   * ------------------------------------------------------------------ */
  Charts.scatterHold = function (host, derived, opts) {
    opts = opts || {};
    var fmt = opts.format || shortMoney;
    // A zero-length hold means the open time was never recorded, so those
    // trades would all stack on one x position and say nothing.
    var pts = derived.filter(function (d) {
      return !d.isOpen && d.holdingMs !== null && d.holdingMs > 0;
    });
    if (pts.length < 2) return empty(host, 'Needs distinct entry and exit times on 2+ closed trades');

    var W = 360, H = 220;
    var P = { t: 14, r: 14, b: 30, l: 50 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;

    var mins = pts.map(function (d) { return Math.max(d.holdingMs / 60000, 0.5); });
    var lx = mins.map(function (m) { return Math.log10(m); });
    var xlo = Math.min.apply(null, lx), xhi = Math.max.apply(null, lx);
    if (xhi - xlo < 0.3) { xlo -= 0.3; xhi += 0.3; }

    var pn = pts.map(function (d) { return d.netPnl; });
    var sc = niceScale(Math.min(0, Math.min.apply(null, pn)),
                       Math.max(0, Math.max.apply(null, pn)), 3);

    var X = function (v) { return P.l + ((v - xlo) / (xhi - xlo)) * iw; };
    var Y = function (v) { return P.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih; };

    var svg = svgRoot(W, H);
    svg.setAttribute('aria-label', 'Holding time versus net profit and loss');

    for (var g = sc.min; g <= sc.max + 1e-9; g += sc.step) {
      var gy = Y(g);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: W - P.r, y2: gy,
        class: Math.abs(g) < 1e-9 ? 'zero-line' : 'grid-line' }));
      svg.appendChild(el('text', { x: P.l - 7, y: gy + 3.5, 'text-anchor': 'end',
        class: 'axis-label' }, fmt(g)));
    }

    // Ticks on the log x axis — half-decades when the span is narrow, so a
    // chart covering minutes-to-hours still gets more than one label.
    var tickStep = (xhi - xlo) < 2.2 ? 0.5 : 1;
    var first = Math.ceil(xlo / tickStep) * tickStep;
    for (var d10 = first; d10 <= xhi + 1e-9; d10 += tickStep) {
      var m = Math.pow(10, d10);
      svg.appendChild(el('text', { x: X(d10), y: H - 10, 'text-anchor': 'middle',
        class: 'axis-label' }, U.fmtDuration(m * 60000)));
    }

    pts.forEach(function (d) {
      var g2 = el('g', { class: 'hoverable' });
      g2.appendChild(el('circle', {
        cx: X(Math.log10(Math.max(d.holdingMs / 60000, 0.5))),
        cy: Y(d.netPnl), r: 4.5,
        fill: d.netPnl > 0 ? 'var(--win)' : (d.netPnl < 0 ? 'var(--loss)' : 'var(--text-faint)'),
        'fill-opacity': .85,
        stroke: 'var(--bg-elev)', 'stroke-width': 2     // 2px surface ring on overlap
      }));
      title(g2, d.symbol + '  ' + (d.netPnl > 0 ? '+' : '') + fmt(d.netPnl) +
                '  ·  held ' + U.fmtDuration(d.holdingMs));
      svg.appendChild(g2);
    });

    svg.appendChild(el('text', { x: W - P.r, y: H - 10, 'text-anchor': 'end',
      class: 'axis-label' }, 'holding time →'));

    host.innerHTML = '';
    host.appendChild(svg);
  };

  /**
   * Compact money with the sign ahead of the currency symbol: -$4.1k, not
   * $-4.1k. Charts take this as `opts.format`.
   */
  Charts.money = function (currency) {
    return function (n) {
      return (n < 0 ? '-' : '') + (currency || '$') + shortMoney(Math.abs(n));
    };
  };

  Charts.shortMoney = shortMoney;
  root.Charts = Charts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
