/* ---------------------------------------------------------------------------
   Build the journal seed files from the MT5 deal history.

   XAUUSD contract size is 100 oz per lot, so a 0.01 lot deal is 1 ounce.
   The journal stores quantity in ounces, which makes
       P&L = (exit - entry) * quantity * direction
   reproduce the broker's figure exactly. Every row below is checked against
   the profit MT5 reported; a mismatch fails the build.
--------------------------------------------------------------------------- */
globalThis.Util = require('../js/util.js');
const Calc = require('../js/calc.js');
const CSV = require('../js/csv.js');
const fs = require('fs');
const path = require('path');

const OZ_PER_LOT = 100;
const ACCOUNT = 'MT5 XAUUSD';

// MT5's summary covers the LIFETIME of the account, including the period
// before the fresh start, so its profit figure is not this journal's.
const MT5 = { deposit: 432.00, withdrawal: -560.00, profit: 638.21, balance: 510.21 };

// The fresh start: "Int. Trans. (Add Funds)" on 2026.09.18 12:20:54. The old
// account had not been withdrawn to exactly zero, so the real opening equity
// is that deposit plus whatever was left over (reconciled below).
const FRESH_DEPOSIT = 232.00;
const START_BALANCE = 232.10;

// lots, side, entry, exit, close time (local), profit as reported by MT5
const DEALS = [
  [0.01, 'sell', 4357.66, 4354.06,  '2026-09-18 17:06:01',   3.60],
  [0.01, 'sell', 4363.70, 4353.97,  '2026-09-18 17:06:04',   9.73],
  [0.01, 'sell', 4369.53, 4354.03,  '2026-09-18 17:06:17',  15.50],
  [0.01, 'sell', 4372.10, 4354.30,  '2026-09-18 17:44:29',  17.80],
  [0.01, 'sell', 4371.81, 4354.30,  '2026-09-18 17:44:29',  17.51],
  [0.01, 'buy',  4307.34, 4307.58,  '2026-09-22 11:14:07',   0.24],
  [0.01, 'buy',  4303.23, 4303.45,  '2026-09-22 11:14:59',   0.22],
  [0.01, 'buy',  4300.43, 4300.65,  '2026-09-22 11:17:46',   0.22],
  [0.01, 'sell', 4338.87, 4349.00,  '2026-09-22 20:53:37', -10.13],
  [0.01, 'sell', 4367.23, 4322.14,  '2026-09-23 10:30:38',  45.09],
  [0.01, 'sell', 4345.22, 4320.00,  '2026-09-23 11:28:47',  25.22],
  [0.01, 'sell', 4342.41, 4319.64,  '2026-09-23 11:28:53',  22.77],
  [0.01, 'sell', 4363.98, 4294.81,  '2026-09-23 21:01:11',  69.17],
  [0.01, 'sell', 4350.39, 4294.96,  '2026-09-23 21:02:02',  55.43],
  [0.01, 'buy',  4276.56, 4276.79,  '2026-09-24 10:59:24',   0.23],
  [0.01, 'sell', 4269.85, 4269.52,  '2026-09-24 11:31:07',   0.33],
  [0.01, 'buy',  4268.24, 4265.13,  '2026-09-24 12:02:04',  -3.11],
  [0.05, 'buy',  4261.35, 4261.53,  '2026-09-24 12:03:22',   0.90],
  [0.05, 'buy',  4261.14, 4261.26,  '2026-09-24 12:19:13',   0.60],
  [0.02, 'buy',  4262.58, 4252.28,  '2026-09-24 12:43:33', -20.60],
  [0.02, 'buy',  4256.85, 4252.19,  '2026-09-24 12:43:33',  -9.32],
  [0.02, 'buy',  4255.22, 4252.28,  '2026-09-24 12:43:33',  -5.88],
  [0.05, 'buy',  4254.25, 4252.31,  '2026-09-24 12:43:33',  -9.70],
  [0.05, 'buy',  4253.26, 4252.37,  '2026-09-24 12:43:33',  -4.45],
  [0.05, 'buy',  4252.10, 4263.448, '2026-09-24 17:58:15',  56.74]
];

// Guard against the same deal being transcribed twice from overlapping
// screenshots — the history screens scroll, so batches share rows.
const seen = new Set();
DEALS.forEach(([lots, side, entry, exit, closeTime], i) => {
  const k = [lots, side, entry, exit, closeTime].join('|');
  if (seen.has(k)) {
    console.error(`Duplicate deal at row ${i + 1}: ${k}`);
    process.exit(1);
  }
  seen.add(k);
});

const trades = DEALS.map(([lots, side, entry, exit, closeTime, reported], i) => ({
  id: 'mt5_' + String(i + 1).padStart(3, '0'),
  symbol: 'XAUUSD',
  direction: side === 'sell' ? 'short' : 'long',
  quantity: +(lots * OZ_PER_LOT).toFixed(2),
  entryPrice: entry,
  exitPrice: exit,
  // MT5's history lists the CLOSE time. The open time is not in the export,
  // so entry is recorded at the same stamp rather than invented.
  entryDate: Util.parseDate(closeTime),
  exitDate: Util.parseDate(closeTime),
  stopPrice: null,
  targetPrice: null,
  fees: 0,                       // MT5 reports swap 0.00 and commission 0.00
  strategy: '',
  tags: [lots + ' lot'],
  mistakes: [],
  rating: null,
  notes: '',
  account: ACCOUNT,
  createdAt: Date.now(),
  _reported: reported
}));

// A deterministic identity per deal, matching what the app derives on import.
// This is what lets a later, larger export merge in cleanly: trades already in
// the journal are recognised and updated, and only genuinely new ones are added.
trades.forEach(t => { t.externalId = Util.externalKey(t); });
const ids = new Set(trades.map(t => t.externalId));
if (ids.size !== trades.length) {
  console.error('externalId collision — two deals hash to the same identity.');
  process.exit(1);
}

// ---- verify every row against the broker's own profit figure --------------
let bad = 0, total = 0;
trades.forEach((t, i) => {
  const d = Calc.derive(t);
  const diff = Math.abs(d.netPnl - t._reported);
  total += t._reported;
  if (diff > 0.005) {
    bad++;
    console.error(`MISMATCH row ${i + 1}: computed ${d.netPnl.toFixed(2)} vs MT5 ${t._reported}`);
  }
});
if (bad) { console.error(`${bad} rows do not reconcile — aborting.`); process.exit(1); }
console.log(`✓ all ${trades.length} deals reconcile with the MT5 profit column`);
console.log(`  transcribed profit: ${total.toFixed(2)}`);

// ---- reconcile the fresh start against the account-level summary ---------
// MT5's own cash identity must hold, or a summary figure was misread.
const identity = +(MT5.deposit + MT5.withdrawal + MT5.profit).toFixed(2);
if (Math.abs(identity - MT5.balance) > 0.005) {
  console.error(`MT5 summary does not balance: ${identity} vs ${MT5.balance}`);
  process.exit(1);
}

// Back out what the pre-reset account left behind. If deals since the reset
// were missing, this residual would come out negative (or implausibly large),
// because the leftover cannot exceed a rounding crumb.
const oldProfit = +(MT5.profit - total).toFixed(2);
const residual  = +((MT5.deposit - FRESH_DEPOSIT) + MT5.withdrawal + oldProfit).toFixed(2);
const implied   = +(FRESH_DEPOSIT + residual).toFixed(2);

if (residual < 0 || residual >= 1) {
  console.error(`Implied leftover from the old account is ${residual} — that points ` +
                `to deals missing from (or duplicated in) the list above.`);
  process.exit(1);
}
if (Math.abs(implied - START_BALANCE) > 0.005) {
  console.error(`START_BALANCE should be ${implied}, not ${START_BALANCE}.`);
  process.exit(1);
}
console.log(`✓ fresh start reconciles: ${FRESH_DEPOSIT.toFixed(2)} deposited ` +
            `+ ${residual.toFixed(2)} left from the old account = ${implied.toFixed(2)}`);
console.log(`  pre-reset period accounts for the other ${oldProfit.toFixed(2)} of lifetime profit`);

trades.forEach(t => delete t._reported);

const doc = {
  schema: 1,
  trades,
  accounts: [{ id: 'mt5', name: ACCOUNT, startBalance: START_BALANCE }],
  settings: {
    currency: '$',
    riskPct: 2,
    theme: 'dark',
    // Check the published CSV on every open and pull in anything new. Additive
    // only, so a sync can never overwrite notes or delete a trade.
    syncUrl: 'data/my-trades.csv',
    autoSync: true,
    strategies: ['Breakout', 'Pullback', 'Reversal', 'Trend continuation',
                 'Range fade', 'Scalp', 'News catalyst'],
    mistakeTags: ['FOMO entry', 'No stop', 'Moved stop', 'Oversized',
                  'Averaged down', 'Early exit', 'Late entry', 'Revenge trade',
                  'Broke plan', 'Chased']
  }
};

const out = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(out, 'my-trades.csv'), CSV.fromTrades(Calc.deriveAll(trades)) + '\n');
fs.writeFileSync(path.join(out, 'journal-seed.json'), JSON.stringify(doc, null, 2) + '\n');

const s = Calc.stats(Calc.deriveAll(trades), START_BALANCE);
console.log(`  net P&L ${s.netPnl.toFixed(2)} · ${s.wins}W/${s.losses}L · ` +
            `win rate ${s.winRate.toFixed(1)}% · PF ${s.profitFactor.toFixed(2)} · ` +
            `balance ${s.endBalance.toFixed(2)}`);

// The journal's closing balance must land on the broker's, to the cent.
if (Math.abs(s.endBalance - MT5.balance) > 0.005) {
  console.error(`Closing balance ${s.endBalance.toFixed(2)} != MT5 ${MT5.balance.toFixed(2)}`);
  process.exit(1);
}
console.log(`✓ closing balance matches the MT5 balance of ${MT5.balance.toFixed(2)}`);
console.log(`✓ ${ids.size} distinct trade identities (safe to re-import)`);
console.log('  wrote data/my-trades.csv and data/journal-seed.json');
