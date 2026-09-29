/* The Quant Footballer — the hub page and the club, player and match pages.
 *
 * Pages render into the shared #tab-page pane. Each declares the competition
 * payloads it needs (PAGE_NEEDS) and loads its own shard (a club's player logs,
 * a match's detail) through FH.loadShard. */
(function (FH) {
'use strict';

const { INDEX, C, PALETTE, ROUND_LABELS, esc, pct, num, signed, fmtNum, fmtMetric, fmtDate, fmtTime, fmtStamp, localDay,
        D, comp, kind, crest, teamLink, teamHref, playerLink, matchHref,
        tableHTML, setHTML, sortableIn, wireRowLinks, statTile, formChips, resultClass, riskClass,
        pctPill, pctRow, pctColor, probBar, statusChip, scoreText, plot, layout, renderShotMap, renderXgRace, renderMomentum,
        renderRadar, renderProbBars, loadShard, fixtureRow, teamHeadline, RADAR_OUT, RADAR_GK } = FH;

// ── the hub ────────────────────────────────────────────────────────────────

let HUB = null;
let hubDay = null;

function renderHome() {
  const comps = INDEX.competitions;
  setHTML('home-sub', comps.filter(c => c.ok).length + ' of ' + comps.length + ' live');
  renderCompetitionCards(comps);
  if (HUB) { renderScoreboard(); renderHubLeaders(); }
  else {
    FH.fetchJSON('data/hub.json', { days: {}, leaders: {} }).then(h => { HUB = h; renderScoreboard(); renderHubLeaders(); });
  }
  const live = comps.filter(c => c.ok && c.favourite);
  if (live.length) {
    renderProbBars('home-chart', live.map(c => ({ label: (c.short_name || c.name) + ' — ' + c.favourite, p: c.p_favourite })), 'Probability the favourite wins', C.blue);
  } else {
    setHTML('home-chart', '<div class="muted">Nothing built yet.</div>');
  }
}

function crestSrc(team, src) { return crest(team, src); }

const RECENT = '__recent', UPCOMING = '__upcoming';

function renderScoreboard() {
  const hub = HUB || {};
  const days = hub.days || {};
  const keys = Object.keys(days).sort();
  // Group by the viewer's local day rather than the UTC day the build used.
  const local = {};
  keys.forEach(k => days[k].forEach(it => { const d = localDay(it.date) || k; (local[d] = local[d] || []).push(it); }));
  const localKeys = Object.keys(local).sort();
  const today = localDay(new Date().toISOString());
  // Every competition's latest results and next fixtures bracket the week, so
  // the board reads during an international break too.
  const buckets = Object.assign({}, local);
  const order = localKeys.slice();
  if ((hub.recent || []).length) { buckets[RECENT] = hub.recent; order.unshift(RECENT); }
  if ((hub.upcoming || []).length) { buckets[UPCOMING] = hub.upcoming; order.push(UPCOMING); }
  if (!order.length) {
    setHTML('scoreboard', '<div class="muted">No matches across the competitions followed.</div>');
    setHTML('date-strip', '');
    return;
  }
  if (!hubDay || order.indexOf(hubDay) < 0) {
    hubDay = localKeys.indexOf(today) >= 0 ? today : (localKeys.find(k => k > today) || (buckets[UPCOMING] ? UPCOMING : order[order.length - 1]));
  }
  setHTML('date-strip', order.map(k => {
    const n = buckets[k].length, lv = buckets[k].filter(i => i.status === 'live').length;
    let name, date;
    if (k === RECENT) { name = 'Latest'; date = 'results'; }
    else if (k === UPCOMING) { name = 'Next up'; date = 'fixtures'; }
    else {
      const d = FH.parseDate(k + 'T12:00:00Z');
      name = k === today ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      date = d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    }
    return '<button class="day-btn' + (k === hubDay ? ' active' : '') + (k === today ? ' today' : '') + (k === RECENT || k === UPCOMING ? ' bucket' : '') + '" data-day="' + k + '">' +
      '<span class="day-name">' + name + '</span><span class="day-date">' + date + '</span>' +
      '<span class="day-n">' + n + (lv ? ' · <span class="live-dot"></span>' : '') + '</span></button>';
  }).join(''));
  document.querySelectorAll('#date-strip .day-btn').forEach(b => b.addEventListener('click', () => { hubDay = b.dataset.day; renderScoreboard(); }));

  const showDate = hubDay === RECENT || hubDay === UPCOMING;
  const items = buckets[hubDay].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.comp.localeCompare(b.comp));
  const byComp = {};
  items.forEach(it => (byComp[it.comp] = byComp[it.comp] || []).push(it));
  const compOrder = INDEX.competitions.map(c => c.slug).filter(s => byComp[s]);
  setHTML('scoreboard', compOrder.map(slug => {
    const c = INDEX.competitions.find(x => x.slug === slug) || { name: slug };
    return '<div class="sb-comp"><div class="sb-comp-head"><a href="#/' + esc(slug) + '/fixtures">' + esc(c.name) + '</a><span class="sb-country">' + esc(c.country || '') + '</span></div>' +
      byComp[slug].map(it => scoreCard(it, slug, showDate)).join('') + '</div>';
  }).join(''));
  wireRowLinks('scoreboard');
}

function scoreCard(it, slug, showDate) {
  const href = it.detail ? matchHref(it.id, slug) : '#/' + slug + '/fixtures';
  const finished = it.status === 'finished' || it.status === 'live';
  const model = it.model ? probBar(it.model, { small: true }) : '';
  return '<div class="sb-card" data-href="' + esc(href) + '">' +
    '<div class="sb-time">' + (showDate ? '<span class="sb-round">' + esc(fmtDate(it.date)) + '</span>' : '') + statusChip(it) + (it.round && it.stage !== 'league' ? '<span class="sb-round">' + esc(ROUND_LABELS[it.round] || it.round) + '</span>' : '') + '</div>' +
    '<div class="sb-teams">' +
      '<div class="sb-team"><a href="' + esc(teamHref(it.home, slug)) + '">' + crest(it.home, it.crests && it.crests[0]) + esc(it.home) + '</a><span class="sb-score">' + (finished ? it.hs : '') + '</span></div>' +
      '<div class="sb-team"><a href="' + esc(teamHref(it.away, slug)) + '">' + crest(it.away, it.crests && it.crests[1]) + esc(it.away) + '</a><span class="sb-score">' + (finished ? it.as : '') + '</span></div>' +
    '</div>' +
    '<div class="sb-side">' + (finished
      ? (it.xg ? '<span class="xg-line">xG ' + num(it.xg[0], 2) + ' – ' + num(it.xg[1], 2) + '</span>' : '') + (it.detail ? '<a href="' + esc(href) + '">Analysis →</a>' : '')
      : model) + '</div>' +
    '</div>';
}

function renderHubLeaders() {
  const L = (HUB || {}).leaders || {};
  const block = (rows, label, fmt, extraKey, extraLabel) => {
    if (!(rows || []).length) return '';
    return '<div class="mini-card"><div class="mini-head">' + esc(label) + '</div>' + rows.slice(0, 8).map((p, i) =>
      '<div class="mini-row"><span class="mini-rank">' + (i + 1) + '</span><span class="mini-name">' + playerLink(p.id, p.name, p.comp) +
      '<span class="mini-sub">' + esc(p.team) + ' · ' + esc(p.comp_name) + '</span></span><span class="mini-val">' + fmtMetric(p.value, fmt) +
      (extraKey && p[extraKey] !== undefined ? '<span class="mini-extra">' + extraLabel + ' ' + num(p[extraKey], 2) + '</span>' : '') + '</span></div>').join('') + '</div>';
  };
  const html = [block(L.goals, 'Goals', 'int', 'xg', 'xG'), block(L.assists, 'Assists', 'int', 'xa', 'xA'), block(L.rating, 'Rating (qualified)', '2', 'minutes', 'min')].filter(Boolean).join('');
  setHTML('hub-leaders', html ? '<div class="mini-grid">' + html + '</div>' : '<div class="muted">No player data yet.</div>');
}

function renderCompetitionCards(comps) {
  setHTML('home-grid', comps.map(c => {
    const first = (c.tabs || ['overview'])[0];
    const chips = [];
    if (!c.ok) chips.push('<span class="chip bad">unavailable</span>');
    if (c.phase === 'pre') chips.push('<span class="chip">' + esc(c.reason && c.reason.length < 40 ? c.reason : 'not started') + '</span>');
    if (c.complete) chips.push('<span class="chip">complete</span>');
    if (c.synthetic) chips.push('<span class="chip warn">sample data</span>');
    if (c.store_fresh === false) chips.push('<span class="chip warn">stale</span>');
    const frac = c.games_total ? Math.min(1, (c.games_played || 0) / c.games_total) : 0;
    const nxt = c.next ? '<div class="comp-next">Next: ' + esc(fmtDate(c.next.date)) + ' ' + esc(fmtTime(c.next.date)) + ' · ' + esc(c.next.home) + ' v ' + esc(c.next.away) + '</div>' : '';
    const lead = c.leader ? '<span>Leader <strong>' + esc(c.leader.team) + '</strong> ' + c.leader.pts + ' pts</span>' : '';
    const scorer = c.top_scorer ? '<span>Top scorer <strong>' + esc(c.top_scorer.name) + '</strong> ' + c.top_scorer.goals + '</span>' : '';
    return '<a class="comp-card' + (c.ok ? '' : ' off') + '" href="#/' + esc(c.slug) + '/' + first + '">' +
      '<div class="comp-country">' + esc(c.country) + '</div>' +
      '<div class="comp-name">' + esc(c.name) + '</div>' +
      (c.ok
        ? (c.favourite ? '<div class="comp-fav">' + esc(c.favourite_label || 'Title') + ' favourite: <strong>' + esc(c.favourite) +
            '</strong> <span class="p">' + pct(c.p_favourite) + '</span></div>' : '<div class="comp-fav">' + esc(c.reason || '') + '</div>') +
          '<div class="progress"><div style="width:' + (frac * 100).toFixed(1) + '%"></div></div>' +
          '<div class="comp-meta">' + lead + scorer + '</div>' + nxt +
          '<div class="comp-meta"><span>' + esc(c.season || '') + '</span><span>' + (c.games_played || 0) + '/' + (c.games_total || 0) + ' played</span>' + chips.join('') + '</div>'
        : '<div class="comp-fav">' + esc(c.reason || 'No data yet') + '</div><div class="comp-meta">' + chips.join('') + '</div>') +
      '</a>';
  }).join(''));
}

// ── club page ──────────────────────────────────────────────────────────────

function findTeamBySlug(param) {
  const teams = (D().teams || {}).teams || {};
  for (const name of Object.keys(teams)) if ((teams[name].slug || FH.slugify(name)) === param) return name;
  for (const name of Object.keys(teams)) if (FH.slugify(name) === param) return name;
  const probs = (D().probs || {}).teams || [];
  const hit = probs.find(p => FH.slugify(p.team) === param);
  return hit ? hit.team : null;
}

function pageHeader(crestHtml, title, sub, chips) {
  return '<div class="page-header"><div class="ph-crest">' + crestHtml + '</div><div class="ph-body"><h2>' + title + '</h2>' +
    '<div class="ph-sub">' + sub + '</div>' + (chips ? '<div class="ph-chips">' + chips + '</div>' : '') + '</div></div>';
}

function renderTeamPage(param) {
  const d = D();
  const k = kind();
  const c = comp() || {};
  const team = findTeamBySlug(param) || decodeURIComponent(param);
  const pane = document.getElementById('tab-page');
  const prob = ((d.probs || {}).teams || []).find(t => t.team === team) || {};
  const str = ((d.strength || {}).rows || []).find(r => r.team === team) || {};
  const ts = ((d.team_stats || {}).teams || {})[team] || { season: {}, matches: [] };
  const season = ts.season || {};
  const metrics = (d.team_stats || {}).metrics || [];
  const t = d.table || {};
  let row = (t.standings || t.overall || []).find(r => r.team === team);
  if (!row && t.conferences) Object.keys(t.conferences).forEach(g => { row = row || (t.conferences[g] || []).find(r => r.team === team); });
  const info = ((d.teams || {}).teams || {})[team] || {};

  const chips = [];
  if (row) chips.push('<span class="chip">' + (info.conference ? esc(info.conference) + ' · ' : '') + 'P' + row.pos + ' · ' + row.pts + ' pts · ' + row.w + '-' + row.d + '-' + row.l + '</span>');
  if (str.form_results) chips.push('<span class="chip form-chip-wrap">Form ' + formChips(str.form_results) + '</span>');
  if (info.league && info.league !== c.slug) chips.push('<a class="chip" href="#/' + esc(info.league) + '/team/' + esc(FH.slugify(team)) + '">In its league →</a>');
  let html = pageHeader(crest(team, null, 'xl'), esc(team), esc(c.name) + (t.season ? ' · ' + esc(t.season) : ''), chips.join(''));

  const tiles = teamHeadline(prob, k).map(([label, v]) => statTile(label, pct(v)));
  tiles.push(statTile('Strength', num(str.strength_ppg, 2), 'expected PPG v average opponent'));
  tiles.push(statTile('Elo', num(str.elo, 0), str.strength_rank ? 'strength rank ' + str.strength_rank : ''));
  tiles.push(statTile('xG for / against', (season.xg === undefined || season.xg === null ? '—' : num(season.xg, 2) + ' / ' + num(season.xga, 2)), 'per match' + (season.with_sheet ? ' · ' + season.with_sheet + ' with stat sheets' : '')));
  tiles.push(statTile('Luck', str.luck === undefined ? '—' : signed(str.luck, 1), 'points above xG expectation'));
  html += '<div class="kpi-grid">' + tiles.join('') + '</div>';

  // Season profile: percentile sliders against the competition.
  const sliders = metrics.filter(m => season[m.key] !== undefined && season[m.key] !== null && (season.pct || {})[m.key] !== undefined);
  html += '<div class="grid-2">';
  html += '<div class="card"><div class="card-header">Season profile <span class="card-sub">Percentile within the competition, from the team-stat sheets.</span></div><div class="pad">' +
    (sliders.length ? sliders.map(m => pctRow(m.label, (season.pct || {})[m.key], fmtMetric(season[m.key], m.fmt))).join('') : '<div class="muted">No team-stat sheets yet for this club.</div>') + '</div></div>';
  html += '<div class="card"><div class="card-header">xG by match <span class="card-sub">For (blue) and against (orange), oldest to newest.</span></div><div id="tp-xg" style="height:360px"></div>' +
    '<div class="card-header">Form <span class="card-sub">Points per match, five-match rolling.</span></div><div id="tp-form" style="height:220px"></div></div>';
  html += '</div>';

  // Results and fixtures.
  const fx = ((d.fixtures || {}).matches || []).filter(f => f.home === team || f.away === team);
  html += '<div class="card"><div class="card-header">Matches <span class="card-sub">Results with xG; fixtures with the model\'s line.</span></div><div id="tp-matches"></div></div>';
  // Squad.
  html += '<div class="card"><div class="card-header">Squad <span class="card-sub">Season lines; percentile pills against positional peers.</span></div><div id="tp-squad"></div></div>';
  pane.innerHTML = html;

  // Charts.
  const rows = (ts.matches || []).slice().reverse();
  const withXg = rows.filter(r => r.xg !== undefined && r.xg !== null);
  if (withXg.length) {
    plot('tp-xg', [
      { type: 'bar', name: 'xG for', x: withXg.map((r, i) => i + 1), y: withXg.map(r => r.xg), marker: { color: C.blue }, text: withXg.map(r => (r.ha === 'H' ? 'v ' : '@ ') + r.opp + ' ' + r.gf + '-' + r.ga), textposition: 'none', hovertemplate: '%{text}<br>xG for %{y:.2f}<extra></extra>' },
      { type: 'bar', name: 'xG against', x: withXg.map((r, i) => i + 1), y: withXg.map(r => (r.xga === null || r.xga === undefined) ? null : r.xga), marker: { color: C.orange }, text: withXg.map(r => (r.ha === 'H' ? 'v ' : '@ ') + r.opp), textposition: 'none', hovertemplate: '%{text}<br>xG against %{y:.2f}<extra></extra>' }
    ], layout({ barmode: 'group', showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 45, r: 15, t: 25, b: 35 }, xaxis: { title: 'Match' }, yaxis: { rangemode: 'tozero' } }));
  } else setHTML('tp-xg', '<div class="muted">No xG data yet.</div>');
  const ptsOf = r => r.res === 'W' ? 3 : r.res === 'D' ? 1 : 0;
  if (rows.length >= 2) {
    const roll = rows.map((r, i) => { const w = rows.slice(Math.max(0, i - 4), i + 1); return w.reduce((s, x) => s + ptsOf(x), 0) / w.length; });
    plot('tp-form', [{ type: 'scatter', mode: 'lines+markers', x: rows.map((r, i) => i + 1), y: roll, line: { color: C.green, width: 2 }, marker: { color: rows.map(r => r.res === 'W' ? C.green : r.res === 'D' ? C.text3 : C.red), size: 8 },
      text: rows.map(r => (r.ha === 'H' ? 'v ' : '@ ') + r.opp + ' ' + r.gf + '-' + r.ga), hovertemplate: '%{text}<br>rolling %{y:.2f} PPG<extra></extra>' }],
      layout({ margin: { l: 45, r: 15, t: 10, b: 35 }, yaxis: { range: [0, 3.1], title: 'PPG' }, xaxis: { title: 'Match' } }));
  } else setHTML('tp-form', '<div class="muted">Not enough matches.</div>');

  // Match list: every competition the club plays in, when the cross-competition
  // list exists; the league's fixtures otherwise.
  const drawMatches = (list, withComp) => {
    setHTML('tp-matches', list.length ? tableHTML([
      { label: 'Date' }].concat(withComp ? [{ label: 'Competition' }] : []).concat([{ label: 'Round', align: 'right' }, { label: 'Opponent' }, { label: 'Venue', align: 'center' },
      { label: 'Result', align: 'center' }, { label: 'xG', align: 'center', sortable: false }, { label: 'Model', align: 'center', sortable: false }, { label: '', sortable: false }
    ]), list.map(f => {
      const home = f.home === team, opp = home ? f.away : f.home;
      const gf = home ? f.hs : f.as, ga = home ? f.as : f.hs;
      const done = f.status === 'finished';
      const res = done ? '<span class="' + resultClass(gf, ga) + '">' + gf + ' – ' + ga + '</span>' : statusChip(f);
      const xg = f.xg ? '<span class="xg-line">' + num(home ? f.xg[0] : f.xg[1], 2) + ' – ' + num(home ? f.xg[1] : f.xg[0], 2) + '</span>' : '';
      const model = !done && f.model ? probBar(f.model, { small: true }) : '';
      const compSlug = f.comp || c.slug;
      const href = f.detail ? matchHref(f.id, compSlug) : null;
      return { _href: href, cells: [
        { v: f.date || '', html: esc(fmtDate(f.date, true)) }].concat(withComp ? [{ v: f.cn || '', html: (compSlug === c.slug ? '<strong>' + esc(f.cn || '') + '</strong>' : '<a href="#/' + esc(compSlug) + '/fixtures">' + esc(f.cn || compSlug) + '</a>') }] : []).concat([
        { v: f.round === null || f.round === undefined ? '' : f.round, html: esc(ROUND_LABELS[f.round] || f.round || ''), align: 'right' },
        { v: opp, html: compSlug === c.slug ? teamLink(opp) : esc(opp) }, { v: home ? 'H' : 'A', align: 'center' },
        { v: done ? gf - ga : -99, html: res, align: 'center' }, { v: '', html: xg, align: 'center' }, { v: '', html: model, align: 'center' },
        { v: '', html: href ? '<a href="' + esc(href) + '">Analysis →</a>' : '' }
      ]) };
    }), { sticky: true }) : '<div class="muted">No matches.</div>');
    wireRowLinks('tp-matches');
    sortableIn('tp-matches');
  };
  drawMatches(fx, false);
  loadShard('club_matches.json', null).then(cm => {
    if (FH.STATE.page !== 'team' || FH.STATE.param !== param) return;
    const all = ((cm || {}).clubs || {})[team];
    if (all && all.length > fx.length) drawMatches(all, true);
  });

  // Squad.
  const squad = ((d.players_live || {}).players || []).filter(p => p.team === team).sort((a, b) => b.minutes - a.minutes);
  setHTML('tp-squad', squad.length ? tableHTML([
    { label: 'Player' }, { label: 'Pos', align: 'center' }, { label: 'Age', align: 'right' }, { label: 'Apps', align: 'right' }, { label: 'Starts', align: 'right' },
    { label: 'Min', align: 'right' }, { label: 'G', align: 'right' }, { label: 'A', align: 'right' }, { label: 'xG', align: 'right' }, { label: 'xA', align: 'right' },
    { label: 'npxG/90', align: 'right' }, { label: 'xA/90', align: 'right' }, { label: 'Pass %', align: 'right' }, { label: 'Rating', align: 'right' }
  ], squad.map(p => {
    const pc = p.pct || {};
    const cell = (key, fmt) => ({ v: p[key] === undefined ? -1 : p[key], html: (p[key] === undefined ? '—' : fmtMetric(p[key], fmt)) + ' ' + (pc[key] !== undefined ? pctPill(pc[key]) : ''), align: 'right' });
    return { cells: [
      { v: p.name, html: playerLink(p.player_id, p.name) },
      { v: p.position || '', html: p.position ? '<span class="pos-badge pos-' + esc(p.position) + '">' + esc(p.position) + '</span>' : '', align: 'center' },
      { v: p.age || 0, html: p.age || '—', align: 'right' }, { v: p.matches, align: 'right' }, { v: p.starts || 0, align: 'right' }, { v: p.minutes, align: 'right' },
      { v: p.goals, align: 'right' }, { v: p.assists, align: 'right' }, { v: p.xg, html: num(p.xg, 2), align: 'right' }, { v: p.xa, html: num(p.xa, 2), align: 'right' },
      p.is_gk ? cell('save_pct', 'pct') : cell('npxg_90', '2'), p.is_gk ? cell('goals_prevented_90', '2') : cell('xa_90', '2'), cell('pass_pct', 'pct'), cell('rating', '2')
    ] };
  }), { sticky: true }) : '<div class="muted">No squad data yet.</div>');
  sortableIn('tp-squad');
}

// ── player page ────────────────────────────────────────────────────────────

const LOG_COLS_OUT = [
  ['min', 'Min', 'int'], ['rt', 'Rating', '2'], ['g', 'G', 'int'], ['a', 'A', 'int'], ['xg', 'xG', '2'], ['xa', 'xA', '2'], ['sh', 'Sh', 'int'], ['sot', 'SoT', 'int'],
  ['kp', 'KP', 'int'], ['pa', 'Pass', 'int'], ['pt', 'Att', 'int'], ['tch', 'Touch', 'int'], ['drw', 'Drb', 'int'], ['pc', 'PrgC', 'int'], ['dw', 'DuelW', 'int'],
  ['tk', 'Tkl', 'int'], ['int', 'Int', 'int'], ['rec', 'Rec', 'int'], ['aw', 'AerW', 'int'], ['fl', 'Fls', 'int'], ['km', 'Km', '1'], ['spr', 'Spr', 'int'], ['ts', 'Top', '1']
];
const LOG_COLS_GK = [
  ['min', 'Min', 'int'], ['rt', 'Rating', '2'], ['ga', 'Conc.', 'int'], ['sv', 'Saves', 'int'], ['svib', 'In box', 'int'], ['gp', 'Prevented', '2'], ['swp', 'Sweeper', 'int'],
  ['hc', 'Claims', 'int'], ['pun', 'Punch', 'int'], ['pa', 'Pass', 'int'], ['pt', 'Att', 'int'], ['lb', 'Long', 'int'], ['lbt', 'Att', 'int'], ['tch', 'Touch', 'int'], ['km', 'Km', '1']
];

function renderPlayerPage(param) {
  const d = D();
  const c = comp() || {};
  const live = d.players_live || {};
  const players = live.players || [];
  const metrics = live.metrics || [];
  const p = players.find(x => String(x.player_id) === String(param));
  const pane = document.getElementById('tab-page');
  if (!p) { pane.innerHTML = '<div class="error-banner">No player with id ' + esc(param) + ' in ' + esc(c.name || 'this competition') + '.</div>'; return; }
  const posLabel = (live.positions || {})[p.position] || (p.is_gk ? 'Goalkeeper' : 'Outfield');
  const sub = [teamLink(p.team), esc(c.name)].join(' · ');
  const chips = [];
  chips.push('<span class="chip pos-' + esc(p.position || '') + '">' + esc(posLabel) + '</span>');
  if (p.age) chips.push('<span class="chip">' + p.age + ' years</span>');
  if (p.height) chips.push('<span class="chip">' + p.height + ' cm</span>');
  if (p.country) chips.push('<span class="chip">' + esc(p.country) + '</span>');
  if (p.shirt) chips.push('<span class="chip">#' + esc(p.shirt) + '</span>');
  if (p.pool) chips.push('<span class="chip">' + esc(p.pool.label) + ' pool · ' + p.pool.n + ' qualified</span>');
  else chips.push('<span class="chip warn">below ' + (live.minutes_floor || 0) + ' minutes: no percentiles yet</span>');
  let html = pageHeader('<span class="ph-initials">' + esc(p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()) + '</span>', esc(p.name), sub, chips.join(''));

  const tiles = [
    statTile('Appearances', p.matches + ' <span class="kpi-dim">(' + (p.starts || 0) + ' starts)</span>', p.minutes + ' minutes'),
    p.is_gk ? statTile('Saves', p.saves, 'save % ' + fmtMetric(p.save_pct, 'pct')) : statTile('Goals', p.goals + (p.pens ? ' <span class="kpi-dim">(' + p.pens + ' pen)</span>' : ''), 'xG ' + num(p.xg, 2) + ' · npxG ' + num(p.npxg, 2)),
    p.is_gk ? statTile('Goals prevented', signed(p.goals_prevented, 2), 'v post-shot xG faced') : statTile('Assists', p.assists, 'xA ' + num(p.xa, 2)),
    p.is_gk ? statTile('Conceded', p.conceded, num(p.conceded_90, 2) + ' per 90') : statTile('Shots', p.shots, num(p.shots_90, 2) + ' per 90 · ' + fmtMetric(p.sot_pct, 'pct') + ' on target'),
    statTile('Rating', p.rating === undefined || p.rating === null ? '—' : num(p.rating, 2), p.pct && p.pct.rating !== undefined ? 'percentile ' + p.pct.rating : 'minutes-weighted'),
    statTile('Cards', (p.yellow || 0) + ' <span class="kpi-dim">Y</span> ' + (p.red || 0) + ' <span class="kpi-dim">R</span>', p.fouls !== undefined ? p.fouls + ' fouls · ' + (p.fouled || 0) + ' fouled' : '')
  ];
  html += '<div class="kpi-grid six">' + tiles.join('') + '</div>';

  // Percentile sliders by group.
  const scope = p.is_gk ? 'gk' : 'out';
  const groups = [];
  metrics.filter(m => m.pct && (m.scope === 'all' || m.scope === scope)).forEach(m => {
    let g = groups.find(x => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
  });
  html += '<div class="grid-2"><div class="card"><div class="card-header">Percentile rankings <span class="card-sub">Against ' + esc(posLabel.toLowerCase()) + 's in this competition with ' + (live.minutes_floor || 0) + '+ minutes. Red is better; for fouls, dispossessions and goals conceded, fewer is better.</span></div><div class="pad pct-groups">' +
    groups.map(g => '<div class="pct-group"><div class="pct-group-head">' + esc(g.name) + '</div>' + g.items.map(m => pctRow(m.label, (p.pct || {})[m.key], fmtMetric(p[m.key], m.fmt), m.lower ? 'lower is better' : '')).join('') + '</div>').join('') +
    '</div></div>';
  html += '<div class="card"><div class="card-header">Profile</div><div id="pp-radar" style="height:380px"></div>' +
    '<div class="card-header">Rating by match</div><div id="pp-rating" style="height:220px"></div>' +
    '<div class="card-header">Shot map <span class="card-sub">Every shot this season; size by xG.</span></div><div id="pp-shots" style="height:420px"></div></div></div>';
  html += '<div class="card"><div class="card-header">Evolution this season <span class="card-sub">Cumulative goals against cumulative xG by match, and the five-match rolling rating.</span></div>' +
    '<div class="grid-2"><div id="pp-evo" style="height:300px"></div><div id="pp-roll" style="height:300px"></div></div></div>';
  html += '<div class="card"><div class="card-header">All competitions this season <span class="card-sub" id="pp-all-sub">Club, cups and national team, from every store the site follows.</span></div><div id="pp-all"></div></div>';
  html += '<div class="card"><div class="card-header">Match log <span class="card-sub" id="pp-log-sub">Loading…</span></div><div id="pp-log"></div></div>';
  html += '<div class="card"><div class="muted"><a href="#/player/' + esc(p.player_id) + '">Career, season by season →</a> &nbsp;·&nbsp; <a href="#/compare/players/' + esc(c.slug) + ':' + esc(p.player_id) + '">Compare with another player →</a> &nbsp;·&nbsp; <a href="#/leaders">Global leaders →</a> &nbsp;·&nbsp; <a href="#/lab/' + esc(c.slug) + '/' + esc(p.position === 'G' ? 'G' : (p.position || 'M')) + '">Compare in the Player lab →</a></div></div>';
  pane.innerHTML = html;

  FH.loadSite('season_index.json').then(idx => {
    if (FH.STATE.page !== 'player' || FH.STATE.param !== param) return;
    const rows = (((idx || {}).players || {})[String(p.player_id)] || {}).rows || [];
    if (!rows.length) { setHTML('pp-all', '<div class="muted">Only this competition so far.</div>'); return; }
    const tot = rows.reduce((s, r) => { ['apps', 'min', 'g', 'a', 'xg', 'xa'].forEach(k => { s[k] = (s[k] || 0) + (r[k] || 0); }); s.rw += (r.rt || 0) * (r.min || 0); return s; }, { rw: 0 });
    const order = { league: 0, cup: 1, domestic: 2, super: 3, international: 4 };
    rows.sort((x, y) => (order[x.fam] || 0) - (order[y.fam] || 0) || (y.min || 0) - (x.min || 0));
    setHTML('pp-all', tableHTML([
      { label: 'Competition' }, { label: 'For' }, { label: 'Apps', align: 'right' }, { label: 'Min', align: 'right' }, { label: 'G', align: 'right' }, { label: 'A', align: 'right' },
      { label: 'xG', align: 'right' }, { label: 'xA', align: 'right' }, { label: 'Shots', align: 'right' }, { label: 'KP', align: 'right' }, { label: 'Cards', align: 'right' }, { label: 'Rating', align: 'right' }
    ], rows.map(r => ({ cells: [
      { v: r.cn, html: (r.comp === c.slug ? '<strong>' + esc(r.cn) + '</strong>' : '<a href="#/' + esc(r.comp) + '/player/' + esc(p.player_id) + '">' + esc(r.cn) + '</a>') + ' <span class="chip">' + esc((FH.FAMILY_LABELS || {})[r.fam] || (r.fam === 'league' ? 'League' : r.fam || '')) + '</span>' },
      { v: r.t, html: esc(r.t) }, { v: r.apps || 0, align: 'right' }, { v: r.min || 0, align: 'right' }, { v: r.g || 0, align: 'right' }, { v: r.a || 0, align: 'right' },
      { v: r.xg || 0, html: num(r.xg, 2), align: 'right' }, { v: r.xa || 0, html: num(r.xa, 2), align: 'right' }, { v: r.sh || 0, align: 'right' }, { v: r.kp || 0, align: 'right' },
      { v: (r.y || 0) + (r.r || 0), html: (r.y || 0) + '<span class="muted-inline">Y</span> ' + (r.r || 0) + '<span class="muted-inline">R</span>', align: 'right' },
      { v: r.rt || 0, html: r.rt ? num(r.rt, 2) : '—', align: 'right' }
    ] })).concat([{ _class: 'total-row', cells: [
      { v: 'Total', html: '<strong>All competitions</strong>' }, { v: '' }, { v: tot.apps, html: '<strong>' + tot.apps + '</strong>', align: 'right' }, { v: tot.min, html: '<strong>' + tot.min + '</strong>', align: 'right' },
      { v: tot.g, html: '<strong>' + tot.g + '</strong>', align: 'right' }, { v: tot.a, html: '<strong>' + tot.a + '</strong>', align: 'right' },
      { v: tot.xg, html: '<strong>' + num(tot.xg, 2) + '</strong>', align: 'right' }, { v: tot.xa, html: '<strong>' + num(tot.xa, 2) + '</strong>', align: 'right' },
      { v: '' }, { v: '' }, { v: '' }, { v: tot.min ? tot.rw / tot.min : 0, html: tot.min && tot.rw ? '<strong>' + num(tot.rw / tot.min, 2) + '</strong>' : '—', align: 'right' }
    ] }])));
  });

  renderRadar('pp-radar', p.is_gk ? RADAR_GK : RADAR_OUT, [p]);

  loadShard('players/' + ((((D().teams || {}).teams || {})[p.team] || {}).slug || FH.slugify(p.team)) + '.json').then(shard => {
    if (FH.STATE.page !== 'player' || FH.STATE.param !== param) return;
    const entry = shard && shard.players ? shard.players[String(p.player_id)] : null;
    const rows = entry ? entry.matches : [];
    setHTML('pp-log-sub', rows.length ? rows.length + ' matches, newest first' : 'No match log available.');
    const cols = p.is_gk ? LOG_COLS_GK : LOG_COLS_OUT;
    setHTML('pp-log', rows.length ? tableHTML(
      [{ label: 'Date' }, { label: 'Opponent' }, { label: 'H/A', align: 'center' }, { label: 'Result', align: 'center' }, { label: 'Pos', align: 'center' }]
        .concat(cols.map(cdef => ({ label: cdef[1], align: 'right' }))).concat([{ label: '', sortable: false }]),
      rows.map(r => ({ _href: matchHref(r.gid), cells: [
        { v: r.date || '', html: esc(fmtDate(r.date, true)) }, { v: r.opp, html: teamLink(r.opp) }, { v: r.ha, align: 'center' },
        { v: r.gf - r.ga, html: '<span class="' + resultClass(r.gf, r.ga) + '">' + r.res + ' ' + r.gf + '–' + r.ga + '</span>', align: 'center' },
        { v: r.pos || '', html: (r.pos ? '<span class="pos-badge pos-' + esc(r.pos) + '">' + esc(r.pos) + '</span>' : '') + (r.start ? '' : ' <span class="sub-mark" title="substitute">S</span>'), align: 'center' }
      ].concat(cols.map(cdef => { const v = cdef[0] === 'ga' ? r.ga : r[cdef[0]]; return { v: v === undefined ? -1 : v, html: v === undefined || v === null ? '—' : fmtMetric(v, cdef[2]), align: 'right' }; }))
       .concat([{ v: '', html: '<a href="' + esc(matchHref(r.gid)) + '">→</a>' }]) })), { sticky: true }) : '<div class="muted">No matches recorded for this player.</div>');
    wireRowLinks('pp-log');
    sortableIn('pp-log');

    const chron = rows.slice().reverse();
    if (chron.length) {
      let g = 0, x = 0, ga = 0;
      const xs = chron.map((r, i) => i + 1);
      const goals = chron.map(r => (g += r.g || 0));
      const xgs = chron.map(r => (x += r.xg || 0));
      const gas = chron.map(r => (ga += (r.g || 0) + (r.a || 0)));
      plot('pp-evo', [
        { type: 'scatter', mode: 'lines+markers', name: 'Goals', x: xs, y: goals, line: { color: C.green, width: 2 } },
        { type: 'scatter', mode: 'lines', name: 'xG', x: xs, y: xgs, line: { color: C.blue, width: 2, dash: 'dot' } },
        { type: 'scatter', mode: 'lines+markers', name: 'G+A', x: xs, y: gas, line: { color: C.orange, width: 1.5 } }
      ], layout({ showlegend: true, legend: { orientation: 'h', y: 1.12, font: { color: C.text2 } }, margin: { l: 40, r: 15, t: 30, b: 35 }, xaxis: { title: 'Match' }, yaxis: { rangemode: 'tozero' } }));
      const rts = chron.map(r => r.rt === undefined ? null : r.rt);
      const roll = rts.map((_, k) => { const w = rts.slice(Math.max(0, k - 4), k + 1).filter(v => v !== null); return w.length ? w.reduce((s, v) => s + v, 0) / w.length : null; });
      plot('pp-roll', [{ type: 'scatter', mode: 'lines+markers', name: 'Rolling rating', x: xs, y: roll, line: { color: C.purple, width: 2 }, hovertemplate: 'rolling rating %{y:.2f}<extra></extra>' }],
        layout({ margin: { l: 40, r: 15, t: 10, b: 35 }, xaxis: { title: 'Match' }, yaxis: { range: [5.5, 9], title: 'Rating, 5-match rolling' } }));
    } else { setHTML('pp-evo', '<div class="muted">No matches yet.</div>'); setHTML('pp-roll', ''); }
    const rated = chron.filter(r => r.rt !== undefined && r.rt !== null);
    if (rated.length) {
      plot('pp-rating', [{ type: 'bar', x: rated.map((r, i) => i + 1), y: rated.map(r => r.rt), marker: { color: rated.map(r => r.rt >= 7.5 ? C.green : r.rt >= 6.5 ? C.blue : C.orange) },
        text: rated.map(r => (r.ha === 'H' ? 'v ' : '@ ') + r.opp + ' · ' + r.min + "'"), textposition: 'none', hovertemplate: '%{text}<br>rating %{y:.2f}<extra></extra>' }],
        layout({ margin: { l: 40, r: 15, t: 10, b: 30 }, yaxis: { range: [4, 10] }, xaxis: { title: 'Match' }, bargap: 0.25 }));
    } else setHTML('pp-rating', '<div class="muted">No ratings.</div>');
    const shots = [];
    rows.forEach(r => (r.shots || []).forEach(s => shots.push(Object.assign({}, s, { match: (r.ha === 'H' ? 'v ' : '@ ') + r.opp + ' ' + r.gf + '-' + r.ga }))));
    if (shots.length) renderShotMap('pp-shots', shots); else setHTML('pp-shots', '<div class="muted">' + (p.is_gk ? 'Goalkeepers rarely shoot.' : 'No shots recorded.') + '</div>');
  });
}

// ── match page ─────────────────────────────────────────────────────────────

// Team-stat sheet rows shown on a match page, in order, with labels.
// ── wiring ─────────────────────────────────────────────────────────────────

Object.assign(FH.RENDERERS, { home: renderHome });
Object.assign(FH.PAGES, { team: renderTeamPage, player: renderPlayerPage });   // match: match.js
Object.assign(FH.PAGE_NEEDS, {
  team: ['probs', 'strength', 'table', 'zones', 'team_stats', 'fixtures', 'players_live'],
  player: ['players_live'],
  match: ['fixtures']
});
})(window.FH);
