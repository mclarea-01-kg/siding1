// common.js - shared settings, helpers and the header/menu used on every page.
// The numbers below (targets, standard cycle times) are MADE-UP planning values.
// Change them here and every page updates.
window.MCL = (function () {
  'use strict';

  // Route / siding master data. std = standard cycle time in hours.
  // target = planned dispatch in MT per day (made up).
  const LOC = {
    Sundargarh: { mode: 'Road',   full: 'Road - Sundargarh', color: '#1f5fa8', std: 8,    target: 400, dist: 100,
                  dests: ['Rourkela', 'Rajgangpur', 'Kansbahal', 'Birmitrapur'] },
    Raigarh:    { mode: 'Road',   full: 'Road - Raigarh',    color: '#6aa6dc', std: 10.5, target: 300, dist: 140,
                  dests: ['Raigarh', 'Kharsia', 'Tamnar', 'Punjipathra'] },
    Laikera:    { mode: 'Siding', full: 'Siding - Laikera',  color: '#0f8b8d', std: 3.5,  target: 720, dist: 25,
                  dests: ['Laikera Siding'] },
    Kanika:     { mode: 'Siding', full: 'Siding - Kanika',   color: '#7a5cc7', std: 4.5,  target: 380, dist: 45,
                  dests: ['Kanika Siding'] }
  };
  const LOC_KEYS = Object.keys(LOC);

  const RULES = {
    opHours: 20,        // hours per day a vehicle can work (used for utilization %)
    queueStdMin: 45,    // standard waiting time at the mine, minutes
    lowUtil: 55,        // utilization % below this = low utilization
    lowPayload: 0.9,    // payload below 90% of vehicle capacity = low payload
    lowTrips: 0.7       // trips below 70% of the route average = low trips
  };

  const MINES = ['Mine A', 'Mine B', 'Mine C', 'Mine D', 'Mine E'];
  const TRANSPORTERS = ['Trans-A', 'Trans-B', 'Trans-C', 'Trans-D', 'Trans-E',
                        'Trans-F', 'Trans-G', 'Trans-H', 'Trans-I', 'Trans-J'];
  const CUSTOMERS = ['Power Plant P1', 'Power Plant P2', 'Steel Plant S1', 'Cement Unit C1',
                     'Sponge Iron I1', 'E-Auction Buyer E1'];
  const VTYPES = { 'Tipper 16T': 16, 'Tipper 20T': 20, 'Hyva 25T': 25 };
  const SHIFTS = ['A', 'B', 'C'];

  const ICONS = {
    box: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
    road: '<path d="M4 22L8 2M20 22L16 2M12 4v3M12 11v3M12 18v3"/>',
    rail: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
           'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           (ICONS[name] || '') + '</svg>';
  }

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function n0(v) { return v == null || isNaN(v) ? '-' : nf0.format(v); }
  function n1(v) { return v == null || isNaN(v) ? '-' : nf1.format(v); }
  function n2(v) { return v == null || isNaN(v) ? '-' : nf2.format(v); }
  function pct(v) { return v == null || isNaN(v) ? '-' : nf1.format(v) + '%'; }

  // Cycle time vs standard -> Normal / Attention / Exception
  function statusOf(ratio) {
    if (ratio == null || isNaN(ratio)) return 'No data';
    if (ratio > 1.2) return 'Exception';
    if (ratio > 1.1) return 'Attention';
    return 'Normal';
  }
  function urgencyOf(ratio) {
    const s = statusOf(ratio);
    return s === 'Exception' ? 'High' : s === 'Attention' ? 'Medium' : 'Low';
  }
  function pill(status) {
    const cls = { Normal: 'ok', Attention: 'warn', Exception: 'bad', 'No data': 'na' }[status] || 'na';
    const dot = { Normal: '● ', Attention: '● ', Exception: '● ', 'No data': '' }[status] || '';
    return '<span class="pill ' + cls + '">' + dot + esc(status) + '</span>';
  }

  function errText(e) {
    if (!e) return 'unknown error';
    const parts = [e.message || String(e)];
    if (e.details) parts.push(e.details);
    if (e.hint) parts.push('Hint: ' + e.hint);
    if (e.code) parts.push('Code: ' + e.code);
    return parts.join(' | ');
  }

  // ---------- database ----------
  function isConfigured() {
    const url = window.SUPABASE_URL || '';
    const key = window.SUPABASE_PUBLISHABLE_KEY || '';
    return url.indexOf('PASTE') === -1 && url.indexOf('https://') === 0 &&
           key.indexOf('PASTE') === -1 && key.length > 10;
  }
  let _db = null;
  function getDb() {
    if (!_db) {
      if (!window.supabase) throw new Error('The Supabase library did not load (check the internet connection).');
      _db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
    }
    return _db;
  }

  // ---------- header + menu (same on every page) ----------
  function header(active) {
    const el = document.getElementById('siteHeader');
    if (!el) return;
    el.className = 'site-header';
    el.innerHTML =
      '<div class="hdr-art" aria-hidden="true">' +
        '<svg viewBox="0 0 520 120" preserveAspectRatio="xMaxYMid slice">' +
          '<g fill="none" stroke="#9fc3ea" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' +
            // truck
            '<path d="M300 92h-8V64h58v28h-6M350 76h20l14 14v2h-8"/><circle cx="312" cy="94" r="7"/><circle cx="366" cy="94" r="7"/>' +
            '<path d="M296 64l10-16h34l10 16"/>' +
            // rail wagons
            '<path d="M410 92h100M414 92V66h42v26M462 92V66h42v26"/><circle cx="428" cy="96" r="4"/><circle cx="444" cy="96" r="4"/>' +
            '<circle cx="476" cy="96" r="4"/><circle cx="492" cy="96" r="4"/>' +
            // coal heaps
            '<path d="M414 66l12-14 12 14M462 66l14-16 14 16"/>' +
          '</g>' +
        '</svg>' +
      '</div>' +
      '<div class="hdr-in">' +
        '<a class="brand" href="index.html" aria-label="Home">' +
          '<span class="logo" aria-hidden="true"><svg viewBox="0 0 40 40" width="40" height="40">' +
            '<rect width="40" height="40" rx="9" fill="#f2b632"/>' +
            '<path d="M8 30V11l6-2 6 12 6-12 6 2v19h-5V18l-7 13-7-13v12z" fill="#0b2545"/></svg></span>' +
          '<span class="brand-txt"><b>Mahanadi Coalfields Limited</b>' +
          '<small>Coal Dispatch &amp; Transportation Monitoring</small></span>' +
        '</a>' +
        '<nav class="menu" aria-label="Main menu">' +
          '<a href="index.html"' + (active === 'index' ? ' class="on"' : '') + '>Record a trip</a>' +
          '<a href="dashboard.html"' + (active === 'dashboard' ? ' class="on"' : '') + '>Dashboard</a>' +
        '</nav>' +
      '</div>';
  }

  return {
    LOC: LOC, LOC_KEYS: LOC_KEYS, RULES: RULES, MINES: MINES, TRANSPORTERS: TRANSPORTERS,
    CUSTOMERS: CUSTOMERS, VTYPES: VTYPES, SHIFTS: SHIFTS,
    icon: icon, esc: esc, n0: n0, n1: n1, n2: n2, pct: pct,
    statusOf: statusOf, urgencyOf: urgencyOf, pill: pill, errText: errText,
    isConfigured: isConfigured, getDb: getDb, header: header
  };
})();
