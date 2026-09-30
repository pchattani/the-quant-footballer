/* The Quant Footballer — the layer above the competitions.
 *
 *   #/clubs                 every club on the pooled scale, a hypothetical-match pricer
 *   #/leaders               global leaderboards, raw and league-adjusted
 *   #/ballon-dor            the Ballon d'Or model against the market
 *   #/compare/...           two players or two clubs side by side
 *   #/player/<id>           a player's career (from the archive)
 *
 * All of it reads the site-wide payloads (pool.json, players_global.json,
 * ballon-dor/ballon_dor.json, careers/, history/) and never needs a competition
 * to be open. The Dixon-Coles pricing of a hypothetical match is computed here
 * from the pooled parameters, so any two clubs across leagues can be priced. */
(function (FH) {
'use strict';

const { INDEX, C, PALETTE, esc, pct, num, signed, fmtMetric, fmtDate, fmtStamp, crest, playerLink, matchHref,
        tableHTML, setHTML, sortableIn, wireRowLinks, statTile, formChips, pctPill, pctRow, pctColor, probBar,
        plot, layout, renderRadar, renderProbBars, loadSite, RADAR_OUT, RADAR_GK } = FH;

// ── Dixon-Coles in the browser ─────────────────────────────────────────────

function poissonPmf(k, lam) {
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i++) p *= lam / i;
  return p;
}

/* The pooled model's score matrix for home v away; `homeAdv` 0 for a neutral venue. */
function dcMatrix(home, away, model, homeAdv) {
  const lamH = Math.exp(home.attack + away.defence + (homeAdv || 0));
  const lamA = Math.exp(away.attack + home.defence);
  const k = (model.max_goals || 8) + 1;
  const rho = model.rho || 0;
  const m = [];
  let total = 0;
  for (let i = 0; i < k; i++) {
    m.push([]);
    for (let j = 0; j < k; j++) {
      let p = poissonPmf(i, lamH) * poissonPmf(j, lamA);
      if (i === 0 && j === 0) p *= 1 - lamH * lamA * rho;
      else if (i === 1 && j === 0) p *= 1 + lamA * rho;
      else if (i === 0 && j === 1) p *= 1 + lamH * rho;
      else if (i === 1 && j === 1) p *= 1 - rho;
      p = Math.max(p, 0);
      m[i].push(p);
      total += p;
    }
  }
  let h = 0, d = 0, a = 0, o25 = 0, btts = 0, best = [0, 0, -1];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const p = m[i][j] / total;
    if (i > j) h += p; else if (i === j) d += p; else a += p;
    if (i + j >= 3) o25 += p;
    if (i >= 1 && j >= 1) btts += p;
    if (p > best[2]) best = [i, j, p];
  }
  return { h, d, a, lamH, lamA, o25, btts, score: best[0] + '-' + best[1], pScore: best[2] };
}

function fairOdds(p) { return p > 0.005 ? (1 / p).toFixed(2) : '—'; }

function matchCard(home, away, model, neutral) {
  const r = dcMatrix(home, away, model, neutral ? 0 : model.home_adv);
  return '<div class="hypo">' + probBar({ h: r.h, d: r.d, a: r.a }) +
    '<div class="kpi-grid six">' +
    statTile(esc(home.team), pct(r.h), 'fair ' + fairOdds(r.h)) + statTile('Draw', pct(r.d), 'fair ' + fairOdds(r.d)) +
    statTile(esc(away.team), pct(r.a), 'fair ' + fairOdds(r.a)) +
    statTile('Expected goals', num(r.lamH, 2) + ' – ' + num(r.lamA, 2), 'most likely ' + r.score + ' (' + pct(r.pScore) + ')') +
    statTile('Over 2.5', pct(r.o25), 'under ' + pct(1 - r.o25)) + statTile('Both score', pct(r.btts), '') +
    '</div></div>';
}

// ── clubs across leagues ───────────────────────────────────────────────────

let POOL = null;

function clubLabel(c) { return c.team + ' (' + (c.comp_name || c.comp) + ')'; }

function renderClubs() {
  loadSite('pool.json').then(pool => {
    POOL = pool;
    if (!pool || !(pool.clubs || []).length) { setHTML('clubs-table', '<div class="muted">' + esc((pool || {}).note || 'No pooled model this run.') + '</div>'); return; }
    const leagues = pool.leagues || {};
    const lrows = Object.keys(leagues).map(s => ({ slug: s, ...leagues[s] })).sort((a, b) => a.rank - b.rank);
    setHTML('leagues-table', tableHTML([
      { label: '#', sortable: false }, { label: 'League' }, { label: 'Clubs', align: 'right' }, { label: 'Strength', align: 'right', title: 'Mean expected points per game of its clubs against the pool-average club, neutral venue' },
      { label: 'Attack', align: 'right' }, { label: 'Defence', align: 'right', title: 'Lower is better (fewer goals conceded)' },
      { label: 'Scoring factor', align: 'right', title: "Multiplier applied to a player's attacking rates from this league: how much harder it is to score here than against the pool average" },
      { label: 'Best club', sortable: false }, { label: 'Bridge', align: 'right', title: 'Cup matches connecting this league to the pool; fewer means a less certain scale' }
    ], lrows.map(L => ({ cells: [
      { v: L.rank, cls: 'pos-cell' }, { v: L.name, html: '<a href="#/' + esc(L.slug) + '/overview">' + esc(L.name) + '</a>' }, { v: L.n_clubs, align: 'right' },
      { v: L.strength, html: '<strong>' + num(L.strength, 3) + '</strong>', align: 'right' },
      { v: L.attack, html: signed(L.attack, 3), align: 'right' }, { v: L.defence, html: signed(L.defence, 3), align: 'right' },
      { v: L.factor_att, html: num(L.factor_att, 3), align: 'right' },
      { v: L.best, html: esc(L.best) + ' <span class="muted-inline">#' + L.best_rank + '</span>' },
      { v: L.connection, html: L.connection + (L.connection < 20 ? ' <span class="chip warn">weak</span>' : ''), align: 'right' }
    ] }))));
    sortableIn('leagues-table');
    const bridges = pool.bridges || {};
    const bkeys = Object.keys(bridges).sort((x, y) => bridges[y] - bridges[x]);
    setHTML('bridges-note', '<p><strong>Between continents</strong> the fit has only these matches to go on — ' +
      (bkeys.length ? bkeys.map(k => esc(k.replace('|', ' – ')) + ': ' + bridges[k]).join(' · ') : 'none') +
      '. Within a block (Europe through the UEFA cups, South America through CONMEBOL\'s, North America through CONCACAF\'s, Asia through the AFC\'s) the scale is well identified; a club\'s rank against clubs of another block is not, and the Club World Cup and Intercontinental Cup are the only bridges. Compare within a block with confidence; across blocks, read the numbers as the model\'s best guess with wide error.</p>');

    const sel = document.getElementById('clubs-league');
    sel.innerHTML = '<option value="">All competitions</option>' + INDEX.competitions.filter(c => pool.clubs.some(x => x.comp === c.slug))
      .map(c => '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>').join('');
    const search = document.getElementById('clubs-search');
    function draw() {
      const q = search.value.trim().toLowerCase(), lg = sel.value;
      const rows = pool.clubs.filter(c => (!lg || c.comp === lg) && (!q || c.team.toLowerCase().indexOf(q) >= 0)).slice(0, lg || q ? 400 : 150);
      setHTML('clubs-table', tableHTML([
        { label: '#', sortable: false }, { label: 'Club' }, { label: 'Competition' }, { label: 'Block', sortable: true }, { label: 'Strength', align: 'right', title: 'Expected points per game against the pool-average club at a neutral venue' },
        { label: 'xG for', align: 'right', title: 'Expected goals against the pool-average defence' }, { label: 'xG against', align: 'right' },
        { label: 'Attack', align: 'right' }, { label: 'Defence', align: 'right' }, { label: 'Elo', align: 'right' }, { label: 'Pos', align: 'right' }, { label: 'Form', align: 'right' }, { label: 'Luck', align: 'right' }
      ], rows.map(c => ({ _href: c.in_league ? '#/' + c.comp + '/team/' + (c.slug || FH.slugify(c.team)) : null, cells: [
        { v: c.rank, cls: 'pos-cell' },
        { v: c.team, html: crest(c.team, c.crest) + esc(c.team) }, { v: c.comp_name, html: esc(c.comp_name) },
        { v: c.block || '', html: '<span class="chip">' + esc(c.block || '') + '</span>' },
        { v: c.strength, html: '<strong>' + num(c.strength, 3) + '</strong>', align: 'right' },
        { v: c.xg_for, html: num(c.xg_for, 2), align: 'right' }, { v: c.xg_against, html: num(c.xg_against, 2), align: 'right' },
        { v: c.attack, html: signed(c.attack, 2), align: 'right' }, { v: c.defence, html: signed(c.defence, 2), align: 'right' },
        { v: c.elo || 0, html: c.elo ? num(c.elo, 0) : '—', align: 'right' }, { v: c.table_rank || 0, html: c.table_rank || '—', align: 'right' },
        { v: c.ppg || 0, html: c.form_results ? formChips(c.form_results) : '—', align: 'right' },
        { v: c.luck === null || c.luck === undefined ? 0 : c.luck, html: c.luck === null || c.luck === undefined ? '—' : signed(c.luck, 1), align: 'right' }
      ] })), { sticky: true }));
      wireRowLinks('clubs-table');
      sortableIn('clubs-table');
    }
    sel.onchange = draw; search.oninput = draw;
    draw();
    setHTML('clubs-sub', pool.clubs.length + ' clubs on one scale · rho ' + num(pool.model.rho, 3) + ' · home advantage ' + num(pool.model.home_adv, 3));

    // The pricer.
    const opts = pool.clubs.map((c, i) => '<option value="' + i + '">' + esc(clubLabel(c)) + '</option>').join('');
    const a = document.getElementById('hypo-a'), b = document.getElementById('hypo-b'), venue = document.getElementById('hypo-venue');
    a.innerHTML = opts; b.innerHTML = opts; b.selectedIndex = Math.min(1, pool.clubs.length - 1);
    function price() {
      const home = pool.clubs[parseInt(a.value, 10)], away = pool.clubs[parseInt(b.value, 10)];
      if (!home || !away) return;
      setHTML('hypo-result', matchCard(home, away, pool.model, venue.value === 'neutral'));
    }
    a.onchange = price; b.onchange = price; venue.onchange = price;
    price();
    const top = pool.clubs.slice(0, 25).reverse();
    plot('clubs-chart', [{ type: 'bar', orientation: 'h', y: top.map(c => c.team + ' · ' + c.comp_name), x: top.map(c => c.strength), marker: { color: C.blue },
      text: top.map(c => num(c.strength, 2)), textposition: 'outside', cliponaxis: false, hovertemplate: '%{y}: %{x:.3f} PPG v average<extra></extra>' }],
      layout({ margin: { l: 240, r: 50, t: 10, b: 40 }, xaxis: { title: 'Expected points per game against the pool-average club', range: [1.5, 3] }, yaxis: { automargin: true } }));
  });
}

// ── national teams ─────────────────────────────────────────────────────────

function renderNations() {
  Promise.all([loadSite('nations.json'), loadSite('hub.json')]).then(([n, hub]) => {
    const teams = (n || {}).teams || [];
    if (!teams.length) { setHTML('nations-table', '<div class="muted">' + esc((n || {}).note || 'No international fit yet — the national-team stores fill on the next fetch.') + '</div>'); setHTML('nations-fixtures', ''); setHTML('nations-chart', ''); return; }
    setHTML('nations-sub', teams.length + ' teams · rho ' + num(n.model.rho, 3) + ' · home advantage ' + num(n.model.home_adv, 3));
    setHTML('nations-note', '<p>' + esc(n.note || '') + '</p>');
    const confs = Array.from(new Set(teams.map(t => t.confederation).filter(Boolean))).sort();
    const sel = document.getElementById('nations-conf'), search = document.getElementById('nations-search');
    sel.innerHTML = '<option value="">All confederations</option>' + confs.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    function draw() {
      const q = search.value.trim().toLowerCase(), conf = sel.value;
      const rows = teams.filter(t => (!conf || t.confederation === conf) && (!q || t.team.toLowerCase().indexOf(q) >= 0)).slice(0, 150);
      setHTML('nations-table', tableHTML([
        { label: '#', sortable: false }, { label: 'Team' }, { label: 'Confederation' }, { label: 'Played', align: 'right', title: 'Matches in the stores' },
        { label: 'Strength', align: 'right', title: 'Expected points per game against the average national team, neutral venue' },
        { label: 'Attack', align: 'right' }, { label: 'Defence', align: 'right' }, { label: 'Elo', align: 'right' }
      ], rows.map(t => ({ cells: [
        { v: t.rank, cls: 'pos-cell' }, { v: t.team, html: esc(t.team) }, { v: t.confederation || '', html: esc(t.confederation || '—') },
        { v: t.played, align: 'right' }, { v: t.strength, html: '<strong>' + num(t.strength, 3) + '</strong>', align: 'right' },
        { v: t.attack, html: signed(t.attack, 2), align: 'right' }, { v: t.defence, html: signed(t.defence, 2), align: 'right' },
        { v: t.elo || 0, html: t.elo ? num(t.elo, 0) : '—', align: 'right' }
      ] })), { sticky: true }));
      sortableIn('nations-table');
    }
    sel.onchange = draw; search.oninput = draw;
    draw();
    const opts = teams.map((t, i) => '<option value="' + i + '">' + esc(t.team) + '</option>').join('');
    const a = document.getElementById('nhypo-a'), b = document.getElementById('nhypo-b'), venue = document.getElementById('nhypo-venue');
    a.innerHTML = opts; b.innerHTML = opts; b.selectedIndex = Math.min(1, teams.length - 1);
    function price() {
      const home = teams[parseInt(a.value, 10)], away = teams[parseInt(b.value, 10)];
      if (!home || !away) return;
      setHTML('nhypo-result', matchCard(home, away, n.model, venue.value === 'neutral'));
    }
    a.onchange = price; b.onchange = price; venue.onchange = price;
    price();
    const upcoming = ((hub || {}).upcoming || []).concat(Object.values((hub || {}).days || {}).flat()).filter(i => i.family === 'international' && i.status !== 'finished')
      .sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const seen = new Set();
    const list = upcoming.filter(i => { const k = i.comp + ':' + i.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);
    setHTML('nations-fixtures', list.length ? list.map(i => FH.fixtureRow(i, { showDate: true }).replace('class="fx-row', 'title="' + esc(i.comp_name) + '" class="fx-row')).join('') : '<div class="muted">No international fixtures in the stores yet.</div>');
    const top = teams.slice(0, 25).reverse();
    plot('nations-chart', [{ type: 'bar', orientation: 'h', y: top.map(t => t.team), x: top.map(t => t.strength), marker: { color: C.green },
      text: top.map(t => num(t.strength, 2)), textposition: 'outside', cliponaxis: false, hovertemplate: '%{y}: %{x:.3f} PPG v average<extra></extra>' }],
      layout({ margin: { l: 160, r: 50, t: 10, b: 40 }, xaxis: { title: 'Expected points per game against the average national team' }, yaxis: { automargin: true } }));
  });
}

// ── global leaderboards ────────────────────────────────────────────────────

function metricOptionsGlobal(metrics, scope, adjustedKeys) {
  const groups = [];
  metrics.filter(m => scope === 'all' || m.scope === 'all' || m.scope === scope).forEach(m => {
    let g = groups.find(x => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
    if (adjustedKeys.indexOf(m.key) >= 0) g.items.push({ key: m.key + '_adj', label: m.label + ' (league-adjusted)', fmt: m.fmt, pct: true, lower: m.lower });
  });
  return groups.map(g => '<optgroup label="' + esc(g.name) + '">' + g.items.map(m => '<option value="' + esc(m.key) + '">' + esc(m.label) + '</option>').join('') + '</optgroup>').join('');
}

function renderLeaders() {
  loadSite('players_global.json').then(g => {
    const all = g.players || [];
    const metrics = g.metrics || [];
    const adjusted = g.adjusted_keys || [];
    if (!all.length) { setHTML('leaders-table', '<div class="muted">No players yet.</div>'); return; }
    setHTML('leaders-sub', all.length + ' qualified players across ' + Object.keys(g.leagues || {}).length + ' leagues and the cups · percentiles against the pool\'s position group over ' + g.minutes_floor + ' minutes');
    setHTML('leaders-note', '<p>' + esc(g.note || '') + '</p>');
    const metricSel = document.getElementById('leaders-metric'), posSel = document.getElementById('leaders-pos'), compSel = document.getElementById('leaders-comp'), minMin = document.getElementById('leaders-min');
    const comps = Array.from(new Set(all.map(p => p.comp)));
    compSel.innerHTML = '<option value="">All competitions</option>' + INDEX.competitions.filter(c => comps.indexOf(c.slug) >= 0).map(c => '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>').join('');
    minMin.value = g.minutes_floor || 270;
    function fill() {
      const scope = posSel.value === 'G' ? 'gk' : posSel.value ? 'out' : 'all';
      const keep = metricSel.value;
      metricSel.innerHTML = metricOptionsGlobal(metrics, scope, adjusted);
      metricSel.value = Array.from(metricSel.options).some(o => o.value === keep) ? keep : (scope === 'gk' ? 'saves_90' : 'npxg_90_adj');
    }
    fill();
    function draw() {
      const key = metricSel.value;
      const base = key.replace(/_adj$/, '');
      const metric = metrics.find(m => m.key === base) || { fmt: '2' };
      const floor = parseInt(minMin.value, 10) || 0, comp = compSel.value, pos = posSel.value;
      const rows = all.filter(p => p.minutes >= floor && (!comp || p.comp === comp) && (!pos || (pos === 'G' ? p.is_gk : p.position === pos)) && p[key] !== undefined && p[key] !== null)
        .sort((a, b) => metric.lower ? a[key] - b[key] : b[key] - a[key]).slice(0, 100);
      const pctKey = (p) => (p.pct_global || {})[key] !== undefined ? key : (p.pct_global || {})[base + '_90'] !== undefined ? base + '_90' : null;
      setHTML('leaders-table', rows.length ? tableHTML([
        { label: '#', sortable: false }, { label: 'Player' }, { label: 'Club' }, { label: 'Competition' }, { label: 'Pos', align: 'center' }, { label: 'Age', align: 'right' },
        { label: 'Min', align: 'right' }, { label: (metric.label || key) + (key.endsWith('_adj') ? ' (adj.)' : ''), align: 'right' },
        { label: 'Raw', align: 'right', title: 'Before the league adjustment' }, { label: 'Factor', align: 'right', title: "The league's scoring factor" },
        { label: 'Pctl', align: 'center', title: 'Percentile in the global position pool' }, { label: 'G', align: 'right' }, { label: 'A', align: 'right' }, { label: 'Rating', align: 'right' }
      ], rows.map((p, i) => { const pk = pctKey(p); return { cells: [
        { v: i + 1, cls: 'pos-cell' }, { v: p.name, html: playerLink(p.player_id, p.name, p.comp) },
        { v: p.team, html: crest(p.team, p.crest) + esc(p.team) }, { v: p.comp_name, html: esc(p.comp_name) },
        { v: p.position || '', html: p.position ? '<span class="pos-badge pos-' + esc(p.position) + '">' + esc(p.position) + '</span>' : '', align: 'center' },
        { v: p.age || 0, html: p.age || '—', align: 'right' }, { v: p.minutes, align: 'right' },
        { v: p[key], html: '<strong>' + fmtMetric(p[key], metric.fmt) + '</strong>', align: 'right' },
        { v: key.endsWith('_adj') ? p[base] : p[key], html: key.endsWith('_adj') ? fmtMetric(p[base], metric.fmt) : '—', align: 'right' },
        { v: p.adj_factor || 1, html: num(p.adj_factor || 1, 2), align: 'right' },
        { v: pk ? p.pct_global[pk] : -1, html: pctPill(pk ? p.pct_global[pk] : undefined), align: 'center' },
        { v: p.goals || 0, align: 'right' }, { v: p.assists || 0, align: 'right' }, { v: p.rating || 0, html: p.rating ? num(p.rating, 2) : '—', align: 'right' }
      ] }; }), { sticky: true }) : '<div class="muted">No player clears the filters.</div>');
      sortableIn('leaders-table');
    }
    metricSel.onchange = draw; posSel.onchange = () => { fill(); draw(); }; compSel.onchange = draw; minMin.onchange = draw; minMin.oninput = draw;
    draw();
  });
}

// ── Ballon d'Or ────────────────────────────────────────────────────────────

function driverBar(c) {
  const d = c.drivers || {};
  const keys = [['ucl', 'UCL', C.blue], ['league', 'League', C.teal], ['international', 'Intl', C.green], ['international_output', 'Intl out.', '#7ee787'],
                ['output', 'Output', C.orange], ['rating', 'Rating', C.purple], ['position', 'Pos', C.text3]];
  return '<div class="drivers">' + keys.map(k => {
    const v = d[k[0]] || 0;
    if (Math.abs(v) < 0.05) return '';
    return '<span class="drv" style="background:' + k[2] + (v < 0 ? '33' : '') + ';border-color:' + k[2] + '" title="' + k[1] + ' ' + signed(v, 2) + '">' + k[1] + ' ' + signed(v, 1) + '</span>';
  }).join('') + '</div>';
}

function renderBallonDor() {
  loadSite('ballon-dor/ballon_dor.json').then(b => {
    if (!b || !b.edition) { setHTML('bd-table', '<div class="muted">No Ballon d\'Or payload yet.</div>'); return; }
    const ed = b.edition, mk = (b.market || {}).winner;
    setHTML('bd-sub', ed.season + ' season · ceremony ' + esc(fmtDate(ed.ceremony, true)) + (mk ? ' · market: Polymarket "' + esc(mk.title) + '", $' + Math.round((mk.volume || 0) / 1e6) + 'M traded, fetched ' + esc(fmtStamp(mk.fetched_at)) : ' · no market this run'));
    setHTML('bd-notes', (b.notes || []).map(n => '<div class="stale-banner">' + esc(n) + '</div>').join(''));
    const w = ed.weights || {};
    const cands = ed.candidates || [];
    setHTML('bd-table', tableHTML([
      { label: '#', sortable: false }, { label: 'Player' }, { label: 'Club', sortable: false }, { label: 'Pos', align: 'center' },
      { label: 'Model', align: 'right', title: 'Model probability of winning' }, { label: 'Market', align: 'right', title: 'Polymarket implied (YES prices normalised)' },
      { label: 'Edge', align: 'right', title: 'Model minus market' }, { label: 'Fair', align: 'right', title: 'Fair decimal odds from the model' },
      { label: 'Drivers', sortable: false, title: 'Contribution of each term to the score' }, { label: 'Season line', sortable: false }
    ], cands.map((c, i) => ({ cells: [
      { v: i + 1, cls: 'pos-cell' },
      { v: c.name, html: c.id ? playerLink(c.id, c.name, c.league_slug || c.league) : esc(c.name) },
      { v: c.club, html: esc(c.club) + (c.club_season && c.club_season !== c.club ? ' <span class="muted-inline">(' + esc(c.club_season) + ' last season)</span>' : '') },
      { v: c.position || '', html: '<span class="pos-badge pos-' + esc(c.position || '') + '">' + esc(c.position || '') + '</span>', align: 'center' },
      { v: c.model, html: '<strong>' + pct(c.model) + '</strong>', align: 'right' },
      { v: c.market === null || c.market === undefined ? -1 : c.market, html: c.market === null || c.market === undefined ? '—' : pct(c.market), align: 'right' },
      { v: c.edge === null || c.edge === undefined ? 0 : c.edge, html: c.edge === null || c.edge === undefined ? '—' : '<span class="' + (c.edge > 0.05 ? 'danger' : c.edge < -0.05 ? '' : 'safe') + '">' + signed(c.edge * 100, 1) + '%</span>', align: 'right' },
      { v: c.model, html: fairOdds(c.model), align: 'right' },
      { v: c.score, html: driverBar(c) },
      { v: '', html: c.line ? (c.line.goals || 0) + 'G ' + (c.line.assists || 0) + 'A in ' + (c.line.minutes || 0) + "'" + (c.line.rating ? ' · ' + num(c.line.rating, 2) : '') + (c.output_source === 'proxy' ? ' <span class="chip warn" title="this season, as a proxy for last season">proxy</span>' : '') + (c.int_line ? '<br><span class="muted-inline">WC: ' + (c.int_line.goals || 0) + 'G ' + (c.int_line.assists || 0) + 'A' + (c.int_line.rating ? ' · ' + num(c.int_line.rating, 2) : '') + '</span>' : '') : '<span class="muted-inline">no line</span>' }
    ] })), { sticky: true }));
    sortableIn('bd-table');

    // Model against market, top names.
    const top = cands.slice(0, 12).reverse();
    plot('bd-chart', [
      { type: 'bar', orientation: 'h', name: 'Model', y: top.map(c => c.name), x: top.map(c => c.model), marker: { color: C.blue }, hovertemplate: '%{y}: model %{x:.1%}<extra></extra>' },
      { type: 'bar', orientation: 'h', name: 'Market', y: top.map(c => c.name), x: top.map(c => c.market || 0), marker: { color: C.orange }, hovertemplate: '%{y}: market %{x:.1%}<extra></extra>' }
    ], layout({ barmode: 'group', showlegend: true, legend: { orientation: 'h', y: 1.08, font: { color: C.text2 } }, margin: { l: 150, r: 20, t: 30, b: 40 }, xaxis: { tickformat: '.0%' }, yaxis: { automargin: true } }));

    // Market top-3 / top-5.
    const t3 = (b.market || {}).top3, t5 = (b.market || {}).top5;
    const implied = m => Object.keys((m || {}).implied || {}).map(n => ({ name: n, p: m.implied[n] })).sort((x, y) => y.p - x.p).slice(0, 12);
    const mkRows = implied(mk), r3 = implied(t3), r5 = implied(t5);
    if (mkRows.length) {
      setHTML('bd-market', tableHTML([{ label: 'Player' }, { label: 'Win', align: 'right' }, { label: 'Top 3', align: 'right' }, { label: 'Top 5', align: 'right' }, { label: 'Price', align: 'right', title: 'YES price (cents)' }, { label: '1w', align: 'right', title: 'Price change over a week' }],
        mkRows.map(r => { const price = (mk.prices || []).find(p => p.name === r.name) || {}; const f3 = r3.find(x => x.name === r.name), f5 = r5.find(x => x.name === r.name); return { cells: [
          { v: r.name }, { v: r.p, html: '<strong>' + pct(r.p) + '</strong>', align: 'right' },
          { v: f3 ? f3.p : 0, html: f3 ? pct(f3.p) : '—', align: 'right' }, { v: f5 ? f5.p : 0, html: f5 ? pct(f5.p) : '—', align: 'right' },
          { v: price.yes || 0, html: price.yes !== undefined ? Math.round(price.yes * 100) + '¢' : '—', align: 'right' },
          { v: price.change_1w || 0, html: price.change_1w !== undefined && price.change_1w !== null ? '<span class="' + (price.change_1w > 0 ? 'res-W' : price.change_1w < 0 ? 'res-L' : '') + '">' + signed(price.change_1w * 100, 1) + '</span>' : '—', align: 'right' }
        ] }; })));
    } else setHTML('bd-market', '<div class="muted">No market data this run.</div>');

    // Snapshots over time.
    const snaps = b.snapshots || [];
    if (snaps.length >= 2) {
      const names = cands.slice(0, 5).map(c => c.name);
      const traces = [];
      names.forEach((n, i) => {
        traces.push({ type: 'scatter', mode: 'lines', name: n + ' (model)', x: snaps.map(s => s.ts), y: snaps.map(s => (s.model || {})[n] || 0), line: { color: PALETTE[i % 8], width: 2 } });
        traces.push({ type: 'scatter', mode: 'lines', name: n + ' (market)', x: snaps.map(s => s.ts), y: snaps.map(s => (s.market || {})[n] || null), line: { color: PALETTE[i % 8], width: 1.5, dash: 'dot' } });
      });
      plot('bd-history', traces, layout({ showlegend: true, legend: { orientation: 'h', y: -0.2, font: { color: C.text2 } }, margin: { l: 55, r: 20, t: 10, b: 80 }, yaxis: { tickformat: '.0%', rangemode: 'tozero' } }));
    } else setHTML('bd-history', '<div class="muted">The model-against-market chart appears after a few hourly runs.</div>');

    // Next edition.
    const nx = b.next || {};
    setHTML('bd-next-sub', (nx.season || '') + ' · ' + esc(nx.note || ''));
    // A projected candidate's league is a weight in the payload; its competition is the key's prefix.
    const slugOf = c => typeof c.league === 'string' ? c.league : String(c.key || '').split(':')[0];
    setHTML('bd-next', (nx.candidates || []).length ? tableHTML([
      { label: '#', sortable: false }, { label: 'Player' }, { label: 'Club' }, { label: 'League' }, { label: 'Pos', align: 'center' }, { label: 'Model', align: 'right' },
      { label: 'P(title)', align: 'right' }, { label: 'P(UCL)', align: 'right' }, { label: 'G+A/90 adj.', align: 'right' }, { label: 'Rating', align: 'right' }, { label: 'Drivers', sortable: false }
    ], nx.candidates.map((c, i) => ({ cells: [
      { v: i + 1, cls: 'pos-cell' }, { v: c.name, html: playerLink(c.id, c.name, slugOf(c)) }, { v: c.club, html: esc(c.club) },
      { v: slugOf(c), html: esc(((INDEX.competitions.find(x => x.slug === slugOf(c)) || {}).short_name) || slugOf(c)) + (typeof c.league === 'number' ? ' <span class="muted-inline" title="League weight in the model">' + num(c.league, 2) + '</span>' : '') },
      { v: c.position || '', html: '<span class="pos-badge pos-' + esc(c.position || '') + '">' + esc(c.position || '') + '</span>', align: 'center' },
      { v: c.model, html: '<strong>' + pct(c.model) + '</strong>', align: 'right' }, { v: c.p_title, html: pct(c.p_title), align: 'right' },
      { v: c.p_ucl, html: pct(c.p_ucl), align: 'right' }, { v: c.ga90, html: num(c.ga90, 2), align: 'right' }, { v: c.rating || 0, html: num(c.rating, 2), align: 'right' },
      { v: c.score, html: driverBar(c) }
    ] })), { sticky: true }) : '<div class="muted">No projection yet.</div>');
    sortableIn('bd-next');

    // History of winners.
    setHTML('bd-winners', tableHTML([{ label: 'Year', align: 'right' }, { label: 'Winner' }, { label: 'Club' }, { label: 'Second' }, { label: 'Third' }],
      (b.history || []).map(h => ({ cells: [{ v: h.year, align: 'right' }, { v: h.winner || '', html: h.winner ? '<strong>' + esc(h.winner) + '</strong>' : '<span class="muted-inline">' + esc(h.note || '—') + '</span>' },
        { v: h.winner_club || '' }, { v: h.second || '' }, { v: h.third || '' }] }))));
    setHTML('bd-weights', tableHTML([{ label: 'Term', sortable: false }, { label: 'Weight', align: 'right', sortable: false }, { label: 'Feature', sortable: false }], [
      ['ucl', 'Champions League: 1 winner, 0.6 finalist, 0.3 semi-finalist'], ['league', 'League title (weighted by league: big five 1.0, others less)'],
      ['international', "That summer's tournament: 1 winner, 0.6 finalist, 0.3 semi-finalist"], ['international_output', 'z-score of goal involvement per 90 at the tournament'],
      ['output', 'z-score of goal involvement per 90 over the season (league + UCL)'], ['rating', 'z-score of the season rating'], ['temperature', 'Softmax temperature']
    ].map(r => ({ cells: [{ v: r[0] }, { v: w[r[0]], html: num(w[r[0]], 2), align: 'right' }, { v: r[1] }] })).concat([{ cells: [{ v: 'position prior' }, { v: '', html: Object.keys(w.position_prior || {}).map(k => k + ' ' + signed(w.position_prior[k], 1)).join(' · '), align: 'right' }, { v: 'Forwards win; midfielders rarely; defenders and keepers almost never' }] }])));
    setHTML('bd-method', '<p>Weights: <strong>' + esc(w.method === 'fitted' ? 'fitted on ' + (w.editions || '') + ' past podiums (Plackett-Luce)' : 'structural defaults') + '</strong>. ' +
      'The score is the weighted sum of the terms; the win probability is a softmax over the shortlist. Fair odds carry no margin. The market column is Polymarket\'s YES price per candidate, normalised so the shortlist sums to one; the edge is model minus market and is only as good as the model\'s inputs — until last season\'s statistics are in the archive, the output and rating terms use this season\'s numbers as a proxy.</p>');
  });
}

// ── compare ────────────────────────────────────────────────────────────────

let SEARCH_IDX = null;

function pickerHTML(id, placeholder) {
  return '<div class="picker"><input id="' + id + '" type="search" placeholder="' + esc(placeholder) + '" autocomplete="off"><div id="' + id + '-results" class="search-results"></div></div>';
}

function wirePicker(id, kind, onPick) {
  const input = document.getElementById(id), box = document.getElementById(id + '-results');
  if (!input) return;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = norm(input.value.trim());
      if (q.length < 2) { box.style.display = 'none'; return; }
      FH.fetchJSON('data/search.json', { teams: [], players: [] }).then(idx => {
        SEARCH_IDX = idx;
        const hits = kind === 'players'
          ? idx.players.filter(p => norm(p.n).indexOf(q) >= 0).slice(0, 10).map(p => ({ key: p.comp + ':' + p.id, label: p.n, sub: p.t + ' · ' + p.comp }))
          : idx.teams.filter(t => norm(t.n).indexOf(q) >= 0).slice(0, 10).map(t => ({ key: t.comp + ':' + t.slug, label: t.n, sub: t.comp_name }));
        box.innerHTML = hits.map(h => '<a class="sr-item" href="#" data-key="' + esc(h.key) + '"><span>' + esc(h.label) + '</span><span class="sr-sub">' + esc(h.sub) + '</span></a>').join('') || '<div class="sr-empty">No match.</div>';
        box.style.display = 'block';
        box.querySelectorAll('a').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); box.style.display = 'none'; input.value = ''; onPick(a.dataset.key); }));
      });
    }, 120);
  });
}

function renderCompare(param) {
  const parts = (param || '').split('/').filter(Boolean);
  const kind = parts[0] === 'clubs' ? 'clubs' : 'players';
  const a = parts[1] || '', b = parts[2] || '';
  const pane = document.getElementById('tab-compare');
  pane.innerHTML = '<div class="card"><div class="card-header">Compare <span class="card-sub">Two players or two clubs from any competition.</span></div>' +
    '<div class="controls"><label><input type="radio" name="cmp-kind" value="players"' + (kind === 'players' ? ' checked' : '') + '> players</label>' +
    '<label><input type="radio" name="cmp-kind" value="clubs"' + (kind === 'clubs' ? ' checked' : '') + '> clubs</label>' +
    pickerHTML('cmp-pick-a', 'Search the first ' + (kind === 'players' ? 'player' : 'club') + '…') + pickerHTML('cmp-pick-b', 'Search the second…') + '</div>' +
    '<div class="pad" id="cmp-picked"></div></div><div id="cmp-body"></div>';
  pane.querySelectorAll('input[name=cmp-kind]').forEach(r => r.addEventListener('change', () => { location.hash = '#/compare/' + r.value; }));
  wirePicker('cmp-pick-a', kind, key => { location.hash = '#/compare/' + kind + '/' + key + (b ? '/' + b : ''); });
  wirePicker('cmp-pick-b', kind, key => { location.hash = '#/compare/' + kind + '/' + (a || '') + '/' + key; });
  if (!a && !b) { setHTML('cmp-body', '<div class="card"><div class="muted">Pick two ' + kind + ' above. Examples: <a href="#/compare/players/mls:12994/saudi-pro-league:750">Messi v Ronaldo</a> · <a href="#/compare/players/premier-league:839956/bundesliga:108579">Haaland v Kane</a> · <a href="#/compare/clubs/premier-league:arsenal/la-liga:barcelona">Arsenal v Barcelona</a></div></div>'); return; }
  if (kind === 'players') comparePlayers(a, b); else compareClubs(a, b);
}

function splitKey(key) { const i = key.indexOf(':'); return i < 0 ? [null, key] : [key.slice(0, i), key.slice(i + 1)]; }

function comparePlayers(ka, kb) {
  loadSite('players_global.json').then(g => {
    const all = g.players || [];
    const find = key => { const [comp, id] = splitKey(key); return all.find(p => String(p.player_id) === String(id) && (!comp || p.comp === comp)) || all.find(p => String(p.player_id) === String(id)); };
    const pa = ka ? find(ka) : null, pb = kb ? find(kb) : null;
    const missing = [ka && !pa ? ka : null, kb && !pb ? kb : null].filter(Boolean);
    setHTML('cmp-picked', [pa, pb].map(p => p ? '<span class="chip">' + esc(p.name) + ' · ' + esc(p.team) + ' · ' + esc(p.comp_name) + '</span>' : '<span class="chip warn">not picked</span>').join(' v ') +
      (missing.length ? ' <span class="muted-inline">(' + esc(missing.join(', ')) + ' not among the qualified players this season)</span>' : ''));
    if (!pa || !pb) { setHTML('cmp-body', '<div class="card"><div class="muted">Pick both players.</div></div>'); return; }
    const gk = pa.is_gk && pb.is_gk;
    const axes = gk ? RADAR_GK : RADAR_OUT;
    let html = '<div class="grid-2">';
    html += '<div class="card"><div class="card-header">Profile <span class="card-sub">Percentiles in the global position pool, this season.</span></div><div id="cmp-radar" style="height:420px"></div></div>';
    html += '<div class="card"><div class="card-header">Season, side by side <span class="card-sub">Adjusted rates use each league\'s scoring factor.</span></div><div id="cmp-table"></div></div>';
    html += '</div>';
    html += '<div class="card"><div class="card-header">Evolution this season <span class="card-sub">Cumulative goals and assists by match, and rolling rating.</span></div><div class="grid-2"><div id="cmp-evo" style="height:320px"></div><div id="cmp-rating" style="height:320px"></div></div></div>';
    html += '<div class="card"><div class="card-header">Careers <span class="card-sub" id="cmp-career-sub">From the archive, season by season.</span></div><div class="grid-2"><div id="cmp-career-goals" style="height:340px"></div><div id="cmp-career-rate" style="height:340px"></div></div><div id="cmp-career-table"></div></div>';
    setHTML('cmp-body', html);
    renderRadar('cmp-radar', axes, [pa, pb].map(p => ({ name: p.name, pct: p.pct_global })));
    const rows = [
      ['Competition', p => p.comp_name], ['Club', p => p.team], ['Position', p => p.position || '—'], ['Age', p => p.age || '—'],
      ['Apps / minutes', p => p.matches + ' / ' + p.minutes], ['Goals', p => p.goals], ['Assists', p => p.assists], ['xG', p => num(p.xg, 2)], ['xA', p => num(p.xa, 2)],
      ['npxG /90', p => num(p.npxg_90, 2)], ['npxG /90 adjusted', p => num(p.npxg_90_adj, 2) + ' <span class="muted-inline">×' + num(p.adj_factor || 1, 2) + '</span>'],
      ['xA /90 adjusted', p => num(p.xa_90_adj, 2)], ['Goals /90 adjusted', p => num(p.goals_90_adj, 2)], ['Shots /90', p => num(p.shots_90, 2)],
      ['Key passes /90', p => num(p.key_passes_90, 2)], ['Pass %', p => fmtMetric(p.pass_pct, 'pct')], ['Dribbles /90', p => num(p.dribbles_90, 2)],
      ['Tackles /90', p => num(p.tackles_90, 2)], ['Interceptions /90', p => num(p.interceptions_90, 2)], ['Aerial %', p => fmtMetric(p.aerial_pct, 'pct')],
      ['Rating', p => num(p.rating, 2)]
    ];
    if (gk) rows.push(['Saves /90', p => num(p.saves_90, 2)], ['Save %', p => fmtMetric(p.save_pct, 'pct')], ['Goals prevented /90', p => num(p.goals_prevented_90, 2)]);
    setHTML('cmp-table', tableHTML([{ label: '', sortable: false }, { label: pa.name, align: 'right', sortable: false }, { label: pb.name, align: 'right', sortable: false }],
      rows.map(r => ({ cells: [{ v: r[0] }, { v: '', html: String(r[1](pa)), align: 'right' }, { v: '', html: String(r[1](pb)), align: 'right' }] }))));
    // Within-season evolution from the two clubs' shards.
    Promise.all([pa, pb].map(p => FH.fetchJSON('data/' + p.comp + '/players/' + (p.team_slug || FH.slugify(p.team)) + '.json', null))).then(shards => {
      const logs = shards.map((s, i) => (((s || {}).players || {})[String([pa, pb][i].player_id)] || {}).matches || []);
      const traces = [], rtraces = [];
      logs.forEach((rows, i) => {
        const chron = rows.slice().reverse();
        let ga = 0;
        const xs = [], ys = [], rs = [];
        chron.forEach((r, k) => { ga += (r.g || 0) + (r.a || 0); xs.push(k + 1); ys.push(ga); rs.push(r.rt || null); });
        const p = [pa, pb][i];
        traces.push({ type: 'scatter', mode: 'lines+markers', name: p.name, x: xs, y: ys, line: { color: PALETTE[i], width: 2 }, hovertemplate: p.name + ': %{y} G+A after %{x} matches<extra></extra>' });
        const roll = rs.map((_, k) => { const w = rs.slice(Math.max(0, k - 4), k + 1).filter(v => v !== null); return w.length ? w.reduce((s, v) => s + v, 0) / w.length : null; });
        rtraces.push({ type: 'scatter', mode: 'lines+markers', name: p.name, x: xs, y: roll, line: { color: PALETTE[i], width: 2 }, hovertemplate: p.name + ': rolling rating %{y:.2f}<extra></extra>' });
      });
      plot('cmp-evo', traces, layout({ showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 45, r: 15, t: 30, b: 40 }, xaxis: { title: 'Match' }, yaxis: { title: 'Cumulative G+A', rangemode: 'tozero' } }));
      plot('cmp-rating', rtraces, layout({ showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 45, r: 15, t: 30, b: 40 }, xaxis: { title: 'Match' }, yaxis: { title: 'Rating (5-match rolling)', range: [5.5, 9] } }));
    });
    // Careers.
    Promise.all([pa, pb].map(p => FH.fetchJSON('data/careers/' + p.player_id + '.json', null))).then(cs => renderCareerCompare([pa, pb], cs));
  });
}

function seasonLabel(s) { return (s.season || s.year || '') + ' ' + (s.tournament || ''); }

function renderCareerCompare(players, careers) {
  const have = careers.map(c => c && (c.seasons || []).length);
  if (!have[0] && !have[1]) {
    setHTML('cmp-career-sub', 'Neither player is in the archive yet — careers fill in as scripts/fetch_sofascore_history.py runs.');
    setHTML('cmp-career-goals', ''); setHTML('cmp-career-rate', ''); setHTML('cmp-career-table', '');
    return;
  }
  // Per season-year, league seasons only (one line per year per player), G+A totals and G+A/90.
  const byYear = careers.map(c => {
    const out = {};
    (c && c.seasons || []).forEach(s => {
      if (!s.minutes) return;
      const y = String(s.year || s.season || '');
      const key = y.indexOf('/') >= 0 ? '20' + y.split('/')[0] : y.slice(0, 4);
      const row = out[key] = out[key] || { goals: 0, assists: 0, minutes: 0, rw: 0, comps: [] };
      row.goals += s.goals || 0; row.assists += s.assists || 0; row.minutes += s.minutes || 0;
      if (s.rating) row.rw += s.rating * s.minutes;
      row.comps.push(s.tournament);
    });
    return out;
  });
  const years = Array.from(new Set(byYear.flatMap(o => Object.keys(o)))).sort();
  plot('cmp-career-goals', players.map((p, i) => ({ type: 'bar', name: p.name, x: years, y: years.map(y => (byYear[i][y] || {}).goals + (byYear[i][y] || {}).assists || 0), marker: { color: PALETTE[i] },
    hovertemplate: p.name + ' %{x}: %{y} G+A<extra></extra>' })), layout({ barmode: 'group', showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 45, r: 15, t: 30, b: 40 }, yaxis: { title: 'Goals + assists (all competitions in the archive)' } }));
  plot('cmp-career-rate', players.map((p, i) => ({ type: 'scatter', mode: 'lines+markers', name: p.name, x: years, y: years.map(y => { const r = byYear[i][y]; return r && r.minutes ? (r.goals + r.assists) / (r.minutes / 90) : null; }), line: { color: PALETTE[i], width: 2 },
    hovertemplate: p.name + ' %{x}: %{y:.2f} G+A per 90<extra></extra>' })), layout({ showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 45, r: 15, t: 30, b: 40 }, yaxis: { title: 'G+A per 90', rangemode: 'tozero' } }));
  setHTML('cmp-career-table', tableHTML([{ label: 'Season', sortable: false }].concat(players.map(p => ({ label: p.name, align: 'right', sortable: false }))),
    years.slice().reverse().map(y => ({ cells: [{ v: y }].concat(players.map((p, i) => { const r = byYear[i][y]; return { v: '', html: r ? r.goals + 'G ' + r.assists + 'A · ' + r.minutes + "' · " + (r.rw ? num(r.rw / r.minutes, 2) : '—') + '<br><span class="muted-inline">' + esc(Array.from(new Set(r.comps)).join(', ')) + '</span>' : '—', align: 'right' }; })) }))));
  setHTML('cmp-career-sub', players.map((p, i) => p.name + ': ' + (have[i] ? careers[i].seasons.length + ' seasons' + (careers[i].complete ? '' : ' (filling)') : 'not archived yet')).join(' · '));
}

function compareClubs(ka, kb) {
  loadSite('pool.json').then(pool => {
    const clubs = (pool || {}).clubs || [];
    const find = key => { const [comp, slug] = splitKey(key); return clubs.find(c => c.comp === comp && (c.slug === slug || FH.slugify(c.team) === slug)) || clubs.find(c => FH.slugify(c.team) === slug); };
    const ca = ka ? find(ka) : null, cb = kb ? find(kb) : null;
    setHTML('cmp-picked', [ca, cb].map(c => c ? '<span class="chip">' + esc(c.team) + ' · ' + esc(c.comp_name) + '</span>' : '<span class="chip warn">not picked</span>').join(' v '));
    if (!ca || !cb) { setHTML('cmp-body', '<div class="card"><div class="muted">Pick both clubs' + (clubs.length ? '' : ' (no pooled model this run)') + '.</div></div>'); return; }
    let html = '<div class="card"><div class="card-header">If they met <span class="card-sub">From the pooled Dixon-Coles fit; the venue toggle applies the pool\'s home advantage.</span></div><div class="pad">' +
      '<div class="grid-2"><div><div class="mini-head">' + esc(ca.team) + ' at home</div>' + matchCard(ca, cb, pool.model, false) + '</div>' +
      '<div><div class="mini-head">Neutral venue</div>' + matchCard(ca, cb, pool.model, true) + '</div></div></div></div>';
    const rows = [
      ['Competition', c => c.comp_name], ['Pool rank', c => '#' + c.rank + ' of ' + clubs.length], ['Strength (PPG v average)', c => num(c.strength, 3)],
      ['Attack', c => signed(c.attack, 3)], ['Defence', c => signed(c.defence, 3)], ['xG for / against v average', c => num(c.xg_for, 2) + ' / ' + num(c.xg_against, 2)],
      ['Elo', c => c.elo ? num(c.elo, 0) : '—'], ['Table position', c => c.table_rank || '—'], ['Points per game', c => c.ppg ? num(c.ppg, 2) : '—'],
      ['Form', c => c.form_results ? formChips(c.form_results) : '—'], ['xG difference', c => c.xg_diff === undefined || c.xg_diff === null ? '—' : signed(c.xg_diff, 1)], ['Luck', c => c.luck === undefined || c.luck === null ? '—' : signed(c.luck, 1)]
    ];
    html += '<div class="card"><div class="card-header">Side by side</div>' + tableHTML([{ label: '', sortable: false }, { label: ca.team, align: 'right', sortable: false }, { label: cb.team, align: 'right', sortable: false }],
      rows.map(r => ({ cells: [{ v: r[0] }, { v: '', html: String(r[1](ca)), align: 'right' }, { v: '', html: String(r[1](cb)), align: 'right' }] }))) + '</div>';
    html += '<div class="card"><div class="card-header">Season statistics <span class="card-sub">Per-match averages from the team-stat sheets, with each club\'s percentile in its own competition.</span></div><div id="cmp-club-stats"></div></div>';
    setHTML('cmp-body', html);
    Promise.all([ca, cb].map(c => c.in_league ? FH.fetchJSON('data/' + c.comp + '/team_stats.json', null) : Promise.resolve(null))).then(ts => {
      const seasons = ts.map((t, i) => (((t || {}).teams || {})[[ca, cb][i].team] || {}).season || {});
      const metrics = ((ts[0] || ts[1]) || {}).metrics || [];
      const keep = metrics.filter(m => seasons[0][m.key] !== undefined || seasons[1][m.key] !== undefined);
      setHTML('cmp-club-stats', keep.length ? tableHTML([{ label: 'Metric', sortable: false }, { label: ca.team, align: 'right', sortable: false }, { label: cb.team, align: 'right', sortable: false }],
        keep.map(m => ({ cells: [{ v: m.label }].concat(seasons.map(s => ({ v: '', html: (s[m.key] === undefined || s[m.key] === null ? '—' : fmtMetric(s[m.key], m.fmt)) + ' ' + ((s.pct || {})[m.key] !== undefined ? pctPill(s.pct[m.key]) : ''), align: 'right' }))) }))) : '<div class="muted">No team-stat sheets for these clubs yet.</div>');
    });
  });
}

// ── career page ────────────────────────────────────────────────────────────

function renderCareer(id) {
  const pane = document.getElementById('tab-page');
  pane.innerHTML = '<div class="muted">Loading…</div>';
  FH.fetchJSON('data/careers/' + id + '.json', null).then(c => {
    if (!c) {
      pane.innerHTML = '<div class="card"><div class="muted">No career in the archive for player ' + esc(id) + ' yet. Careers fill in as the history fetch runs; this season\'s page is under the player\'s competition.</div></div>';
      return;
    }
    const d = c.details || {};
    const age = d.dob ? Math.floor((Date.now() / 1000 - d.dob) / (365.25 * 86400)) : null;
    const chips = [];
    if (d.position) chips.push('<span class="chip pos-' + esc(d.position) + '">' + esc(d.position) + '</span>');
    if (age) chips.push('<span class="chip">' + age + ' years</span>');
    if (d.height) chips.push('<span class="chip">' + d.height + ' cm</span>');
    if (d.country) chips.push('<span class="chip">' + esc(d.country) + '</span>');
    if (d.foot) chips.push('<span class="chip">' + esc(d.foot) + ' foot</span>');
    if (d.market_value) chips.push('<span class="chip">€' + Math.round(d.market_value / 1e6) + 'M</span>');
    let html = '<div class="page-header"><div class="ph-crest"><span class="ph-initials">' + esc((d.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()) + '</span></div>' +
      '<div class="ph-body"><h2>' + esc(d.name || 'Player ' + id) + '</h2><div class="ph-sub">' + esc(d.team || '') + ' · career from the archive' + (c.complete ? '' : ' (still filling)') + '</div><div class="ph-chips">' + chips.join('') + '</div></div></div>';
    const t = c.totals || {};
    html += '<div class="kpi-grid six">' + statTile('Seasons', c.seasons.length, 'in the archive') + statTile('Apps', t.apps || 0, (t.minutes || 0) + ' minutes') +
      statTile('Goals', t.goals || 0, t.xg ? 'xG ' + num(t.xg, 1) : '') + statTile('Assists', t.assists || 0, t.xa ? 'xA ' + num(t.xa, 1) : '') +
      statTile('G+A per 90', num(t.ga_90, 2), 'over the archived seasons') + statTile('Rating', t.rating ? num(t.rating, 2) : '—', 'minutes-weighted') + '</div>';
    html += '<div class="grid-2"><div class="card"><div class="card-header">Goals and assists by season</div><div id="cr-goals" style="height:340px"></div></div>' +
      '<div class="card"><div class="card-header">Rate and rating by season</div><div id="cr-rate" style="height:340px"></div></div></div>';
    html += '<div class="card"><div class="card-header">Season by season <span class="card-sub">Every tournament the archive follows.</span></div><div id="cr-table"></div></div>';
    html += '<div class="card"><div class="muted"><a href="#/compare/players/' + esc((INDEX.competitions.find(x => true) || {}).slug || '') + ':' + esc(id) + '">Compare this player →</a></div></div>';
    pane.innerHTML = html;
    const ss = c.seasons || [];
    const labels = ss.map(s => seasonLabel(s));
    plot('cr-goals', [
      { type: 'bar', name: 'Goals', x: labels, y: ss.map(s => s.goals || 0), marker: { color: C.blue } },
      { type: 'bar', name: 'Assists', x: labels, y: ss.map(s => s.assists || 0), marker: { color: C.teal } }
    ], layout({ barmode: 'stack', showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 40, r: 15, t: 30, b: 110 }, xaxis: { tickangle: -45 } }));
    plot('cr-rate', [
      { type: 'scatter', mode: 'lines+markers', name: 'G+A per 90', x: labels, y: ss.map(s => s.ga_90 || 0), line: { color: C.orange, width: 2 } },
      { type: 'scatter', mode: 'lines+markers', name: 'Rating', x: labels, y: ss.map(s => s.rating || null), line: { color: C.purple, width: 2 }, yaxis: 'y2' }
    ], layout({ showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 40, r: 40, t: 30, b: 110 }, xaxis: { tickangle: -45 },
      yaxis2: { overlaying: 'y', side: 'right', range: [5.5, 9], gridcolor: '#21262d' } }));
    setHTML('cr-table', tableHTML([
      { label: 'Season' }, { label: 'Competition' }, { label: 'Club' }, { label: 'Apps', align: 'right' }, { label: 'Min', align: 'right' }, { label: 'G', align: 'right' }, { label: 'A', align: 'right' },
      { label: 'xG', align: 'right' }, { label: 'xA', align: 'right' }, { label: 'G+A/90', align: 'right' }, { label: 'Shots/90', align: 'right' }, { label: 'KP/90', align: 'right' }, { label: 'Rating', align: 'right' }
    ], ss.slice().reverse().map(s => ({ cells: [
      { v: s.season || s.year || '' }, { v: s.tournament || '' }, { v: s.team || '' }, { v: s.apps || 0, align: 'right' }, { v: s.minutes || 0, align: 'right' },
      { v: s.goals || 0, align: 'right' }, { v: s.assists || 0, align: 'right' }, { v: s.xg || 0, html: s.xg !== undefined ? num(s.xg, 2) : '—', align: 'right' },
      { v: s.xa || 0, html: s.xa !== undefined ? num(s.xa, 2) : '—', align: 'right' }, { v: s.ga_90 || 0, html: num(s.ga_90, 2), align: 'right' },
      { v: s.shots_90 || 0, html: s.shots_90 !== undefined ? num(s.shots_90, 2) : '—', align: 'right' }, { v: s.key_passes_90 || 0, html: s.key_passes_90 !== undefined ? num(s.key_passes_90, 2) : '—', align: 'right' },
      { v: s.rating || 0, html: s.rating ? num(s.rating, 2) : '—', align: 'right' }
    ] })), { sticky: true }));
    sortableIn('cr-table');
  });
}

Object.assign(FH.GLOBAL_PAGES, { clubs: renderClubs, nations: renderNations, leaders: renderLeaders, ballondor: renderBallonDor, compare: renderCompare, career: renderCareer });
FH.dcMatrix = dcMatrix;
FH.matchCard = matchCard;
})(window.FH);
