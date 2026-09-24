# Trading Journal

A self-contained trading journal that runs from a single HTML file. No build
step, no server, no dependencies, no network calls. Your trades are stored in
your browser's local storage and never leave your machine.

```
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

## What it does

**Dashboard** — net P&L, win rate, profit factor, expectancy, average win/loss,
max drawdown, open risk and current streak, above an equity curve (in currency
or in R), monthly P&L, the win/loss split and an underwater drawdown plot.

**Trade log** — every trade with computed net P&L, R multiple, return and
holding time. Sortable, filterable by date range, account, side, status,
result, setup, symbol, and free-text search across notes and tags.

**Analytics** — performance broken down by setup, symbol, direction, weekday,
hour of entry and mistake tag, plus an R-multiple histogram, a holding-time
scatter and a 36-line statistics table (SQN, recovery factor, payoff ratio,
streaks, per-day averages and the rest).

**Logging a trade** — symbol, side, size, entry/exit, stop, target, fees,
setup, tags, mistake tags, an execution grade and free-form notes. The dialog
computes P&L, return, risk at stop, R multiple and planned R:R as you type, and
warns when the position risks more than your configured budget.

Leave the exit price blank and the trade stays open: it is excluded from
realised performance but counted in open risk.

## Your data

Everything lives in `localStorage` under the key `trading-journal/v1`. It is
never uploaded. Because it is per-browser and per-machine, **export a backup
regularly** — Settings → Export backup (JSON).

| Action | Where |
|---|---|
| CSV export (respects current filters) | Trades → Export CSV |
| CSV import | Trades → Import CSV |
| Full backup / restore | Settings → Data |
| Sample data to explore the UI | Settings → Load demo data |

### Importing a CSV

A header row is required; column names are matched case-insensitively and
common broker spellings are accepted (`ticker`/`symbol`, `qty`/`size`/`volume`,
`side`/`direction`, `commission`/`fees`, and so on). Extra columns are ignored.

```
symbol, direction, quantity, entryPrice, exitPrice, entryDate, exitDate,
stopPrice, targetPrice, fees, strategy, tags, mistakes, rating, notes, account
```

Dates accept `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` or `MM/DD/YYYY`. Direction accepts
long/short/buy/sell. A blank `exitPrice` means the position is still open. Rows
missing a symbol, quantity or entry price are reported rather than guessed at.

## Seeded data

`data/` holds the journal seeded from the MT5 XAUUSD history in
`tools/build-seed.js`:

- `journal-seed.json` — full backup (account, starting balance, 25 trades).
  Restore it via Settings → Restore backup.
- `my-trades.csv` — the same trades as CSV.

Gold is 100 oz per lot, so quantity is stored in **ounces** (0.01 lot = 1 oz),
which makes `(exit − entry) × quantity × direction` reproduce the broker's
profit figure exactly. `tools/build-seed.js` asserts that for every row and
fails the build on any mismatch:

```
node tools/build-seed.js
```

## How the numbers are defined

| Metric | Definition |
|---|---|
| Net P&L | `(exit − entry) × quantity × direction − fees` |
| Outcome | decided on **net** P&L, so fees can turn a gross win into a loss |
| Return | net P&L over position notional (`entry × quantity`) — on leveraged products this is not return on account equity |
| Planned risk | `|entry − stop| × quantity`; without a stop there is no R |
| R multiple | net P&L ÷ planned risk, so fees count against R |
| Profit factor | gross profit ÷ gross loss; `∞` with winners and no losers |
| Expectancy | net P&L ÷ closed trades |
| Max drawdown | largest peak-to-trough fall of the equity curve, ordered by exit time |
| SQN | mean trade ÷ std dev × √n |
| Breakeven | net P&L within a rounding tolerance of zero — counted separately, excluded from win rate |

Open trades are counted and contribute to open risk, but never to realised
performance. R-based metrics only cover trades that recorded a stop, and the
trade count behind them is shown so a partial sample is never mistaken for the
whole.

## Tests

```
npm test
```

28 tests over the P&L maths, aggregate statistics, drawdown, streaks, grouping,
CSV round-tripping and date handling.

## Layout

```
index.html        markup and the trade dialog
styles.css        themes (dark/light) and layout
js/util.js        parsing, formatting, small maths helpers
js/store.js       localStorage persistence, accounts, settings
js/calc.js        trade derivation and statistics  (pure, unit tested)
js/charts.js      hand-rolled inline SVG charts
js/csv.js         CSV parse/serialise               (pure, unit tested)
js/demo.js        seeded sample data
js/app.js         wiring, filtering, rendering
tools/            seed builder for the MT5 history
data/             seeded journal (JSON backup + CSV)
test/             node --test suite
```

Charts are hand-drawn SVG that read their colours from CSS custom properties,
so both themes work without a redraw path. Profit and loss is a diverging
encoding: the green/red pair is validated for colour-vision deficiency, and the
sign is always carried by position relative to the zero baseline and by signed
labels as well as by colour.

## Keyboard

- `n` — log a new trade
- `/` — jump to search
- `Esc` — close the dialog
