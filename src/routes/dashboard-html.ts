// Dashboard 前端（ADR-0009 v5） — 移动端优先 + 车辆 Tab + 分类列表 + 分页 + 双语。
// Token 由服务端注入 JS，URL 无需携带。Chart.js 动态加载以防 CDN 被墙阻塞页面。

export function dashboardPage(tokenHint?: string, lang?: string): string {
  const tokenParam = tokenHint || '';
  // 使用 emoji SVG favicon (URL 编码)，比 base64 PNG 更短更可靠
  const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🏍%3C/text%3E%3C/svg%3E";
  return `<!DOCTYPE html>
<html lang="${lang || 'zh'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<link rel="icon" type="image/svg+xml" href="${favicon}">
<title>Moto Agent Dashboard</title>
<style>
:root {
  color-scheme: dark;
  --bg: #111827;
  --card: #1f2937;
  --text: #f3f4f6;
  --muted: #9ca3af;
  --accent: #f59e0b;
  --green: #10b981;
  --red: #ef4444;
  --blue: #3b82f6;
  --border: #374151;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  padding: 12px;
  -webkit-text-size-adjust: 100%;
}

/* ── 页头 ── */
h1 { font-size: 1.25rem; margin-bottom: 12px; }

/* ── 车辆 Tab 栏 ── */
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-bottom: 4px;
  margin-bottom: 12px;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  flex: 0 0 auto;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--muted);
  font-size: .9rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background .15s, color .15s;
}
.tab.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }

/* ── 时间范围按钮 ── */
.btn-row { display: flex; gap: 6px; margin-bottom: 12px; }
.btn-row button {
  flex: 1;
  padding: 10px 0;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-size: .82rem;
  cursor: pointer;
  min-height: 40px;
  transition: background .15s;
}
.btn-row button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }

/* ── 汇总卡片 ── */
.cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
.card {
  background: var(--card);
  border-radius: 10px;
  padding: 14px;
}
.card .label { font-size: .72rem; color: var(--muted); margin-bottom: 2px; }
.card .value { font-size: 1.15rem; font-weight: 700; }

/* ── 图表 ── */
.chart-box { background: var(--card); border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.chart-box canvas { max-height: 260px; }

/* ── 分类列表 ── */
.list-section { margin-bottom: 14px; }
.list-section h2 {
  font-size: .95rem;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.list-section h2 .count { font-size: .75rem; color: var(--muted); font-weight: 400; }

/* 加油记录表格 */
.fuel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .8rem;
}
.fuel-table th {
  text-align: left;
  padding: 8px 6px;
  color: var(--muted);
  font-weight: 500;
  font-size: .7rem;
  text-transform: uppercase;
  letter-spacing: .5px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.fuel-table td {
  padding: 10px 6px;
  border-bottom: 1px solid var(--border);
  min-height: 40px;
}
.fuel-table tbody tr:active { background: rgba(255,255,255,.03); }
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; background: var(--card); padding: 4px 8px; }

/* 维保 & 提醒列表 */
.item-list { list-style: none; }
.item-list li {
  background: var(--card);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
}
.item-list li .icon {
  width: 36px; height: 36px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}
.icon-maint { background: rgba(59,130,246,.15); }
.icon-remind-mileage { background: rgba(245,158,11,.15); }
.icon-remind-date { background: rgba(239,68,68,.15); }
.item-list li .body { flex: 1; min-width: 0; }
.item-list li .title { font-size: .85rem; font-weight: 500; }
.item-list li .meta { font-size: .72rem; color: var(--muted); margin-top: 2px; display: flex; gap: 10px; flex-wrap: wrap; }
.item-list li .cost { font-weight: 600; color: var(--green); white-space: nowrap; }

/* ── 加载更多 ── */
/* ── 分页条 ── */
.page-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.page-bar button {
  min-width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-size: .8rem;
  cursor: pointer;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s;
}
.page-bar button:active { background: rgba(255,255,255,.1); }
.page-bar button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
.page-bar button:disabled { opacity: .3; cursor: default; }
.page-bar .info { color: var(--muted); font-size: .75rem; padding: 0 6px; }

/* ── 工具 ── */
.empty { text-align: center; padding: 24px; color: var(--muted); font-size: .82rem; }
.loading { text-align: center; padding: 36px; color: var(--muted); }
.error { color: var(--red); font-size: .8rem; margin: 8px 0; }

/* ── 略大屏稍宽 ── */
@media (min-width: 600px) {
  body { max-width: 640px; margin: 0 auto; padding: 20px; }
  .cards { grid-template-columns: repeat(4, 1fr); }
  .btn-row button { flex: 0 0 auto; padding: 10px 20px; }
  .btn-row { justify-content: flex-start; }
}
</style>
</head>
<body>
<h1>⛽ Moto Agent</h1>

<nav class="tabs" id="tabs"></nav>

<div class="btn-row">
  <button data-days="30" class="active"></button>
  <button data-days="60"></button>
  <button data-days="90"></button>
  <button data-days="180"></button>
</div>

<div class="cards" id="cards"></div>
<div class="chart-box"><canvas id="chart"></canvas></div>

<section class="list-section">
  <h2 id="fuel-h"></h2>
  <div class="table-wrap"><table class="fuel-table"><thead><tr id="fuel-th"></tr></thead><tbody id="fuel-body"></tbody></table></div>
  <div class="empty" id="fuel-empty" style="display:none"></div>
  <div class="page-bar" id="fuel-page" style="display:none"></div>
</section>

<section class="list-section">
  <h2 id="maint-h"></h2>
  <ul class="item-list" id="maint-body"></ul>
  <div class="empty" id="maint-empty" style="display:none"></div>
  <div class="page-bar" id="maint-page" style="display:none"></div>
</section>

<section class="list-section">
  <h2 id="reminder-h"></h2>
  <ul class="item-list" id="reminder-body"></ul>
  <div class="empty" id="reminder-empty" style="display:none"></div>
  <div class="page-bar" id="reminder-page" style="display:none"></div>
</section>

<div id="loading" class="loading"></div>
<div id="error" class="error"></div>

<script>
// ── i18n ──
var I18N = {
  zh: {
    days: '天', fuelH: '⛽ 加油记录', maintH: '🔧 维保记录', reminderH: '🔔 提醒事项',
    dateCol: '日期', fuelCol: '油号', unitPriceCol: '单价', litersCol: '加油量', costCol: '金额', odoCol: '里程',
    noFuel: '暂无加油记录', noMaint: '暂无维保记录', noRem: '暂无提醒事项',
    loadMore: '加载更多', loading: '加载中...', loadFailed: '加载失败: ',
    noVehicles: '暂无车辆，请先在 Bot 中添加车辆',
    avgConsumption: '平均油耗', totalLiters: '总油量', totalCost: '总费用', totalKm: '总里程',
    fuelVolume: '加油量 (L)', fuelCost: '费用 (¥)', fuelConsumption: '油耗 (L/100km)', lPer100km: 'L/100km'
  },
  en: {
    days: 'd', fuelH: '⛽ Fuel Records', maintH: '🔧 Maintenance', reminderH: '🔔 Reminders',
    dateCol: 'Date', fuelCol: 'Grade', unitPriceCol: 'Price/L', litersCol: 'Liters', costCol: 'Cost', odoCol: 'Odo',
    noFuel: 'No fuel records', noMaint: 'No maintenance records', noRem: 'No reminders',
    loadMore: 'Load More', loading: 'Loading...', loadFailed: 'Load failed: ',
    noVehicles: 'No vehicles. Add one in the Bot first.',
    avgConsumption: 'Avg Fuel', totalLiters: 'Total Vol', totalCost: 'Total Cost', totalKm: 'Total Odo',
    fuelVolume: 'Volume (L)', fuelCost: 'Cost (¥)', fuelConsumption: 'Consumption (L/100km)', lPer100km: 'L/100km'
  }
};

// 语言检测: URL ?lang=xx > 浏览器 navigator.language > zh
var LANG = 'zh';
var qp = new URLSearchParams(location.search);
if (qp.get('lang') === 'en') LANG = 'en';
else if (!qp.get('lang') && navigator.language && !navigator.language.startsWith('zh')) LANG = 'en';
document.documentElement.lang = LANG === 'en' ? 'en' : 'zh';
var L = I18N[LANG];

function t(key) { return L[key] || key; }

// ── 初始化静态文案 ──
document.querySelectorAll('button[data-days]').forEach(function(b) {
  b.textContent = b.dataset.days + t('days');
});
document.getElementById('fuel-h').innerHTML = t('fuelH') + ' <span class="count" id="fuel-count"></span>';
document.getElementById('maint-h').innerHTML = t('maintH') + ' <span class="count" id="maint-count"></span>';
document.getElementById('reminder-h').innerHTML = t('reminderH') + ' <span class="count" id="reminder-count"></span>';
document.getElementById('fuel-th').innerHTML = [
  t('dateCol'), t('fuelCol'), t('unitPriceCol'), t('litersCol'), t('costCol'), t('odoCol')
].map(function(c) { return '<th>' + c + '</th>'; }).join('');
document.getElementById('fuel-empty').textContent = t('noFuel');
document.getElementById('maint-empty').textContent = t('noMaint');
document.getElementById('reminder-empty').textContent = t('noRem');
document.getElementById('loading').textContent = t('loading') + '...';

var TOKEN = '${tokenParam}';
var PAGE_SIZE = 10;
var currentVehicle = '';

// ── 分页状态 ──
var fuelPage = 1, fuelTotalPages = 1;
var maintPage = 1, maintTotalPages = 1;
var remPage = 1, remTotalPages = 1;

// ── fetch ──
async function fetchApi(path) {
  var sep = path.includes('?') ? '&' : '?';
  var v = currentVehicle ? ('&vehicle=' + encodeURIComponent(currentVehicle)) : '';
  var r = await fetch(path + sep + 'token=' + TOKEN + v);
  if (!r.ok) {
    var txt = await r.text();
    document.getElementById('error').textContent = path + ': ' + r.status + ' ' + txt;
    throw new Error(txt);
  }
  return r.json();
}

function safeArr(x) { return Array.isArray(x) ? x : []; }
function safeRecords(x) { return (x && Array.isArray(x.records)) ? x.records : []; }

// ── 渲染函数 ──
function renderFuelRow(r) {
  var unitPrice = (r.liters > 0 ? r.cost / r.liters : 0).toFixed(2);
  var fuelLabel = r.fuel_type ? r.fuel_type + '#' : '—';
  return '<tr>' +
    '<td>' + r.date + '</td>' +
    '<td>' + fuelLabel + '</td>' +
    '<td>¥' + unitPrice + '/L</td>' +
    '<td>' + r.liters.toFixed(2) + '</td>' +
    '<td>¥' + r.cost.toLocaleString() + '</td>' +
    '<td>' + r.odometer.toLocaleString() + '</td>' +
    '</tr>';
}

function renderMaintRow(r) {
  var costStr = r.cost != null ? '<span class="cost">¥' + r.cost.toLocaleString() + '</span>' : '';
  var odoStr = r.odometer ? r.odometer.toLocaleString() + ' km' : '';
  return '<li>' +
    '<div class="icon icon-maint">🔧</div>' +
    '<div class="body"><div class="title">' + r.type + '</div>' +
    '<div class="meta"><span>' + r.date + '</span>' + (odoStr ? '<span>' + odoStr + '</span>' : '') + (r.note ? '<span>' + r.note + '</span>' : '') + '</div></div>' +
    costStr +
    '</li>';
}

function renderRemRow(r) {
  var isMileage = r.mode === 'mileage';
  var iconCls = isMileage ? 'icon-remind-mileage' : 'icon-remind-date';
  var iconEmoji = isMileage ? '📏' : '📅';
  return '<li>' +
    '<div class="icon ' + iconCls + '">' + iconEmoji + '</div>' +
    '<div class="body"><div class="title">' + r.type + '</div>' +
    '<div class="meta"><span>' + r.trigger + '</span>' + (r.vehicle ? '<span>' + r.vehicle + '</span>' : '') + '</div></div>' +
    '</li>';
}

// ── 图表：动态加载 Chart.js，不阻塞页面渲染 ──
function loadChartJS(cb) {
  if (typeof Chart !== 'undefined') return cb();
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.onload = cb;
  s.onerror = function() {
    document.getElementById('chart').style.display = 'none';
  };
  document.head.appendChild(s);
}

function drawChart(ctx, recs) {
  loadChartJS(function() {
    var canvas = document.getElementById('chart');
    if (typeof Chart === 'undefined') { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';
    if (window._motoChart) window._motoChart.destroy();
    window._motoChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: recs.map(function(p) { return p.date; }),
        datasets: [
          { label: t('fuelVolume'), data: recs.map(function(p) { return p.liters; }), backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1, yAxisID: 'y', type: 'bar', pointStyle: 'rectRounded' },
          { label: t('fuelCost'), data: recs.map(function(p) { return p.cost; }), backgroundColor: 'rgba(16,185,129,0.6)', borderColor: '#10b981', borderWidth: 1, yAxisID: 'y1', type: 'bar', pointStyle: 'rectRounded' },
          { label: t('fuelConsumption'), data: recs.map(function(p) { return p.consumption; }), borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3, yAxisID: 'y', type: 'line', pointRadius: 3, pointBackgroundColor: '#f59e0b', pointBorderColor: '#f59e0b', pointBorderWidth: 2, pointStyle: 'line' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12, padding: 12, usePointStyle: true } } },
        scales: {
          x: { ticks: { color: '#6b7280', maxTicksLimit: 8, font: { size: 10 } } },
          y:  { type: 'linear', position: 'left',  title: { display: true, text: 'L', color: '#9ca3af' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
          y1: { type: 'linear', position: 'right', title: { display: true, text: '¥', color: '#10b981' }, grid: { drawOnChartArea: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        },
      },
    });
  });
}

// ── 分页条渲染 ──
function renderPageBar(containerId, currentPage, totalPages, section) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  var html = '';
  html += '<button class="page-prev" data-section="' + section + '" ' + (currentPage <= 1 ? 'disabled' : '') + '>‹</button>';
  var start = Math.max(1, currentPage - 2);
  var end = Math.min(totalPages, currentPage + 2);
  if (start > 1) html += '<button class="page-num" data-section="' + section + '" data-page="1">1</button>';
  if (start > 2) html += '<span class="info">…</span>';
  for (var p = start; p <= end; p++) {
    html += '<button class="page-num' + (p === currentPage ? ' active' : '') + '" data-section="' + section + '" data-page="' + p + '">' + p + '</button>';
  }
  if (end < totalPages - 1) html += '<span class="info">…</span>';
  if (end < totalPages) html += '<button class="page-num" data-section="' + section + '" data-page="' + totalPages + '">' + totalPages + '</button>';
  html += '<button class="page-next" data-section="' + section + '" ' + (currentPage >= totalPages ? 'disabled' : '') + '>›</button>';
  el.innerHTML = html;
}

// ── 每个列表的分页渲染 ──
function renderFuelPage(data) {
  var recs = safeRecords(data);
  fuelTotalPages = data.totalPages || 1;
  fuelPage = data.page || 1;
  var body = document.getElementById('fuel-body');
  var count = document.getElementById('fuel-count');
  var empty = document.getElementById('fuel-empty');
  if (recs.length) {
    count.textContent = '(' + (data.total || recs.length) + ')';
    empty.style.display = 'none';
    body.closest('.table-wrap').style.display = '';
    body.innerHTML = recs.map(renderFuelRow).join('');
  } else {
    count.textContent = fuelPage > 1 ? '' : '';
    empty.style.display = fuelPage > 1 ? 'none' : '';
    if (fuelPage === 1) body.closest('.table-wrap').style.display = 'none';
  }
  renderPageBar('fuel-page', fuelPage, fuelTotalPages, 'fuel');
}

function renderMaintPage(data) {
  var recs = safeRecords(data);
  maintTotalPages = data.totalPages || 1;
  maintPage = data.page || 1;
  var body = document.getElementById('maint-body');
  var count = document.getElementById('maint-count');
  var empty = document.getElementById('maint-empty');
  if (recs.length) {
    count.textContent = '(' + (data.total || recs.length) + ')';
    empty.style.display = 'none';
    body.style.display = '';
    body.innerHTML = recs.map(renderMaintRow).join('');
  } else {
    count.textContent = maintPage > 1 ? '' : '';
    empty.style.display = maintPage > 1 ? 'none' : '';
    if (maintPage === 1) body.style.display = 'none';
  }
  renderPageBar('maint-page', maintPage, maintTotalPages, 'maint');
}

function renderRemPage(data) {
  var rems = safeArr(data.reminders);
  remTotalPages = data.totalPages || 1;
  remPage = data.page || 1;
  var body = document.getElementById('reminder-body');
  var count = document.getElementById('reminder-count');
  var empty = document.getElementById('reminder-empty');
  if (rems.length) {
    count.textContent = '(' + (data.total || rems.length) + ')';
    empty.style.display = 'none';
    body.style.display = '';
    body.innerHTML = rems.map(renderRemRow).join('');
  } else {
    count.textContent = remPage > 1 ? '' : '';
    empty.style.display = remPage > 1 ? 'none' : '';
    if (remPage === 1) body.style.display = 'none';
  }
  renderPageBar('reminder-page', remPage, remTotalPages, 'reminder');
}

// ── 主加载 ──
async function load() {
  document.getElementById('error').textContent = '';
  document.getElementById('loading').style.display = 'block';

  var activeBtn = document.querySelector('button[data-days].active');
  var days = (activeBtn && activeBtn.dataset && activeBtn.dataset.days) ? activeBtn.dataset.days : 90;

  try {
    var vehData = await fetch('/api/v1/vehicles?token=' + TOKEN).then(function(r) { return r.json(); }).catch(function() { return { vehicles: [] }; });
    var vehs = safeArr(vehData.vehicles);
    var tabsEl = document.getElementById('tabs');
    tabsEl.innerHTML = vehs.map(function(v, i) {
      var label = '🏍 ' + v.name + (v.alias ? ' (' + v.alias + ')' : '');
      return '<button class="tab' + (i === 0 && !currentVehicle ? ' active' : '') + '" data-vehicle="' + v.name + '">' + label + '</button>';
    }).join('');

    if (!currentVehicle && vehs.length) currentVehicle = vehs[0].name;
    tabsEl.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.vehicle === currentVehicle);
    });

    if (!currentVehicle) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('cards').innerHTML = '<div class="empty">' + t('noVehicles') + '</div>';
      return;
    }

    var statsData = await fetchApi('/api/v1/stats?days=' + days);
    resetPages();
    var fuelData = await fetchApi('/api/v1/fuel-records?days=' + days + '&page=1&limit=' + PAGE_SIZE);
    var maintData = await fetchApi('/api/v1/maintenance?page=1&limit=' + PAGE_SIZE);
    var remData = await fetchApi('/api/v1/reminders?page=1&limit=' + PAGE_SIZE);

    // 汇总卡片
    var cardsEl = document.getElementById('cards');
    var rows = [
      { label: t('avgConsumption'), value: '<span style="white-space:nowrap">' + (statsData.avg || 0).toFixed(2) + ' <small style="font-size:.65rem">' + t('lPer100km') + '</small></span>' },
      { label: t('totalLiters'),   value: (statsData.totalLiters || 0).toFixed(1) + ' L' },
      { label: t('totalCost'),     value: '¥' + (statsData.totalCost || 0).toLocaleString() },
      { label: t('totalKm'),       value: (statsData.totalKm || 0).toLocaleString() + ' km' },
    ];
    cardsEl.innerHTML = rows.map(function(r) { return '<div class="card"><div class="label">' + r.label + '</div><div class="value">' + r.value + '</div></div>'; }).join('');

    // 图表
    var canvas = document.getElementById('chart');
    var ctx = canvas.getContext('2d');
    if (window._motoChart) window._motoChart.destroy();
    var recs = safeRecords(statsData).filter(function(p) { return p && p.consumption != null; });
    if (!recs.length) {
      canvas.style.display = 'none';
    } else {
      canvas.style.display = 'block';
      drawChart(ctx, recs);
    }

    renderFuelPage(fuelData);
    renderMaintPage(maintData);
    renderRemPage(remData);

    document.getElementById('loading').style.display = 'none';
  } catch (e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').textContent = e.message;
  }
}

function resetPages() {
  fuelPage = 1; fuelTotalPages = 1;
  maintPage = 1; maintTotalPages = 1;
  remPage = 1; remTotalPages = 1;
}

// ── 分页导航 ──
async function goToPage(section, page) {
  var daysEl = document.querySelector('button[data-days].active');
  var days = (daysEl && daysEl.dataset && daysEl.dataset.days) ? daysEl.dataset.days : 90;
  document.getElementById('error').textContent = '';
  try {
    if (section === 'fuel') {
      var data = await fetchApi('/api/v1/fuel-records?days=' + days + '&page=' + page + '&limit=' + PAGE_SIZE);
      renderFuelPage(data);
    } else if (section === 'maint') {
      var data = await fetchApi('/api/v1/maintenance?page=' + page + '&limit=' + PAGE_SIZE);
      renderMaintPage(data);
    } else if (section === 'reminder') {
      var data = await fetchApi('/api/v1/reminders?page=' + page + '&limit=' + PAGE_SIZE);
      renderRemPage(data);
    }
  } catch (e) { document.getElementById('error').textContent = t('loadFailed') + e.message; }
}

// ── 事件绑定 ──
document.getElementById('tabs').addEventListener('click', function(e) {
  var tab = e.target.closest('.tab');
  if (!tab) return;
  currentVehicle = tab.dataset.vehicle;
  load();
});

document.querySelectorAll('button[data-days]').forEach(function(b) {
  b.onclick = function() {
    document.querySelectorAll('button[data-days]').forEach(function(x) { x.classList.remove('active'); });
    b.classList.add('active');
    load();
  };
});

// ── 分页按钮事件（委托） ──
document.body.addEventListener('click', function(e) {
  var target = e.target;
  var section = target.getAttribute && target.getAttribute('data-section');
  if (!section) return;
  if (target.classList.contains('page-num')) {
    goToPage(section, parseInt(target.getAttribute('data-page')));
  } else if (target.classList.contains('page-prev')) {
    var cur = section === 'fuel' ? fuelPage : section === 'maint' ? maintPage : remPage;
    if (cur > 1) goToPage(section, cur - 1);
  } else if (target.classList.contains('page-next')) {
    var cur = section === 'fuel' ? fuelPage : section === 'maint' ? maintPage : remPage;
    var total = section === 'fuel' ? fuelTotalPages : section === 'maint' ? maintTotalPages : remTotalPages;
    if (cur < total) goToPage(section, cur + 1);
  }
});

load();
</script>
</body>
</html>`;
}
