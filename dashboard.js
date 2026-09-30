// dashboard.js - Coal Dispatch & Transportation Monitoring dashboard (MCL)
// Reads trips from the Supabase table "dispatch_trips". If the database cannot be
// reached (or is empty) it shows clearly-labelled DEMO data instead.
(function () {
  'use strict';
  const M = window.MCL, R = M.RULES;
  const $ = function (id) { return document.getElementById(id); };
  M.header('dashboard');

  // ---------- state ----------
  let ALL = [];            // every trip in the database (or demo)
  let rows = [];           // trips after the filters
  let V = [];              // vehicle statistics for the filtered trips
  let DMIN = '', DMAX = '';
  let source = { demo: false, canSave: false };
  const FILTERS = [
    ['mine', 'f-mine', 'Mine', function (r) { return r.mine; }],
    ['mode', 'f-mode', 'Dispatch mode', function (r) { return r.mode; }],
    ['destination', 'f-destination', 'Destination', function (r) { return r.destination; }],
    ['transporter', 'f-transporter', 'Transporter', function (r) { return r.transporter; }],
    ['vehicle', 'f-vehicle', 'Vehicle number', function (r) { return r.vehicle_no; }],
    ['vtype', 'f-vtype', 'Vehicle type', function (r) { return r.vehicle_type; }],
    ['shift', 'f-shift', 'Shift', function (r) { return r.shift; }],
    ['customer', 'f-customer', 'Customer', function (r) { return r.customer; }]
  ];
  const F = { from: '', to: '' };
  FILTERS.forEach(function (f) { F[f[0]] = ''; });
  let vehShowAll = false, vehSort = { k: 'ratio', dir: -1 };
  const vehOpen = new Set(), trOpen = new Set();
  const charts = {};

  const COL = { green: '#2e9e5b', orange: '#f28c28', red: '#d64545', blue: '#1f5fa8', navy: '#0b2545', grey: '#8497ad' };
  const STATUS_COL = { Normal: COL.green, Attention: COL.orange, Exception: COL.red, 'No data': COL.grey };
  const COMP_COL = { load: '#1f5fa8', queue: '#f28c28', travel: '#0f8b8d', unload: '#7a5cc7', ret: '#8497ad' };

  // ---------- small helpers ----------
  function groupBy(rs, fn) {
    const m = new Map();
    rs.forEach(function (r) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  }
  function modeOf(list, fn) {
    const m = new Map(); let best = null, n = 0;
    list.forEach(function (r) { const k = fn(r); const c = (m.get(k) || 0) + 1; m.set(k, c); if (c > n) { n = c; best = k; } });
    return best;
  }
  function agg(rs) {
    const veh = new Set(), tr = new Set();
    let mt = 0, cs = 0, cn = 0, ds = 0, dn = 0;
    rs.forEach(function (r) {
      mt += r.payload; veh.add(r.vehicle_no); tr.add(r.transporter);
      if (r.cyc != null) { cs += r.cyc; cn++; }
      if (r.dist != null) { ds += r.dist; dn++; }
    });
    const trips = rs.length;
    return { mt: mt, trips: trips, veh: veh.size, tr: tr.size, cyc: cn ? cs / cn : null, cycHours: cs,
             pay: trips ? mt / trips : null, dist: dn ? ds / dn : null, tpv: veh.size ? trips / veh.size : null,
             mtv: veh.size ? mt / veh.size : null };
  }
  function ratioAvg(rs) { // average of (cycle time / standard) over finished trips
    let s = 0, n = 0;
    rs.forEach(function (r) { if (r.cyc != null) { s += r.cyc / r.std; n++; } });
    return n ? s / n : null;
  }
  function avgOf(rs, key) {
    let s = 0, n = 0;
    rs.forEach(function (r) { if (r[key] != null) { s += +r[key]; n++; } });
    return n ? s / n : null;
  }
  function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function monthLabel(m) {
    return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function dayLabel(d) {
    return new Date(d + 'T00:00:00Z').toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  function rag(share) { return share >= 0.15 ? 'bad' : share >= 0.05 ? 'warn' : 'ok'; }
  function ragPill(cls) { return M.pill(cls === 'bad' ? 'Exception' : cls === 'warn' ? 'Attention' : 'Normal'); }

  // ---------- period / targets ----------
  function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; }
  function winFrom() { return F.from && F.from > DMIN ? F.from : DMIN; }
  function winTo() { return F.to && F.to < DMAX ? F.to : DMAX; }
  function windowDays() { return DMIN ? Math.max(1, dayDiff(winFrom(), winTo())) : 1; }
  function daysForMonth(m) {
    const s = m + '-01';
    const e = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
    const a = s > winFrom() ? s : winFrom(), b = e < winTo() ? e : winTo();
    return Math.max(1, dayDiff(a, b));
  }
  function targetFor(rs, days) {
    const locs = new Set(rs.map(function (r) { return r.location; }));
    let t = 0; locs.forEach(function (l) { t += M.LOC[l].target; });
    return t * days;
  }
  function dateList() {
    const out = []; if (!DMIN) return out;
    const end = Date.parse(winTo());
    for (let t = Date.parse(winFrom()); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }

  // ---------- data loading ----------
  function prep(r) {
    const L = M.LOC[r.location] || M.LOC.Sundargarh;
    const o = Object.assign({}, r);
    o.payload = +r.payload_mt || 0;
    o.dist = r.distance_km == null ? null : +r.distance_km;
    o.dep = Date.parse(r.departure_time);
    o.ret = r.return_time ? Date.parse(r.return_time) : null;
    o.cyc = o.ret && o.dep && o.ret > o.dep ? (o.ret - o.dep) / 3.6e6 : null;
    o.std = L.std;
    o.trip_date = String(r.trip_date).slice(0, 10);
    o.month = o.trip_date.slice(0, 7);
    return o;
  }

  function banner(kind, html) { $('banner').innerHTML = html ? '<div class="banner ' + kind + '">' + html + '</div>' : ''; }

  async function loadData() {
    banner('info', 'Loading trip data...');
    if (!M.isConfigured()) {
      return useDemo('The database settings in config.js are not filled in yet.', false);
    }
    try {
      const db = M.getDb();
      let all = [], from = 0;
      const step = 1000;
      for (;;) {
        const res = await db.from('dispatch_trips').select('*').order('trip_date').order('id').range(from, from + step - 1);
        if (res.error) throw res.error;
        all = all.concat(res.data);
        if (res.data.length < step) break;
        from += step;
      }
      if (!all.length) return useDemo('The table dispatch_trips exists but has no trips yet.', true);
      source = { demo: false, canSave: false };
      setData(all);
      banner('ok', 'Live data from the database: <b>' + M.n0(all.length) + '</b> trips.');
    } catch (e) {
      useDemo('The database could not be read. Error text: <b>' + M.esc(M.errText(e)) + '</b>', false);
    }
  }

  function useDemo(reason, canSave) {
    source = { demo: true, canSave: canSave };
    setData(window.Demo.generate());
    banner('warn', '<b>DEMO DATA (made up).</b> ' + reason +
      (canSave ? '<br>To fill the database with the demo trips, press the button (do this only once).' +
                 '<br><button class="btn" id="saveDemo" type="button">Save demo data to the database</button>' : ''));
    if (canSave) $('saveDemo').addEventListener('click', saveDemo);
  }

  async function saveDemo() {
    if (!window.confirm('Save about ' + M.n0(ALL.length) + ' made-up trips into the database? Do this only once.')) return;
    const btn = $('saveDemo'); btn.disabled = true;
    try {
      await window.Demo.save(M.getDb(), ALL.map(stripExtra), function (done, total) { btn.textContent = 'Saving ' + done + ' of ' + total + '...'; });
      await loadData();
    } catch (e) {
      banner('bad', 'Saving failed. Please pass this error text on: <b>' + M.esc(M.errText(e)) + '</b>');
    }
  }
  function stripExtra(r) {
    const keys = ['trip_date', 'shift', 'mine', 'mode', 'location', 'destination', 'customer', 'transporter', 'vehicle_no', 'vehicle_type',
                  'payload_mt', 'distance_km', 'departure_time', 'return_time', 'loading_min', 'queue_min', 'travel_min', 'unloading_min', 'urgency', 'status'];
    const o = {}; keys.forEach(function (k) { o[k] = r[k]; }); return o;
  }

  function setData(list) {
    ALL = list.map(prep);
    DMIN = ALL.reduce(function (a, r) { return !a || r.trip_date < a ? r.trip_date : a; }, '');
    DMAX = ALL.reduce(function (a, r) { return !a || r.trip_date > a ? r.trip_date : a; }, '');
    FILTERS.forEach(function (f) {
      const vals = Array.from(new Set(ALL.map(f[3]))).sort();
      $(f[1]).innerHTML = '<option value="">All</option>' + vals.map(function (v) {
        return '<option' + (F[f[0]] === v ? ' selected' : '') + '>' + M.esc(v) + '</option>';
      }).join('');
    });
    $('f-from').min = $('f-to').min = DMIN; $('f-from').max = $('f-to').max = DMAX;
    render();
  }

  // ---------- filters ----------
  function applyFilters() {
    rows = ALL.filter(function (r) {
      return (!F.from || r.trip_date >= F.from) && (!F.to || r.trip_date <= F.to) &&
        (!F.mine || r.mine === F.mine) && (!F.mode || r.mode === F.mode) &&
        (!F.destination || r.destination === F.destination) && (!F.transporter || r.transporter === F.transporter) &&
        (!F.vehicle || r.vehicle_no === F.vehicle) && (!F.vtype || r.vehicle_type === F.vtype) &&
        (!F.shift || r.shift === F.shift) && (!F.customer || r.customer === F.customer);
    });
  }
  function bindFilters() {
    $('f-from').addEventListener('change', function (e) { F.from = e.target.value; render(); });
    $('f-to').addEventListener('change', function (e) { F.to = e.target.value; render(); });
    FILTERS.forEach(function (f) {
      $(f[1]).addEventListener('change', function (e) { F[f[0]] = e.target.value; render(); });
    });
    $('resetBtn').addEventListener('click', function () {
      F.from = F.to = ''; $('f-from').value = $('f-to').value = '';
      FILTERS.forEach(function (f) { F[f[0]] = ''; $(f[1]).value = ''; });
      render();
    });
    $('filterToggle').addEventListener('click', function () { $('filters').classList.toggle('open'); });
    $('closeFilters').addEventListener('click', function () { $('filters').classList.remove('open'); });
    $('vStatus').addEventListener('change', function () { renderVehicles(); });
    $('vehMore').addEventListener('click', function () { vehShowAll = true; renderVehicles(); });
  }

  // ---------- vehicle statistics ----------
  function comps(rs) { // average minutes of each cycle-time component
    const use = rs.filter(function (r) {
      return r.cyc != null && r.loading_min != null && r.queue_min != null && r.travel_min != null && r.unloading_min != null;
    });
    if (!use.length) return null;
    const c = { load: 0, queue: 0, travel: 0, unload: 0, ret: 0 };
    use.forEach(function (r) {
      c.load += r.loading_min; c.queue += r.queue_min; c.travel += r.travel_min; c.unload += r.unloading_min;
      c.ret += Math.max(0, r.cyc * 60 - r.loading_min - r.queue_min - r.travel_min - r.unloading_min);
    });
    Object.keys(c).forEach(function (k) { c[k] /= use.length; });
    return c;
  }

  function vehStats(rs, days) {
    const out = [];
    groupBy(rs, function (r) { return r.vehicle_no; }).forEach(function (list, v) {
      const a = agg(list);
      const loc = modeOf(list, function (r) { return r.location; });
      const done = list.filter(function (r) { return r.cyc != null; }).map(function (r) { return r.cyc; });
      const ratio = ratioAvg(list);
      out.push({
        v: v, loc: loc, tr: modeOf(list, function (r) { return r.transporter; }),
        dest: modeOf(list, function (r) { return r.destination; }),
        route: modeOf(list, function (r) { return r.mine; }) + ' → ' + modeOf(list, function (r) { return r.destination; }),
        trips: list.length, mt: a.mt, cyc: a.cyc, pay: a.pay,
        min: done.length ? Math.min.apply(null, done) : null, max: done.length ? Math.max.apply(null, done) : null,
        std: M.LOC[loc].std, ratio: ratio, status: M.statusOf(ratio),
        cap: M.VTYPES[list[0].vehicle_type] || null, type: list[0].vehicle_type,
        queue: avgOf(list, 'queue_min'), util: Math.min(100, a.cycHours / (days * R.opHours) * 100), list: list
      });
    });
    return out;
  }

  // ---------- charts ----------
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.fmt) return;
      const ctx = chart.ctx; ctx.save();
      ctx.font = '600 12px "Segoe UI", Arial'; ctx.fillStyle = opts.color || '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const horiz = chart.options.indexAxis === 'y';
      chart.data.datasets.forEach(function (ds, i) {
        const meta = chart.getDatasetMeta(i); if (meta.hidden || meta.type !== 'bar') return;
        meta.data.forEach(function (el, j) {
          const len = horiz ? el.width : el.height; if (Math.abs(len) < 26) return;
          const t = opts.fmt(ds, j); if (!t) return;
          const p = el.getCenterPoint(); ctx.fillText(t, p.x, p.y);
        });
      });
      ctx.restore();
    }
  };
  const centerText = {
    id: 'centerText',
    afterDraw: function (chart, args, opts) {
      if (!opts || !opts.lines) return;
      const a = chart.chartArea, ctx = chart.ctx; ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
      ctx.fillStyle = COL.navy; ctx.font = '800 22px "Segoe UI", Arial'; ctx.fillText(opts.lines[0], cx, cy - 8);
      ctx.fillStyle = '#5d6f84'; ctx.font = '600 12px "Segoe UI", Arial'; ctx.fillText(opts.lines[1], cx, cy + 14);
      ctx.restore();
    }
  };
  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = $(id); if (!el || !window.Chart) return;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    charts[id] = new Chart(el, cfg);
  }
  function tickMT(v) { return M.n0(v); }

  // ---------- LEVEL 1: KPI cards ----------
  function kpiSet(rs, days) {
    const a = agg(rs), t = targetFor(rs, days);
    return {
      mt: a.mt, road: agg(rs.filter(function (r) { return r.mode === 'Road'; })).mt,
      siding: agg(rs.filter(function (r) { return r.mode === 'Siding'; })).mt,
      veh: a.veh, cyc: a.cyc, tpv: a.tpv, ach: t ? a.mt / t * 100 : null, short: Math.max(0, t - a.mt)
    };
  }
  function momHtml(cur, prev, goodUp, pts, prevLabel) {
    if (cur == null || prev == null || (!pts && prev === 0)) return '<span class="flat">-</span> no earlier month to compare';
    const d = pts ? cur - prev : (cur - prev) / prev * 100;
    if (Math.abs(d) < 0.05) return '<span class="flat">▬ 0.0%</span> vs ' + prevLabel;
    const good = (d > 0) === goodUp;
    return '<span class="' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + M.n1(Math.abs(d)) + (pts ? ' pts' : '%') +
           '</span> vs ' + prevLabel;
  }
  function renderKPIs() {
    const months = Array.from(new Set(rows.map(function (r) { return r.month; }))).sort();
    const days = windowDays();
    const all = kpiSet(rows, days);
    let cur = null, prev = null, prevLabel = '';
    if (months.length >= 2) {
      const mc = months[months.length - 1], mp = months[months.length - 2];
      cur = kpiSet(rows.filter(function (r) { return r.month === mc; }), daysForMonth(mc));
      prev = kpiSet(rows.filter(function (r) { return r.month === mp; }), daysForMonth(mp));
      prevLabel = monthLabel(mp);
    }
    const defs = [
      ['mt', 'Total coal dispatched', 'box', '', function (v) { return M.n0(v) + ' <small>MT</small>'; }, true, false],
      ['road', 'Road dispatch', 'road', '', function (v) { return M.n0(v) + ' <small>MT</small>'; }, true, false],
      ['siding', 'Siding dispatch', 'rail', 'c-teal', function (v) { return M.n0(v) + ' <small>MT</small>'; }, true, false],
      ['veh', 'Total vehicles deployed', 'truck', '', function (v) { return M.n0(v); }, true, false],
      ['cyc', 'Average cycle time', 'clock', 'c-orange', function (v) { return M.n1(v) + ' <small>hours</small>'; }, false, false],
      ['tpv', 'Average trips per vehicle', 'repeat', '', function (v) { return M.n1(v); }, true, false],
      ['ach', 'Dispatch achievement', 'target', 'c-green', function (v) { return M.pct(v); }, true, true],
      ['short', 'Pending / shortfall', 'alert', 'c-red', function (v) { return M.n0(v) + ' <small>MT</small>'; }, false, false]
    ];
    $('kpis').innerHTML = defs.map(function (d) {
      const cmp = cur ? '<div class="mom">' + momHtml(cur[d[0]], prev[d[0]], d[5], d[6], prevLabel) + '</div>'
                      : '<div class="mom">Only one month in view</div>';
      return '<div class="kpi ' + d[3] + '"><div class="ic">' + M.icon(d[2]) + '</div><div class="lbl">' + d[1] +
             '</div><div class="val">' + (all[d[0]] == null ? '-' : d[4](all[d[0]])) + '</div>' + cmp + '</div>';
    }).join('');
  }

  // Cards for the exceptions (used in Level 1 strip and Level 3 grid)
  function exceptionData() {
    const nV = V.length || 1;
    const ex = V.filter(function (x) { return x.status === 'Exception'; });
    const att = V.filter(function (x) { return x.status === 'Attention'; });
    const wait = V.filter(function (x) { return x.queue != null && x.queue > R.queueStdMin * 1.2; })
                  .sort(function (a, b) { return b.queue - a.queue; });
    const locAvgTrips = {};
    groupBy(V, function (x) { return x.loc; }).forEach(function (l, k) { locAvgTrips[k] = sum(l.map(function (x) { return x.trips; })) / l.length; });
    const lowTrips = V.filter(function (x) { return x.trips < R.lowTrips * locAvgTrips[x.loc]; })
                      .sort(function (a, b) { return a.trips - b.trips; });
    const lowPay = V.filter(function (x) { return x.cap && x.pay != null && x.pay < R.lowPayload * x.cap; })
                    .sort(function (a, b) { return a.pay / a.cap - b.pay / b.cap; });
    const idle = V.filter(function (x) { return x.util < R.lowUtil; }).sort(function (a, b) { return a.util - b.util; });
    const routes = M.LOC_KEYS.map(function (l) {
      const rs = rows.filter(function (r) { return r.location === l; });
      return { l: l, n: rs.length, ratio: ratioAvg(rs), a: agg(rs), queue: avgOf(rs, 'queue_min') };
    }).filter(function (x) { return x.n; });
    const trs = [];
    groupBy(rows, function (r) { return r.transporter; }).forEach(function (rs, t) {
      trs.push({ t: t, a: agg(rs), ratio: ratioAvg(rs), queue: avgOf(rs, 'queue_min') });
    });
    trs.sort(function (a, b) { return (b.ratio || 0) - (a.ratio || 0); });
    const badRoutes = routes.filter(function (x) { return M.statusOf(x.ratio) !== 'Normal'; });
    const badTrs = trs.filter(function (x) { return M.statusOf(x.ratio) !== 'Normal'; });
    return { nV: nV, ex: ex, att: att, wait: wait, lowTrips: lowTrips, lowPay: lowPay, idle: idle, routes: routes, trs: trs, badRoutes: badRoutes, badTrs: badTrs };
  }
  function names(list, fn, n) { return list.slice(0, n || 3).map(fn).join(', ') || 'none'; }

  function renderExStrip(E) {
    const chips = [
      [E.ex.length, 'vehicles >20% above standard cycle time', E.ex.length / E.nV >= 0.1 ? 'bad' : E.ex.length ? 'warn' : ''],
      [E.wait.length, 'vehicles with excessive waiting', rag(E.wait.length / E.nV)],
      [E.lowPay.length, 'vehicles with low payload', rag(E.lowPay.length / E.nV)],
      [E.idle.length, 'vehicles with low utilization', rag(E.idle.length / E.nV)]
    ];
    $('exStrip').innerHTML = chips.map(function (c) {
      const cls = c[2] === 'ok' ? '' : c[2];
      return '<div class="ex-chip ' + cls + '"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
    }).join('') + '<div class="legend-note" style="flex-basis:100%;margin:0">Achievement compares dispatch with route-level targets; narrowing filters such as transporter or vehicle will show a lower percentage. Details: see <a href="#exceptions">Exceptions</a>.</div>';
  }

  // ---------- Key insights ----------
  function renderInsights(E) {
    const tot = agg(rows), out = [];
    const byLoc = M.LOC_KEYS.map(function (l) { return { l: l, a: agg(rows.filter(function (r) { return r.location === l; })) }; });
    const days = windowDays();
    const share = function (x, y) { return y ? x / y * 100 : 0; };
    if (!rows.length) { $('insights').innerHTML = '<div class="insight"><b>No trips match the filters.</b></div>'; return; }
    const top = byLoc.slice().sort(function (a, b) { return b.a.mt - a.a.mt; })[0];
    out.push(['Highest dispatch route', M.LOC[top.l].full, M.n0(top.a.mt) + ' MT = ' + M.pct(share(top.a.mt, tot.mt)) + ' of total dispatch']);
    const sid = byLoc.filter(function (x) { return M.LOC[x.l].mode === 'Siding' && x.a.trips; })
      .sort(function (a, b) { return b.a.mt / M.LOC[b.l].target - a.a.mt / M.LOC[a.l].target; });
    if (sid.length) out.push(['Highest-performing siding', sid[0].l, M.pct(sid[0].a.mt / (M.LOC[sid[0].l].target * days) * 100) + ' of target, ' + M.n0(sid[0].a.mt) + ' MT']);
    if (E.trs.length) {
      const bestD = E.trs.slice().sort(function (a, b) { return b.a.mt - a.a.mt; })[0];
      out.push(['Highest-dispatch transporter', bestD.t, M.n0(bestD.a.mt) + ' MT with ' + bestD.a.veh + ' vehicles']);
      const worstC = E.trs[0];
      if (worstC.ratio != null) out.push(['Transporter with highest cycle time', worstC.t,
        M.n1(worstC.a.cyc) + ' h average, ' + M.pct((worstC.ratio - 1) * 100) + ' vs standard']);
    }
    out.push(['Vehicles with abnormal cycle time', E.ex.length + ' of ' + V.length + ' vehicles',
      'more than 20% above standard' + (E.att.length ? '; ' + E.att.length + ' more on Attention' : '')]);
    out.push(['Average dispatch per vehicle', M.n0(tot.mtv) + ' MT per vehicle', M.n1(tot.tpv) + ' trips per vehicle in the period']);
    const road = byLoc.filter(function (x) { return M.LOC[x.l].mode === 'Road'; }), siding = byLoc.filter(function (x) { return M.LOC[x.l].mode === 'Siding'; });
    const rMT = sum(road.map(function (x) { return x.a.mt; })), sMT = sum(siding.map(function (x) { return x.a.mt; }));
    out.push(['Road vs siding contribution', 'Road ' + M.pct(share(rMT, tot.mt)) + ' | Siding ' + M.pct(share(sMT, tot.mt)), M.n0(rMT) + ' MT road, ' + M.n0(sMT) + ' MT siding']);
    const g = function (l) { return byLoc.find(function (x) { return x.l === l; }).a.mt; };
    out.push(['Sundargarh vs Raigarh', 'Sundargarh ' + M.pct(share(g('Sundargarh'), rMT)) + ' | Raigarh ' + M.pct(share(g('Raigarh'), rMT)), 'share of road dispatch']);
    out.push(['Laikera vs Kanika', 'Laikera ' + M.pct(share(g('Laikera'), sMT)) + ' | Kanika ' + M.pct(share(g('Kanika'), sMT)), 'share of siding dispatch']);
    $('insights').innerHTML = out.map(function (i) {
      return '<div class="insight"><small>' + M.esc(i[0]) + '</small><b>' + M.esc(i[1]) + '</b><span>' + M.esc(i[2]) + '</span></div>';
    }).join('');
  }

  // ---------- Mode split ----------
  function renderMode() {
    const road = agg(rows.filter(function (r) { return r.mode === 'Road'; })).mt;
    const sid = agg(rows.filter(function (r) { return r.mode === 'Siding'; })).mt, tot = road + sid;
    chart('ch-donut', {
      type: 'doughnut', plugins: [centerText],
      data: { labels: ['Road', 'Siding'], datasets: [{ data: [road, sid], backgroundColor: [M.LOC.Sundargarh.color, M.LOC.Laikera.color], borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { centerText: { lines: [M.n0(tot), 'MT total'] }, legend: { position: 'bottom' },
        tooltip: { callbacks: { label: function (c) { return c.label + ': ' + M.n0(c.parsed) + ' MT (' + M.pct(tot ? c.parsed / tot * 100 : 0) + ')'; } } } } }
    });
    $('modeNote').innerHTML = '<b>Road</b> ' + M.n0(road) + ' MT (' + M.pct(tot ? road / tot * 100 : 0) + ') &nbsp;|&nbsp; <b>Siding</b> ' +
      M.n0(sid) + ' MT (' + M.pct(tot ? sid / tot * 100 : 0) + ')';
    const months = Array.from(new Set(rows.map(function (r) { return r.month; }))).sort();
    const val = function (m, mode) { return agg(rows.filter(function (r) { return r.month === m && r.mode === mode; })).mt; };
    chart('ch-monthly', {
      type: 'bar', plugins: [valueLabels],
      data: { labels: months.map(monthLabel), datasets: [
        { label: 'Road', data: months.map(function (m) { return val(m, 'Road'); }), backgroundColor: M.LOC.Sundargarh.color },
        { label: 'Siding', data: months.map(function (m) { return val(m, 'Siding'); }), backgroundColor: M.LOC.Laikera.color }] },
      options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: tickMT }, title: { display: true, text: 'MT' } } },
        plugins: { valueLabels: { fmt: function (ds, j) { return M.n0(ds.data[j]); } } } }
    });
  }

  // ---------- Zone panels + comparison charts ----------
  function zoneHtml(loc) {
    const L = M.LOC[loc], rs = rows.filter(function (r) { return r.location === loc; }), a = agg(rs);
    const t = L.target * windowDays(), st = M.statusOf(ratioAvg(rs));
    const s = function (v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; };
    const items = L.mode === 'Road'
      ? [s(M.n0(a.mt), 'Dispatch (MT)'), s(M.n0(a.veh), 'Number of vehicles'), s(M.n0(a.trips), 'Number of trips'),
         s(M.n1(a.mtv), 'Avg load per vehicle (MT)'), s(M.n1(a.cyc), 'Avg cycle time (h)'), s(M.n0(a.dist), 'Avg distance (km)'),
         s(M.n1(a.tpv), 'Avg trips / vehicle'), s(M.pct(a.mt / t * 100), 'Achievement vs target')]
      : [s(M.n0(a.mt), 'Dispatch (MT)'), s(M.n0(a.trips), 'Number of trips'), s(M.n0(a.veh), 'Number of vehicles'),
         s(M.n0(a.tr), 'Transporter count'), s(M.n1(a.cyc), 'Avg cycle time (h)'), s(M.n1(a.pay), 'Avg payload / trip (MT)'),
         s(M.n1(a.tpv), 'Avg trips / vehicle'), s(M.pct(a.mt / t * 100), 'Achievement vs target')];
    return '<h3>' + (L.mode === 'Road' ? loc + ' side' : loc + ' siding') + ' ' + M.pill(st) + '</h3><div class="stats">' + items.join('') + '</div>' +
           '<div class="legend-note">Standard cycle time ' + M.n1(L.std) + ' h</div>';
  }
  function shareChart(id, locs, metrics) {
    chart(id, {
      type: 'bar', plugins: [valueLabels],
      data: { labels: metrics.map(function (m) { return m.label; }), datasets: locs.map(function (loc, i) {
        return { label: loc, backgroundColor: M.LOC[loc].color, raw: metrics.map(function (m) { return m.vals[i]; }),
                 data: metrics.map(function (m) { const t = m.vals[0] + m.vals[1]; return t ? m.vals[i] / t * 100 : 0; }) };
      }) },
      options: { indexAxis: 'y', scales: { x: { stacked: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }, y: { stacked: true } },
        plugins: { valueLabels: { fmt: function (ds, j) { return M.n0(ds.raw[j]) + ' (' + Math.round(ds.data[j]) + '%)'; } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + M.n0(c.dataset.raw[c.dataIndex]) + ' (' + M.n1(c.parsed.x) + '%)'; } } } } }
    });
  }
  function cycleChart(id, locs) {
    const act = locs.map(function (l) { return agg(rows.filter(function (r) { return r.location === l; })).cyc; });
    chart(id, {
      type: 'bar', plugins: [valueLabels],
      data: { labels: locs, datasets: [
        { label: 'Actual', data: act, backgroundColor: locs.map(function (l, i) { return STATUS_COL[M.statusOf(act[i] == null ? null : act[i] / M.LOC[l].std)]; }) },
        { label: 'Standard', data: locs.map(function (l) { return M.LOC[l].std; }), backgroundColor: COL.grey }] },
      options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'hours' } } },
        plugins: { valueLabels: { fmt: function (ds, j) { return ds.data[j] == null ? '' : M.n1(ds.data[j]); } } } }
    });
  }
  function locAgg(l) { return agg(rows.filter(function (r) { return r.location === l; })); }
  // ---------- Daily trend ----------
  function renderDaily() {
    const dates = dateList();
    const by = {}; M.LOC_KEYS.forEach(function (l) { by[l] = {}; });
    rows.forEach(function (r) { by[r.location][r.trip_date] = (by[r.location][r.trip_date] || 0) + r.payload; });
    const total = dates.map(function (d) { return sum(M.LOC_KEYS.map(function (l) { return by[l][d] || 0; })); });
    const avg7 = total.map(function (v, i) { const s = total.slice(Math.max(0, i - 6), i + 1); return sum(s) / s.length; });
    const tgt = sum(Array.from(new Set(rows.map(function (r) { return r.location; }))).map(function (l) { return M.LOC[l].target; }));
    const bars = M.LOC_KEYS.map(function (l) {
      return { type: 'bar', label: M.LOC[l].full, data: dates.map(function (d) { return by[l][d] || 0; }), backgroundColor: M.LOC[l].color, stack: 's', order: 2 };
    });
    chart('ch-daily', {
      data: { labels: dates.map(dayLabel), datasets: bars.concat([
        { type: 'line', label: 'Daily target', data: dates.map(function () { return tgt; }), borderColor: COL.red, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, order: 1 },
        { type: 'line', label: '7-day average', data: avg7, borderColor: COL.navy, backgroundColor: COL.navy, pointRadius: 0, borderWidth: 3, tension: 0.3, order: 0 }]) },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 14 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: tickMT }, title: { display: true, text: 'MT per day' } } },
        plugins: { legend: { position: 'bottom' } } }
    });
  }

  // ---------- Siding section ----------
  function renderSiding() {
    ['Laikera', 'Kanika'].forEach(function (l) { $('zone-' + l).innerHTML = zoneHtml(l); });
    const a = locAgg('Laikera'), b = locAgg('Kanika');
    shareChart('ch-siding-share', ['Laikera', 'Kanika'], [
      { label: 'Dispatch MT', vals: [a.mt, b.mt] }, { label: 'Trips', vals: [a.trips, b.trips] },
      { label: 'Vehicles', vals: [a.veh, b.veh] }, { label: 'Transporters', vals: [a.tr, b.tr] }]);
    cycleChart('ch-siding-cycle', ['Laikera', 'Kanika']);
  }

  // ---------- Siding transporter table (drill-down) ----------
  function renderTransporters() {
    const days = windowDays();
    const vmap = {}; V.forEach(function (x) { vmap[x.v] = x; });
    const sidRows = rows.filter(function (r) { return r.mode === 'Siding'; });
    let html = '<thead><tr><th>Transporter</th><th>Siding</th><th class="num">Vehicles</th><th class="num">Trips</th><th class="num">Dispatch MT</th>' +
      '<th class="num">Avg Payload/Trip</th><th class="num">Avg Cycle Time (h)</th><th class="num">Trips/Vehicle</th><th class="num">Achievement %</th><th>Flags</th></tr></thead><tbody>';
    const line = function (cls, key, kids, name, siding, a, ach, flags, indent, open) {
      const btn = kids ? '<button class="tree-btn" data-k="' + M.esc(key) + '" aria-label="expand">' + (open ? '−' : '+') + '</button>' : '';
      return '<tr class="' + cls + '"><td class="' + indent + '">' + btn + M.esc(name) + '</td><td>' + M.esc(siding) + '</td><td class="num">' + M.n0(a.veh) +
        '</td><td class="num">' + M.n0(a.trips) + '</td><td class="num">' + M.n0(a.mt) + '</td><td class="num">' + M.n1(a.pay) + '</td><td class="num">' + M.n1(a.cyc) +
        '</td><td class="num">' + M.n1(a.tpv) + '</td><td class="num">' + (ach == null ? '-' : M.pct(ach)) + '</td><td>' + (flags || '') + '</td></tr>';
    };
    const sidings = ['Laikera', 'Kanika'].filter(function (l) { return sidRows.some(function (r) { return r.location === l; }); });
    if (!sidings.length) html += '<tr><td colspan="10">No siding trips for these filters.</td></tr>';
    sidings.forEach(function (sd) {
      const rs = sidRows.filter(function (r) { return r.location === sd; }), sa = agg(rs);
      const sKey = 's:' + sd, sOpen = trOpen.has(sKey);
      html += line('lvl0', sKey, true, sd + ' Siding - all transporters', sd, sa, sa.mt / (M.LOC[sd].target * days) * 100, '', '', sOpen);
      if (!sOpen) return;
      const groups = groupBy(rs, function (r) { return r.transporter; });
      const nTr = groups.size, avgMT = sa.mt / nTr;
      const list = [];
      groups.forEach(function (trs, t) { list.push({ t: t, rs: trs, a: agg(trs), ratio: ratioAvg(trs) }); });
      list.sort(function (a, b) { return b.a.mt - a.a.mt; });
      list.forEach(function (x) {
        const utils = Array.from(new Set(x.rs.map(function (r) { return r.vehicle_no; }))).map(function (v) { return vmap[v] ? vmap[v].util : 0; });
        const flags = [];
        if (nTr > 1 && x.a.mt >= 1.25 * avgMT) flags.push('<span class="flag good">High dispatch</span>');
        if (nTr > 1 && x.a.mt <= 0.6 * avgMT) flags.push('<span class="flag bad">Low dispatch</span>');
        if (x.ratio != null && x.ratio > 1.1) flags.push('<span class="flag bad">High cycle time</span>');
        if (utils.length && sum(utils) / utils.length < R.lowUtil) flags.push('<span class="flag warn">Low vehicle utilization</span>');
        if (x.a.tpv != null && sa.tpv != null && x.a.tpv < 0.8 * sa.tpv) flags.push('<span class="flag warn">Low trips/vehicle</span>');
        const tKey = 't:' + sd + '|' + x.t, tOpen = trOpen.has(tKey);
        html += line('', tKey, true, x.t, sd, x.a, x.a.mt / (M.LOC[sd].target * days / nTr) * 100, flags.join(''), 'ind1', tOpen);
        if (!tOpen) return;
        const vlist = [];
        groupBy(x.rs, function (r) { return r.vehicle_no; }).forEach(function (vr, v) { vlist.push({ v: v, a: agg(vr), ratio: ratioAvg(vr) }); });
        vlist.sort(function (a, b) { return b.a.mt - a.a.mt; });
        vlist.forEach(function (y) {
          html += line('lvl2', '', false, y.v, sd, y.a, null, y.ratio != null && y.ratio > 1.1 ? '<span class="flag bad">High cycle time</span>' : '', 'ind2', false);
        });
      });
    });
    $('trTable').innerHTML = html + '</tbody>';
  }

  // ---------- Vehicle section ----------
  function renderVehicles() {
    const ex = V.filter(function (x) { return x.status === 'Exception'; }).sort(function (a, b) { return b.ratio - a.ratio; });
    $('abnormalBox').innerHTML = ex.length
      ? '<div class="callout"><b>' + ex.length + ' vehicle' + (ex.length > 1 ? 's' : '') + ' with unusually high cycle time</b> (more than 20% above standard):' +
        '<div class="chips">' + ex.slice(0, 12).map(function (x) { return '<span>' + M.esc(x.v) + ' (' + M.n1(x.cyc) + ' h)</span>'; }).join('') +
        (ex.length > 12 ? ' and ' + (ex.length - 12) + ' more' : '') + '</div></div>'
      : '<div class="callout ok"><b>No vehicle is more than 20% above its standard cycle time.</b></div>';

    const topV = V.filter(function (x) { return x.cyc != null; }).sort(function (a, b) { return b.cyc - a.cyc; }).slice(0, 15);
    chart('ch-veh-cycle', {
      data: { labels: topV.map(function (x) { return x.v; }), datasets: [
        { type: 'bar', label: 'Avg cycle time (h)', data: topV.map(function (x) { return x.cyc; }), backgroundColor: topV.map(function (x) { return STATUS_COL[x.status]; }), order: 1 },
        { type: 'line', label: 'Standard for its route (h)', data: topV.map(function (x) { return x.std; }), borderColor: COL.navy, borderDash: [5, 4],
          pointRadius: 3, borderWidth: 2, stepped: 'middle', order: 0 }] },
      options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'hours' } }, x: { ticks: { maxRotation: 70, minRotation: 45, font: { size: 10 } } } },
        plugins: { legend: { position: 'bottom' } } }
    });

    const locs = M.LOC_KEYS.filter(function (l) { return rows.some(function (r) { return r.location === l; }); });
    const cm = locs.map(function (l) { return comps(rows.filter(function (r) { return r.location === l; })); });
    const defs = [['load', 'Loading'], ['queue', 'Queue / waiting'], ['travel', 'Travel'], ['unload', 'Unloading'], ['ret', 'Return']];
    chart('ch-components', {
      type: 'bar', plugins: [valueLabels],
      data: { labels: locs, datasets: defs.map(function (d) {
        return { label: d[1], backgroundColor: COMP_COL[d[0]], data: cm.map(function (c) { return c ? c[d[0]] / 60 : 0; }) };
      }) },
      options: { indexAxis: 'y', scales: { x: { stacked: true, title: { display: true, text: 'hours per trip' } }, y: { stacked: true } },
        plugins: { legend: { position: 'bottom' }, valueLabels: { fmt: function (ds, j) { return ds.data[j] ? M.n1(ds.data[j]) : ''; } } } }
    });

    // table
    const cols = [['v', 'Vehicle No.'], ['tr', 'Transporter'], ['route', 'Route'], ['dest', 'Siding/Destination'], ['trips', 'Trips', 1],
      ['cyc', 'Avg Cycle Time (h)', 1], ['min', 'Min (h)', 1], ['max', 'Max (h)', 1], ['pay', 'Avg Payload (MT)', 1], ['ratio', 'Status']];
    const flt = $('vStatus').value;
    let list = V.filter(function (x) { return !flt || x.status === flt; });
    const k = vehSort.k, d = vehSort.dir;
    list.sort(function (a, b) {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d;
    });
    const limit = vehShowAll ? list.length : 30;
    let html = '<thead><tr>' + cols.map(function (c) {
      const arrow = vehSort.k === c[0] ? (vehSort.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th class="sortable' + (c[2] ? ' num' : '') + '" data-k="' + c[0] + '">' + c[1] + arrow + '</th>';
    }).join('') + '</tr></thead><tbody>';
    if (!list.length) html += '<tr><td colspan="10">No vehicles for these filters.</td></tr>';
    list.slice(0, limit).forEach(function (x) {
      html += '<tr class="clickable" data-v="' + M.esc(x.v) + '"><td>' + M.esc(x.v) + '</td><td>' + M.esc(x.tr) + '</td><td>' + M.esc(x.route) + '</td><td>' + M.esc(x.dest) +
        '</td><td class="num">' + x.trips + '</td><td class="num">' + M.n1(x.cyc) + '</td><td class="num">' + M.n1(x.min) + '</td><td class="num">' + M.n1(x.max) +
        '</td><td class="num">' + M.n1(x.pay) + '</td><td>' + M.pill(x.status) + '</td></tr>';
      if (vehOpen.has(x.v)) html += '<tr class="detail"><td colspan="10">' + compBar(x) + '</td></tr>';
    });
    $('vehTable').innerHTML = html + '</tbody>';
    $('vehMore').style.display = !vehShowAll && list.length > limit ? 'inline-flex' : 'none';
    $('vehMore').textContent = 'Show all ' + list.length + ' vehicles';
  }
  function compBar(x) {
    const c = comps(x.list);
    if (!c) return 'No loading / waiting / travel / unloading times were recorded for this vehicle.';
    const defs = [['load', 'Loading'], ['queue', 'Queue / waiting'], ['travel', 'Travel'], ['unload', 'Unloading'], ['ret', 'Return']];
    const total = sum(defs.map(function (d) { return c[d[0]]; })) || 1;
    return '<b>Average time components per trip (' + M.n0(total) + ' min)</b>' +
      '<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;margin:6px 0">' + defs.map(function (d) {
        return '<div title="' + d[1] + '" style="width:' + (c[d[0]] / total * 100) + '%;background:' + COMP_COL[d[0]] + '"></div>';
      }).join('') + '</div><div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.85rem">' + defs.map(function (d) {
        return '<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + COMP_COL[d[0]] + ';margin-right:4px"></i>' +
               d[1] + ' ' + M.n0(c[d[0]]) + ' min</span>';
      }).join('') + '</div>';
  }

  // ---------- Exceptions ----------
  function renderExceptions(E) {
    const n = E.nV;
    const cards = [
      ['Cycle time above standard', E.ex.length, 'vehicles >20% above; ' + E.att.length + ' more 10-20% above',
        E.ex.length / n >= 0.1 ? 'bad' : (E.ex.length || E.att.length / n >= 0.1) ? 'warn' : 'ok', names(E.ex, function (x) { return x.v; })],
      ['Excessive waiting time', E.wait.length, 'vehicles waiting over ' + M.n0(R.queueStdMin * 1.2) + ' min at the mine (standard ' + R.queueStdMin + ')',
        rag(E.wait.length / n), names(E.wait, function (x) { return x.v + ' (' + M.n0(x.queue) + ' min)'; })],
      ['Low trips per vehicle', E.lowTrips.length, 'vehicles with less than ' + M.n0(R.lowTrips * 100) + '% of their route\'s average trips',
        rag(E.lowTrips.length / n), names(E.lowTrips, function (x) { return x.v + ' (' + x.trips + ')'; })],
      ['Low payload', E.lowPay.length, 'vehicles carrying under ' + M.n0(R.lowPayload * 100) + '% of capacity',
        rag(E.lowPay.length / n), names(E.lowPay, function (x) { return x.v + ' (' + M.n0(x.pay / x.cap * 100) + '%)'; })],
      ['Vehicle idle time', E.idle.length, 'vehicles used less than ' + R.lowUtil + '% of available hours',
        rag(E.idle.length / n), names(E.idle, function (x) { return x.v + ' (idle ' + M.n0(100 - x.util) + '%)'; })],
      ['Route-wise delays', E.badRoutes.length, 'of ' + E.routes.length + ' routes / sidings run above standard',
        E.badRoutes.some(function (x) { return M.statusOf(x.ratio) === 'Exception'; }) ? 'bad' : E.badRoutes.length ? 'warn' : 'ok', names(E.badRoutes, function (x) { return x.l; })],
      ['Transporter-wise delays', E.badTrs.length, 'of ' + E.trs.length + ' transporters run above standard',
        E.badTrs.some(function (x) { return M.statusOf(x.ratio) === 'Exception'; }) ? 'bad' : E.badTrs.length ? 'warn' : 'ok', names(E.badTrs, function (x) { return x.t; })],
      ['Trips far above standard', rows.filter(function (r) { return r.cyc != null && r.cyc / r.std > 1.2; }).length,
        'trips out of ' + M.n0(rows.filter(function (r) { return r.cyc != null; }).length) + ' finished trips took over 20% longer than standard',
        rag(rows.filter(function (r) { return r.cyc != null && r.cyc / r.std > 1.2; }).length / Math.max(1, rows.filter(function (r) { return r.cyc != null; }).length)), '']
    ];
    $('exGrid').innerHTML = cards.map(function (c) {
      return '<div class="ex-card ' + (c[3] === 'ok' ? '' : c[3]) + '"><h4>' + c[0] + ' ' + ragPill(c[3]) + '</h4><div class="big">' + c[1] + '</div><p>' + c[2] + '</p>' +
             (c[4] ? '<p><b>Worst:</b> ' + M.esc(c[4]) + '</p>' : '') + '</div>';
    }).join('');

    const dl = function (x, name, extra) {
      return '<tr><td>' + M.esc(name) + '</td>' + extra + '<td class="num">' + M.n1(x.a.cyc) + '</td><td class="num">' + M.pct(x.ratio == null ? null : (x.ratio - 1) * 100) +
             '</td><td class="num">' + M.n0(x.queue) + '</td><td>' + M.pill(M.statusOf(x.ratio)) + '</td></tr>';
    };
    $('routeDelay').innerHTML = '<thead><tr><th>Route / siding</th><th class="num">Standard (h)</th><th class="num">Avg cycle (h)</th><th class="num">vs standard</th><th class="num">Avg wait (min)</th><th>Status</th></tr></thead><tbody>' +
      (E.routes.map(function (x) { return dl(x, M.LOC[x.l].full, '<td class="num">' + M.n1(M.LOC[x.l].std) + '</td>'); }).join('') || '<tr><td colspan="6">No data.</td></tr>') + '</tbody>';
    $('trDelay').innerHTML = '<thead><tr><th>Transporter</th><th class="num">Vehicles</th><th class="num">Avg cycle (h)</th><th class="num">vs standard</th><th class="num">Avg wait (min)</th><th>Status</th></tr></thead><tbody>' +
      (E.trs.map(function (x) { return dl(x, x.t, '<td class="num">' + x.a.veh + '</td>'); }).join('') || '<tr><td colspan="6">No data.</td></tr>') + '</tbody>';
  }

  // ---------- Utilization ----------
  function renderUtilization() {
    const availV = new Set(ALL.map(function (r) { return r.vehicle_no; })).size;
    const a = agg(rows);
    const util = V.length ? sum(V.map(function (x) { return x.util; })) / V.length : null;
    const cards = [
      ['Total vehicles available', M.n0(availV), 'truck', ''], ['Vehicles deployed', M.n0(V.length), 'truck', 'c-green'],
      ['Vehicles not deployed', M.n0(Math.max(0, availV - V.length)), 'alert', 'c-orange'],
      ['Average trips per vehicle', M.n1(a.tpv), 'repeat', ''], ['Average payload per vehicle', M.n1(a.pay) + ' <small>MT / trip</small>', 'box', 'c-teal'],
      ['Vehicle utilization', M.pct(util), 'target', 'c-green']];
    $('utilKpis').className = 'kpis six';
    $('utilKpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c[3] + '"><div class="ic">' + M.icon(c[2]) + '</div><div class="lbl">' + c[0] + '</div><div class="val">' + c[1] + '</div></div>';
    }).join('');
    const rank = function (list, low) {
      return list.map(function (x, i) {
        return '<div class="rank ' + (low ? 'low' : '') + '"><b>' + (i + 1) + '</b><div>' + M.esc(x.v) + ' <small>' + M.esc(x.tr) + ' - ' + M.esc(x.loc) + ' - ' + x.trips + ' trips</small>' +
               '<div class="bar"><i style="width:' + x.util + '%"></i></div></div><b>' + M.n0(x.util) + '%</b></div>';
      }).join('') || 'No vehicles.';
    };
    const sorted = V.slice().sort(function (x, y) { return y.util - x.util; });
    $('top10').innerHTML = rank(sorted.slice(0, 10), false);
    $('bottom10').innerHTML = rank(sorted.slice(-10).reverse(), true);
  }

  // ---------- Actions + summary ----------
  function renderActions(E) {
    const byLoc = M.LOC_KEYS.map(function (l) { return { l: l, a: locAgg(l) }; }).filter(function (x) { return x.a.trips; });
    const topR = byLoc.slice().sort(function (x, y) { return y.a.mt - x.a.mt; })[0];
    const days = windowDays(), tot = agg(rows), t = targetFor(rows, days);
    const q = avgOf(rows, 'queue_min'), l = avgOf(rows, 'loading_min');
    const lai = locAgg('Laikera'), kan = locAgg('Kanika');
    const lag = byLoc.slice().sort(function (x, y) { return x.a.mt / M.LOC[x.l].target - y.a.mt / M.LOC[y.l].target; })[0];
    const modeAch = function (m) {
      const rs = rows.filter(function (r) { return r.mode === m; }), tt = targetFor(rs, days);
      return tt ? M.pct(agg(rs).mt / tt * 100) : '-';
    };
    const cols = [
      ['Operations', [
        ['Improve vehicle deployment on high-demand routes.', topR ? 'Highest demand: ' + topR.l + ' (' + M.n0(topR.a.mt) + ' MT, ' + M.n1(topR.a.tpv) + ' trips/vehicle).' : ''],
        ['Reduce loading and queue time.', 'Average loading ' + M.n0(l) + ' min and waiting ' + M.n0(q) + ' min per trip.'],
        ['Monitor vehicles with repeated high cycle times.', E.ex.length + ' vehicle(s) are more than 20% above standard.']]],
      ['Transport Management', [
        ['Review transporter-wise performance.', E.trs.length ? 'Slowest: ' + E.trs[0].t + ' (' + M.pct((E.trs[0].ratio - 1) * 100) + ' vs standard).' : ''],
        ['Optimize vehicle allocation between Laikera and Kanika.', 'Trips/vehicle: Laikera ' + M.n1(lai.tpv) + ', Kanika ' + M.n1(kan.tpv) + '. Cycle time: ' + M.n1(lai.cyc) + ' h vs ' + M.n1(kan.cyc) + ' h.'],
        ['Monitor low-utilization vehicles.', E.idle.length + ' vehicle(s) below ' + R.lowUtil + '% utilization.']]],
      ['Dispatch Management', [
        ['Monitor daily dispatch achievement.', 'Achievement ' + M.pct(t ? tot.mt / t * 100 : null) + '; shortfall ' + M.n0(Math.max(0, t - tot.mt)) + ' MT.'],
        ['Compare road and siding performance.', 'Achievement: road ' + modeAch('Road') + ', siding ' + modeAch('Siding') + '.'],
        ['Track destination-wise dispatch against targets.', lag ? 'Furthest behind target: ' + lag.l + ' (' + M.pct(lag.a.mt / (M.LOC[lag.l].target * days) * 100) + ').' : '']]]
    ];
    $('actionsBox').innerHTML = cols.map(function (c) {
      return '<div class="action-col"><h3>' + c[0] + '</h3><ul>' + c[1].map(function (i) {
        return '<li>' + i[0] + (i[1] ? '<small>' + M.esc(i[1]) + '</small>' : '') + '</li>';
      }).join('') + '</ul></div>';
    }).join('');
  }
  function renderSummary() {
    const days = windowDays();
    const line = function (mode, name, rs, target) {
      const a = agg(rs);
      return '<tr' + (mode === 'Total' ? ' class="total"' : '') + '><td>' + mode + '</td><td>' + name + '</td><td class="num">' + M.n0(a.mt) + '</td><td class="num">' + M.n0(a.veh) +
        '</td><td class="num">' + M.n0(a.trips) + '</td><td class="num">' + M.n1(a.pay) + '</td><td class="num">' + M.n1(a.cyc) + '</td><td class="num">' +
        (target ? M.pct(a.mt / target * 100) : '-') + '</td></tr>';
    };
    $('sumTable').innerHTML = '<thead><tr><th>Mode</th><th>Route / Siding</th><th class="num">Dispatch MT</th><th class="num">Vehicles</th><th class="num">Trips</th>' +
      '<th class="num">Avg Payload (MT)</th><th class="num">Avg Cycle Time (h)</th><th class="num">Achievement</th></tr></thead><tbody>' +
      M.LOC_KEYS.map(function (l) {
        return line(M.LOC[l].mode, l, rows.filter(function (r) { return r.location === l; }), M.LOC[l].target * days);
      }).join('') + line('Total', '', rows, targetFor(rows, days)) + '</tbody>';
  }

  // ---------- main render ----------
  function render() {
    if (!window.Chart) { banner('bad', 'The chart library did not load (check the internet connection). Tables still work.'); }
    applyFilters();
    const days = windowDays();
    V = vehStats(rows, days);
    const E = exceptionData();
    renderKPIs(); renderExStrip(E); renderInsights(E); renderMode(); renderDaily();
    renderSiding(); renderTransporters(); renderVehicles(); renderExceptions(E);
    renderUtilization(); renderActions(E); renderSummary();
  }

  // table click handlers (set once)
  document.addEventListener('click', function (e) {
    const tb = e.target.closest && e.target.closest('.tree-btn');
    if (tb) { const k = tb.getAttribute('data-k'); if (trOpen.has(k)) trOpen.delete(k); else trOpen.add(k); renderTransporters(); return; }
    const th = e.target.closest && e.target.closest('#vehTable th.sortable');
    if (th) { const k = th.getAttribute('data-k'); vehSort = { k: k, dir: vehSort.k === k ? -vehSort.dir : (k === 'v' || k === 'tr' || k === 'route' || k === 'dest' ? 1 : -1) }; renderVehicles(); return; }
    const tr = e.target.closest && e.target.closest('#vehTable tr.clickable');
    if (tr) { const v = tr.getAttribute('data-v'); if (vehOpen.has(v)) vehOpen.delete(v); else vehOpen.add(v); renderVehicles(); }
  });

  if (window.Chart) {
    Chart.defaults.font.family = '"Segoe UI", system-ui, Arial, sans-serif';
    Chart.defaults.color = '#33465b';
    Chart.defaults.plugins.legend.labels.boxWidth = 14;
  }
  bindFilters();
  loadData();
})();
