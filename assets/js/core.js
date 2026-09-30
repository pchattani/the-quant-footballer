/* The Quant Footballer — core: state, helpers, routing, loading, search.
 *
 * The site is a static shell over JSON payloads built by scripts/build_site_all.py.
 * data/competitions.json is the index that drives the competition picker and the
 * tab list; each competition's payloads live under data/<slug>/ and load lazily
 * when first needed. Routes:
 *
 *   #/                         the hub (scoreboard, leaders, competitions)
 *   #/<slug>/<tab>             a competition tab
 *   #/<slug>/team/<team-slug>  a club page
 *   #/<slug>/player/<id>       a player page
 *   #/<slug>/match/<id>        a match page
 *
 * Everything degrades rather than fails: a missing payload disables one tab, a
 * missing competition is listed as unavailable, a missing chart library leaves
 * the tables in place. The other modules (charts.js, tabs.js, pages.js) attach
 * themselves to the FH namespace defined here.
 */
window.FH = (function () {
'use strict';

const INDEX = { competitions: [], updated_at: null };
const CACHE = {};             // slug -> { data, pending, rendered, shards }
const STATE = { current: null, page: null, param: null };

const DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#8b949e', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', size: 11 },
  xaxis: { gridcolor: '#21262d', zerolinecolor: '#30363d' },
  yaxis: { gridcolor: '#21262d', zerolinecolor: '#30363d' },
  margin: { l: 60, r: 20, t: 30, b: 50 },
  hovermode: 'closest',
  showlegend: false
};
const PLOTLY_CONF = { displayModeBar: false, responsive: true };
const C = {
  blue: '#58a6ff', green: '#3fb950', red: '#f85149', orange: '#f97316',
  purple: '#bc8cff', yellow: '#d29922', teal: '#39d0d8', text2: '#8b949e', text3: '#6e7681',
  pctLow: [59, 130, 246], pctMid: [107, 114, 128], pctHigh: [239, 68, 68]
};
const PALETTE = [C.blue, C.green, C.orange, C.purple, C.red, C.yellow, '#79c0ff', '#d2a8ff'];

// Pages above the competitions, by route segment -> pane / renderer name.
const GLOBAL = { clubs: 'clubs', nations: 'nations', leaders: 'leaders', 'ballon-dor': 'ballondor', compare: 'compare', player: 'career', disclaimer: 'disclaimer', lab: 'lab', glossary: 'glossary', methodology: 'methodologysite' };
const GLOBAL_TABS = ['home', 'clubs', 'nations', 'leaders', 'lab', 'ballondor', 'compare'];
const GLOBAL_ROUTE = { clubs: '#/clubs', nations: '#/nations', leaders: '#/leaders', lab: '#/lab', ballondor: '#/ballon-dor', compare: '#/compare', glossary: '#/glossary', methodologysite: '#/methodology' };
const FAMILY_LABELS = { cup: 'Continental & world', domestic: 'National cups', super: 'Super cups', international: 'National teams' };

const TAB_LABELS = {
  home: 'Hub', disclaimer: 'Disclaimer & terms', glossary: 'Glossary', methodologysite: 'Methodology', analytics: 'Analytics', clubs: 'Clubs across leagues', nations: 'National teams', leaders: 'Global leaders', lab: 'Player lab', ballondor: "Ballon d'Or", compare: 'Compare',
  overview: 'Overview', table: 'Table', fixtures: 'Fixtures & Results', zones: 'Zones',
  bracket: 'Playoffs', anual: 'Tabla Anual', relegation: 'Relegation', probs: 'Probabilities',
  power: 'Power Rankings', team: 'Clubs', players: 'Players', matches: 'Matches', market: 'Market',
  history: 'History', methodology: 'Methodology'
};
const ROUND_LABELS = {
  r1: 'Round One', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final',
  wc: 'Wild Card', csf: 'Conf. Semi', cf: 'Conf. Final', po: 'Play-off', play_in: 'Play-in',
  r2: 'Second round', r3: 'Third round', r4: 'Fourth round', r5: 'Fifth round', r6: 'Sixth round',
  r32: 'Round of 32', r64: 'Round of 64', '3rd': 'Third place', prelim: 'Preliminary round', q1: 'First qualifying round',
  q2: 'Second qualifying round', q3: 'Third qualifying round'
};
const STAGE_LABELS = { league: 'League', playoff: 'Knockout', qualifying: 'Qualifying', split: 'Split', other: 'Other' };

// Which payloads each tab needs. Core payloads load when a competition opens; the
// rest load on first visit to the tab. Pages (team/player/match) declare theirs
// in pages.js.
const CORE = {
  league: ['meta', 'teams', 'table', 'probs'], conference: ['meta', 'teams', 'table', 'probs'],
  playoff: ['meta', 'teams', 'table', 'probs'], cup: ['meta', 'teams', 'table', 'probs'],
  liga: ['meta', 'teams', 'zones', 'probs']
};
const NEEDS = {
  overview: ['meta', 'table', 'probs', 'fixtures', 'players_live', 'zones', 'bracket'],
  table: ['table'], fixtures: ['fixtures'], zones: ['zones'], bracket: ['bracket'], anual: ['anual'],
  relegation: ['relegation'], probs: ['probs'], power: ['strength'], analytics: ['analytics', 'players_live', 'team_stats', 'strength', 'table', 'fixtures'],
  team: ['probs', 'strength', 'relegation', 'table', 'zones', 'team_stats', 'analytics', 'players_live', 'fixtures'],
  players: ['players_live', 'player_leaders', 'shots'], matches: ['matches'],
  market: ['market_odds'], history: ['history'], methodology: ['meta', 'table', 'bracket']
};
const FILES = {
  meta: 'meta.json', teams: 'teams.json', table: 'table.json', zones: 'zones.json',
  probs: 'probs.json', bracket: 'bracket.json', anual: 'anual.json', relegation: 'relegation.json',
  strength: 'strength.json', players_live: 'players_live.json', player_leaders: 'player_leaders.json',
  shots: 'shots.json', matches: 'matches.json', market_odds: 'market_odds.json',
  history: 'history.json', fixtures: 'fixtures.json', team_stats: 'team_stats.json', analytics: 'analytics.json'
};
const FALLBACK = {
  meta: {}, teams: { teams: {} }, table: null, zones: null, probs: { teams: [] },
  bracket: { rounds: [], seeds: {}, results: {}, reach: {}, p_title: {}, p_cup: {} },
  anual: null, relegation: null, strength: { rows: [], elo_history: {}, notes: {} },
  players_live: { ok: false, players: [], metrics: [] }, player_leaders: { top_scorer: [], live: [] },
  shots: { players: {} }, matches: { matches: [] }, market_odds: { ok: false },
  history: { snapshots: [] }, fixtures: { matches: [] }, team_stats: { teams: {}, metrics: [] },
  analytics: { rounds: [], season_xi: {}, performers: { players: {}, teams: {} }, team_metrics: [] }
};

// ── formatting helpers ─────────────────────────────────────────────────────

function fetchJSON(path, fallback) {
  return fetch(path + '?v=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(path + ': HTTP ' + r.status); return r.json(); })
    .catch(err => {
      if (fallback === undefined) throw err;
      console.warn('optional payload missing:', path, err.message);
      return fallback;
    });
}

function pct(v, digits) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const d = digits === undefined ? 1 : digits;
  if (v > 0 && v < 0.001) return '<0.1%';
  return (v * 100).toFixed(d) + '%';
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v, d) {
  return (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(d === undefined ? 1 : d);
}

function signed(v, d) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v > 0 ? '+' : '') + Number(v).toFixed(d === undefined ? 1 : d);
}

function fmtNum(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.abs(v) >= 100 || Number.isInteger(v) ? String(v) : Number(v).toFixed(2);
}

/* Format a catalogue metric by its declared format. */
function fmtMetric(v, fmt) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (fmt === 'pct') return Number(v).toFixed(1) + '%';
  if (fmt === 'int') return String(Math.round(v));
  if (fmt === '1') return Number(v).toFixed(1);
  if (fmt === '3') return Number(v).toFixed(3);
  return Number(v).toFixed(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s);
  return isNaN(d.getTime()) ? null : d;
}

/* "Sat 20 Sep" in the viewer's timezone. */
function fmtDate(s, withYear) {
  const d = parseDate(s);
  if (!d) return '—';
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
}

function fmtTime(s) {
  const d = parseDate(s);
  if (!d || String(s).length === 10) return '';
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function fmtStamp(s) {
  return s ? String(s).replace('T', ' ').replace('Z', ' UTC') : '';
}

/* The local calendar date (YYYY-MM-DD) of a kickoff. */
function localDay(s) {
  const d = parseDate(s);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* The build's _slug(): every character that is not a letter or digit (any script)
   becomes one dash, and dashes are trimmed from the ends. Club shard files and
   club URLs are named with it, so the two must agree exactly. */
const ALNUM = (() => { try { return new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (e) { return /[a-z0-9\u00c0-\u024f]/; } })();
function slugify(s) {
  return Array.from(String(s || '').toLowerCase()).map(ch => ALNUM.test(ch) ? ch : '-').join('').replace(/^-+|-+$/g, '');
}

// ── state accessors ────────────────────────────────────────────────────────

function D() { return STATE.current ? CACHE[STATE.current].data : {}; }
function comp() { return INDEX.competitions.find(c => c.slug === STATE.current) || null; }
function kind() { const c = comp(); return c ? c.kind : 'league'; }
function cupKind() { const c = comp(); return c ? (c.cup_kind || '') : ''; }

// ── crests and links ───────────────────────────────────────────────────────

function initials(team) {
  return String(team || '?').replace(/[^A-Za-zÀ-ÿ ]/g, '')
    .split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* Club crest, or a monogram chip when there is none. `src` overrides the lookup. */
function crest(team, src, size) {
  const info = ((D().teams || {}).teams || {})[team] || {};
  const url = src || info.crest;
  const cls = size === 'lg' ? 'crest crest-lg' : size === 'xl' ? 'crest crest-xl' : 'crest';
  const fcls = size === 'lg' ? 'crest-fallback crest-lg' : size === 'xl' ? 'crest-fallback crest-xl' : 'crest-fallback';
  if (url) {
    // A missing file degrades to the monogram rather than a broken-image icon.
    return '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy"' +
           ' onerror="this.outerHTML=\'<span class=&quot;' + fcls + '&quot;>' + esc(initials(team)) + '</span>\'">';
  }
  return '<span class="' + fcls + '">' + esc(initials(team)) + '</span>';
}

function teamHref(team, slug) {
  const s = slug || STATE.current;
  const info = (((CACHE[s] || {}).data || {}).teams || {}).teams || {};
  const tslug = (info[team] || {}).slug || slugify(team);
  return '#/' + s + '/team/' + tslug;
}

function teamLink(team, slug) {
  if (!team) return '<span class="muted-inline">—</span>';
  return '<a class="team-link" href="' + esc(teamHref(team, slug)) + '">' + crest(team) + esc(team) + '</a>';
}

function playerLink(id, name, slug) {
  if (!id) return esc(name);
  return '<a class="player-link" href="#/' + esc(slug || STATE.current) + '/player/' + esc(id) + '">' + esc(name) + '</a>';
}

function matchHref(id, slug) {
  return '#/' + (slug || STATE.current) + '/match/' + id;
}

// ── tables ─────────────────────────────────────────────────────────────────

function makeSortable(table) {
  if (!table) return;
  const ths = table.querySelectorAll('th.sortable-th');
  ths.forEach((th, idx) => {
    th.addEventListener('click', () => {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const asc = th.dataset.sortDir !== 'asc';
      ths.forEach(o => { delete o.dataset.sortDir; });
      th.dataset.sortDir = asc ? 'asc' : 'desc';
      rows.sort((a, b) => {
        const av = a.children[idx] ? a.children[idx].dataset.v : '';
        const bv = b.children[idx] ? b.children[idx].dataset.v : '';
        const an = parseFloat(av), bn = parseFloat(bv);
        const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
        return asc ? cmp : -cmp;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

function tableHTML(cols, rows, opts) {
  const o = opts || {};
  let h = '<div class="table-wrap' + (o.compact ? ' compact' : '') + '"><table class="wc-table' + (o.sticky ? ' sticky-head' : '') + '"><thead><tr>';
  cols.forEach(c => {
    h += '<th class="' + (c.sortable === false ? '' : 'sortable-th') + '"' +
         (c.align ? ' style="text-align:' + c.align + '"' : '') +
         (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' + esc(c.label) + '</th>';
  });
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr' + (r._class ? ' class="' + r._class + '"' : '') + (r._href ? ' data-href="' + esc(r._href) + '"' : '') + '>';
    r.cells.forEach(c => {
      h += '<td data-v="' + esc(c.v !== undefined ? c.v : c.html) + '"' +
           (c.cls ? ' class="' + c.cls + '"' : '') +
           (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' +
           (c.html !== undefined ? c.html : esc(c.v)) + '</td>';
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function sortableIn(id) {
  const t = document.querySelector('#' + id + ' table');
  if (t) makeSortable(t);
}

/* Rows carrying data-href navigate on click (except on links inside them). */
function wireRowLinks(root) {
  const el = typeof root === 'string' ? document.getElementById(root) : root;
  if (!el) return;
  el.querySelectorAll('tr[data-href]').forEach(tr => {
    tr.classList.add('row-link');
    tr.addEventListener('click', ev => {
      if (ev.target.closest('a')) return;
      location.hash = tr.dataset.href;
    });
  });
}

function statTile(label, value, sub, cls) {
  return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-label">' + esc(label) + '</div>' +
    '<div class="kpi-value">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
}

function formChips(results) {
  return '<span class="form">' + (results || []).map(r => '<span class="form-chip form-' + esc(r) + '">' + esc(r) + '</span>').join('') + '</span>';
}

function resultClass(gf, ga) {
  if (gf === null || gf === undefined || ga === null || ga === undefined) return '';
  return gf > ga ? 'res-W' : gf === ga ? 'res-D' : 'res-L';
}

function riskClass(p) {
  if (p >= 0.5) return 'danger';
  if (p >= 0.15) return '';
  return 'safe';
}

function bandClass(bands, pos) {
  let up = 0, down = 0;
  for (const b of bands || []) {
    if (pos >= b.first && pos <= b.last) return b.kind === 'down' ? 'band-down-' + Math.min(down, 1) : 'band-' + Math.min(up, 4);
    if (b.kind === 'down') down++; else up++;
  }
  return '';
}

function bandColor(bands, key) {
  let up = 0, down = 0;
  const ups = [C.green, C.teal, C.blue, C.purple, C.yellow];
  const downs = [C.orange, C.red];
  for (const b of bands || []) {
    if (b.key === key) return b.kind === 'down' ? downs[Math.min(down, 1)] : ups[Math.min(up, 4)];
    if (b.kind === 'down') down++; else up++;
  }
  return C.text3;
}

// ── percentiles (the Savant-style sliders) ─────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

/* Blue at the bottom, grey in the middle, red at the top. */
function pctColor(p) {
  if (p === null || p === undefined || isNaN(p)) return '#30363d';
  const t = Math.max(0, Math.min(100, p)) / 100;
  const from = t < 0.5 ? C.pctLow : C.pctMid, to = t < 0.5 ? C.pctMid : C.pctHigh;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return 'rgb(' + Math.round(lerp(from[0], to[0], u)) + ',' + Math.round(lerp(from[1], to[1], u)) + ',' + Math.round(lerp(from[2], to[2], u)) + ')';
}

function pctPill(p) {
  if (p === null || p === undefined || isNaN(p)) return '<span class="pct-pill empty">—</span>';
  return '<span class="pct-pill" style="background:' + pctColor(p) + '">' + Math.round(p) + '</span>';
}

/* One slider row: label, a bar with the percentile dot, and the raw value. */
function pctRow(label, p, valueText, title) {
  const known = !(p === null || p === undefined || isNaN(p));
  const x = known ? Math.max(0, Math.min(100, p)) : 0;
  return '<div class="pct-row"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
    '<span class="pct-label">' + esc(label) + '</span>' +
    '<div class="pct-bar">' + (known
      ? '<div class="pct-fill" style="width:' + x + '%;background:' + pctColor(p) + '"></div>' +
        '<span class="pct-dot" style="left:' + x + '%;background:' + pctColor(p) + '">' + Math.round(p) + '</span>'
      : '<span class="pct-none">not enough minutes</span>') +
    '</div><span class="pct-val">' + valueText + '</span></div>';
}

/* A stacked home / draw / away probability bar. */
function probBar(m, opts) {
  if (!m) return '<span class="muted-inline">—</span>';
  const o = opts || {};
  const seg = (k, cls) => '<span class="pb-seg ' + cls + '" style="width:' + (m[k] * 100).toFixed(1) + '%">' +
    (m[k] >= 0.12 ? pct(m[k], 0) : '') + '</span>';
  return '<div class="prob-bar' + (o.small ? ' small' : '') + '">' + seg('h', 'pb-h') + seg('d', 'pb-d') + seg('a', 'pb-a') + '</div>';
}

function statusChip(f) {
  if (f.status === 'finished') return '<span class="chip st-ft">FT</span>';
  if (f.status === 'live') return '<span class="chip st-live">LIVE</span>';
  if (f.status === 'postponed') return '<span class="chip warn">PPD</span>';
  if (f.status === 'cancelled') return '<span class="chip bad">CANC</span>';
  return '<span class="chip st-time">' + (fmtTime(f.date) || 'TBD') + '</span>';
}

function scoreText(f) {
  if (f.status === 'finished' || f.status === 'live') return f.hs + ' – ' + f.as;
  return 'v';
}

// ── routing and loading ────────────────────────────────────────────────────

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { slug: null, tab: 'home', page: null, param: null };
  const parts = h.split('/').map(decodeURIComponent);
  if (GLOBAL[parts[0]] && !INDEX.competitions.some(c => c.slug === parts[0])) {
    return { slug: null, tab: null, page: null, param: parts.slice(1).join('/'), global: GLOBAL[parts[0]] };
  }
  if (parts.length === 1 && !INDEX.competitions.some(c => c.slug === parts[0])) {
    return { slug: STATE.current, tab: parts[0], page: null, param: null };
  }
  if (parts.length >= 3 && ['team', 'player', 'match'].indexOf(parts[1]) >= 0) {
    return { slug: parts[0], tab: null, page: parts[1], param: parts.slice(2).join('/') };
  }
  return { slug: parts[0] || null, tab: parts[1] || null, page: null, param: null };
}

function navigate(slug, tab) {
  const target = slug ? '#/' + slug + '/' + (tab || '') : '#/';
  if (location.hash !== target) location.hash = target;
  else route();
}

function route() {
  const r = parseHash();
  closeSearch();
  if (r.global) { openGlobal(r.global, r.param); window.scrollTo(0, 0); return; }
  if (!r.slug) { openHome(); return; }
  const c = INDEX.competitions.find(x => x.slug === r.slug);
  if (!c) { openHome(); return; }
  openCompetition(c, r.tab, r.page, r.param);
  window.scrollTo(0, 0);
}

function openHome() {
  STATE.current = null; STATE.page = null; STATE.param = null; STATE.global = null;
  document.getElementById('comp-select').value = '';
  buildTabs(GLOBAL_TABS);
  updateMeta();
  showPane('home');
  const r = FH.RENDERERS && FH.RENDERERS.home;
  if (r) safeRender('home', r);
}

/* A page above the competitions: clubs, leaders, the Ballon d'Or, compare, a career. */
function openGlobal(page, param) {
  STATE.current = null; STATE.page = null; STATE.param = param || null; STATE.global = page;
  document.getElementById('comp-select').value = '';
  buildTabs(GLOBAL_TABS);
  updateMeta();
  const pane = page === 'career' ? 'page' : page;
  showPane(pane);
  document.querySelectorAll('#mainTabs .nav-link').forEach(a => a.classList.toggle('active', a.dataset.tab === (page === 'career' ? 'leaders' : page)));
  const fn = (FH.GLOBAL_PAGES || {})[page];
  if (fn) safeRender(page, fn, param);
}

const SITE = { data: {}, pending: {} };

/* A site-wide payload (pool, global players, the Ballon d'Or, careers), cached for the session. */
function loadSite(path) {
  if (path in SITE.data) return Promise.resolve(SITE.data[path]);
  if (!SITE.pending[path]) {
    SITE.pending[path] = fetchJSON('data/' + path, null).then(v => { SITE.data[path] = v; delete SITE.pending[path]; return v; });
  }
  return SITE.pending[path];
}

function ensure(names) {
  const entry = CACHE[STATE.current];
  const c = comp();
  const wanted = names.filter(n => FILES[n]);
  const missing = wanted.filter(n => !(n in entry.data) && !(n in entry.pending));
  missing.forEach(n => {
    entry.pending[n] = fetchJSON('data/' + c.slug + '/' + FILES[n], FALLBACK[n])
      .then(v => { entry.data[n] = v; delete entry.pending[n]; return v; });
  });
  return Promise.all(wanted.map(n => (n in entry.data) ? Promise.resolve(entry.data[n]) : entry.pending[n]));
}

/* A sharded payload (a match page, a club's player logs) for the open competition. */
function loadShard(path, fallback) {
  const entry = CACHE[STATE.current];
  if (entry.shards[path]) return entry.shards[path];
  entry.shards[path] = fetchJSON('data/' + STATE.current + '/' + path, fallback === undefined ? null : fallback)
    .then(v => { if (v === null) delete entry.shards[path]; return v; });
  return entry.shards[path];
}

function openCompetition(c, tab, page, param) {
  const first = STATE.current !== c.slug;
  STATE.current = c.slug; STATE.page = page || null; STATE.param = param || null;
  document.getElementById('comp-select').value = c.slug;
  if (!CACHE[c.slug]) CACHE[c.slug] = { data: {}, pending: {}, rendered: new Set(), shards: {} };
  const tabs = ['home'].concat(c.tabs || []);
  buildTabs(tabs);
  if (!c.ok) {
    updateMeta();
    showPane('home');
    const r = FH.RENDERERS && FH.RENDERERS.home;
    if (r) safeRender('home', r);
    setHTML('stale-banners', '<div class="error-banner">' + esc(c.name) + ' is not available yet' +
      (c.reason ? ': ' + esc(c.reason) : '') + '.</div>');
    return;
  }
  const target = tabs.indexOf(tab) >= 0 && tab !== 'home' ? tab : (c.tabs || ['overview'])[0];
  const overlay = document.getElementById('loading-overlay');
  if (first) overlay.style.display = 'flex';
  ensure(CORE[c.kind] || CORE.league).then(() => {
    overlay.style.display = 'none';
    if (STATE.current !== c.slug) return;   // navigated away while loading
    updateMeta();
    if (page) openPage(page, param); else activateTab(target);
  }).catch(err => {
    console.error(err);
    overlay.style.display = 'none';
    setHTML('stale-banners', '<div class="error-banner">Could not load ' + esc(c.name) + ': ' + esc(err.message) + '</div>');
  });
}

function buildTabs(tabs) {
  const ul = document.getElementById('mainTabs');
  ul.innerHTML = tabs.map(t =>
    '<li class="nav-item"><a class="nav-link" href="#" data-tab="' + t + '">' +
    esc(tabLabel(t)) + '</a></li>').join('');
  ul.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      const t = a.dataset.tab;
      if (t === 'home') navigate(null);
      else if (GLOBAL_ROUTE[t]) { if (location.hash !== GLOBAL_ROUTE[t]) location.hash = GLOBAL_ROUTE[t]; else route(); }
      else navigate(STATE.current, t);
    });
  });
}

function tabLabel(t) {
  const c = comp() || {};
  const k = kind();
  if (t === 'table' && k === 'conference') return 'Conferences';
  if (t === 'table' && k === 'cup') return c.cup_kind === 'groups' || c.cup_kind === 'international' ? 'Groups' : c.cup_kind === 'regional_swiss' ? 'Regions' : 'League phase';
  if (t === 'power' && c.family === 'international') return 'Ratings';
  if (t === 'team' && c.family === 'international') return 'Nations';
  if (t === 'bracket' && k === 'cup') return 'Knockout';
  if (t === 'bracket' && k === 'playoff') return 'Liguilla';
  if (t === 'bracket' && k === 'liga') return 'Playoffs';
  return TAB_LABELS[t] || t;
}

function showPane(name) {
  document.querySelectorAll('#mainTabs .nav-link').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

function safeRender(name, fn, arg) {
  try {
    fn(arg);
  } catch (err) {
    console.error('render failed for', name, err);
    const pane = document.getElementById('tab-' + name) || document.getElementById('tab-page');
    if (pane) pane.insertAdjacentHTML('afterbegin', '<div class="error-banner">This section could not be shown: ' + esc(err.message) + '</div>');
  }
}

function activateTab(name) {
  showPane(name);
  const entry = CACHE[STATE.current];
  if (entry.rendered.has(name)) return;
  ensure(NEEDS[name] || []).then(() => {
    if (STATE.current === null || CACHE[STATE.current] !== entry) return;
    const fn = FH.RENDERERS[name];
    if (!fn) return;
    safeRender(name, fn);
    entry.rendered.add(name);
  });
}

/* A club, player or match page: rendered into the shared page pane. */
function openPage(page, param) {
  const parent = { team: 'team', player: 'players', match: 'matches' }[page];
  showPane('page');
  document.querySelectorAll('#mainTabs .nav-link').forEach(a => a.classList.toggle('active', a.dataset.tab === parent));
  const pane = document.getElementById('tab-page');
  pane.innerHTML = '<div class="muted">Loading…</div>';
  const needs = (FH.PAGE_NEEDS || {})[page] || [];
  const entry = CACHE[STATE.current];
  ensure(needs).then(() => {
    if (STATE.current === null || CACHE[STATE.current] !== entry || STATE.page !== page || STATE.param !== param) return;
    const fn = (FH.PAGES || {})[page];
    if (!fn) { pane.innerHTML = '<div class="muted">Unknown page.</div>'; return; }
    safeRender(page, fn, param);
  }).catch(err => {
    pane.innerHTML = '<div class="error-banner">Could not load this page: ' + esc(err.message) + '</div>';
  });
}

function updateMeta() {
  const c = comp();
  const banners = [];
  if (!c) {
    if (STATE.global) {
      setHTML('meta-line', esc(TAB_LABELS[STATE.global] || (STATE.global === 'career' ? 'Player career' : STATE.global)) + (INDEX.updated_at ? ' · updated ' + fmtStamp(INDEX.updated_at) : ''));
      setHTML('footer-meta', INDEX.updated_at ? 'Updated ' + fmtStamp(INDEX.updated_at) : '');
      setHTML('stale-banners', '');
      return;
    }
    const n = INDEX.competitions.filter(x => x.ok).length;
    setHTML('meta-line', n + ' competitions · ' + (INDEX.updated_at ? 'updated ' + fmtStamp(INDEX.updated_at) : ''));
    setHTML('footer-meta', INDEX.updated_at ? 'Updated ' + fmtStamp(INDEX.updated_at) : '');
    setHTML('stale-banners', '');
    return;
  }
  const m = D().meta || {};
  const played = m.games_played !== undefined ? m.games_played : c.games_played;
  const total = m.games_total !== undefined ? m.games_total : c.games_total;
  const season = c.kind === 'liga' ? ('Torneo ' + (m.phase === 'clausura' ? 'Clausura' : 'Apertura')) : (m.season || c.season || '');
  setHTML('meta-line', esc(c.name) + ' · ' + esc(season) + ' · ' + (played || 0) + '/' + (total || 0) + ' matches played' +
    (m.n_sims ? ' · ' + m.n_sims.toLocaleString('en-US') + ' simulations' : '') +
    (m.updated_at ? ' · updated ' + fmtStamp(m.updated_at) : ''));
  setHTML('footer-meta', m.updated_at ? 'Updated ' + fmtStamp(m.updated_at) : '');
  if (m.synthetic) banners.push('Sample data generated to exercise the site. These are not real results.');
  if (m.store_fresh === false) banners.push('The Sofascore data could not be refreshed' + (m.store_age_hours ? ' (last good data ' + m.store_age_hours + ' h ago)' : '') + '. Showing the last good data.');
  if (m.phase === 'pre') banners.push(m.phase_note || 'The main phase has not started.');
  else if (m.season_stale) banners.push(c.complete ? 'This edition is complete; the next one is simulated once its draw is known.' : 'The most recent recorded match is old. The configured season may be out of date.');
  if (m.league_complete && c.kind === 'league') banners.push('The league season is complete; probabilities reflect the final table.');
  if (m.unsimulated) banners.push('National-team competitions are not simulated: tables and the knockout ladder are as played; the line on each fixture comes from the international fit.');
  setHTML('stale-banners', banners.map(b => '<div class="stale-banner">' + esc(b) + '</div>').join(''));
}

// ── search ─────────────────────────────────────────────────────────────────

let SEARCH = null;          // { teams, players } once loaded
let searchPending = null;

function loadSearch() {
  if (SEARCH) return Promise.resolve(SEARCH);
  if (!searchPending) searchPending = fetchJSON('data/search.json', { teams: [], players: [] }).then(v => { SEARCH = v; return v; });
  return searchPending;
}

function closeSearch() {
  const box = document.getElementById('search-results');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
}

function runSearch(q) {
  const box = document.getElementById('search-results');
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) { closeSearch(); return; }
  loadSearch().then(idx => {
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const n = norm(needle);
    const comps = INDEX.competitions.filter(c => norm(c.name).indexOf(n) >= 0 || norm(c.short_name).indexOf(n) >= 0).slice(0, 3);
    const teams = idx.teams.filter(t => norm(t.n).indexOf(n) >= 0).slice(0, 6);
    const players = idx.players.filter(p => norm(p.n).indexOf(n) >= 0).slice(0, 8);
    let html = '';
    if (comps.length) html += '<div class="sr-head">Competitions</div>' + comps.map(c =>
      '<a class="sr-item" href="#/' + esc(c.slug) + '/' + ((c.tabs || ['overview'])[0]) + '"><span>' + esc(c.name) + '</span><span class="sr-sub">' + esc(c.country) + '</span></a>').join('');
    if (teams.length) html += '<div class="sr-head">Clubs</div>' + teams.map(t =>
      '<a class="sr-item" href="#/' + esc(t.comp) + '/team/' + esc(t.slug) + '">' + crest(t.n, t.crest) + '<span>' + esc(t.n) + '</span><span class="sr-sub">' + esc(t.comp_name) + '</span></a>').join('');
    if (players.length) html += '<div class="sr-head">Players</div>' + players.map(p => {
      const c = INDEX.competitions.find(x => x.slug === p.comp) || {};
      return '<a class="sr-item" href="#/' + esc(p.comp) + '/player/' + esc(p.id) + '"><span>' + esc(p.n) + (p.pos ? ' <span class="pos-badge">' + esc(p.pos) + '</span>' : '') + '</span><span class="sr-sub">' + esc(p.t) + ' · ' + esc(c.short_name || p.comp) + '</span></a>';
    }).join('');
    box.innerHTML = html || '<div class="sr-empty">No club, player or competition matches.</div>';
    box.style.display = 'block';
  });
}

function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 120); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) runSearch(input.value); });
  input.addEventListener('keydown', ev => { if (ev.key === 'Escape') { input.value = ''; closeSearch(); input.blur(); } });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-box')) closeSearch(); });
  document.getElementById('search-results').addEventListener('click', ev => {
    if (ev.target.closest('a')) { input.value = ''; closeSearch(); }
  });
}

// ── init ───────────────────────────────────────────────────────────────────

function init() {
  fetchJSON('data/competitions.json').then(index => {
    INDEX.competitions = index.competitions || [];
    INDEX.updated_at = index.updated_at;
    const sel = document.getElementById('comp-select');
    const fam = c => c.kind !== 'cup' ? 'league' : (c.family || 'cup');
    const groups = [['Leagues', c => fam(c) === 'league'], ['Continental & world', c => fam(c) === 'cup'],
                    ['National cups', c => fam(c) === 'domestic'], ['Super cups', c => fam(c) === 'super'], ['National teams', c => fam(c) === 'international']];
    sel.innerHTML = '<option value="">Hub — all competitions</option>' + groups.map(g =>
      '<optgroup label="' + g[0] + '">' + INDEX.competitions.filter(g[1]).map(c =>
        '<option value="' + esc(c.slug) + '"' + (c.ok ? '' : ' disabled') + '>' + esc(c.name) + (c.ok ? '' : c.reason === 'no store yet' ? ' (soon)' : ' (unavailable)') + '</option>').join('') + '</optgroup>').join('');
    sel.addEventListener('change', () => {
      const c = INDEX.competitions.find(x => x.slug === sel.value);
      if (c) navigate(c.slug, (c.tabs || ['overview'])[0]); else navigate(null);
    });
    initSearch();
    document.getElementById('loading-overlay').style.display = 'none';
    window.addEventListener('hashchange', route);
    route();
  }).catch(err => {
    console.error(err);
    document.getElementById('loading-overlay').innerHTML =
      '<div class="error-banner" style="max-width:520px">Could not load the competition index: ' + esc(err.message) + '</div>';
  });
}

document.addEventListener('DOMContentLoaded', init);

return {
  INDEX, CACHE, STATE, DARK_LAYOUT, PLOTLY_CONF, C, PALETTE, TAB_LABELS, ROUND_LABELS, STAGE_LABELS, FAMILY_LABELS,
  CORE, NEEDS, FILES, FALLBACK,
  fetchJSON, pct, esc, num, signed, fmtNum, fmtMetric, fmtDate, fmtTime, fmtStamp, localDay, parseDate, slugify,
  D, comp, kind, cupKind, crest, teamHref, teamLink, playerLink, matchHref,
  makeSortable, tableHTML, setHTML, sortableIn, wireRowLinks, statTile, formChips, resultClass, riskClass,
  bandClass, bandColor, pctColor, pctPill, pctRow, probBar, statusChip, scoreText,
  parseHash, navigate, route, ensure, loadShard, loadSite, activateTab, openPage, updateMeta, tabLabel, showPane,
  RENDERERS: {}, PAGES: {}, PAGE_NEEDS: {}, GLOBAL_PAGES: {}
};
})();
