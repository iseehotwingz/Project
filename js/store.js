/* ---------------------------------------------------------------------------
   Persistence. Everything lives in localStorage under one key; the whole
   document is rewritten on each save, which is fine at journal scale.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var U = root.Util;
  var KEY = 'trading-journal/v1';
  var SCHEMA = 1;

  var DEFAULT_STRATEGIES = [
    'Breakout', 'Pullback', 'Reversal', 'Trend continuation',
    'Range fade', 'Gap fill', 'News catalyst', 'Scalp'
  ];
  var DEFAULT_MISTAKES = [
    'FOMO entry', 'No stop', 'Moved stop', 'Oversized', 'Undersized',
    'Early exit', 'Late entry', 'Revenge trade', 'Broke plan', 'Chased'
  ];

  function blank() {
    return {
      schema: SCHEMA,
      trades: [],
      accounts: [{ id: 'default', name: 'Default', startBalance: 10000 }],
      settings: {
        currency: '$',
        riskPct: 1,
        // On by default and pointed at the journal's own published data file.
        // Existing installs pick this up through migrate(), which fills in
        // settings they were saved before this option existed.
        syncUrl: 'data/my-trades.csv',
        autoSync: true,
        theme: 'dark',
        strategies: DEFAULT_STRATEGIES.slice(),
        mistakeTags: DEFAULT_MISTAKES.slice()
      }
    };
  }

  var Store = {
    data: blank(),
    available: true,

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) this.data = this.migrate(JSON.parse(raw));
      } catch (e) {
        this.available = false;
        console.warn('Trading Journal: local storage unavailable —', e);
      }
      return this.data;
    },

    /** Fill in anything a older/hand-edited document is missing. */
    migrate: function (d) {
      var base = blank();
      if (!d || typeof d !== 'object') return base;
      d.schema = SCHEMA;
      d.trades = Array.isArray(d.trades) ? d.trades : [];
      d.accounts = (Array.isArray(d.accounts) && d.accounts.length) ? d.accounts : base.accounts;
      d.settings = Object.assign({}, base.settings, d.settings || {});
      if (!Array.isArray(d.settings.strategies)) d.settings.strategies = base.settings.strategies;
      if (!Array.isArray(d.settings.mistakeTags)) d.settings.mistakeTags = base.settings.mistakeTags;
      d.trades.forEach(function (t) {
        if (!t.id) t.id = U.uid();
        if (!t.account) t.account = d.accounts[0].name;
      });
      return d;
    },

    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        this.available = false;
        console.error('Trading Journal: save failed —', e);
        return false;
      }
    },

    /* ------------------------------ trades ------------------------------ */

    trades: function () { return this.data.trades; },

    get: function (id) {
      return this.data.trades.filter(function (t) { return t.id === id; })[0] || null;
    },

    upsert: function (trade) {
      if (!trade.id) {
        trade.id = U.uid();
        trade.createdAt = Date.now();
        this.data.trades.push(trade);
      } else {
        var i = this.data.trades.findIndex(function (t) { return t.id === trade.id; });
        trade.updatedAt = Date.now();
        if (i >= 0) this.data.trades[i] = trade; else this.data.trades.push(trade);
      }
      this.save();
      return trade;
    },

    remove: function (id) {
      this.data.trades = this.data.trades.filter(function (t) { return t.id !== id; });
      this.save();
    },

    /**
     * Merge trades in by their broker identity: anything already held is
     * updated in place, anything new is appended. This is what makes a repeat
     * import safe — re-importing a history that has grown by three trades adds
     * three rows, not a second copy of everything.
     *
     * Journal-only fields the broker cannot know (notes, setup, mistake tags,
     * rating, stop, target) are preserved on an update, so re-syncing never
     * wipes the review work that is the point of keeping a journal.
     */
    mergeMany: function (trades) {
      var self = this;
      var index = {};
      this.data.trades.forEach(function (t, i) { index[U.externalKey(t)] = i; });

      var added = 0, updated = 0, unchanged = 0;
      trades.forEach(function (incoming) {
        var key = U.externalKey(incoming);
        var at = index[key];

        if (at === undefined) {
          incoming.id = incoming.id || U.uid();
          incoming.externalId = key;
          incoming.createdAt = incoming.createdAt || Date.now();
          index[key] = self.data.trades.length;
          self.data.trades.push(incoming);
          added++;
          return;
        }

        var existing = self.data.trades[at];
        var keep = ['notes', 'strategy', 'tags', 'mistakes', 'rating',
                    'stopPrice', 'targetPrice'];
        var merged = Object.assign({}, existing, incoming);
        keep.forEach(function (f) {
          var had = existing[f];
          var isSet = Array.isArray(had) ? had.length > 0
                    : (had !== null && had !== undefined && had !== '');
          if (isSet) merged[f] = had;
        });
        merged.id = existing.id;
        merged.externalId = key;
        merged.createdAt = existing.createdAt;

        if (JSON.stringify(merged) === JSON.stringify(existing)) { unchanged++; return; }
        merged.updatedAt = Date.now();
        self.data.trades[at] = merged;
        updated++;
      });

      if (added || updated) this.save();
      return { added: added, updated: updated, unchanged: unchanged };
    },

    addMany: function (trades) {
      var self = this;
      trades.forEach(function (t) {
        if (!t.id) t.id = U.uid();
        t.createdAt = t.createdAt || Date.now();
        self.data.trades.push(t);
      });
      this.save();
      return trades.length;
    },

    replaceAll: function (doc) {
      this.data = this.migrate(doc);
      this.save();
    },

    clear: function () {
      this.data = blank();
      this.save();
    },

    /* ----------------------------- accounts ----------------------------- */

    accounts: function () { return this.data.accounts; },

    account: function (name) {
      return this.data.accounts.filter(function (a) { return a.name === name; })[0]
          || this.data.accounts[0];
    },

    addAccount: function (name, startBalance) {
      name = (name || '').trim();
      if (!name) return false;
      if (this.data.accounts.some(function (a) { return a.name.toLowerCase() === name.toLowerCase(); })) return false;
      this.data.accounts.push({
        id: 'a_' + Math.random().toString(36).slice(2, 8),
        name: name,
        startBalance: U.num(startBalance) || 0
      });
      this.save();
      return true;
    },

    updateAccount: function (id, patch) {
      var a = this.data.accounts.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      Object.assign(a, patch);
      this.save();
    },

    removeAccount: function (id) {
      if (this.data.accounts.length <= 1) return false;
      this.data.accounts = this.data.accounts.filter(function (a) { return a.id !== id; });
      this.save();
      return true;
    },

    /* ----------------------------- settings ----------------------------- */

    settings: function () { return this.data.settings; },

    setSettings: function (patch) {
      Object.assign(this.data.settings, patch);
      this.save();
    },

    /** Known setups: configured list plus anything already used in a trade. */
    strategyOptions: function () {
      var set = {};
      this.data.settings.strategies.forEach(function (s) { set[s] = true; });
      this.data.trades.forEach(function (t) { if (t.strategy) set[t.strategy] = true; });
      return Object.keys(set).sort();
    },

    symbolOptions: function () {
      var set = {};
      this.data.trades.forEach(function (t) {
        if (t.symbol) set[String(t.symbol).toUpperCase()] = true;
      });
      return Object.keys(set).sort();
    },

    approxBytes: function () {
      try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return 0; }
    }
  };

  Store.DEFAULT_STRATEGIES = DEFAULT_STRATEGIES;
  Store.DEFAULT_MISTAKES = DEFAULT_MISTAKES;
  root.Store = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
