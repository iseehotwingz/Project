/* ---------------------------------------------------------------------------
   Application controller: wiring, filtering, rendering.
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  var U = Util, S = Store, C = Calc, CH = Charts;

  var state = {
    view: 'dashboard',
    sort: { key: 'entryDate', dir: -1 },
    equityMode: 'currency',
    editingId: null,
    pendingImportKind: null,
    filters: { search: '', account: '', from: '', to: '', direction: '', status: '', result: '', strategy: '', symbol: '' }
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ------------------------------- toasts ------------------------------- */

  function toast(msg, kind) {
    var host = $('#toast-host');
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, kind === 'err' ? 5200 : 2800);
  }

  /* ------------------------------ filtering ----------------------------- */

  function currentAccount() {
    return state.filters.account || null;
  }

  /** Starting balance for whichever account scope is in view. */
  function scopeStartBalance() {
    var accts = S.accounts();
    if (state.filters.account) {
      var a = S.account(state.filters.account);
      return a ? (U.num(a.startBalance) || 0) : 0;
    }
    return U.sum(accts, function (x) { return U.num(x.startBalance) || 0; });
  }

  function filtered() {
    var f = state.filters;
    var all = C.deriveAll(S.trades());
    var fromMs = f.from ? U.parseDate(f.from) : null;
    var toMs = f.to ? U.parseDate(f.to) + 86399999 : null;   // inclusive end of day
    var q = f.search.trim().toLowerCase();

    return all.filter(function (d) {
      if (f.account && d.account !== f.account) return false;
      if (f.direction && d.direction !== f.direction) return false;
      if (f.status === 'open' && !d.isOpen) return false;
      if (f.status === 'closed' && d.isOpen) return false;
      if (f.result) {
        if (d.isOpen) return false;
        if (d.outcome !== f.result) return false;
      }
      if (f.strategy && d.strategy !== f.strategy) return false;
      if (f.symbol && d.symbol !== f.symbol) return false;

      // Date filter runs against the entry date — that is when the decision
      // was made, which is what a journal is reviewing.
      if (fromMs !== null && (d.entryDate === null || d.entryDate < fromMs)) return false;
      if (toMs !== null && (d.entryDate === null || d.entryDate > toMs)) return false;

      if (q) {
        var hay = [d.symbol, d.strategy, d.notes, d.account,
                   d.tags.join(' '), d.mistakes.join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function cur() { return S.settings().currency || '$'; }
  /** Compact money for chart axes and tight tiles: -$4.1k. */
  function shortCur(n) { return CH.money(cur())(n); }
  function money(n, dec) { return U.fmtMoney(n, cur(), dec); }
  function signedMoney(n, dec) { return U.fmtSignedMoney(n, cur(), dec); }

  /* ------------------------------ rendering ----------------------------- */

  function render() {
    var d = filtered();
    var stats = C.stats(d, scopeStartBalance());

    $('#filter-count').textContent = d.length === S.trades().length
      ? d.length + ' trades'
      : d.length + ' of ' + S.trades().length + ' trades';

    if (state.view === 'dashboard') renderDashboard(d, stats);
    if (state.view === 'trades') renderTrades(d, stats);
    if (state.view === 'analytics') renderAnalytics(d, stats);
    if (state.view === 'settings') renderSettings();
  }

  function kpi(label, value, sub, cls, bar) {
    return '<div class="kpi">' +
      '<div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value ' + (cls || '') + '">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      (bar || '') +
      '</div>';
  }

  function renderDashboard(d, s) {
    var pf = s.profitFactor === null ? '—'
           : (s.profitFactor === Infinity ? '∞' : U.fmtNum(s.profitFactor, 2));
    var streak = s.currentStreak.count
      ? s.currentStreak.count + ' ' + (s.currentStreak.type === 'win' ? 'win' : s.currentStreak.type === 'loss' ? 'loss' : 'flat') +
        (s.currentStreak.count > 1 ? 's' : '') + ' in a row'
      : '—';

    var wrBar = s.winRate === null ? '' :
      '<div class="kpi-bar"><i style="width:' + U.clamp(s.winRate, 0, 100) + '%;background:var(--win)"></i></div>';

    $('#kpi-grid').innerHTML = [
      kpi('Net P&L', signedMoney(s.netPnl), 
          s.totalReturnPct === null ? s.closedTrades + ' closed' : U.fmtPct(s.totalReturnPct) + ' on start balance',
          U.pnlClass(s.netPnl)),
      kpi('Win rate', s.winRate === null ? '—' : U.fmtPct(s.winRate),
          s.wins + 'W · ' + s.losses + 'L' + (s.breakeven ? ' · ' + s.breakeven + 'BE' : ''),
          '', wrBar),
      kpi('Profit factor', pf,
          money(s.grossProfit, 0) + ' won / ' + money(s.grossLoss, 0) + ' lost',
          s.profitFactor !== null && s.profitFactor !== Infinity
            ? (s.profitFactor >= 1 ? 'pos' : 'neg') : ''),
      kpi('Expectancy', s.expectancy === null ? '—' : signedMoney(s.expectancy),
          'per trade' + (s.avgR !== null ? ' · ' + U.fmtR(s.avgR) + ' avg' : ''),
          U.pnlClass(s.expectancy)),
      kpi('Avg win / loss', 
          (s.avgWin === null ? '—' : shortCur(s.avgWin)) + ' / ' +
          (s.avgLoss === null ? '—' : shortCur(Math.abs(s.avgLoss))),
          s.payoffRatio === null ? 'no pairs yet' : U.fmtNum(s.payoffRatio, 2) + ':1 payoff'),
      kpi('Max drawdown', s.maxDrawdown ? money(s.maxDrawdown) : money(0),
          s.maxDrawdownPct !== null ? U.fmtPct(s.maxDrawdownPct) + ' peak-to-trough' : 'peak to trough',
          s.maxDrawdown < 0 ? 'neg' : ''),
      kpi('Open positions', String(s.openTrades),
          s.openRisk ? money(s.openRisk, 0) + ' risk at stop' : 'no risk recorded'),
      kpi('Current streak', streak.split(' ')[0] === '—' ? '—' : String(s.currentStreak.count),
          streak === '—' ? 'no closed trades' : streak,
          s.currentStreak.type === 'win' ? 'pos' : s.currentStreak.type === 'loss' ? 'neg' : '')
    ].join('');

    var curveSource = C.equityCurve(d, state.equityMode === 'r' ? 0 : scopeStartBalance());
    if (state.equityMode === 'r') {
      CH.equityCurve($('#chart-equity'), curveSource, {
        value: function (p) { return p.r; },
        format: function (v) { return U.fmtNum(v, 1) + 'R'; },
        baseline: 0
      });
    } else {
      CH.equityCurve($('#chart-equity'), curveSource, {
        format: shortCur,
        baseline: scopeStartBalance()
      });
    }

    var months = C.monthlyPnl(d).map(function (m) {
      var parts = m.key.split('-');
      var dt = new Date(+parts[0], +parts[1] - 1, 1);
      return {
        label: dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        short: dt.toLocaleDateString('en-US', { month: 'short' }),
        value: m.netPnl,
        sub: m.count + ' trades, ' + (m.count ? Math.round((m.wins / m.count) * 100) : 0) + '% won'
      };
    });
    CH.divergingBars($('#chart-monthly'), months, {
      format: shortCur,
      emptyMsg: 'No closed trades yet',
      ariaLabel: 'Net profit and loss by month'
    });

    CH.winLossSplit($('#chart-winloss'), s);
    CH.drawdown($('#chart-drawdown'), s.equityCurve, { format: shortCur });

    renderTradeRows($('#recent-trades'), d.slice().sort(function (a, b) {
      return (b.entryDate || 0) - (a.entryDate || 0);
    }).slice(0, 8), true);
  }

  /* -------------------------------- trades ------------------------------ */

  function outcomeCell(d) {
    if (d.isOpen) return '<span class="badge badge-open">OPEN</span>';
    return '<span class="' + U.pnlClass(d.netPnl) + '">' + signedMoney(d.netPnl) + '</span>';
  }

  function tradeRow(d) {
    return '<tr data-id="' + U.esc(d.id) + '">' +
      '<td>' + U.fmtDate(d.entryDate, true) + '</td>' +
      '<td><span class="sym">' + U.esc(d.symbol) + '</span></td>' +
      '<td><span class="badge badge-' + d.direction + '">' + d.direction.toUpperCase() + '</span></td>' +
      '<td class="num">' + U.fmtNum(d.quantity, d.quantity % 1 ? 4 : 0) + '</td>' +
      '<td class="num">' + U.fmtNum(d.entryPrice, 2) + '</td>' +
      '<td class="num">' + (d.exitPrice === null ? '—' : U.fmtNum(d.exitPrice, 2)) + '</td>' +
      '<td class="num">' + outcomeCell(d) + '</td>' +
      '<td class="num ' + U.pnlClass(d.rMultiple) + '">' + U.fmtR(d.rMultiple) + '</td>' +
      '<td class="num ' + U.pnlClass(d.returnPct) + '">' +
        (d.returnPct === null ? '—' : U.fmtPct(d.returnPct, 2)) + '</td>' +
      '<td>' + (d.strategy ? U.esc(d.strategy) : '<span class="flat">—</span>') +
        (d.tags.length ? ' ' + d.tags.slice(0, 2).map(function (t) {
          return '<span class="tag">' + U.esc(t) + '</span>'; }).join('') : '') + '</td>' +
      '<td>' + U.fmtDuration(d.holdingMs) + '</td>' +
      '<td><button class="btn btn-ghost btn-sm row-btn" data-edit="' + U.esc(d.id) + '">Edit</button></td>' +
      '</tr>';
  }

  function renderTradeRows(host, list, compact) {
    if (!list.length) {
      host.innerHTML = '<div class="empty"><h3>Nothing here yet</h3>' +
        '<p class="muted">Log a trade or load the demo data from Settings.</p></div>';
      return;
    }
    host.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Entry</th><th>Symbol</th><th>Side</th><th class="num">Qty</th>' +
      '<th class="num">In</th><th class="num">Out</th><th class="num">Net P&L</th>' +
      '<th class="num">R</th><th class="num" title="Net P&L as a percentage of ' +
      'position notional (entry price x quantity). On leveraged products this ' +
      'is not return on account equity.">Return</th><th>Setup</th><th>Hold</th><th></th>' +
      '</tr></thead><tbody>' + list.map(tradeRow).join('') + '</tbody></table></div>';
    wireRows(host);
  }

  function wireRows(host) {
    host.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDialog(tr.getAttribute('data-id')); });
    });
  }

  function renderTrades(d, s) {
    var key = state.sort.key, dir = state.sort.dir;
    var sorted = d.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      // Nulls (open trades, missing R) always sort to the bottom.
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });

    var tbody = $('#trades-tbody');
    var emptyBox = $('#trades-empty');

    if (!sorted.length) {
      tbody.innerHTML = '';
      emptyBox.classList.remove('hidden');
      emptyBox.innerHTML = S.trades().length
        ? '<h3>No trades match these filters</h3><p class="muted">Try clearing the filter bar.</p>'
        : '<h3>Your journal is empty</h3><p class="muted">Add your first trade, import a CSV, ' +
          'or load demo data from Settings to see how it works.</p>';
    } else {
      emptyBox.classList.add('hidden');
      tbody.innerHTML = sorted.map(tradeRow).join('');
      wireRows($('#trades-table'));
    }

    $$('#trades-table th.sortable').forEach(function (th) {
      var ind = th.querySelector('.sort-ind');
      ind.textContent = th.getAttribute('data-sort') === key ? (dir > 0 ? '▲' : '▼') : '';
    });

    $('#trades-foot').innerHTML =
      '<span>' + sorted.length + ' shown</span>' +
      '<span>Net <b class="' + U.pnlClass(s.netPnl) + '">' + signedMoney(s.netPnl) + '</b></span>' +
      '<span>Fees ' + money(s.totalFees) + '</span>' +
      '<span>Win rate ' + (s.winRate === null ? '—' : U.fmtPct(s.winRate)) + '</span>' +
      (s.totalR !== null ? '<span>Total <b class="' + U.pnlClass(s.totalR) + '">' +
        U.fmtR(s.totalR) + '</b> over ' + s.tradesWithR + ' trades with a stop</span>' : '');
  }

  /* ------------------------------ analytics ----------------------------- */

  function breakdown(host, groups, opts) {
    opts = opts || {};
    if (!groups.length) {
      host.innerHTML = '<div class="chart-empty">' + (opts.emptyMsg || 'No data yet') + '</div>';
      return;
    }
    var maxAbs = Math.max.apply(null, groups.map(function (g) { return Math.abs(g.netPnl); })) || 1;
    var rows = groups.slice(0, opts.limit || 12).map(function (g) {
      var w = (Math.abs(g.netPnl) / maxAbs) * 100;
      var color = g.netPnl >= 0 ? 'var(--win)' : 'var(--loss)';
      return '<div class="bd-row">' +
        '<div><div class="bd-name">' + U.esc(g.key) + '</div>' +
          '<div class="bd-meter"><i style="width:' + w.toFixed(1) + '%;background:' + color + '"></i></div></div>' +
        '<div>' + g.count + '</div>' +
        '<div class="' + U.pnlClass(g.netPnl) + '">' + signedMoney(g.netPnl, 0) + '</div>' +
        '<div>' + (g.winRate === null ? '—' : U.fmtNum(g.winRate, 0) + '%') + '</div>' +
        '</div>';
    }).join('');

    host.innerHTML = '<div class="bd-head"><div>' + U.esc(opts.nameLabel || 'Name') +
      '</div><div>Trades</div><div>Net P&L</div><div>Win%</div></div>' + rows;
  }

  function renderAnalytics(d, s) {
    breakdown($('#bd-strategy'), C.groupBy(d, function (t) { return t.strategy || '—'; }),
      { nameLabel: 'Setup' });
    breakdown($('#bd-symbol'), C.groupBy(d, function (t) { return t.symbol; }),
      { nameLabel: 'Symbol' });
    breakdown($('#bd-direction'), C.groupBy(d, function (t) {
      return t.direction === 'long' ? 'Long' : 'Short'; }), { nameLabel: 'Side' });

    var wd = C.groupBy(d, function (t) {
      return t.entryDate === null ? null : U.WEEKDAYS[new Date(t.entryDate).getDay()];
    });
    // Keep calendar order rather than P&L order for the weekday view.
    wd.sort(function (a, b) { return U.WEEKDAYS.indexOf(a.key) - U.WEEKDAYS.indexOf(b.key); });
    breakdown($('#bd-weekday'), wd, { nameLabel: 'Day' });

    breakdown($('#bd-mistakes'), C.groupBy(d, function (t) {
      return t.mistakes.length ? t.mistakes : null; }),
      { nameLabel: 'Mistake', emptyMsg: 'No mistakes tagged — add them when logging a trade' });

    // Hour of entry.
    var byHour = {};
    d.filter(function (t) { return !t.isOpen && t.entryDate !== null; }).forEach(function (t) {
      var h = new Date(t.entryDate).getHours();
      byHour[h] = (byHour[h] || 0) + t.netPnl;
    });
    var hours = Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; })
      .map(function (h) {
        return { label: String(h).padStart(2, '0') + ':00', short: String(h).padStart(2, '0'),
                 value: byHour[h] };
      });
    CH.divergingBars($('#chart-hour'), hours, {
      format: shortCur,
      emptyMsg: 'No closed trades with entry times',
      ariaLabel: 'Net profit and loss by hour of entry'
    });

    CH.histogram($('#chart-rdist'), C.rHistogram(d), {
      emptyMsg: 'Record a stop loss on your trades to see R distribution',
      ariaLabel: 'Distribution of R multiples',
      colorFor: function (b, i) { return i < 6 ? 'var(--loss)' : 'var(--win)'; }
    });

    CH.scatterHold($('#chart-hold'), d, { format: shortCur });

    var lines = [
      ['Total trades', s.totalTrades],
      ['Closed / open', s.closedTrades + ' / ' + s.openTrades],
      ['Wins / losses / BE', s.wins + ' / ' + s.losses + ' / ' + s.breakeven],
      ['Win rate', s.winRate === null ? '—' : U.fmtPct(s.winRate)],
      ['Net P&L', signedMoney(s.netPnl)],
      ['Gross profit', money(s.grossProfit)],
      ['Gross loss', money(-s.grossLoss)],
      ['Total fees', money(s.totalFees)],
      ['Profit factor', s.profitFactor === null ? '—'
        : (s.profitFactor === Infinity ? '∞' : U.fmtNum(s.profitFactor, 2))],
      ['Expectancy / trade', s.expectancy === null ? '—' : signedMoney(s.expectancy)],
      ['Median trade', s.medianPnl === null ? '—' : signedMoney(s.medianPnl)],
      ['Average win', s.avgWin === null ? '—' : signedMoney(s.avgWin)],
      ['Average loss', s.avgLoss === null ? '—' : signedMoney(s.avgLoss)],
      ['Payoff ratio', s.payoffRatio === null ? '—' : U.fmtNum(s.payoffRatio, 2) + ':1'],
      ['Largest win', s.largestWin === null ? '—' : signedMoney(s.largestWin)],
      ['Largest loss', s.largestLoss === null ? '—' : signedMoney(s.largestLoss)],
      ['Std dev per trade', s.stdevPnl === null ? '—' : money(s.stdevPnl)],
      ['System quality (SQN)', s.systemQuality === null ? '—' : U.fmtNum(s.systemQuality, 2)],
      ['Max drawdown', money(s.maxDrawdown)],
      ['Max drawdown %', s.maxDrawdownPct === null ? '—' : U.fmtPct(s.maxDrawdownPct)],
      ['Recovery factor', s.recoveryFactor === null ? '—' : U.fmtNum(s.recoveryFactor, 2)],
      ['Max win streak', s.maxWinStreak],
      ['Max loss streak', s.maxLossStreak],
      ['Trades with a stop', s.tradesWithR],
      ['Total R', s.totalR === null ? '—' : U.fmtR(s.totalR)],
      ['Average R', s.avgR === null ? '—' : U.fmtR(s.avgR)],
      ['Best / worst R', (s.bestR === null ? '—' : U.fmtR(s.bestR)) + ' / ' +
        (s.worstR === null ? '—' : U.fmtR(s.worstR))],
      ['Avg hold', U.fmtDuration(s.avgHoldMs)],
      ['Avg hold (wins)', U.fmtDuration(s.avgHoldWinMs)],
      ['Avg hold (losses)', U.fmtDuration(s.avgHoldLossMs)],
      ['Trading days', s.tradingDays],
      ['Avg P&L per day', s.avgPerDay === null ? '—' : signedMoney(s.avgPerDay)],
      ['Trades per day', s.avgTradesPerDay === null ? '—' : U.fmtNum(s.avgTradesPerDay, 1)],
      ['Start balance', money(s.startBalance)],
      ['Current balance', money(s.endBalance)],
      ['Total return', s.totalReturnPct === null ? '—' : U.fmtPct(s.totalReturnPct)]
    ];

    $('#stats-table').innerHTML = '<div class="stat-grid">' + lines.map(function (l) {
      return '<div class="stat-line"><span>' + U.esc(l[0]) + '</span><span>' + l[1] + '</span></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------- settings ----------------------------- */

  function renderSettings() {
    var st = S.settings();
    $('#pref-currency').value = st.currency;
    $('#pref-risk').value = st.riskPct;
    $('#pref-strategies').value = st.strategies.join('\n');
    $('#pref-mistakes').value = st.mistakeTags.join('\n');

    $('#accounts-list').innerHTML = S.accounts().map(function (a) {
      var used = S.trades().filter(function (t) { return t.account === a.name; }).length;
      return '<div class="acct-row">' +
        '<span class="acct-name">' + U.esc(a.name) + '</span>' +
        '<input class="input input-sm" style="width:120px" type="number" step="any" ' +
          'data-balance="' + U.esc(a.id) + '" value="' + (U.num(a.startBalance) || 0) + '">' +
        '<span class="muted">' + used + ' trades</span>' +
        '<button class="btn btn-ghost btn-sm" data-del-acct="' + U.esc(a.id) + '">Remove</button>' +
        '</div>';
    }).join('');

    $$('#accounts-list [data-balance]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        S.updateAccount(inp.getAttribute('data-balance'), { startBalance: U.num(inp.value) || 0 });
        toast('Balance updated', 'ok');
        render();
      });
    });
    $$('#accounts-list [data-del-acct]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del-acct');
        var a = S.accounts().filter(function (x) { return x.id === id; })[0];
        if (!a) return;
        var n = S.trades().filter(function (t) { return t.account === a.name; }).length;
        if (n && !confirm('"' + a.name + '" has ' + n + ' trades. They will stay in the journal but ' +
            'lose their account. Remove the account anyway?')) return;
        if (S.removeAccount(id)) { toast('Account removed', 'ok'); refreshOptions(); render(); }
        else toast('Keep at least one account', 'err');
      });
    });

    var bytes = S.approxBytes();
    $('#storage-info').textContent = S.trades().length + ' trades · about ' +
      (bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' bytes') + ' stored' +
      (S.available ? '' : ' · WARNING: local storage is unavailable, changes will not persist');
  }

  /* -------------------------------- dialog ------------------------------ */

  var selectedMistakes = [];
  var selectedRating = null;

  function renderMistakeChips() {
    var opts = S.settings().mistakeTags.slice();
    selectedMistakes.forEach(function (m) { if (opts.indexOf(m) < 0) opts.push(m); });
    $('#t-mistakes').innerHTML = opts.map(function (m) {
      var on = selectedMistakes.indexOf(m) >= 0;
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-m="' +
        U.esc(m) + '">' + U.esc(m) + '</button>';
    }).join('');
    $$('#t-mistakes .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        var m = c.getAttribute('data-m');
        var i = selectedMistakes.indexOf(m);
        if (i >= 0) selectedMistakes.splice(i, 1); else selectedMistakes.push(m);
        renderMistakeChips();
      });
    });
  }

  function renderRating() {
    $$('#t-rating .star').forEach(function (s) {
      var v = +s.getAttribute('data-value');
      s.classList.toggle('is-on', selectedRating !== null && v <= selectedRating);
    });
  }

  function openDialog(id) {
    var dlg = $('#trade-dialog');
    state.editingId = id || null;
    var t = id ? S.get(id) : null;

    $('#dialog-title').textContent = t ? 'Edit trade' : 'New trade';
    $('#delete-trade').classList.toggle('hidden', !t);

    refreshOptions();

    var f = $('#trade-form');
    f.reset();
    if (t) {
      $('#t-symbol').value = t.symbol || '';
      $('#t-direction').value = t.direction || 'long';
      $('#t-account').value = t.account || S.accounts()[0].name;
      $('#t-quantity').value = t.quantity === null || t.quantity === undefined ? '' : t.quantity;
      $('#t-entryPrice').value = t.entryPrice === null || t.entryPrice === undefined ? '' : t.entryPrice;
      $('#t-exitPrice').value = t.exitPrice === null || t.exitPrice === undefined ? '' : t.exitPrice;
      $('#t-entryDate').value = U.toLocalInput(U.parseDate(t.entryDate));
      $('#t-exitDate').value = U.toLocalInput(U.parseDate(t.exitDate));
      $('#t-fees').value = t.fees === null || t.fees === undefined ? '' : t.fees;
      $('#t-stopPrice').value = t.stopPrice === null || t.stopPrice === undefined ? '' : t.stopPrice;
      $('#t-targetPrice').value = t.targetPrice === null || t.targetPrice === undefined ? '' : t.targetPrice;
      $('#t-strategy').value = t.strategy || '';
      $('#t-tags').value = U.splitList(t.tags).join(', ');
      $('#t-notes').value = t.notes || '';
      selectedMistakes = U.splitList(t.mistakes);
      selectedRating = U.num(t.rating);
    } else {
      $('#t-entryDate').value = U.toLocalInput(Date.now());
      $('#t-account').value = state.filters.account || S.accounts()[0].name;
      selectedMistakes = [];
      selectedRating = null;
    }

    renderMistakeChips();
    renderRating();
    updateLiveCalc();
    dlg.showModal();
    setTimeout(function () { $('#t-symbol').focus(); }, 30);
  }

  function readForm() {
    return {
      id: state.editingId || undefined,
      symbol: ($('#t-symbol').value || '').trim().toUpperCase(),
      direction: $('#t-direction').value,
      account: $('#t-account').value,
      quantity: U.num($('#t-quantity').value),
      entryPrice: U.num($('#t-entryPrice').value),
      exitPrice: $('#t-exitPrice').value === '' ? null : U.num($('#t-exitPrice').value),
      entryDate: U.parseDate($('#t-entryDate').value),
      exitDate: $('#t-exitDate').value === '' ? null : U.parseDate($('#t-exitDate').value),
      fees: U.num($('#t-fees').value) || 0,
      stopPrice: $('#t-stopPrice').value === '' ? null : U.num($('#t-stopPrice').value),
      targetPrice: $('#t-targetPrice').value === '' ? null : U.num($('#t-targetPrice').value),
      strategy: ($('#t-strategy').value || '').trim(),
      tags: U.splitList($('#t-tags').value),
      mistakes: selectedMistakes.slice(),
      rating: selectedRating,
      notes: $('#t-notes').value || ''
    };
  }

  function updateLiveCalc() {
    var d = C.derive(readForm());
    var st = S.settings();
    var acct = S.account($('#t-account').value);
    var balance = acct ? (U.num(acct.startBalance) || 0) : 0;

    var items = [];
    items.push(['Status', d.isOpen ? 'Open' : 'Closed', '']);
    items.push(['Position size', d.costBasis === null ? '—' : money(d.costBasis, 0), '']);
    items.push(['Net P&L', d.netPnl === null ? '—' : signedMoney(d.netPnl), U.pnlClass(d.netPnl)]);
    items.push(['Return', d.returnPct === null ? '—' : U.fmtPct(d.returnPct, 2), U.pnlClass(d.returnPct)]);
    items.push(['Risk at stop', d.plannedRisk === null ? 'no stop set' : money(d.plannedRisk),
                d.plannedRisk === null ? 'flat' : '']);
    items.push(['R multiple', U.fmtR(d.rMultiple), U.pnlClass(d.rMultiple)]);
    items.push(['Planned R:R', d.plannedRR === null ? '—' : U.fmtNum(d.plannedRR, 2) + ':1', '']);

    // Position-size sanity check against the configured risk budget.
    if (d.plannedRisk !== null && balance > 0) {
      var pct = (d.plannedRisk / balance) * 100;
      var over = st.riskPct > 0 && pct > st.riskPct * 1.05;
      items.push(['Risk of balance', U.fmtPct(pct, 2) +
        (st.riskPct > 0 ? ' of ' + U.fmtPct(st.riskPct, 1) + ' budget' : ''),
        over ? 'neg' : 'pos']);
    }
    if (d.holdingMs !== null) items.push(['Held', U.fmtDuration(d.holdingMs), '']);

    $('#live-calc').innerHTML = items.map(function (it) {
      return '<div class="lc-item"><span class="lc-label">' + U.esc(it[0]) + '</span>' +
        '<span class="lc-value ' + (it[2] || '') + '">' + it[1] + '</span></div>';
    }).join('');
  }

  function saveTrade() {
    var t = readForm();

    if (!t.symbol) { toast('Symbol is required', 'err'); $('#t-symbol').focus(); return false; }
    if (t.quantity === null || t.quantity <= 0) {
      toast('Quantity must be greater than zero', 'err'); $('#t-quantity').focus(); return false;
    }
    if (t.entryPrice === null) {
      toast('Entry price is required', 'err'); $('#t-entryPrice').focus(); return false;
    }
    if (t.entryDate === null) {
      toast('Entry date is required', 'err'); $('#t-entryDate').focus(); return false;
    }
    if (t.exitDate !== null && t.entryDate !== null && t.exitDate < t.entryDate) {
      toast('Exit time is before entry time', 'err'); $('#t-exitDate').focus(); return false;
    }
    // A closed trade needs an exit time for holding-period stats; default it
    // to the entry time rather than rejecting the save.
    if (t.exitPrice !== null && t.exitDate === null) t.exitDate = t.entryDate;

    if (state.editingId) t.id = state.editingId;
    S.upsert(t);
    toast(state.editingId ? 'Trade updated' : 'Trade logged', 'ok');
    state.editingId = null;
    refreshOptions();
    render();
    return true;
  }

  /* ---------------------------- option lists ---------------------------- */

  function fillSelect(sel, values, placeholder, keep) {
    var prev = keep === undefined ? sel.value : keep;
    sel.innerHTML = (placeholder ? '<option value="">' + U.esc(placeholder) + '</option>' : '') +
      values.map(function (v) {
        return '<option value="' + U.esc(v) + '">' + U.esc(v) + '</option>';
      }).join('');
    if (prev && values.indexOf(prev) >= 0) sel.value = prev;
  }

  function refreshOptions() {
    var accts = S.accounts().map(function (a) { return a.name; });
    fillSelect($('#f-account'), accts, 'All accounts');
    fillSelect($('#t-account'), accts, null);
    fillSelect($('#f-strategy'), S.strategyOptions(), 'Any setup');
    fillSelect($('#f-symbol'), S.symbolOptions(), 'Any symbol');
    $('#strategy-list').innerHTML = S.strategyOptions().map(function (s) {
      return '<option value="' + U.esc(s) + '"></option>';
    }).join('');
  }

  /* ------------------------------ file i/o ------------------------------ */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
           String(d.getDate()).padStart(2, '0');
  }

  function doExportCsv() {
    var d = filtered();
    if (!d.length) return toast('Nothing to export with these filters', 'err');
    download('trading-journal-' + stamp() + '.csv', CSV.fromTrades(d), 'text/csv');
    toast('Exported ' + d.length + ' trades', 'ok');
  }

  function doExportJson() {
    download('trading-journal-backup-' + stamp() + '.json',
      JSON.stringify(S.data, null, 2), 'application/json');
    toast('Backup downloaded', 'ok');
  }

  function handleFile(file) {
    var kind = state.pendingImportKind;
    var reader = new FileReader();

    reader.onload = function () {
      var text = String(reader.result);
      try {
        if (kind === 'json') {
          var doc = JSON.parse(text);
          var n = (doc.trades || []).length;
          if (!confirm('Restoring this backup replaces all ' + S.trades().length +
              ' trades currently in the journal with ' + n + ' from the file. Continue?')) return;
          S.replaceAll(doc);
          applyTheme(S.settings().theme);
          refreshOptions();
          render();
          toast('Restored ' + n + ' trades', 'ok');
        } else {
          var res = CSV.toTrades(text, state.filters.account || S.accounts()[0].name);
          if (!res.trades.length) {
            toast(res.errors[0] || 'No importable rows found', 'err');
            return;
          }
          S.addMany(res.trades);
          refreshOptions();
          render();
          var msg = 'Imported ' + res.trades.length + ' trades';
          if (res.skipped) msg += ' · ' + res.skipped + ' rows skipped';
          toast(msg, res.skipped ? '' : 'ok');
          if (res.errors.length) console.warn('CSV import notes:', res.errors);
        }
      } catch (e) {
        toast('Could not read that file: ' + e.message, 'err');
      }
    };
    reader.onerror = function () { toast('Could not read that file', 'err'); };
    reader.readAsText(file);
  }

  /* -------------------------------- theme ------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  /* -------------------------------- wiring ------------------------------ */

  function switchView(name) {
    state.view = name;
    $$('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-view') === name);
    });
    $$('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + name);
    });
    // The filter bar drives the data views only.
    $('#filterbar').classList.toggle('hidden', name === 'settings');
    render();
  }

  function readFilters() {
    state.filters = {
      search: $('#f-search').value,
      account: $('#f-account').value,
      from: $('#f-from').value,
      to: $('#f-to').value,
      direction: $('#f-direction').value,
      status: $('#f-status').value,
      result: $('#f-result').value,
      strategy: $('#f-strategy').value,
      symbol: $('#f-symbol').value
    };
    render();
  }

  function init() {
    S.load();
    applyTheme(S.settings().theme);
    refreshOptions();

    // Tabs
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.getAttribute('data-view')); });
    });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-goto')); });
    });

    // Theme
    $('#theme-toggle').addEventListener('click', function () {
      var next = S.settings().theme === 'light' ? 'dark' : 'light';
      S.setSettings({ theme: next });
      applyTheme(next);
      render();                       // charts re-read the CSS variables
    });

    // Filters
    $('#f-search').addEventListener('input', U.debounce(readFilters, 180));
    ['#f-account', '#f-from', '#f-to', '#f-direction', '#f-status', '#f-result',
     '#f-strategy', '#f-symbol'].forEach(function (sel) {
      $(sel).addEventListener('change', readFilters);
    });
    $('#f-clear').addEventListener('click', function () {
      ['#f-search', '#f-from', '#f-to'].forEach(function (s) { $(s).value = ''; });
      ['#f-account', '#f-direction', '#f-status', '#f-result', '#f-strategy', '#f-symbol']
        .forEach(function (s) { $(s).value = ''; });
      readFilters();
    });

    // Equity mode
    $$('#equity-mode .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#equity-mode .seg-btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        state.equityMode = b.getAttribute('data-mode');
        render();
      });
    });

    // Sorting
    $$('#trades-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort.key === k) state.sort.dir *= -1;
        else state.sort = { key: k, dir: k === 'symbol' || k === 'strategy' ? 1 : -1 };
        render();
      });
    });

    // Dialog
    $('#new-trade-btn').addEventListener('click', function () { openDialog(null); });
    $('#new-trade-btn-2').addEventListener('click', function () { openDialog(null); });
    $('#dialog-close').addEventListener('click', function () { $('#trade-dialog').close(); });
    $('#cancel-trade').addEventListener('click', function () { $('#trade-dialog').close(); });

    $('#trade-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (saveTrade()) $('#trade-dialog').close();
    });

    $('#delete-trade').addEventListener('click', function () {
      if (!state.editingId) return;
      var t = S.get(state.editingId);
      if (!confirm('Delete the ' + (t ? t.symbol : '') + ' trade? This cannot be undone.')) return;
      S.remove(state.editingId);
      state.editingId = null;
      $('#trade-dialog').close();
      refreshOptions();
      render();
      toast('Trade deleted', 'ok');
    });

    ['#t-symbol', '#t-direction', '#t-quantity', '#t-entryPrice', '#t-exitPrice',
     '#t-entryDate', '#t-exitDate', '#t-fees', '#t-stopPrice', '#t-targetPrice', '#t-account']
      .forEach(function (sel) {
        $(sel).addEventListener('input', updateLiveCalc);
        $(sel).addEventListener('change', updateLiveCalc);
      });

    $$('#t-rating .star').forEach(function (s) {
      s.addEventListener('click', function () {
        var v = +s.getAttribute('data-value');
        selectedRating = (selectedRating === v) ? null : v;
        renderRating();
      });
    });
    $('#clear-rating').addEventListener('click', function () {
      selectedRating = null; renderRating();
    });

    // Import / export
    $('#export-csv').addEventListener('click', doExportCsv);
    $('#export-csv-2').addEventListener('click', doExportCsv);
    $('#export-json').addEventListener('click', doExportJson);
    $('#import-csv').addEventListener('click', function () {
      state.pendingImportKind = 'csv';
      $('#file-input').value = '';
      $('#file-input').click();
    });
    $('#import-json').addEventListener('click', function () {
      state.pendingImportKind = 'json';
      $('#file-input').value = '';
      $('#file-input').click();
    });
    $('#file-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    });

    // Settings
    $('#add-account').addEventListener('click', function () {
      var name = $('#new-account-name').value;
      if (S.addAccount(name, $('#new-account-balance').value)) {
        $('#new-account-name').value = '';
        $('#new-account-balance').value = '';
        refreshOptions();
        render();
        toast('Account added', 'ok');
      } else {
        toast('Give the account a unique name', 'err');
      }
    });

    $('#save-prefs').addEventListener('click', function () {
      S.setSettings({
        currency: $('#pref-currency').value || '$',
        riskPct: U.num($('#pref-risk').value) || 0,
        strategies: $('#pref-strategies').value.split('\n')
          .map(function (s) { return s.trim(); }).filter(Boolean),
        mistakeTags: $('#pref-mistakes').value.split('\n')
          .map(function (s) { return s.trim(); }).filter(Boolean)
      });
      refreshOptions();
      render();
      toast('Preferences saved', 'ok');
    });

    $('#load-demo').addEventListener('click', function () {
      if (S.trades().length &&
          !confirm('Add 92 demo trades alongside your ' + S.trades().length +
                   ' existing trades?')) return;
      S.addMany(Demo.generate(90, S.accounts()[0].name));
      refreshOptions();
      render();
      toast('Demo data loaded', 'ok');
    });

    $('#wipe-data').addEventListener('click', function () {
      if (!confirm('Delete all ' + S.trades().length + ' trades, accounts and settings? ' +
          'This cannot be undone — export a backup first if you might want it back.')) return;
      if (!confirm('Last chance. Really delete everything?')) return;
      S.clear();
      applyTheme(S.settings().theme);
      refreshOptions();
      render();
      toast('Journal cleared', 'ok');
    });

    // Keyboard: "n" for a new trade, Esc closes the dialog.
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'n' && !typing && !$('#trade-dialog').open &&
          !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openDialog(null);
      }
      if (e.key === '/' && !typing) { e.preventDefault(); $('#f-search').focus(); }
    });

    switchView('dashboard');

    if (!S.trades().length) {
      toast('Empty journal — load demo data from Settings to explore, or press "n" to log a trade.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
