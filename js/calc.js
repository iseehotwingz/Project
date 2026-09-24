/* ---------------------------------------------------------------------------
   Trade maths: per-trade derived fields and aggregate performance statistics.
   Pure functions — no DOM, no storage — so they can be unit tested in Node.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);
  var Calc = {};

  /**
   * Derive every computed field for a single trade.
   * A trade is "closed" once it has a numeric exit price; otherwise it is open
   * and contributes no realised P&L.
   */
  Calc.derive = function (t) {
    var dir = t.direction === 'short' ? -1 : 1;
    var qty = U.num(t.quantity) || 0;
    var entry = U.num(t.entryPrice);
    var exit = U.num(t.exitPrice);
    var stop = U.num(t.stopPrice);
    var target = U.num(t.targetPrice);
    var fees = U.num(t.fees) || 0;

    var d = {
      id: t.id,
      symbol: (t.symbol || '').toUpperCase(),
      direction: t.direction === 'short' ? 'short' : 'long',
      account: t.account || 'Default',
      quantity: qty,
      entryPrice: entry,
      exitPrice: exit,
      stopPrice: stop,
      targetPrice: target,
      fees: fees,
      strategy: t.strategy || '',
      tags: U.splitList(t.tags),
      mistakes: U.splitList(t.mistakes),
      rating: U.num(t.rating),
      notes: t.notes || '',
      entryDate: U.parseDate(t.entryDate),
      exitDate: U.parseDate(t.exitDate),
      isOpen: exit === null
    };

    // Capital committed at entry (notional). Used for percentage return.
    d.costBasis = (entry !== null && qty) ? Math.abs(entry * qty) : null;

    if (d.isOpen || entry === null) {
      d.grossPnl = null;
      d.netPnl = null;
      d.returnPct = null;
      d.rMultiple = null;
      d.holdingMs = null;
      d.outcome = 'open';
    } else {
      d.grossPnl = (exit - entry) * qty * dir;
      d.netPnl = d.grossPnl - fees;
      d.returnPct = d.costBasis ? (d.netPnl / d.costBasis) * 100 : null;
      d.holdingMs = (d.entryDate !== null && d.exitDate !== null) ? d.exitDate - d.entryDate : null;
      // Breakeven band: anything inside a tenth of a currency unit is "flat".
      d.outcome = d.netPnl > 1e-9 ? 'win' : (d.netPnl < -1e-9 ? 'loss' : 'be');
    }

    // Planned risk: distance to stop, only meaningful when the stop sits on the
    // losing side of the entry.
    d.riskPerUnit = (stop !== null && entry !== null) ? Math.abs(entry - stop) : null;
    d.plannedRisk = (d.riskPerUnit !== null && qty) ? d.riskPerUnit * qty : null;
    d.plannedReward = (target !== null && entry !== null && qty)
      ? Math.abs(target - entry) * qty : null;
    d.plannedRR = (d.plannedRisk && d.plannedReward) ? d.plannedReward / d.plannedRisk : null;

    if (!d.isOpen && d.plannedRisk && d.plannedRisk > 0 && d.netPnl !== null) {
      d.rMultiple = d.netPnl / d.plannedRisk;
    } else {
      d.rMultiple = null;
    }

    d.raw = t;
    return d;
  };

  Calc.deriveAll = function (trades) {
    return trades.map(Calc.derive);
  };

  /** Chronological order by exit (falling back to entry) — the order P&L lands. */
  Calc.byRealisedTime = function (a, b) {
    var ta = a.exitDate !== null ? a.exitDate : a.entryDate;
    var tb = b.exitDate !== null ? b.exitDate : b.entryDate;
    return (ta || 0) - (tb || 0);
  };

  /**
   * Equity curve over closed trades.
   * Returns points including an origin point at the starting balance.
   */
  Calc.equityCurve = function (derived, startBalance) {
    var closed = derived.filter(function (d) { return !d.isOpen; }).sort(Calc.byRealisedTime);
    var eq = startBalance || 0;
    var rEq = 0;
    var peak = eq;
    var rPeak = 0;
    var pts = [{ t: closed.length ? (closed[0].exitDate || closed[0].entryDate) : null,
                 equity: eq, r: 0, drawdown: 0, drawdownPct: 0, index: 0, trade: null }];

    for (var i = 0; i < closed.length; i++) {
      var d = closed[i];
      eq += d.netPnl;
      rEq += (d.rMultiple || 0);
      if (eq > peak) peak = eq;
      if (rEq > rPeak) rPeak = rEq;
      pts.push({
        t: d.exitDate || d.entryDate,
        equity: eq,
        r: rEq,
        drawdown: eq - peak,
        drawdownPct: peak > 0 ? ((eq - peak) / peak) * 100 : 0,
        index: i + 1,
        trade: d
      });
    }
    return pts;
  };

  /** Longest run of a given outcome in chronological order. */
  function longestStreak(closed, outcome) {
    var best = 0, cur = 0;
    for (var i = 0; i < closed.length; i++) {
      if (closed[i].outcome === outcome) { cur++; if (cur > best) best = cur; }
      else cur = 0;
    }
    return best;
  }

  /** Current run at the end of the series: {type, count}. */
  function currentStreak(closed) {
    if (!closed.length) return { type: null, count: 0 };
    var last = closed[closed.length - 1].outcome;
    if (last === 'be') return { type: 'be', count: 1 };
    var n = 0;
    for (var i = closed.length - 1; i >= 0; i--) {
      if (closed[i].outcome === last) n++; else break;
    }
    return { type: last, count: n };
  }

  /**
   * Aggregate statistics over a set of derived trades.
   * Open trades are counted but excluded from realised performance metrics.
   */
  Calc.stats = function (derived, startBalance) {
    startBalance = startBalance || 0;
    var closed = derived.filter(function (d) { return !d.isOpen; }).sort(Calc.byRealisedTime);
    var open = derived.filter(function (d) { return d.isOpen; });

    var wins = closed.filter(function (d) { return d.outcome === 'win'; });
    var losses = closed.filter(function (d) { return d.outcome === 'loss'; });
    var bes = closed.filter(function (d) { return d.outcome === 'be'; });

    var grossProfit = U.sum(wins, function (d) { return d.netPnl; });
    var grossLoss = Math.abs(U.sum(losses, function (d) { return d.netPnl; }));
    var netPnl = U.sum(closed, function (d) { return d.netPnl; });
    var totalFees = U.sum(closed, function (d) { return d.fees; }) +
                    U.sum(open, function (d) { return d.fees; });

    var s = {
      totalTrades: derived.length,
      closedTrades: closed.length,
      openTrades: open.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: bes.length,
      netPnl: netPnl,
      grossProfit: grossProfit,
      grossLoss: grossLoss,
      totalFees: totalFees,
      startBalance: startBalance,
      endBalance: startBalance + netPnl
    };

    var decisive = wins.length + losses.length;
    s.winRate = decisive ? (wins.length / decisive) * 100 : null;
    s.winRateAll = closed.length ? (wins.length / closed.length) * 100 : null;

    // Profit factor: infinite when there are winners but no losers.
    if (grossLoss > 0) s.profitFactor = grossProfit / grossLoss;
    else s.profitFactor = grossProfit > 0 ? Infinity : null;

    s.avgWin = wins.length ? grossProfit / wins.length : null;
    s.avgLoss = losses.length ? -grossLoss / losses.length : null;
    s.payoffRatio = (s.avgWin !== null && s.avgLoss) ? Math.abs(s.avgWin / s.avgLoss) : null;
    s.expectancy = closed.length ? netPnl / closed.length : null;
    s.medianPnl = U.median(closed.map(function (d) { return d.netPnl; }));

    s.largestWin = wins.length ? Math.max.apply(null, wins.map(function (d) { return d.netPnl; })) : null;
    s.largestLoss = losses.length ? Math.min.apply(null, losses.map(function (d) { return d.netPnl; })) : null;

    s.totalReturnPct = startBalance > 0 ? (netPnl / startBalance) * 100 : null;

    // R-based metrics only over trades that recorded a stop.
    var rs = closed.filter(function (d) { return d.rMultiple !== null; })
                   .map(function (d) { return d.rMultiple; });
    s.tradesWithR = rs.length;
    s.totalR = rs.length ? U.sum(rs) : null;
    s.avgR = rs.length ? U.sum(rs) / rs.length : null;
    s.bestR = rs.length ? Math.max.apply(null, rs) : null;
    s.worstR = rs.length ? Math.min.apply(null, rs) : null;

    // Per-trade dispersion. Not annualised — it describes trade quality spread.
    var pnls = closed.map(function (d) { return d.netPnl; });
    var sd = U.stdev(pnls);
    s.stdevPnl = sd;
    s.systemQuality = (sd && sd > 0 && closed.length)
      ? (U.mean(pnls) / sd) * Math.sqrt(closed.length) : null;

    s.maxWinStreak = longestStreak(closed, 'win');
    s.maxLossStreak = longestStreak(closed, 'loss');
    s.currentStreak = currentStreak(closed);

    var curve = Calc.equityCurve(closed, startBalance);
    s.equityCurve = curve;
    var maxDD = 0, maxDDPct = 0;
    for (var i = 0; i < curve.length; i++) {
      if (curve[i].drawdown < maxDD) maxDD = curve[i].drawdown;
      if (curve[i].drawdownPct < maxDDPct) maxDDPct = curve[i].drawdownPct;
    }
    s.maxDrawdown = maxDD;
    s.maxDrawdownPct = startBalance > 0 ? maxDDPct : null;
    s.recoveryFactor = (maxDD < 0 && netPnl > 0) ? netPnl / Math.abs(maxDD) : null;

    var holds = closed.map(function (d) { return d.holdingMs; })
                      .filter(function (x) { return x !== null && x >= 0; });
    s.avgHoldMs = holds.length ? U.mean(holds) : null;
    s.avgHoldWinMs = U.mean(wins.map(function (d) { return d.holdingMs; })
                                .filter(function (x) { return x !== null && x >= 0; })) ;
    s.avgHoldLossMs = U.mean(losses.map(function (d) { return d.holdingMs; })
                                   .filter(function (x) { return x !== null && x >= 0; }));

    // Trading days covered and per-day averages.
    var days = {};
    closed.forEach(function (d) {
      var t = d.exitDate || d.entryDate;
      if (t !== null) days[U.fmtDate(t)] = true;
    });
    s.tradingDays = Object.keys(days).length;
    s.avgPerDay = s.tradingDays ? netPnl / s.tradingDays : null;
    s.avgTradesPerDay = s.tradingDays ? closed.length / s.tradingDays : null;

    s.openRisk = U.sum(open, function (d) { return d.plannedRisk || 0; });

    return s;
  };

  /**
   * Group derived trades by a key and compute a compact stat block per group.
   * keyFn may return a string or an array of strings (for tags/mistakes).
   */
  Calc.groupBy = function (derived, keyFn, startBalance) {
    var map = {};
    derived.forEach(function (d) {
      var keys = keyFn(d);
      if (keys === null || keys === undefined) return;
      if (!Array.isArray(keys)) keys = [keys];
      keys.forEach(function (k) {
        k = (k === '' || k === null || k === undefined) ? '—' : String(k);
        (map[k] || (map[k] = [])).push(d);
      });
    });

    return Object.keys(map).map(function (k) {
      var st = Calc.stats(map[k], 0);
      return {
        key: k,
        trades: map[k],
        count: map[k].length,
        closed: st.closedTrades,
        netPnl: st.netPnl,
        winRate: st.winRate,
        profitFactor: st.profitFactor,
        expectancy: st.expectancy,
        avgR: st.avgR,
        totalR: st.totalR
      };
    }).sort(function (a, b) { return b.netPnl - a.netPnl; });
  };

  /** Monthly buckets in realised order: [{key:'2026-03', netPnl, count}] */
  Calc.monthlyPnl = function (derived) {
    var map = {};
    derived.filter(function (d) { return !d.isOpen; }).forEach(function (d) {
      var t = d.exitDate || d.entryDate;
      if (t === null) return;
      var k = U.monthKey(t);
      if (!map[k]) map[k] = { key: k, netPnl: 0, count: 0, wins: 0 };
      map[k].netPnl += d.netPnl;
      map[k].count++;
      if (d.outcome === 'win') map[k].wins++;
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  };

  /** Histogram of R multiples into fixed buckets. */
  Calc.rHistogram = function (derived) {
    var edges = [-Infinity, -3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, Infinity];
    var labels = ['<-3', '-3..-2', '-2..-1.5', '-1.5..-1', '-1..-0.5', '-0.5..0',
                  '0..0.5', '0.5..1', '1..1.5', '1.5..2', '2..3', '>3'];
    var buckets = labels.map(function (l) { return { label: l, count: 0 }; });
    derived.forEach(function (d) {
      if (d.rMultiple === null) return;
      for (var i = 0; i < buckets.length; i++) {
        if (d.rMultiple >= edges[i] && d.rMultiple < edges[i + 1]) { buckets[i].count++; break; }
      }
    });
    return buckets;
  };

  root.Calc = Calc;
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
