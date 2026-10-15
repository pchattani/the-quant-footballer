/* The Quant Footballer — player value, club strengths and needs, the transfer simulator.
 *
 *   #/value       goals above replacement: a leaderboard (last 12 months, or this season
 *                 by competition), the best at each position, and how the number is made.
 *                 Filters live in the query: ?v=season&c=<slug>&t=<tier>&club=<tid>&r=<role>&min=<n>&q=<text>
 *   #/transfer    the transfer simulator: ?p=<player id>&to=<buying club id>&out=<id,id>
 *   FH.renderClubNeeds(el, tid)   the club page's "Strengths and needs" card
 *
 * Reads data/value/meta.json, players.json, lines.json, club/<tid>.json (UNIFIED_PAYLOADS.md
 * section 11), each league's sensitivity.json and probs.json. Every number on these pages
 * comes from a payload; the simulator only interpolates the build's sensitivity curves. */
(function (FH) {
'use strict';

const { INDEX, C, esc, num, pct, signed, crest, statTile, tableHTML, setHTML, sortableIn, wireRowLinks, pctPill,
        loadSite, ensureComp, clubHref, personHref, rowsOf, normText } = FH;

const ROLE_ORDER = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST', 'DF', 'MF', 'FW'];
const ROLE_SHORT = { GK: 'GK', CB: 'CB', FB: 'FB', DM: 'DM', CM: 'CM', AM: 'AM', W: 'W', ST: 'ST', DF: 'DF', MF: 'MF', FW: 'FW' };
const UNIT_OF = { GK: 'GK', CB: 'CB', FB: 'FB', DM: 'MID', CM: 'MID', AM: 'ATT', W: 'ATT', ST: 'ST', DF: 'CB', MF: 'MID', FW: 'ST' };
const MINUTES_CAP = 85;
const HONEST = 'Model suggestions based on on-field value; not considering wages, transfer fees, contracts, fit or availability unless shown.';

function has(v) { return v !== undefined && v !== null && !(typeof v === 'number' && isNaN(v)); }
function g2(v) { return has(v) ? signed(v, 2) : '—'; }
function roleBadge(r) { return r ? '<span class="vrole vrole-' + esc(r) + '" title="' + esc(roleLabel(r)) + '">' + esc(ROLE_SHORT[r] || r) + '</span>' : ''; }
function roleLabel(r) { const m = META || {}; return ((m.roles || {})[r]) || r; }
function compOf(slug) { return INDEX.competitions.find(c => c.slug === slug) || null; }
function compName(slug) { const c = compOf(slug); if (c) return c.short_name || c.name; const m = ((META || {}).comps || {})[slug]; return m ? (m.short || m.name) : (slug || '—'); }
function ordinal(n) { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); }
function money(v) { if (!has(v)) return '—'; return v >= 1e6 ? '€' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm' : '€' + Math.round(v / 1e3) + 'k'; }
function clubA(name, tid) {
  if (!name) return '<span class="muted-inline">—</span>';
  return tid ? '<a class="team-link" href="' + esc(clubHref(tid)) + '">' + crest(name, 'assets/crests/' + tid + '.png') + esc(name) + '</a>' : esc(name);
}
function playerA(id, name) { return '<a class="player-link" href="' + esc(personHref(id)) + '">' + esc(name) + '</a>'; }

let META = null;

/* The components that drive a value, largest first: "Creating +0.12 · Shooting +0.08". */
function drivers(c, n) {
  const names = (META || {}).components || [];
  if (!c || !names.length) return '';
  return c.map((v, i) => [names[i], v]).filter(x => has(x[1]) && Math.abs(x[1]) >= 0.01)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n || 2)
    .map(x => '<span class="vdrv ' + (x[1] > 0 ? 'up' : 'down') + '">' + esc(x[0]) + ' ' + signed(x[1], 2) + '</span>').join(' ');
}

function loadValue() {
  return Promise.all([loadSite('value/meta.json'), loadSite('value/players.json')]).then(([m, p]) => {
    META = m;
    const rows = rowsOf(p);
    const byId = {};
    rows.forEach(r => { byId[String(r.id)] = r; });
    return { meta: m, players: rows, byId: byId };
  });
}

function setQuery(base, q) {
  const target = '#/' + base + FH.queryString(q);
  if (location.hash !== target) history.replaceState(null, '', target);
  FH.STATE.query = q;
}

function missingValue(pane) {
  pane.innerHTML = '<div class="card"><div class="muted">The value payloads are not built yet (data/value/). They arrive with the next hourly build.</div></div>';
}

// ══ #/value ═════════════════════════════════════════════════════════════

let VALUE_TOKEN = 0;
let LINES = null;

function renderValue() {
  const pane = document.getElementById('tab-value');
  const token = ++VALUE_TOKEN;
  pane.innerHTML = '<div class="muted">Loading player value…</div>';
  loadValue().then(V => {
    if (token !== VALUE_TOKEN) return;
    if (!V.meta || !V.players.length) { missingValue(pane); return; }
    drawValue(pane, V, token);
  }).catch(err => { pane.innerHTML = '<div class="error-banner">Could not load player value: ' + esc(err.message) + '</div>'; });
}

function validationLine(m) {
  const v = (m.validation || {}).r2 || {};
  const x = v.xgd || {}, g = v.gd || {}, rel = m.reliability || {};
  if (!x.value) return '';
  return 'On ' + ((m.validation || {}).n_test || 0).toLocaleString('en-US') + ' matches it had not seen, the line-ups\' value explained ' + pct(x.value, 1) +
    ' of the variance in non-penalty xG difference (Sofascore rating alone: ' + pct(x.rating, 1) + '; each team\'s own form: ' + pct(x.team, 1) + ') and ' +
    pct(g.value, 1) + ' of goal difference (rating: ' + pct(g.rating, 1) + ').' + (rel.value_r ? ' Split by odd and even matches, a player\'s value correlates ' + num(rel.value_r, 2) + ' with itself, his rating ' + num(rel.rating_r, 2) + '.' : '');
}

function drawValue(pane, V, token) {
  const m = V.meta;
  const q = Object.assign({}, FH.STATE.query || {});
  const v = m.validation || {};
  const r2 = (v.r2 || {}).xgd || {};
  pane.innerHTML =
    '<div class="card"><div class="card-header">Player value <span class="card-sub">Goals above replacement, from Sofascore\'s match data. <a href="#/methodology/value">How it works →</a></span></div>' +
    '<div class="prose-dark pad"><p>Every player\'s minutes are priced in <strong>goals of expected goal difference</strong>: sixteen actions from each match (non-penalty xG, xA, key passes, carries, dribbles, passes in the opposition half, possession lost, tackles, interceptions, blocks, clearances, recoveries, aerials, errors, and for keepers goals prevented and claims) plus his match rating, weighted by how well they predicted later matches. ' +
    FH.glossaryLink('gar', 'GAR/90') + ' is the value per 90 minutes above a replacement-level player in the same role; ' + FH.glossaryLink('par', 'PAR') + ' turns it into league points. Competitions are put on one scale with the pooled model\'s league strengths.</p>' +
    '<p class="vsmall">' + esc(validationLine(m)) + '</p></div>' +
    '<div class="kpi-grid">' +
    statTile('Players valued', ((m.counts || {}).players || 0).toLocaleString('en-US'), ((m.counts || {}).regulars || 0).toLocaleString('en-US') + ' regulars (900+ min in 12 months)') +
    statTile('Matches fitted', ((m.model || {}).fit_matches || 0).toLocaleString('en-US'), 'club matches with both line-ups') +
    statTile('Held-out fit', r2.value ? pct(r2.value, 1) : '—', 'of xG difference explained · rating ' + (r2.rating ? pct(r2.rating, 1) : '—')) +
    statTile('Updated', esc(String(m.updated_at || '').slice(0, 10)), 'rebuilt every hour') + '</div></div>' +
    '<div class="card"><div class="controls" id="val-controls"></div><div id="val-note" class="pad vsmall muted-inline"></div><div id="val-table"></div></div>' +
    '<div class="card"><div class="card-header">Best at each position <span class="card-sub" id="val-best-sub"></span></div><div class="vbest" id="val-best"></div></div>' +
    '<div class="card"><div class="card-header">The weights and the checks <span class="card-sub">Fitted at every build; the method is in the methodology.</span></div><div id="val-method"></div></div>';
  const draw = nq => {
    Object.keys(nq).forEach(k => { if (nq[k] === '' || nq[k] === undefined || nq[k] === null) delete nq[k]; });
    setQuery('value', nq);
    if (nq.v === 'season' && !LINES) {
      setHTML('val-table', '<div class="muted">Loading this season\'s lines…</div>');
      Promise.all([loadSite('value/lines.json'), loadSite('clubs_index.json')]).then(([l, ci]) => {
        LINES = rowsOf(l);
        CLUB_NAMES = CLUB_NAMES || {};
        rowsOf(ci).forEach(c => { CLUB_NAMES[String(c.id)] = c.name; });
        if (token === VALUE_TOKEN) drawValueBody(V, nq, draw);
      });
      return;
    }
    drawValueBody(V, nq, draw);
  };
  draw(q);
  setHTML('val-method', methodHTML(m));
  sortableIn('val-method');
}

function valueRows(V, q) {
  const season = q.v === 'season';
  const comps = (META || {}).comps || {};
  const min = has(q.min) && q.min !== '' ? Number(q.min) : (season ? ((comps[q.c] || {}).floor || 270) : 900);
  const qn = q.q ? normText(q.q) : '';
  const tierOf = slug => (comps[slug] || {}).tier || '';
  let rows;
  if (season) {
    rows = (LINES || []).map(l => {
      const p = V.byId[String(l.id)] || {};
      // A line at a club he has since left names that club (from the clubs index).
      return { id: l.id, name: p.name || ('#' + l.id), age: p.age, comp: l.comp, tid: l.tid || p.tid, club: !l.tid || l.tid === p.tid ? p.club : clubNameFor(l.tid),
               role: l.role, min: l.min, gar90: l.gar90, gar: l.gar, par: l.par, pct: l.pct, prev90: l.prev90, rt: l.rt, c: l.c, fvi: p.fvi, proj: p.proj };
    });
  } else {
    rows = V.players.filter(p => (p.min || 0) > 0).map(p => ({ id: p.id, name: p.name, age: p.age, comp: p.league, tid: p.tid, club: p.club, role: p.role, min: p.min,
      gar90: p.gar90, gar: p.gar, par: p.par, pct: p.pct, proj: p.proj, fvi: p.fvi, mv: p.mv, rt: p.rt, c: p.c, free: p.free }));
  }
  return rows.filter(r => (r.min || 0) >= min && has(r.gar90) &&
    (!q.c || r.comp === q.c) && (!q.t || tierOf(r.comp) === q.t) && (!q.club || String(r.tid) === String(q.club)) &&
    (!q.r || r.role === q.r || (q.r.length > 2 && UNIT_OF[r.role] === q.r)) && (!qn || normText(r.name).indexOf(qn) >= 0));
}

let CLUB_NAMES = null;
function clubNameFor(tid) { return CLUB_NAMES ? CLUB_NAMES[String(tid)] || null : null; }

function drawValueBody(V, q, draw) {
  const season = q.v === 'season';
  const comps = (META || {}).comps || {};
  const all = season ? (LINES || []) : V.players;
  // Filter options from what the view holds.
  const compSlugs = Array.from(new Set(all.map(r => season ? r.comp : r.league).filter(Boolean)));
  const compOpts = compSlugs.map(s => [s, compName(s), (comps[s] || {}).kind === 'league' ? 0 : 1]).sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1]));
  const tiers = (META || {}).tiers || [];
  const roles = ROLE_ORDER.filter(r => V.players.some(p => p.role === r));
  const minDefault = season ? ((comps[q.c] || {}).floor || 270) : 900;
  const base = valueRows(V, Object.assign({}, q, { club: '', r: '', q: '' }));
  const clubs = {};
  base.forEach(r => { if (r.tid && r.club) clubs[r.tid] = r.club; });
  const clubOpts = Object.keys(clubs).map(t => [t, clubs[t]]).sort((a, b) => a[1].localeCompare(b[1]));
  setHTML('val-controls',
    '<div class="scope-chips"><button type="button" class="fam-btn' + (season ? '' : ' active') + '" data-v="">Last 12 months</button>' +
    '<button type="button" class="fam-btn' + (season ? ' active' : '') + '" data-v="season">This season, by competition</button></div>' +
    '<label>' + (season ? 'Competition' : 'League') + ' <select class="team-select" data-f="c"><option value="">' + (season ? 'All competitions' : 'All leagues') + '</option>' +
    compOpts.map(o => '<option value="' + esc(o[0]) + '"' + (q.c === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>' +
    '<label>Tier <select class="team-select" data-f="t"><option value="">Every tier</option>' + tiers.map(t => '<option' + (q.t === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>' +
    '<label>Club <select class="team-select" data-f="club"><option value="">Every club</option>' + clubOpts.map(o => '<option value="' + esc(o[0]) + '"' + (String(q.club) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>' +
    '<label>Position <select class="team-select" data-f="r"><option value="">Every position</option>' +
    roles.map(r => '<option value="' + r + '"' + (q.r === r ? ' selected' : '') + '>' + esc(roleLabel(r)) + '</option>').join('') + '</select></label>' +
    '<label>Min. minutes <input type="number" data-f="min" min="0" step="90" value="' + esc(has(q.min) ? q.min : minDefault) + '" style="width:80px"></label>' +
    '<input type="search" data-f="q" placeholder="Find a player" value="' + esc(q.q || '') + '" style="max-width:180px">');
  const bar = document.getElementById('val-controls');
  bar.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => draw(Object.assign({}, q, { v: b.dataset.v || undefined, c: undefined, min: undefined }))));
  bar.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', () => { const n = Object.assign({}, q); n[s.dataset.f] = s.value || undefined; if (s.dataset.f !== 'club') n.club = s.dataset.f === 'c' || s.dataset.f === 't' ? undefined : n.club; draw(n); }));
  bar.querySelectorAll('input[data-f]').forEach(inp => {
    let t = null;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const n = Object.assign({}, q); n[inp.dataset.f] = inp.value || undefined; draw(n); }, 300); });
  });

  const rows = valueRows(V, q).sort((a, b) => (b.gar90 || 0) - (a.gar90 || 0));
  const shown = rows.slice(0, 150);
  setHTML('val-note', rows.length.toLocaleString('en-US') + ' players' + (rows.length > shown.length ? ' (the top ' + shown.length + ' shown)' : '') +
    (season ? ' · this season\'s lines in each competition; percentiles within the competition and position group over its minutes floor; trend against last season in the same competition'
      : ' · club football over the last 12 months, every competition; percentiles among regulars (900+ minutes) in the same role') + '. ' + esc(HONEST));
  const cols = [
    { label: '#', sortable: false }, { label: 'Player' }, { label: 'Club' }, { label: season ? 'Competition' : 'League' }, { label: 'Pos', align: 'center' },
    { label: 'Age', align: 'right' }, { label: 'Min', align: 'right' },
    { label: 'GAR/90', align: 'right', title: 'Goals above replacement per 90 minutes' }, { label: 'GAR', align: 'right', title: 'Goals above replacement in these minutes' },
    { label: 'PAR', align: 'right', title: 'Points above replacement: GAR times the points a goal of goal difference is worth' },
    { label: 'Pctl', align: 'center', title: season ? 'Percentile in the competition, same position group' : 'Percentile among regulars in the same role' }
  ].concat(season ? [{ label: 'Trend', align: 'right', title: 'GAR/90 change against last season in the same competition (450+ minutes then)' }]
    : [{ label: 'Proj.', align: 'right', title: 'Projected GAR/90: shrunk toward replacement by 900 minutes' }, { label: 'FVI', align: 'right', title: 'Fair value index: 100 = the median regular of the top five leagues; not euros' }])
    .concat([{ label: 'Why', sortable: false }, { label: '', sortable: false }]);
  setHTML('val-table', shown.length ? tableHTML(cols, shown.map((r, i) => ({ cells: [
    { v: i + 1, cls: 'pos-cell' }, { v: r.name, html: playerA(r.id, r.name) + (r.free ? ' <span class="chip warn" title="Sofascore lists him without a club">no club</span>' : '') },
    { v: r.club || '', html: clubA(r.club, r.tid) }, { v: compName(r.comp), html: r.comp ? esc(compName(r.comp)) : '<span class="muted-inline">—</span>' },
    { v: r.role || '', html: roleBadge(r.role), align: 'center' }, { v: r.age || 0, html: has(r.age) ? r.age : '—', align: 'right' },
    { v: r.min || 0, html: (r.min || 0).toLocaleString('en-US'), align: 'right' },
    { v: r.gar90, html: '<strong>' + g2(r.gar90) + '</strong>', align: 'right' }, { v: r.gar || 0, html: has(r.gar) ? signed(r.gar, 1) : '—', align: 'right' },
    { v: r.par || 0, html: has(r.par) ? signed(r.par, 1) : '—', align: 'right' }, { v: has(r.pct) ? r.pct : -1, html: pctPill(r.pct), align: 'center' }
  ].concat(season ? [{ v: has(r.prev90) ? r.gar90 - r.prev90 : -9, html: has(r.prev90) ? '<span class="' + (r.gar90 >= r.prev90 ? 'vup' : 'vdown') + '" title="Last season ' + g2(r.prev90) + '">' + signed(r.gar90 - r.prev90, 2) + '</span>' : '<span class="muted-inline">—</span>', align: 'right' }]
    : [{ v: has(r.proj) ? r.proj : -9, html: g2(r.proj), align: 'right' }, { v: has(r.fvi) ? r.fvi : -1, html: has(r.fvi) ? String(r.fvi) : '—', align: 'right' }])
    .concat([{ v: '', html: drivers(r.c) }, { v: '', html: '<a href="#/transfer?p=' + esc(r.id) + '" title="Simulate a transfer">Transfer →</a>' }]) })), { sticky: true }) :
    '<div class="muted">No player clears the filters.</div>');
  sortableIn('val-table');

  // Best at each position, under the same filters (except the position).
  const pool = valueRows(V, Object.assign({}, q, { r: '' }));
  setHTML('val-best-sub', 'The top eight in each role under the filters above' + (season ? ' (this season)' : ' (last 12 months)') + '; roles come from the starting formations.');
  setHTML('val-best', ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'].map(role => {
    const top = pool.filter(r => r.role === role).sort((a, b) => b.gar90 - a.gar90).slice(0, 8);
    return '<div class="vbest-card"><div class="vbest-head">' + roleBadge(role) + ' ' + esc(roleLabel(role)) + '</div>' + (top.length ? '<ol>' + top.map(r =>
      '<li><div class="vbest-row"><span class="vbest-name">' + playerA(r.id, r.name) + '</span><span class="vbest-val">' + g2(r.gar90) + '</span>' + pctPill(r.pct) + '</div>' +
      '<div class="vbest-sub">' + (has(r.gar) ? signed(r.gar, 1) + ' GAR in ' + (r.min || 0).toLocaleString('en-US') + ' min · ' : '') + (r.club ? esc(r.club) : '') + (r.comp ? ' · ' + esc(compName(r.comp)) : '') + (has(r.age) ? ' · ' + r.age : '') + '</div>' +
      '<div class="vbest-why">' + drivers(r.c, 3) + '</div></li>').join('') + '</ol>' : '<div class="muted">Nobody clears the filters.</div>') + '</div>';
  }).join(''));
}

function methodHTML(m) {
  const mod = m.model || {};
  const w = (mod.weights || []).slice();
  const v = (m.validation || {}).r2 || {};
  const lbl = { rating: 'Sofascore rating of the line-ups', team: 'Each team\'s own prior xG difference', box: 'Box-score part of the value alone', value: 'Player value (box score + rating)' };
  let h = '<div class="grid-2"><div class="vcell">' + tableHTML([{ label: 'Action' }, { label: 'Component' }, { label: 'Goals per action', align: 'right' }],
    w.map(x => ({ cells: [{ v: x.label, html: esc(x.label) }, { v: x.component, html: esc(x.component) }, { v: x.weight, html: x.weight ? signed(x.weight, 4) : '<span class="muted-inline">0 (no predictive weight)</span>', align: 'right' }] })), { compact: true }) +
    '<div class="pad vsmall muted-inline">Fitted on ' + (mod.fit_matches || 0).toLocaleString('en-US') + ' club matches: a ridge regression with signs fixed (more of a good action never lowers value) predicts each match\'s non-penalty xG difference from the line-ups\' earlier per-90 rates; the rating weight is a second stage on the same matches. "Possession-adjusted" actions are scaled by 50 / the opponent\'s possession.</div></div><div class="vcell">';
  if (v.xgd) {
    h += tableHTML([{ label: 'Predictor (matches not yet seen)' }, { label: 'xG diff. R²', align: 'right' }, { label: 'Goal diff. R²', align: 'right' }],
      ['rating', 'team', 'box', 'value'].map(k => ({ cells: [{ v: lbl[k], html: k === 'value' ? '<strong>' + esc(lbl[k]) + '</strong>' : esc(lbl[k]) },
        { v: v.xgd[k], html: pct(v.xgd[k], 1), align: 'right' }, { v: (v.gd || {})[k], html: pct((v.gd || {})[k], 1), align: 'right' }] })), { compact: true }) +
      '<div class="pad vsmall muted-inline">Walk-forward: the last 60% of ' + ((m.validation || {}).n_matches || 0).toLocaleString('en-US') + ' matches in five blocks from ' + esc((m.validation || {}).first_test_day || '') +
      ', each predicted by models fitted only on earlier matches, every input from before the match day. R² against a home-advantage-only model. Football is noisy: a single match\'s goal difference is mostly luck.</div>';
  } else h += '<div class="muted">No validation this build: ' + esc((m.validation || {}).reason || 'not enough matches') + '.</div>';
  const rep = m.replacement || {};
  h += tableHTML([{ label: 'Role' }, { label: 'Replacement level', align: 'right', title: 'Gross goals added per 90 of the 20th-percentile regular' }, { label: 'Regulars', align: 'right' }],
    ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'].map(r => ({ cells: [{ v: r, html: roleBadge(r) + ' ' + esc(roleLabel(r)) }, { v: rep[r], html: g2(rep[r]), align: 'right' }, { v: (m.regulars || {})[r] || 0, align: 'right' }] })), { compact: true });
  h += '</div></div>';
  return h;
}

// ══ #/transfer ══════════════════════════════════════════════════════════

let TR_TOKEN = 0;

function clubFile(tid) { return tid ? loadSite('value/club/' + tid + '.json') : Promise.resolve(null); }
function sensFile(slug) { return slug ? loadSite(slug + '/sensitivity.json') : Promise.resolve(null); }

function renderTransfer() {
  const pane = document.getElementById('tab-transfer');
  const token = ++TR_TOKEN;
  pane.innerHTML = '<div class="muted">Loading the transfer simulator…</div>';
  Promise.all([loadValue(), loadSite('clubs_index.json')]).then(([V, ci]) => {
    if (token !== TR_TOKEN) return;
    if (!V.meta || !V.players.length) { missingValue(pane); return; }
    const leagues = Object.keys(V.meta.comps || {}).filter(s => (V.meta.comps[s] || {}).kind === 'league');
    const clubs = rowsOf(ci).filter(c => !c.national && leagues.indexOf(c.home) >= 0);
    CLUB_NAMES = CLUB_NAMES || {};
    rowsOf(ci).forEach(c => { CLUB_NAMES[String(c.id)] = c.name; });
    drawTransfer(pane, V, clubs, token);
  }).catch(err => { pane.innerHTML = '<div class="error-banner">Could not load the simulator: ' + esc(err.message) + '</div>'; });
}

function picker(id, placeholder, value) {
  return '<div class="picker vpicker"><input id="' + id + '" type="search" placeholder="' + esc(placeholder) + '" autocomplete="off" value="' + esc(value || '') + '"><div id="' + id + '-results" class="search-results"></div></div>';
}

function wirePicker(id, items, label, onPick) {
  const input = document.getElementById(id), box = document.getElementById(id + '-results');
  if (!input || !box) return;
  const show = () => {
    const n = normText(input.value.trim());
    if (n.length < 2) { box.style.display = 'none'; return; }
    const hits = items.filter(x => normText(x.n).indexOf(n) >= 0).sort((a, b) => (normText(a.n).indexOf(n) === 0 ? 0 : 1) - (normText(b.n).indexOf(n) === 0 ? 0 : 1) || (b.w || 0) - (a.w || 0)).slice(0, 10);
    box.innerHTML = hits.length ? hits.map((x, i) => '<a class="sr-item" href="#" data-i="' + i + '"><span>' + label(x) + '</span></a>').join('') : '<div class="sr-empty">No match.</div>';
    box.style.display = 'block';
    box.querySelectorAll('[data-i]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); box.style.display = 'none'; onPick(hits[Number(a.dataset.i)]); }));
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', ev => { if (ev.key === 'Escape') box.style.display = 'none'; });
  document.addEventListener('click', ev => { if (!ev.target.closest('.vpicker')) box.style.display = 'none'; });
}

function drawTransfer(pane, V, clubs, token) {
  const q = Object.assign({}, FH.STATE.query || {});
  const P = q.p ? V.byId[String(q.p)] : null;
  const buyerRow = q.to ? clubs.find(c => String(c.id) === String(q.to)) : null;
  pane.innerHTML =
    '<div class="card"><div class="card-header">Transfer simulator <span class="card-sub">Put a player in another club\'s squad and see what the models say. <a href="#/methodology/value">How it works →</a></span></div>' +
    '<div class="controls vtr-pick"><label class="vgrow">Player ' + picker('tr-player', 'Search a player…', P ? P.name : '') + '</label>' +
    '<label class="vgrow">Buying club ' + picker('tr-club', 'Search a club in a followed league…', buyerRow ? buyerRow.name : '') + '</label>' +
    '<button type="button" class="btn-ghost" id="tr-share" title="Copy a link to this transfer">Copy link</button></div>' +
    '<div class="pad vsmall muted-inline">' + esc(HONEST) + ' Clubs: the twelve pooled leagues and Argentina.</div></div>' +
    '<div id="tr-body"></div>';
  const nav = nq => { Object.keys(nq).forEach(k => { if (!nq[k]) delete nq[k]; }); location.hash = '#/transfer' + FH.queryString(nq); };
  wirePicker('tr-player', V.players.filter(p => (p.min || 0) >= 90).map(p => ({ n: p.name, w: p.min, p: p })),
    x => esc(x.n) + ' ' + roleBadge(x.p.role) + ' <span class="sr-sub">' + esc(x.p.club || 'no club') + ' · ' + g2(x.p.gar90) + '</span>',
    x => nav(Object.assign({}, q, { p: x.p.id })));
  wirePicker('tr-club', clubs.map(c => ({ n: c.name, w: 1, c: c })), x => crest(x.n, x.c.crest) + esc(x.n) + ' <span class="sr-sub">' + esc(compName(x.c.home)) + '</span>',
    x => nav(Object.assign({}, q, { to: x.c.id, out: undefined })));
  const share = document.getElementById('tr-share');
  if (share) share.addEventListener('click', () => {
    const url = location.href;
    const done = () => { share.textContent = 'Link copied'; setTimeout(() => { share.textContent = 'Copy link'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link', url));
    else window.prompt('Copy this link', url);
  });
  if (!P) {
    const eg = V.players.filter(p => (p.min || 0) >= 1800 && has(p.proj)).slice(0, 1)[0];
    setHTML('tr-body', '<div class="card"><div class="muted">Pick a player and a buying club. ' + (eg && clubs.length ? 'For example: <a href="#/transfer?p=' + esc(eg.id) + '&to=' + esc(clubs[0].id) + '">' + esc(eg.name) + ' to ' + esc(clubs[0].name) + '</a>.' : '') + '</div></div>');
    return;
  }
  if (!buyerRow) {
    setHTML('tr-body', playerCard(P) + '<div class="card"><div class="muted">Now pick the buying club.</div></div>');
    return;
  }
  setHTML('tr-body', playerCard(P) + '<div class="muted">Simulating…</div>');
  const sellerTid = P.free ? null : P.tid;
  Promise.all([clubFile(buyerRow.id), clubFile(sellerTid)]).then(([B, S]) => {
    if (token !== TR_TOKEN) return;
    if (!B) { setHTML('tr-body', playerCard(P) + '<div class="card"><div class="muted">No strengths-and-needs file for ' + esc(buyerRow.name) + ' yet.</div></div>'); return; }
    const leagues = [B.league].concat(S && S.league !== B.league ? [S.league] : []);
    return Promise.all(leagues.map(sensFile).concat(leagues.map(s => ensureComp(s, ['probs', 'teams', 'meta'])))).then(res => {
      if (token !== TR_TOKEN) return;
      const sens = {};
      leagues.forEach((s, i) => { sens[s] = res[i]; });
      drawTransferResult(V, P, B, S && String(S.tid) !== String(B.tid) ? S : null, sens, q);
    });
  }).catch(err => setHTML('tr-body', '<div class="error-banner">Could not simulate: ' + esc(err.message) + '</div>'));
}

function playerCard(P) {
  const m = META || {};
  return '<div class="card"><div class="pad vplayer">' +
    '<div><div class="vplayer-name">' + playerA(P.id, P.name) + ' ' + roleBadge(P.role) + '</div>' +
    '<div class="muted-inline">' + (P.free ? 'No club (Sofascore lists him without a team)' : clubA(P.club, P.tid)) + (P.league ? ' · ' + esc(compName(P.league)) : '') + (has(P.age) ? ' · ' + P.age + ' years' : '') + (P.nat ? ' · ' + esc(P.nat) : '') + '</div></div>' +
    '<div class="kpi-grid six vkpis">' +
    statTile('GAR/90', g2(P.gar90), (P.min || 0).toLocaleString('en-US') + ' min, last 12 months') +
    statTile('Projected', g2(P.proj), 'shrunk by 900 minutes') +
    statTile('Percentile', has(P.pct) ? ordinal(P.pct) : '—', esc(roleLabel(P.role)) + ' regulars') +
    statTile('Fair value index', has(P.fvi) ? String(P.fvi) : '—', '100 = median top-five regular · not euros') +
    statTile('Sofascore value', money(P.mv), has(P.mv) ? 'Sofascore\'s estimate, reference only' : 'not in our stores') +
    statTile('Contract', P.until ? esc(P.until) : '—', P.until ? 'until (Sofascore)' : 'not in our stores') + '</div>' +
    (P.c ? '<div class="vsmall">Why: ' + drivers(P.c, 4) + ' <span class="muted-inline">(per 90, against the average ' + esc(roleLabel(P.role)).toLowerCase() + ')</span></div>' : '') +
    '</div></div>';
}

/* Goals added per match by a unit: its slots x 90 minutes go to the best projections first, each up
   to 85 minutes, the rest to a replacement-level player (0). Returns the value and each player's minutes. */
function alloc(depth, slots) {
  let left = Math.max(slots || 1, 0) * 90;
  let total = 0;
  const mins = {};
  depth.slice().sort((a, b) => (b.proj || 0) - (a.proj || 0)).forEach(d => {
    const take = Math.max(0, Math.min(has(d.cap) ? d.cap : MINUTES_CAP, left));
    mins[d.id] = take;
    total += take * (d.proj || 0) / 90;
    left -= take;
  });
  return { value: total, mins: mins, spare: Math.max(left, 0) };
}

function unitOf(role) { return UNIT_OF[role] || 'MID'; }

/* Each player's 85 minutes a match, split over the units he played in this season in proportion to his
   minutes there (all of it in his own role's unit when he has none), so nobody plays twice. */
function withCaps(club) {
  const tot = {};
  (club.units || []).forEach(u => (u.depth || []).forEach(d => { tot[d.id] = (tot[d.id] || 0) + (d.min || 0); }));
  return (club.units || []).map(u => Object.assign({}, u, { depth: (u.depth || []).map(d => Object.assign({}, d, {
    cap: tot[d.id] > 0 ? MINUTES_CAP * (d.min || 0) / tot[d.id] : (unitOf(d.role) === u.unit ? MINUTES_CAP : 0) })) }));
}

/* The club's change in goals added per match when `add` joins and `remove` leave. */
function clubDelta(club, add, remove) {
  const out = { delta: 0, units: [] };
  withCaps(club).forEach(u => {
    const before = alloc(u.depth || [], u.slots);
    let depth = (u.depth || []).filter(d => remove.indexOf(String(d.id)) < 0);
    if (add && unitOf(add.role) === u.unit) depth = depth.filter(d => String(d.id) !== String(add.id)).concat([{ id: String(add.id), name: add.name, role: add.role, proj: add.proj || 0, min: 0, cap: MINUTES_CAP, isNew: true }]);
    const touched = depth.length !== (u.depth || []).length || depth.some(d => d.isNew);
    if (!touched) return;
    const after = alloc(depth, u.slots);
    out.delta += after.value - before.value;
    out.units.push({ unit: u, before: before, after: after, depth: depth });
  });
  return out;
}

function interp(xs, ys, x) {
  if (!xs || !ys || !xs.length) return null;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  }
  return ys[ys.length - 1];
}

/* The club's season numbers now and after a shift, from probs.json and the sensitivity curves. */
function oddsRows(slug, teamName, delta) {
  const sens = (FH.CACHE[slug] || {}).sens;
  const s = sens || null;
  const d = ((FH.CACHE[slug] || {}).data || {});
  const probs = ((d.probs || {}).teams || []).find(t => t.team === teamName) || null;
  const c = compOf(slug) || {};
  const curves = s && s.teams ? s.teams[teamName] : null;
  if (!curves || !probs) return null;
  const shifts = s.shifts || [];
  const out = [];
  const add = (label, base, key, isPts) => {
    const ys = curves[key];
    if (!ys || !has(base)) return;
    const diff = interp(shifts, ys, delta) - interp(shifts, ys, 0);
    const after = isPts ? base + diff : Math.min(Math.max(base + diff, 0), 1);
    out.push({ label: label, base: base, after: after, diff: after - base, pts: !!isPts });
  };
  const k = c.kind;
  if (k === 'liga') {
    add('Torneo champion', probs.p_title, 'p_title');
    add('Copa Libertadores', probs.p_libertadores, 'band:libertadores');
    add('Copa Sudamericana', probs.p_sudamericana, 'band:sudamericana');
    add('Relegation', probs.p_relegation, 'band:relegation');
  } else {
    add(k === 'conference' ? 'Supporters\' Shield' : k === 'playoff' ? 'Top of the table' : 'Title', probs.p_title, 'p_title');
    if (has(probs.p_cup)) add(k === 'conference' ? 'MLS Cup' : k === 'playoff' ? 'Liguilla title' : 'Play-off title', probs.p_cup, 'p_cup');
    if (has(probs.p_playoffs)) add('Play-offs', probs.p_playoffs, 'p_playoffs');
    (s.bands || []).forEach(b => { const key = b.key.replace(/^band:/, ''); if (probs.bands && has(probs.bands[key])) add(b.label, probs.bands[key], b.key); });
  }
  add('Expected points', probs.exp_pts, 'exp_pts', true);
  return { rows: out, clamped: delta < shifts[0] || delta > shifts[shifts.length - 1], n: s.n_sims, remaining: curves.remaining };
}

function oddsTable(o) {
  if (!o) return '<div class="muted">No season odds for this club (its league is not simulated, or the season is over).</div>';
  return tableHTML([{ label: '' }, { label: 'Now', align: 'right' }, { label: 'After', align: 'right' }, { label: 'Change', align: 'right' }],
    o.rows.map(r => ({ cells: [{ v: r.label, html: esc(r.label) },
      { v: r.base, html: r.pts ? num(r.base, 1) : pct(r.base, 1), align: 'right' }, { v: r.after, html: '<strong>' + (r.pts ? num(r.after, 1) : pct(r.after, 1)) + '</strong>', align: 'right' },
      { v: r.diff, html: '<span class="' + (Math.abs(r.diff) < (r.pts ? 0.05 : 0.0005) ? 'muted-inline' : ((r.label === 'Relegation' || /relegation/i.test(r.label)) ? (r.diff > 0 ? 'vdown' : 'vup') : (r.diff > 0 ? 'vup' : 'vdown'))) + '">' + (r.pts ? signed(r.diff, 1) : signed(r.diff * 100, 1) + ' pp') + '</span>', align: 'right' }] })), { compact: true }) +
    '<div class="pad vsmall muted-inline">Changes in probabilities are in percentage points (pp). From re-running the season simulation with the club\'s strength shifted (' + (o.n || 0).toLocaleString('en-US') + ' runs per shift, common random numbers) and applying the change to the published probabilities' +
    (o.remaining ? '; ' + o.remaining + ' league matches left' : '') + '.' + (o.clamped ? ' The shift is beyond the simulated range, so the change is capped at its edge.' : '') + '</div>';
}

function depthTable(du, P) {
  const rows = du.depth.slice().sort((a, b) => (du.after.mins[b.id] || 0) - (du.after.mins[a.id] || 0) || (b.proj || 0) - (a.proj || 0));
  return '<div class="vunit-head">' + esc(du.unit.label) + ' <span class="muted-inline">· ' + num(du.unit.slots, 1) + ' players a match on average</span></div>' +
    tableHTML([{ label: 'Player' }, { label: 'Proj. GAR/90', align: 'right' }, { label: 'Min/match before', align: 'right' }, { label: 'After', align: 'right' }],
      rows.concat(du.unit.depth.filter(d => !du.depth.some(x => String(x.id) === String(d.id))).map(d => Object.assign({}, d, { gone: true }))).map(d => ({ _class: d.isNew ? 'vnew' : d.gone ? 'vgone' : '', cells: [
        { v: d.name, html: playerA(d.id, d.name) + ' ' + roleBadge(d.role) + (d.isNew ? ' <span class="chip ok">in</span>' : d.gone ? ' <span class="chip bad">out</span>' : '') },
        { v: d.proj || 0, html: g2(d.proj), align: 'right' },
        { v: du.before.mins[d.id] || 0, html: d.isNew ? '—' : Math.round(du.before.mins[d.id] || 0) + "'", align: 'right' },
        { v: du.after.mins[d.id] || 0, html: d.gone ? '—' : Math.round(du.after.mins[d.id] || 0) + "'", align: 'right' }] })), { compact: true }) +
    (du.after.spare > 1 ? '<div class="pad vsmall muted-inline">' + Math.round(du.after.spare) + ' minutes a match left to a replacement-level player.</div>' : '');
}

function drawTransferResult(V, P, B, S, sens, q) {
  Object.keys(sens).forEach(s => { FH.CACHE[s] = FH.CACHE[s] || { data: {}, pending: {}, rendered: new Set(), shards: {} }; FH.CACHE[s].sens = sens[s]; });
  const out = String(q.out || '').split(',').filter(Boolean);
  if (String(P.tid) === String(B.tid)) {
    setHTML('tr-body', playerCard(P) + '<div class="card"><div class="muted">' + esc(P.name) + ' already plays for ' + esc(B.name) + '. Pick another club.</div></div>');
    return;
  }
  const bd = clubDelta(B, P, out);
  const sd = S ? clubDelta(S, null, [String(P.id)]) : null;
  const gdB = B.gd_per_delta || ((sens[B.league] || {}).teams || {})[B.name] && sens[B.league].teams[B.name].gd_per_delta || 1.3;
  const deltaB = bd.delta / gdB;
  const oB = oddsRows(B.league, B.name, deltaB);
  let oS = null, deltaS = 0;
  if (S) {
    const gdS = S.gd_per_delta || 1.3;
    deltaS = sd.delta / gdS;
    oS = oddsRows(S.league, S.name, deltaS);
  }
  const pMins = (bd.units.find(u => u.unit.unit === unitOf(P.role)) || { after: { mins: {} } }).after.mins[String(P.id)] || 0;
  const role = pMins >= 70 ? 'would start' : pMins >= 30 ? 'would share the minutes' : pMins > 0 ? 'would be a back-up' : 'would not get minutes ahead of the current players';
  const ptsB = oB ? (oB.rows.find(r => r.pts) || {}).diff : null;
  const ptsS = oS ? (oS.rows.find(r => r.pts) || {}).diff : null;
  const verdict = (name, d, pts, seller) => {
    if (Math.abs(d) < 0.005) return esc(name) + ': <strong>no change now</strong>' + (seller ? '' : ' — ' + esc(P.name) + ' ' + role + '.');
    const word = d > 0 ? (d > 0.05 ? 'strengthens now' : 'a marginal gain now') : (d < -0.05 ? 'weakens now' : 'a marginal loss now');
    return esc(name) + ': <strong>' + word + '</strong> (' + signed(d, 2) + ' goals of xG difference a match' + (has(pts) ? ', ' + signed(pts, 1) + ' expected points over the rest of the season' : '') + ').';
  };
  const age = P.age;
  const longTerm = !has(age) ? '' : age <= 23 ? 'Long term: on the archive\'s ageing curve players of ' + age + ' still improve, and the fair value index counts four seasons.' :
    age >= 31 ? 'Long term: at ' + age + ' the ageing curve and career length both shorten the value; the index weighs that.' : 'Long term: at ' + age + ' roughly at his peak on the ageing curve.';
  const win = ((META || {}).windows || {})[B.league];
  const winText = win ? (win.open ? 'The ' + compName(B.league) + ' window is open (usually until ' + esc(win.until) + ').' : 'The ' + compName(B.league) + ' window is closed; the next usually opens ' + esc(win.next || '') + '.') + ' Typical dates; each association sets its own.' : '';
  // A player can sit in two units' depth charts (minutes in both): list him once.
  const seenOut = {};
  const outOpts = (B.units || []).map(u => (u.depth || []).filter(d => !seenOut[d.id] && (seenOut[d.id] = 1)).map(d => '<label class="vout"><input type="checkbox" data-out="' + esc(d.id) + '"' + (out.indexOf(String(d.id)) >= 0 ? ' checked' : '') + '> ' + esc(d.name) + ' ' + roleBadge(d.role) + '</label>').join('')).join('');
  let h = playerCard(P);
  h += '<div class="card"><div class="card-header">The verdict <span class="card-sub">' + esc(P.name) + ' to ' + esc(B.name) + (out.length ? ', ' + out.length + ' out' : '') + '</span></div><div class="pad prose-dark">' +
    '<p>' + verdict(B.name, bd.delta, ptsB) + '</p>' + (S ? '<p>' + verdict(S.name, sd.delta, ptsS, true) + '</p>' : P.free ? '<p>No selling club: Sofascore lists him without a team.</p>' : '<p>' + esc(P.club || 'His club') + ' is outside the followed leagues, so there are no odds for the seller.</p>') +
    (longTerm ? '<p>' + esc(longTerm) + '</p>' : '') + '<p class="vsmall">' + esc(winText) + '</p></div></div>';
  h += '<div class="grid-2"><div class="card"><div class="card-header">' + crest(B.name, 'assets/crests/' + B.tid + '.png') + esc(B.name) + ' <span class="card-sub">buying · ' + esc(compName(B.league)) + '</span></div>' +
    '<div class="pad vsmall">Rating shift ' + signed(deltaB, 3) + ' (log goal rate) from ' + signed(bd.delta, 3) + ' goals a match; he ' + esc(role) + ' (' + Math.round(pMins) + '\' a match).</div>' +
    oddsTable(oB) + bd.units.map(du => depthTable(du, P)).join('') + '</div>';
  h += '<div class="card"><div class="card-header">' + (S ? crest(S.name, 'assets/crests/' + S.tid + '.png') + esc(S.name) + ' <span class="card-sub">selling · ' + esc(compName(S.league)) + '</span>' : 'The seller') + '</div>' +
    (S ? '<div class="pad vsmall">Rating shift ' + signed(deltaS, 3) + ' from ' + signed(sd.delta, 3) + ' goals a match.</div>' + oddsTable(oS) + sd.units.map(du => depthTable(du, P)).join('') :
      '<div class="muted">No strengths-and-needs file for the seller: its odds are not simulated here.</div>') + '</div></div>';
  h += '<div class="card"><div class="card-header">Fair value <span class="card-sub">No transfer fees are in our data, so this is an index, not a price.</span></div><div class="pad prose-dark">' +
    '<p><strong>Fair value index ' + (has(P.fvi) ? P.fvi : '—') + '</strong> — expected points above replacement over the next ' + (((META || {}).fvi || {}).years || 4) + ' seasons at ' + ((((META || {}).fvi || {}).minutes) || 2500).toLocaleString('en-US') +
    ' minutes a season, discounted ' + Math.round((1 - ((((META || {}).fvi || {}).discount) || 0.85)) * 100) + '% a year, with the ageing curve and the chance of still being a regular, scaled so the median regular of the top five leagues is 100. ' +
    (has(P.mv) ? 'Sofascore\'s market value, for reference only: ' + money(P.mv) + '.' : 'Sofascore\'s market value is not in our stores for him.') + '</p>' +
    '<p class="vsmall">' + esc(HONEST) + '</p></div></div>';
  h += '<div class="card"><div class="card-header">Players out <span class="card-sub">Tick players leaving ' + esc(B.name) + ' in the same deal; their minutes go to the next in line.</span></div><div class="pad vouts" id="tr-outs">' + (outOpts || '<span class="muted-inline">No squad on record.</span>') + '</div></div>';
  setHTML('tr-body', h);
  document.querySelectorAll('#tr-outs [data-out]').forEach(cb => cb.addEventListener('change', () => {
    const sel = Array.from(document.querySelectorAll('#tr-outs [data-out]')).filter(x => x.checked).map(x => x.dataset.out);
    const nq = Object.assign({}, q, { out: sel.join(',') || undefined });
    Object.keys(nq).forEach(k => { if (!nq[k]) delete nq[k]; });
    location.hash = '#/transfer' + FH.queryString(nq);
  }));
}

// ══ the club page: strengths and needs ══════════════════════════════════

function gradeBadge(g) { return '<span class="vgrade vgrade-' + esc(g || 'C') + '">' + esc(g || '—') + '</span>'; }

function renderClubNeeds(el, tid) {
  if (!el) return;
  Promise.all([loadSite('value/club/' + tid + '.json'), loadSite('value/meta.json')]).then(([d, m]) => {
    META = META || m;
    if (!d || !d.units) { el.innerHTML = ''; return; }
    const units = {};
    d.units.forEach(u => { units[u.unit] = u; });
    const evidence = u => {
      const e = u.evidence || {};
      return esc(u.label) + ': ' + g2(u.rate) + ' GAR/90 from the players used, ' + ordinal(u.rank) + ' of ' + u.n + ' in ' + esc(compName(d.league)) +
        (e.component && has(e.delta) && Math.abs(e.delta) >= 0.005 ? ' — ' + esc(e.component) + ' ' + signed(e.delta, 2) + ' a player per 90 against the league\'s ' + esc(u.label.toLowerCase()) : '') +
        (u.few ? ' (few minutes this season: graded on the squad\'s best at the position)' : '') + (u.empty ? ' (no current player has played here)' : '') + '.';
    };
    const win = d.window;
    let h = '<div class="card vneeds"><div class="card-header">Strengths and needs <span class="card-sub">' + esc(compName(d.league)) + ' · graded against the league\'s clubs on projected value of the players used this season · as of ' + esc(d.as_of || '') + '</span></div>';
    h += tableHTML([{ label: 'Unit' }, { label: 'Grade', align: 'center' }, { label: 'GAR/90', align: 'right', title: 'Minutes-weighted projected value of the current players used there this season' },
      { label: 'Rank', align: 'right' }, { label: 'Pctl', align: 'center' }, { label: 'Players (minutes this season)', sortable: false }, { label: 'What stands out', sortable: false }],
      d.units.map(u => ({ cells: [
        { v: u.label, html: esc(u.label) }, { v: u.pct, html: gradeBadge(u.grade), align: 'center' }, { v: u.rate, html: g2(u.rate), align: 'right' },
        { v: u.rank, html: u.rank + '/' + u.n, align: 'right' }, { v: u.pct, html: pctPill(u.pct), align: 'center' },
        { v: '', html: (u.depth || []).filter(x => x.min > 0).slice(0, 3).map(x => playerA(x.id, x.name) + ' <span class="muted-inline">' + x.min + "'</span>").join(', ') || '<span class="muted-inline">—</span>' },
        { v: '', html: u.evidence && u.evidence.component && Math.abs(u.evidence.delta || 0) >= 0.005 ? '<span class="vdrv ' + (u.evidence.delta > 0 ? 'up' : 'down') + '">' + esc(u.evidence.component) + ' ' + signed(u.evidence.delta, 2) + '</span>' : '' }
      ] })), { compact: true });
    // Ranked within the club: say so when even its weakest units are above the league median (or its best below).
    const allAbove = (d.weaknesses || []).every(k => units[k] && units[k].pct >= 50);
    const allBelow = (d.strengths || []).every(k => units[k] && units[k].pct < 50);
    h += '<div class="grid-2 vsw"><div class="pad"><div class="vsw-head up">Top strengths' + (allBelow ? ' <span class="muted-inline">(relative: every unit is below the league median)</span>' : '') + '</div><ol>' + (d.strengths || []).map(k => '<li>' + evidence(units[k]) + '</li>').join('') + '</ol></div>' +
      '<div class="pad"><div class="vsw-head down">Top weaknesses' + (allAbove ? ' <span class="muted-inline">(relative: even these are above the league median)</span>' : '') + '</div><ol>' + (d.weaknesses || []).map(k => '<li>' + evidence(units[k]) + '</li>').join('') + '</ol></div></div>';
    h += '<div class="pad"><div class="vsw-head">Ways to improve</div><div class="vsmall muted-inline">For each weakness, the players who would add the most projected value over the weakest current regular there, among realistic targets: at a club of similar or lower strength on the pooled scale, from a league at most a step stronger, aged 31 or under, 900+ minutes in the last 12 months (or without a club, as Sofascore lists him). Points assume he plays 85% of the minutes. ' +
      (win ? (win.open ? 'The window is open (usually until ' + esc(win.until) + ').' : 'The window is closed; the next usually opens ' + esc(win.next || '') + ' (typical dates).') : '') + '</div></div>';
    (d.weaknesses || []).forEach(k => {
      const ts = (d.targets || {})[k] || [];
      h += '<div class="vneed-unit">' + esc(units[k].label) + '</div>' + (ts.length ? tableHTML([
        { label: 'Player' }, { label: 'Age', align: 'right' }, { label: 'Club' }, { label: 'Min (12m)', align: 'right' }, { label: 'Proj. GAR/90', align: 'right' },
        { label: 'Gain/90', align: 'right', title: 'Over the weakest current regular in the unit' }, { label: 'Pts, rest of season', align: 'right' }, { label: 'FVI', align: 'right', title: 'Fair value index (not euros)' },
        { label: 'Sofascore value', align: 'right', title: 'Reference only, where our stores hold it' }, { label: 'Notes', sortable: false }, { label: '', sortable: false }
      ], ts.map(t => ({ cells: [
        { v: t.name, html: playerA(t.id, t.name) + ' ' + roleBadge(t.role) }, { v: t.age || 0, html: has(t.age) ? t.age : '—', align: 'right' },
        { v: t.club || '', html: t.free ? '<span class="chip warn">no club</span>' : clubA(t.club, t.tid) + (t.league ? ' <span class="muted-inline">' + esc(compName(t.league)) + '</span>' : '') },
        { v: t.min, html: (t.min || 0).toLocaleString('en-US'), align: 'right' }, { v: t.proj, html: g2(t.proj), align: 'right' }, { v: t.gain90, html: '<strong>' + g2(t.gain90) + '</strong>', align: 'right' },
        { v: t.gain_pts_rest || 0, html: has(t.gain_pts_rest) ? signed(t.gain_pts_rest, 1) : '—', align: 'right' }, { v: t.fvi || 0, html: has(t.fvi) ? t.fvi : '—', align: 'right' },
        { v: t.mv || 0, html: money(t.mv), align: 'right' }, { v: '', html: (t.hints || []).map(x => '<span class="muted-inline">' + esc(x) + '</span>').join('<br>') },
        { v: '', html: '<a href="#/transfer?p=' + esc(t.id) + '&to=' + esc(d.tid) + '">Simulate →</a>' }
      ] })), { compact: true }) : '<div class="muted">No realistic target clears the filters for this unit.</div>');
    });
    h += '<div class="pad vsmall muted-inline">' + esc(HONEST) + ' <a href="#/value?club=' + esc(d.tid) + '">The squad on the value table →</a> · <a href="#/transfer?to=' + esc(d.tid) + '">Transfer simulator →</a></div></div>';
    el.innerHTML = h;
    el.querySelectorAll('table').forEach(t => FH.makeSortable(t));
  }).catch(() => { el.innerHTML = ''; });
}

FH.renderClubNeeds = renderClubNeeds;
Object.assign(FH.GLOBAL_PAGES, { value: renderValue, transfer: renderTransfer });
})(window.FH);
