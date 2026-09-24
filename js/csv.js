/* ---------------------------------------------------------------------------
   CSV import / export. RFC4180-ish: quoted fields, doubled quotes, embedded
   newlines and commas all survive a round trip.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);
  var CSV = {};

  CSV.COLUMNS = ['symbol', 'direction', 'quantity', 'entryPrice', 'exitPrice',
    'entryDate', 'exitDate', 'stopPrice', 'targetPrice', 'fees', 'strategy',
    'tags', 'mistakes', 'rating', 'notes', 'account'];

  /** Parse a CSV document into an array of row arrays. */
  CSV.parse = function (text) {
    var rows = [], row = [], field = '', inQuotes = false;
    text = String(text).replace(/^﻿/, '');          // strip BOM

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // handled by the \n branch
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    // Drop rows that are entirely empty — a trailing newline or a line of
    // bare commas is formatting noise, not a row the user got wrong.
    return rows.filter(function (r) {
      return r.length && r.some(function (f) { return String(f).trim() !== ''; });
    });
  };

  function normKey(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Header aliases so exports from common platforms import without editing.
  var ALIASES = {
    symbol: ['symbol', 'ticker', 'instrument', 'market', 'pair', 'asset'],
    direction: ['direction', 'side', 'type', 'longshort', 'buysell', 'position'],
    quantity: ['quantity', 'qty', 'size', 'shares', 'contracts', 'volume', 'units', 'lots'],
    entryPrice: ['entryprice', 'entry', 'openprice', 'open', 'avgentry', 'buyprice', 'priceopen'],
    exitPrice: ['exitprice', 'exit', 'closeprice', 'close', 'avgexit', 'sellprice', 'priceclose'],
    entryDate: ['entrydate', 'opendate', 'opentime', 'entrytime', 'dateopened', 'date', 'opened'],
    exitDate: ['exitdate', 'closedate', 'closetime', 'exittime', 'dateclosed', 'closed'],
    stopPrice: ['stopprice', 'stop', 'stoploss', 'sl', 'initialstop'],
    targetPrice: ['targetprice', 'target', 'takeprofit', 'tp', 'limit'],
    fees: ['fees', 'fee', 'commission', 'commissions', 'costs', 'charges', 'swap'],
    strategy: ['strategy', 'setup', 'system', 'playbook', 'pattern'],
    tags: ['tags', 'tag', 'labels'],
    mistakes: ['mistakes', 'mistake', 'errors'],
    rating: ['rating', 'grade', 'score', 'quality'],
    notes: ['notes', 'note', 'comment', 'comments', 'journal', 'description'],
    account: ['account', 'portfolio', 'acct', 'broker']
  };

  function mapHeaders(header) {
    var map = {};
    header.forEach(function (h, i) {
      var k = normKey(h);
      for (var field in ALIASES) {
        if (ALIASES[field].indexOf(k) >= 0) { map[field] = i; return; }
      }
    });
    return map;
  }

  function normDirection(v) {
    var s = String(v || '').trim().toLowerCase();
    if (/^(s|short|sell|sld|sel)/.test(s)) return 'short';
    return 'long';
  }

  /**
   * Convert CSV text to trade objects.
   * Returns { trades, skipped, errors } — a row without a symbol, quantity or
   * entry price cannot become a trade, so it is reported rather than guessed.
   */
  CSV.toTrades = function (text, defaultAccount) {
    var rows = CSV.parse(text);
    var out = { trades: [], skipped: 0, errors: [] };
    if (rows.length < 2) {
      out.errors.push('File needs a header row and at least one data row.');
      return out;
    }

    var map = mapHeaders(rows[0]);
    if (map.symbol === undefined) {
      out.errors.push('No "symbol" column found. Expected one of: ' +
        ALIASES.symbol.join(', ') + '.');
      return out;
    }

    var pick = function (r, f) { return map[f] === undefined ? '' : (r[map[f]] || '').trim(); };

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var symbol = pick(r, 'symbol');
      var qty = U.num(pick(r, 'quantity'));
      var entry = U.num(pick(r, 'entryPrice'));

      if (!symbol || qty === null || entry === null) {
        out.skipped++;
        if (out.errors.length < 5) {
          out.errors.push('Row ' + (i + 1) + ' skipped — needs symbol, quantity and entry price.');
        }
        continue;
      }

      var entryDate = U.parseDate(pick(r, 'entryDate'));
      var exitRaw = pick(r, 'exitPrice');

      out.trades.push({
        id: U.uid(),
        symbol: symbol.toUpperCase(),
        direction: normDirection(pick(r, 'direction')),
        quantity: Math.abs(qty),
        entryPrice: entry,
        exitPrice: exitRaw === '' ? null : U.num(exitRaw),
        entryDate: entryDate === null ? Date.now() : entryDate,
        exitDate: U.parseDate(pick(r, 'exitDate')),
        stopPrice: U.num(pick(r, 'stopPrice')),
        targetPrice: U.num(pick(r, 'targetPrice')),
        fees: U.num(pick(r, 'fees')) || 0,
        strategy: pick(r, 'strategy'),
        tags: U.splitList(pick(r, 'tags')),
        mistakes: U.splitList(pick(r, 'mistakes')),
        rating: U.num(pick(r, 'rating')),
        notes: pick(r, 'notes'),
        account: pick(r, 'account') || defaultAccount || 'Default',
        createdAt: Date.now()
      });
    }
    return out;
  };

  function cell(v) {
    if (v === null || v === undefined) return '';
    var s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * Export derived trades. Computed columns are included so the file is useful
   * in a spreadsheet, and the raw columns still round-trip back through import.
   */
  CSV.fromTrades = function (derived) {
    var cols = CSV.COLUMNS.concat(['netPnl', 'grossPnl', 'returnPct', 'rMultiple',
      'outcome', 'holdingHours']);
    var lines = [cols.join(',')];

    derived.forEach(function (d) {
      lines.push([
        cell(d.symbol),
        cell(d.direction),
        cell(d.quantity),
        cell(d.entryPrice),
        cell(d.exitPrice),
        cell(d.entryDate === null ? '' : U.fmtDate(d.entryDate, true)),
        cell(d.exitDate === null ? '' : U.fmtDate(d.exitDate, true)),
        cell(d.stopPrice),
        cell(d.targetPrice),
        cell(d.fees),
        cell(d.strategy),
        cell(d.tags),
        cell(d.mistakes),
        cell(d.rating),
        cell(d.notes),
        cell(d.account),
        cell(d.netPnl === null ? '' : d.netPnl.toFixed(2)),
        cell(d.grossPnl === null ? '' : d.grossPnl.toFixed(2)),
        cell(d.returnPct === null ? '' : d.returnPct.toFixed(3)),
        cell(d.rMultiple === null ? '' : d.rMultiple.toFixed(3)),
        cell(d.outcome),
        cell(d.holdingMs === null ? '' : (d.holdingMs / 3600000).toFixed(2))
      ].join(','));
    });

    return lines.join('\n');
  };

  root.CSV = CSV;
  if (typeof module !== 'undefined' && module.exports) module.exports = CSV;
})(typeof globalThis !== 'undefined' ? globalThis : this);
