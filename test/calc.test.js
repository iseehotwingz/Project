/* Unit tests for the trade maths. Run with: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.Util = require('../js/util.js');
const Calc = require('../js/calc.js');
const CSV = require('../js/csv.js');
const U = globalThis.Util;

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

/* ------------------------------- derive -------------------------------- */

test('long winner: P&L, fees, return and R', () => {
  const d = Calc.derive({
    symbol: 'aapl', direction: 'long', quantity: 100,
    entryPrice: 150, exitPrice: 155, stopPrice: 148, fees: 2,
    entryDate: '2026-03-02 09:30', exitDate: '2026-03-02 15:00'
  });
  assert.equal(d.symbol, 'AAPL');           // normalised to upper case
  close(d.grossPnl, 500);
  close(d.netPnl, 498);                     // fees deducted
  close(d.returnPct, 498 / 15000 * 100);
  close(d.plannedRisk, 200);                // |150-148| * 100
  close(d.rMultiple, 2.49);                 // net / risk, so fees count
  assert.equal(d.outcome, 'win');
  close(d.holdingMs, 5.5 * 3600000);
});

test('short winner: profit when price falls', () => {
  const d = Calc.derive({
    symbol: 'ES', direction: 'short', quantity: 2,
    entryPrice: 5000, exitPrice: 4950, stopPrice: 5015, fees: 4
  });
  close(d.grossPnl, 100);
  close(d.netPnl, 96);
  close(d.plannedRisk, 30);
  close(d.rMultiple, 3.2);
  assert.equal(d.outcome, 'win');
});

test('short loser: loss when price rises', () => {
  const d = Calc.derive({
    direction: 'short', quantity: 2, entryPrice: 5000, exitPrice: 5010,
    stopPrice: 5015, fees: 4, symbol: 'ES'
  });
  close(d.netPnl, -24);
  close(d.rMultiple, -0.8);
  assert.equal(d.outcome, 'loss');
});

test('open trade has no realised P&L', () => {
  const d = Calc.derive({ symbol: 'X', quantity: 10, entryPrice: 5, exitPrice: null });
  assert.equal(d.isOpen, true);
  assert.equal(d.netPnl, null);
  assert.equal(d.rMultiple, null);
  assert.equal(d.outcome, 'open');
});

test('no stop means no R multiple, but still a P&L', () => {
  const d = Calc.derive({ symbol: 'X', quantity: 10, entryPrice: 5, exitPrice: 6 });
  close(d.netPnl, 10);
  assert.equal(d.rMultiple, null);
  assert.equal(d.plannedRisk, null);
});

test('fees alone can turn a gross win into a net loss', () => {
  const d = Calc.derive({ symbol: 'X', quantity: 1, entryPrice: 100, exitPrice: 101, fees: 5 });
  close(d.grossPnl, 1);
  close(d.netPnl, -4);
  assert.equal(d.outcome, 'loss');          // outcome follows NET, not gross
});

test('exactly flat is breakeven, not a win', () => {
  const d = Calc.derive({ symbol: 'X', quantity: 1, entryPrice: 100, exitPrice: 100 });
  assert.equal(d.outcome, 'be');
});

test('planned R:R from stop and target', () => {
  const d = Calc.derive({
    symbol: 'X', direction: 'long', quantity: 10,
    entryPrice: 100, stopPrice: 98, targetPrice: 106
  });
  close(d.plannedRR, 3);                    // 6 up vs 2 down
});

/* -------------------------------- stats -------------------------------- */

function mk(net, extra = {}) {
  // Helper: a 1-unit trade whose net P&L is exactly `net` (no fees).
  return { symbol: 'T', direction: 'long', quantity: 1,
           entryPrice: 100, exitPrice: 100 + net, stopPrice: 99,
           entryDate: extra.d || '2026-01-05 10:00',
           exitDate: extra.d || '2026-01-05 12:00', ...extra };
}

test('aggregate stats over a known set', () => {
  const s = Calc.stats(Calc.deriveAll([
    mk(10), mk(20), mk(-5), mk(-15), mk(30)
  ]), 1000);

  assert.equal(s.closedTrades, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);
  close(s.netPnl, 40);
  close(s.grossProfit, 60);
  close(s.grossLoss, 20);
  close(s.profitFactor, 3);
  close(s.winRate, 60);
  close(s.expectancy, 8);
  close(s.avgWin, 20);
  close(s.avgLoss, -10);
  close(s.payoffRatio, 2);
  close(s.largestWin, 30);
  close(s.largestLoss, -15);
  close(s.endBalance, 1040);
  close(s.totalReturnPct, 4);
});

test('profit factor is infinite with no losers and null with no trades', () => {
  assert.equal(Calc.stats(Calc.deriveAll([mk(10)]), 0).profitFactor, Infinity);
  assert.equal(Calc.stats([], 0).profitFactor, null);
});

test('empty input produces a safe zeroed stat block', () => {
  const s = Calc.stats([], 500);
  assert.equal(s.totalTrades, 0);
  assert.equal(s.winRate, null);
  close(s.netPnl, 0);
  close(s.endBalance, 500);
  assert.equal(s.maxDrawdown, 0);
});

test('drawdown measures peak to trough, not start to end', () => {
  // +100 (peak 1100), -300 (trough 800), +150 (end 950)
  const s = Calc.stats(Calc.deriveAll([
    mk(100, { d: '2026-01-01 10:00' }),
    mk(-300, { d: '2026-01-02 10:00' }),
    mk(150, { d: '2026-01-03 10:00' })
  ]), 1000);
  close(s.netPnl, -50);
  close(s.maxDrawdown, -300);
  close(s.maxDrawdownPct, -300 / 1100 * 100);
});

test('streaks count consecutive outcomes in realised order', () => {
  const s = Calc.stats(Calc.deriveAll([
    mk(5,  { d: '2026-01-01 10:00' }),
    mk(5,  { d: '2026-01-02 10:00' }),
    mk(5,  { d: '2026-01-03 10:00' }),
    mk(-5, { d: '2026-01-04 10:00' }),
    mk(-5, { d: '2026-01-05 10:00' })
  ]), 0);
  assert.equal(s.maxWinStreak, 3);
  assert.equal(s.maxLossStreak, 2);
  assert.equal(s.currentStreak.type, 'loss');
  assert.equal(s.currentStreak.count, 2);
});

test('equity curve is ordered by exit time, not insertion order', () => {
  const s = Calc.stats(Calc.deriveAll([
    mk(100, { d: '2026-02-10 10:00' }),
    mk(-50, { d: '2026-01-10 10:00' })
  ]), 0);
  const eq = s.equityCurve.map(p => p.equity);
  assert.deepEqual(eq, [0, -50, 50]);       // January loss lands first
});

test('open trades are counted but excluded from realised metrics', () => {
  const s = Calc.stats(Calc.deriveAll([
    mk(100),
    { symbol: 'O', quantity: 1, entryPrice: 10, exitPrice: null, stopPrice: 9 }
  ]), 0);
  assert.equal(s.totalTrades, 2);
  assert.equal(s.closedTrades, 1);
  assert.equal(s.openTrades, 1);
  close(s.netPnl, 100);
  close(s.openRisk, 1);
});

test('grouping splits multi-valued keys like tags across groups', () => {
  const g = Calc.groupBy(Calc.deriveAll([
    { ...mk(10), mistakes: ['FOMO entry', 'Chased'] },
    { ...mk(-20), mistakes: ['FOMO entry'] }
  ]), t => (t.mistakes.length ? t.mistakes : null));

  const byKey = Object.fromEntries(g.map(x => [x.key, x]));
  assert.equal(byKey['FOMO entry'].count, 2);
  close(byKey['FOMO entry'].netPnl, -10);
  assert.equal(byKey['Chased'].count, 1);
});

test('monthly buckets are keyed by exit month and sorted', () => {
  const m = Calc.monthlyPnl(Calc.deriveAll([
    mk(10, { d: '2026-03-15 10:00' }),
    mk(20, { d: '2026-01-15 10:00' }),
    mk(-5, { d: '2026-03-20 10:00' })
  ]));
  assert.deepEqual(m.map(x => x.key), ['2026-01', '2026-03']);
  close(m[1].netPnl, 5);
  assert.equal(m[1].count, 2);
});

/* --------------------------------- CSV ---------------------------------- */

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = CSV.parse('a,b\n"x,1","line1\nline2"\n"he said ""hi""",z');
  assert.deepEqual(rows[1], ['x,1', 'line1\nline2']);
  assert.deepEqual(rows[2], ['he said "hi"', 'z']);
});

test('CSV import maps broker header aliases', () => {
  const r = CSV.toTrades(
    'Ticker,Side,Qty,Entry,Exit,Open Date,Commission\n' +
    'aapl,Buy,100,150,155,2026-03-02 09:30,1.5\n' +
    'tsla,Sell Short,50,240,235,2026-03-03,2\n', 'Main');
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].symbol, 'AAPL');
  assert.equal(r.trades[0].account, 'Main');
  assert.equal(r.trades[1].direction, 'short');
});

test('CSV import reports unusable rows instead of inventing data', () => {
  const r = CSV.toTrades('symbol,quantity,entryPrice\nAAPL,100,150\n,,\nMSFT,,\n');
  assert.equal(r.trades.length, 1);
  assert.equal(r.skipped, 1);               // the fully blank row is dropped as blank
  assert.ok(r.errors.length >= 1);
});

test('CSV import refuses a file with no symbol column', () => {
  const r = CSV.toTrades('foo,bar\n1,2\n');
  assert.equal(r.trades.length, 0);
  assert.match(r.errors[0], /symbol/);
});

test('export then re-import preserves the trade', () => {
  const original = {
    symbol: 'NVDA', direction: 'short', quantity: 25, entryPrice: 128.5,
    exitPrice: 121.25, stopPrice: 132, targetPrice: 118, fees: 3.4,
    entryDate: '2026-04-01 09:45', exitDate: '2026-04-01 14:10',
    strategy: 'Reversal', tags: ['gap-up'], mistakes: [], rating: 4,
    notes: 'Note with, a comma and "quotes"', account: 'Main'
  };
  const csv = CSV.fromTrades(Calc.deriveAll([original]));
  const back = CSV.toTrades(csv).trades[0];

  assert.equal(back.symbol, 'NVDA');
  assert.equal(back.direction, 'short');
  assert.equal(back.notes, original.notes);
  assert.equal(back.strategy, 'Reversal');
  close(back.fees, 3.4);

  const a = Calc.derive(original), b = Calc.derive(back);
  close(b.netPnl, a.netPnl);
  close(b.rMultiple, a.rMultiple);
});

/* -------------------------------- util ---------------------------------- */

test('number parsing survives currency symbols, commas and parentheses', () => {
  close(U.num('$1,234.50'), 1234.5);
  close(U.num('(250)'), -250);
  assert.equal(U.num(''), null);
  assert.equal(U.num('abc'), null);
  assert.equal(U.num(0), 0);
});

test('date parsing covers the formats the importer promises', () => {
  assert.ok(U.parseDate('2026-03-04') !== null);
  assert.ok(U.parseDate('2026-03-04 09:30') !== null);
  assert.ok(U.parseDate('3/4/2026') !== null);
  assert.equal(U.parseDate(''), null);
  assert.equal(U.parseDate('not a date'), null);
});

test('HTML escaping neutralises injected markup', () => {
  assert.equal(U.esc('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(U.esc('a"b\'c'), 'a&quot;b&#39;c');
});

test('epoch timestamps round-trip through parseDate', () => {
  // Dates are persisted as numbers, so this is the save/load path.
  const ms = new Date(2026, 2, 4, 9, 30).getTime();
  assert.equal(U.parseDate(ms), ms);
  assert.equal(U.parseDate(String(ms)), ms);
  assert.equal(U.parseDate(Math.floor(ms / 1000) + ''), Math.floor(ms / 1000) * 1000);
  assert.equal(U.parseDate(new Date(ms)), ms);
});

test('a reloaded trade keeps its dates and derived stats', () => {
  const stored = {
    symbol: 'AAPL', direction: 'long', quantity: 10, entryPrice: 100, exitPrice: 110,
    stopPrice: 95,
    entryDate: new Date(2026, 2, 4, 9, 30).getTime(),
    exitDate: new Date(2026, 2, 4, 15, 30).getTime()
  };
  const d = Calc.derive(stored);
  assert.equal(d.entryDate, stored.entryDate);
  close(d.holdingMs, 6 * 3600000);
  assert.equal(Calc.monthlyPnl([d]).length, 1);
  assert.equal(Calc.monthlyPnl([d])[0].key, '2026-03');
});

test('a zero-length hold reads as unknown, not as an instant trade', () => {
  // Brokers that export only the close time produce entry === exit.
  assert.equal(U.fmtDuration(0), '—');
  assert.equal(U.fmtDuration(null), '—');
  assert.equal(U.fmtDuration(90000), '2m');
});
