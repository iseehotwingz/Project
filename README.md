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

## Use it on your phone

Three ways, best first.

**1. Host it and install it (recommended).** The app is a plain static site, so
GitHub Pages serves it as-is: repo **Settings → Pages → Source: Deploy from a
branch**, pick the branch and `/ (root)`. Open the resulting URL on your phone,
then:

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*

It then launches full-screen with its own icon, like any other app, and a
service worker caches the whole shell so it **works with no connection** — on a
plane, on the trading floor, anywhere. Verified by reloading with the network
disabled: the journal and charts come straight from cache.

**2. One file, no hosting.** `npm run build` produces
`dist/trading-journal.html` — the entire app inlined into a single 153 KB file
with no external references. AirDrop it, email it to yourself, or drop it in
iCloud/Drive and open it. Everything works except the offline service worker,
which needs a real URL (the file is already local, so it hardly matters).

**3. Just open it.** Any browser, any device, straight off disk.

## Use it on a PC

The hosted URL is the whole answer — open it in Chrome, Edge, Firefox or Safari
and it runs. No install, no Node, no server.

Chrome and Edge will also install it as a desktop app: open the URL and click
the install icon at the right of the address bar (or menu → *Cast, save and
share → Install page as app*). You get a windowed app with its own icon and the
same offline caching as the phone.

Prefer a file you own outright? Download `dist/trading-journal.html` and
double-click it. One file, works with no network at all.

Remember that each browser keeps its own storage, so your PC starts empty:
**Settings → Data → Import** pulls your journal across in one click.

Phones get larger controls automatically: 44px minimum tap targets, 16px inputs
so iOS doesn't zoom when you focus a field, a full-width bottom sheet for the
trade dialog, and safe-area padding around the notch and home indicator. None
of that changes the desktop layout — it is gated on `pointer: coarse`.

To load an existing journal onto a phone, skip the download-then-pick dance:
**Settings → Data** has an **Import** button with a URL beside it, prefilled
with `data/journal-seed.json`. One tap pulls the journal straight from the site
it is served from. It accepts any JSON backup or CSV URL, so you can point it at
your own backup anywhere that allows direct downloads.

### Your phone and your desktop are separate journals

Storage is per-browser and per-device, so trades logged on your phone do **not**
appear on your laptop. That is the cost of keeping everything local and private.
To move a journal across: **Settings → Export backup (JSON)** on one device,
then **Settings → Restore backup** on the other. Pick one device as the place
you actually log trades and treat the other as read-only, or you will end up
merging by hand.

## Your data

Everything lives in `localStorage` under the key `trading-journal/v1`. It is
never uploaded. Because it is per-browser and per-machine, **export a backup
regularly** — Settings → Export backup (JSON).

| Action | Where |
|---|---|
| CSV export (respects current filters) | Trades → Export CSV |
| CSV import | Trades → Import CSV |
| Import from a web address | Settings → Data → Import |
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
profit figure exactly. The builder asserts that for every row and fails on any
mismatch.

It also reconciles the account. MT5's summary covers the **lifetime** of the
account, including the period before the fresh start, so its $638.21 profit is
not this journal's. Backing the pre-reset period out:

| | |
|---|---|
| Fresh deposit, 2026.09.18 12:20:54 | $232.00 |
| Left over from the pre-reset account | $0.10 |
| **Opening equity** | **$232.10** |
| Profit over the 25 journalled deals | $278.11 |
| **Closing balance** | **$510.21** — matches MT5 exactly |

The pre-reset period accounts for the other $360.10 of lifetime profit. Because
the leftover from a reset account cannot exceed a rounding crumb, that figure
doubles as a completeness check: a missing or duplicated deal pushes it out of
range and the build fails. Run it with:

```
npm run seed
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
sw.js             service worker: caches the shell for offline use
manifest.webmanifest  home-screen install metadata
icons/            app icons (180/192/512 px)
dist/             single-file build (npm run build)
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
