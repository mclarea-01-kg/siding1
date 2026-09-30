// demo-data.js - makes up trip records so the dashboard can be shown before the
// database has data. Everything here is INVENTED. No real names, vehicles or figures.
window.Demo = (function () {
  'use strict';
  const M = window.MCL;
  const IST = 19800000; // 5.5 hours in milliseconds

  function rng(seed) { // small repeatable random-number maker
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate() {
    const r = rng(20260930);
    const pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    const startMs = Date.UTC(2026, 7, 1) - IST; // 1 Aug 2026, midnight IST
    const DAYS = 61;                            // 1 Aug - 30 Sep 2026

    const plan = { Sundargarh: 12, Raigarh: 10, Laikera: 10, Kanika: 8 };
    const pool = {
      Sundargarh: ['Trans-A', 'Trans-B', 'Trans-C', 'Trans-D', 'Trans-E', 'Trans-F'],
      Raigarh:    ['Trans-D', 'Trans-E', 'Trans-F', 'Trans-G', 'Trans-H'],
      Laikera:    ['Trans-A', 'Trans-B', 'Trans-G', 'Trans-H', 'Trans-I'],
      Kanika:     ['Trans-C', 'Trans-E', 'Trans-I', 'Trans-J']
    };
    const bias = { 'Trans-J': 1.9, 'Trans-E': 1.4, 'Trans-B': 0.7 }; // waiting-time bias per transporter

    const vehicles = [];
    let no = 1001;
    M.LOC_KEYS.forEach(function (loc) {
      for (let i = 0; i < plan[loc]; i++) {
        const tr = pick(pool[loc]);
        const roadType = pick(['Tipper 16T', 'Tipper 20T', 'Tipper 20T', 'Hyva 25T']);
        vehicles.push({
          no: 'OD14-T-' + (no++), loc: loc, tr: tr,
          type: M.LOC[loc].mode === 'Road' ? roadType : (r() < 0.8 ? 'Hyva 25T' : 'Tipper 20T'),
          active: 0.6 + r() * 0.38,
          queueF: (r() < 0.15 ? 2.6 + r() : 0.6 + r() * 0.9) * (bias[tr] || 1),
          payF: r() < 0.12 ? 0.78 + r() * 0.06 : 0.93 + r() * 0.08,
          mine: pick(M.MINES), customer: pick(M.CUSTOMERS)
        });
      }
    });
    // a few vehicles on record that hardly work at all
    for (let i = 0; i < 5; i++) {
      const loc = M.LOC_KEYS[i % 4];
      const tr = pick(pool[loc]);
      vehicles.push({ no: 'OD14-T-' + (no++), loc: loc, tr: tr, type: 'Tipper 20T', active: 0.07,
                      queueF: 1, payF: 0.97, mine: pick(M.MINES), customer: pick(M.CUSTOMERS) });
    }

    const rows = [];
    const lastDay = DAYS - 1;
    vehicles.forEach(function (v) {
      const L = M.LOC[v.loc];
      const cap = M.VTYPES[v.type];
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(startMs + d * 86400000 + IST);
        const dow = date.getUTCDay();
        let p = v.active * (dow === 0 ? 0.8 : 1);
        if (d >= 17 && d <= 19) p *= 0.55;   // a rainy spell
        if (r() > p) continue;
        const dayStart = startMs + d * 86400000;
        let t = dayStart + (5 + r() * 3) * 3600000;
        while (t < dayStart + 21 * 3600000) {
          const dest = pick(L.dests);
          const dist = L.dist * (0.9 + r() * 0.2);
          const noise = 0.9 + r() * 0.25;
          const loading = Math.round((40 + r() * 15) * (0.8 + v.queueF * 0.1));
          const queue = Math.round((30 + r() * 30) * v.queueF * (v.loc === 'Kanika' ? 1.1 : 1));
          const travel = Math.round(dist / 30 * 60 * noise);
          const unloading = Math.round(25 + r() * 15);
          const back = Math.round(dist / 38 * 60 * noise);
          const cycMin = loading + queue + travel + unloading + back;
          const dep = t;
          const ret = dep + cycMin * 60000;
          const local = new Date(dep + IST);
          const h = local.getUTCHours();
          const shift = h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C';
          const open = d === lastDay && h >= 15;   // trips still running on the last day
          const ratio = cycMin / 60 / L.std;
          rows.push({
            trip_date: local.toISOString().slice(0, 10),
            shift: shift, mine: v.mine, mode: L.mode, location: v.loc, destination: dest,
            customer: v.customer, transporter: v.tr, vehicle_no: v.no, vehicle_type: v.type,
            payload_mt: Math.round(Math.min(cap * 1.05, cap * v.payF * (0.97 + r() * 0.06)) * 100) / 100,
            distance_km: Math.round(dist * 10) / 10,
            departure_time: new Date(dep).toISOString(),
            return_time: open ? null : new Date(ret).toISOString(),
            loading_min: loading, queue_min: queue, travel_min: travel, unloading_min: unloading,
            urgency: open ? 'Low' : M.urgencyOf(ratio),
            status: open ? 'In progress' : 'Resolved'
          });
          t = ret + (15 + r() * 45) * 60000;
        }
      }
    });
    return rows;
  }

  // Saves demo rows into the database in small batches.
  async function save(db, rows, onProgress) {
    const step = 500;
    for (let i = 0; i < rows.length; i += step) {
      const { error } = await db.from('dispatch_trips').insert(rows.slice(i, i + step));
      if (error) throw error;
      if (onProgress) onProgress(Math.min(i + step, rows.length), rows.length);
    }
  }

  return { generate: generate, save: save };
})();
