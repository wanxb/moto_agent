// Dashboard 前端（ADR-0009 v4） — 移动端优先 + 车辆 Tab + 分类列表 + 分页。
// Token 由服务端注入 JS，URL 无需携带。Chart.js 动态加载以防 CDN 被墙阻塞页面。

export function dashboardPage(tokenHint?: string): string {
  const tokenParam = tokenHint || '';
  const favicon = 'data:image/png;base64,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';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<link rel="icon" type="image/png" href="${favicon}">
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
.load-more {
  display: block;
  width: 100%;
  padding: 12px;
  margin-top: 8px;
  border-radius: 10px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--muted);
  font-size: .82rem;
  cursor: pointer;
  min-height: 44px;
  transition: background .15s;
}
.load-more:hover, .load-more:active { background: var(--card); color: var(--text); }
.load-more:disabled { opacity: .4; cursor: default; }

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
  <button data-days="30" class="active">30天</button>
  <button data-days="60">60天</button>
  <button data-days="90">90天</button>
  <button data-days="180">180天</button>
</div>

<div class="cards" id="cards"></div>
<div class="chart-box"><canvas id="chart"></canvas></div>

<section class="list-section">
  <h2>⛽ 加油记录 <span class="count" id="fuel-count"></span></h2>
  <div class="table-wrap"><table class="fuel-table"><thead><tr><th>日期</th><th>油号</th><th>单价</th><th>加油量</th><th>金额</th><th>里程</th></tr></thead><tbody id="fuel-body"></tbody></table></div>
  <div class="empty" id="fuel-empty" style="display:none">暂无加油记录</div>
  <button class="load-more" id="fuel-more" style="display:none">加载更多</button>
</section>

<section class="list-section">
  <h2>🔧 维保记录 <span class="count" id="maint-count"></span></h2>
  <ul class="item-list" id="maint-body"></ul>
  <div class="empty" id="maint-empty" style="display:none">暂无维保记录</div>
  <button class="load-more" id="maint-more" style="display:none">加载更多</button>
</section>

<section class="list-section">
  <h2>🔔 提醒事项 <span class="count" id="reminder-count"></span></h2>
  <ul class="item-list" id="reminder-body"></ul>
  <div class="empty" id="reminder-empty" style="display:none">暂无提醒事项</div>
  <button class="load-more" id="reminder-more" style="display:none">加载更多</button>
</section>

<div id="loading" class="loading">加载中...</div>
<div id="error" class="error"></div>

<script>
var TOKEN = '${tokenParam}';
var PAGE_SIZE = 15;
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
    // CDN 不可用时静默跳过，列表数据仍可用
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
          { label: '加油量 (L)', data: recs.map(function(p) { return p.liters; }), backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1, yAxisID: 'y', type: 'bar' },
          { label: '费用 (¥)', data: recs.map(function(p) { return p.cost; }), backgroundColor: 'rgba(16,185,129,0.6)', borderColor: '#10b981', borderWidth: 1, yAxisID: 'y1', type: 'bar' },
          { label: '油耗 (L/100km)', data: recs.map(function(p) { return p.consumption; }), borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3, yAxisID: 'y', type: 'line', pointRadius: 3, pointBackgroundColor: '#f59e0b' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12, padding: 12 } } },
        scales: {
          x: { ticks: { color: '#6b7280', maxTicksLimit: 8, font: { size: 10 } } },
          y:  { type: 'linear', position: 'left',  title: { display: true, text: 'L / L/100km', color: '#9ca3af' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
          y1: { type: 'linear', position: 'right', title: { display: true, text: '¥', color: '#10b981' }, grid: { drawOnChartArea: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        },
      },
    });
  });
}

// ── 每个列表的分页渲染 ──
function renderFuelPage(data) {
  var recs = safeRecords(data);
  fuelTotalPages = data.totalPages || 1;
  fuelPage = data.page || 1;
  var body = document.getElementById('fuel-body');
  var count = document.getElementById('fuel-count');
  var empty = document.getElementById('fuel-empty');
  var more = document.getElementById('fuel-more');
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
  more.style.display = fuelPage < fuelTotalPages ? '' : 'none';
}

function renderMaintPage(data) {
  var recs = safeRecords(data);
  maintTotalPages = data.totalPages || 1;
  maintPage = data.page || 1;
  var body = document.getElementById('maint-body');
  var count = document.getElementById('maint-count');
  var empty = document.getElementById('maint-empty');
  var more = document.getElementById('maint-more');
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
  more.style.display = maintPage < maintTotalPages ? '' : 'none';
}

function renderRemPage(data) {
  var rems = safeArr(data.reminders);
  remTotalPages = data.totalPages || 1;
  remPage = data.page || 1;
  var body = document.getElementById('reminder-body');
  var count = document.getElementById('reminder-count');
  var empty = document.getElementById('reminder-empty');
  var more = document.getElementById('reminder-more');
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
  more.style.display = remPage < remTotalPages ? '' : 'none';
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
      document.getElementById('cards').innerHTML = '<div class="empty">暂无车辆，请先在 Bot 中添加车辆</div>';
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
      { label: '平均油耗', value: '<span style="white-space:nowrap">' + (statsData.avg || 0).toFixed(2) + ' <small style="font-size:.65rem">L/100km</small></span>' },
      { label: '总油量',   value: (statsData.totalLiters || 0).toFixed(1) + ' L' },
      { label: '总费用',   value: '¥' + (statsData.totalCost || 0).toLocaleString() },
      { label: '总里程',   value: (statsData.totalKm || 0).toLocaleString() + ' km' },
    ];
    cardsEl.innerHTML = rows.map(function(r) { return '<div class="card"><div class="label">' + r.label + '</div><div class="value">' + r.value + '</div></div>'; }).join('');

    // 图表 — 动态加载，不阻塞列表渲染
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

// ── 加载更多 ──
async function loadMoreFuel() {
  var activeBtn = document.querySelector('button[data-days].active');
  var days = (activeBtn && activeBtn.dataset && activeBtn.dataset.days) ? activeBtn.dataset.days : 90;
  var nextPage = fuelPage + 1;
  var btn = document.getElementById('fuel-more');
  btn.disabled = true; btn.textContent = '加载中...';
  try {
    var data = await fetchApi('/api/v1/fuel-records?days=' + days + '&page=' + nextPage + '&limit=' + PAGE_SIZE);
    var recs = safeRecords(data);
    document.getElementById('fuel-body').insertAdjacentHTML('beforeend', recs.map(renderFuelRow).join(''));
    fuelPage = data.page || nextPage;
    fuelTotalPages = data.totalPages || fuelTotalPages;
    document.getElementById('fuel-more').style.display = fuelPage < fuelTotalPages ? '' : 'none';
  } catch (e) { document.getElementById('error').textContent = '加载失败: ' + e.message; }
  btn.disabled = false; btn.textContent = '加载更多';
}

async function loadMoreMaint() {
  var nextPage = maintPage + 1;
  var btn = document.getElementById('maint-more');
  btn.disabled = true; btn.textContent = '加载中...';
  try {
    var data = await fetchApi('/api/v1/maintenance?page=' + nextPage + '&limit=' + PAGE_SIZE);
    var recs = safeRecords(data);
    document.getElementById('maint-body').insertAdjacentHTML('beforeend', recs.map(renderMaintRow).join(''));
    maintPage = data.page || nextPage;
    maintTotalPages = data.totalPages || maintTotalPages;
    document.getElementById('maint-more').style.display = maintPage < maintTotalPages ? '' : 'none';
  } catch (e) { document.getElementById('error').textContent = '加载失败: ' + e.message; }
  btn.disabled = false; btn.textContent = '加载更多';
}

async function loadMoreRem() {
  var nextPage = remPage + 1;
  var btn = document.getElementById('reminder-more');
  btn.disabled = true; btn.textContent = '加载中...';
  try {
    var data = await fetchApi('/api/v1/reminders?page=' + nextPage + '&limit=' + PAGE_SIZE);
    var rems = safeArr(data.reminders);
    document.getElementById('reminder-body').insertAdjacentHTML('beforeend', rems.map(renderRemRow).join(''));
    remPage = data.page || nextPage;
    remTotalPages = data.totalPages || remTotalPages;
    document.getElementById('reminder-more').style.display = remPage < remTotalPages ? '' : 'none';
  } catch (e) { document.getElementById('error').textContent = '加载失败: ' + e.message; }
  btn.disabled = false; btn.textContent = '加载更多';
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

document.getElementById('fuel-more').addEventListener('click', loadMoreFuel);
document.getElementById('maint-more').addEventListener('click', loadMoreMaint);
document.getElementById('reminder-more').addEventListener('click', loadMoreRem);

load();
</script>
</body>
</html>`;
}
