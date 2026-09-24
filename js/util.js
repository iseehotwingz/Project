/* Small helpers shared across the app. */
(function (root) {
  'use strict';

  var Util = {};

  Util.uid = function () {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  };

  /** Parse into a finite number, or null. Accepts "1,234.50", "$12", "(5)" as -5. */
  Util.num = function (v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '').replace(/[^0-9eE.+-]/g, '');
    if (!s) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  };

  /** Accepts Date, ISO, "YYYY-MM-DD", "YYYY-MM-DD HH:MM", "MM/DD/YYYY". Returns ms or null. */
  Util.parseDate = function (v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    // Stored dates are epoch milliseconds, so a number must pass through
    // untouched — this is the round trip every save/load depends on.
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    // A bare run of digits is an epoch stamp: 13 digits ms, 10 digits seconds.
    if (/^\d{10}$/.test(s)) return parseInt(s, 10) * 1000;
    if (/^\d{12,}$/.test(s)) return parseInt(s, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) {
      return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)).getTime();
    }
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  };

  /** ms -> value for <input type="datetime-local"> */
  Util.toLocalInput = function (ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '';
    var d = new Date(ms);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  Util.fmtDate = function (ms, withTime) {
    if (!ms && ms !== 0) return '—';
    var d = new Date(ms);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return withTime ? s + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : s;
  };

  /** "2026-03" month key in local time. */
  Util.monthKey = function (ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };

  Util.fmtMoney = function (n, cur, decimals) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    cur = cur === undefined ? '$' : cur;
    var d = decimals === undefined ? 2 : decimals;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return sign + cur + s;
  };

  Util.fmtSignedMoney = function (n, cur, decimals) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + Util.fmtMoney(n, cur, decimals);
  };

  Util.fmtNum = function (n, d) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return n.toLocaleString('en-US', {
      minimumFractionDigits: d === undefined ? 2 : d,
      maximumFractionDigits: d === undefined ? 2 : d
    });
  };

  Util.fmtPct = function (n, d) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Util.fmtNum(n, d === undefined ? 1 : d) + '%';
  };

  Util.fmtR = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + Util.fmtNum(n, 2) + 'R';
  };

  /** Human duration from a millisecond span. */
  Util.fmtDuration = function (ms) {
    if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return '—';
    // An exactly-zero span means the open time was never recorded (MT5 and
    // several brokers export only the close time), not a zero-length trade.
    if (ms === 0) return '—';
    var mins = ms / 60000;
    if (mins < 1) return Math.round(ms / 1000) + 's';
    if (mins < 60) return Math.round(mins) + 'm';
    var hrs = mins / 60;
    if (hrs < 24) return (hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)) + 'h';
    var days = hrs / 24;
    if (days < 31) return (days < 10 ? days.toFixed(1) : Math.round(days)) + 'd';
    return Math.round(days / 7) + 'w';
  };

  Util.pnlClass = function (n) {
    if (n === null || n === undefined || !isFinite(n) || Math.abs(n) < 1e-9) return 'flat';
    return n > 0 ? 'pos' : 'neg';
  };

  /** Escape for safe insertion into HTML text/attribute context. */
  Util.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  Util.splitList = function (s) {
    if (Array.isArray(s)) return s.map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!s) return [];
    return String(s).split(/[,;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
  };

  Util.sum = function (arr, f) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) { var v = f ? f(arr[i]) : arr[i]; if (isFinite(v)) t += v; }
    return t;
  };

  Util.mean = function (arr) { return arr.length ? Util.sum(arr) / arr.length : null; };

  Util.stdev = function (arr) {
    if (arr.length < 2) return null;
    var m = Util.mean(arr);
    var v = Util.sum(arr, function (x) { return (x - m) * (x - m); }) / (arr.length - 1);
    return Math.sqrt(v);
  };

  Util.median = function (arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };

  Util.clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

  Util.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  Util.WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  root.Util = Util;
  if (typeof module !== 'undefined' && module.exports) module.exports = Util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
