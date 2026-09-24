/* ---------------------------------------------------------------------------
   Sample data so the dashboard has something to show on a first visit.
   Deterministic (seeded) so the demo looks the same every time.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var U = root.Util;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SYMBOLS = [
    { s: 'AAPL', px: 190, vol: 0.018, qty: 120 },
    { s: 'MSFT', px: 415, vol: 0.015, qty: 50 },
    { s: 'NVDA', px: 128, vol: 0.035, qty: 200 },
    { s: 'TSLA', px: 245, vol: 0.033, qty: 80 },
    { s: 'SPY',  px: 560, vol: 0.010, qty: 40 },
    { s: 'AMD',  px: 152, vol: 0.030, qty: 150 },
    { s: 'META', px: 520, vol: 0.022, qty: 40 },
    { s: 'COIN', px: 215, vol: 0.045, qty: 60 }
  ];
  var SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Trend continuation', 'Range fade', 'Gap fill'];
  var TAGCLOUD = ['earnings', 'gap-up', 'high-volume', 'premarket', 'fed-day', 'momentum', 'daily-level'];
  var MISTAKES = ['FOMO entry', 'Moved stop', 'Oversized', 'Early exit', 'Late entry', 'Revenge trade', 'Chased'];

  var NOTES_WIN = [
    'Clean break of the premarket high on strong volume. Sized properly, trailed behind the 5m structure.',
    'Waited for the retest instead of chasing. Entry was exactly at plan, exit at the measured move.',
    'Textbook setup. Held through the first pullback because the thesis had not broken.',
    'Took the trade off into strength rather than waiting for the target to print. Good discipline.'
  ];
  var NOTES_LOSS = [
    'Entered before the level confirmed. Stopped out almost immediately — this was impatience.',
    'Thesis invalidated on the macro print. Stop did its job, loss was within plan.',
    'Sized too large for a choppy tape, so the normal noise took me out.',
    'Chased an extended move after missing the first entry. Exactly the habit I am trying to break.'
  ];

  /**
   * Build a run of trades ending today, with a mild positive edge so the
   * equity curve has a believable shape (real drawdowns, not a straight line).
   */
  root.Demo = {
    generate: function (count, accountName) {
      count = count || 90;
      var rnd = mulberry32(20260924);
      var trades = [];
      var equity = 10000;                 // tracks the demo account balance
      var day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - Math.round(count * 1.6));

      for (var i = 0; i < count; i++) {
        // Advance 1-3 days, skipping weekends.
        day.setDate(day.getDate() + 1 + Math.floor(rnd() * 2));
        while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);

        var m = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)];
        var isLong = rnd() > 0.32;
        var dir = isLong ? 1 : -1;

        var entryPx = +(m.px * (1 + (rnd() - 0.5) * 0.08)).toFixed(2);
        var stopDist = +(entryPx * m.vol * (0.8 + rnd() * 0.8)).toFixed(2);
        var stop = +(entryPx - dir * stopDist).toFixed(2);
        var target = +(entryPx + dir * stopDist * (1.6 + rnd() * 1.6)).toFixed(2);
        // Risk-based sizing: ~1% of the running balance per trade, which is
        // what the risk budget in Settings assumes.
        var riskBudget = equity * (0.008 + rnd() * 0.006);
        var qty = Math.max(1, Math.round(riskBudget / stopDist));

        var hour = 9 + Math.floor(rnd() * 6);
        var minute = Math.floor(rnd() * 60);
        var entryDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);

        // ~46% of trades win, but winners run further than losers — the edge
        // comes from the payoff ratio, which is what a journal should reveal.
        var win = rnd() < 0.46;
        var rMult = win
          ? (0.7 + rnd() * 2.3)
          : -(0.45 + rnd() * 0.75);
        if (rnd() < 0.06) rMult = win ? rMult + 2.4 : rMult - 0.9;   // occasional outlier

        var exitPx = +(entryPx + dir * stopDist * rMult).toFixed(2);
        equity += (exitPx - entryPx) * qty * dir;

        var holdMin = Math.round(12 + rnd() * rnd() * 900);
        var exitDate = new Date(entryDate.getTime() + holdMin * 60000);

        var tags = [];
        if (rnd() < 0.5) tags.push(TAGCLOUD[Math.floor(rnd() * TAGCLOUD.length)]);
        if (rnd() < 0.25) tags.push(TAGCLOUD[Math.floor(rnd() * TAGCLOUD.length)]);

        var mistakes = [];
        if (!win && rnd() < 0.55) mistakes.push(MISTAKES[Math.floor(rnd() * MISTAKES.length)]);
        if (rnd() < 0.10) mistakes.push(MISTAKES[Math.floor(rnd() * MISTAKES.length)]);

        trades.push({
          id: U.uid(),
          symbol: m.s,
          direction: isLong ? 'long' : 'short',
          quantity: qty,
          entryPrice: entryPx,
          exitPrice: exitPx,
          entryDate: entryDate.getTime(),
          exitDate: exitDate.getTime(),
          stopPrice: stop,
          targetPrice: target,
          fees: +(1 + rnd() * 4).toFixed(2),
          strategy: SETUPS[Math.floor(rnd() * SETUPS.length)],
          tags: tags.filter(function (v, k, arr) { return arr.indexOf(v) === k; }),
          mistakes: mistakes.filter(function (v, k, arr) { return arr.indexOf(v) === k; }),
          rating: win ? 3 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3),
          notes: (win ? NOTES_WIN : NOTES_LOSS)[Math.floor(rnd() * 4)],
          account: accountName || 'Default',
          createdAt: Date.now()
        });
      }

      // Leave a couple of positions open so the open-risk view has content.
      for (var k = 0; k < 2; k++) {
        var mm = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)];
        var lng = rnd() > 0.4;
        var px = +(mm.px * (1 + (rnd() - 0.5) * 0.05)).toFixed(2);
        var sd = +(px * mm.vol * 1.2).toFixed(2);
        var oqty = Math.max(1, Math.round((equity * 0.01) / sd));
        var od = new Date();
        od.setDate(od.getDate() - k);
        od.setHours(10, 15, 0, 0);
        trades.push({
          id: U.uid(),
          symbol: mm.s,
          direction: lng ? 'long' : 'short',
          quantity: oqty,
          entryPrice: px,
          exitPrice: null,
          entryDate: od.getTime(),
          exitDate: null,
          stopPrice: +(px - (lng ? 1 : -1) * sd).toFixed(2),
          targetPrice: +(px + (lng ? 1 : -1) * sd * 2.2).toFixed(2),
          fees: 1.5,
          strategy: SETUPS[Math.floor(rnd() * SETUPS.length)],
          tags: ['swing'],
          mistakes: [],
          rating: null,
          notes: 'Still open — managing against the daily level.',
          account: accountName || 'Default',
          createdAt: Date.now()
        });
      }

      return trades;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
