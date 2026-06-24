// Dashboard 前端 HTML（ADR-0009）。单页 + Chart.js CDN + 三个 API 调用。

export function dashboardPage(tokenHint?: string): string {
  const tokenParam = tokenHint || 'YOUR_TOKEN';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Moto Agent Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
:root { color-scheme: dark; --bg:#111827; --card:#1f2937; --text:#f3f4f6; --muted:#9ca3af; --accent:#f59e0b; --green:#10b981; --red:#ef4444; --blue:#3b82f6; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); min-height:100vh; padding: 16px; }
h1 { font-size:1.5rem; margin-bottom:20px; }
.grid { display:grid; gap:16px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:12px; margin-bottom:16px; }
.card { background:var(--card); border-radius:10px; padding:16px; }
.card .label { font-size:.75rem; color:var(--muted); }
.card .value { font-size:1.5rem; font-weight:700; margin-top:4px; }
.chart-box { background:var(--card); border-radius:10px; padding:16px; }
.chart-box canvas { max-height:320px; }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
select, button { padding:8px 14px; border-radius:8px; border:1px solid #374151; background:var(--card); color:var(--text); font-size:.85rem; cursor:pointer; }
button.active { background:var(--accent); color:#000; border-color:var(--accent); }
.reminders { background:var(--card); border-radius:10px; padding:16px; margin-top:16px; }
.reminders ul { list-style:none; margin-top:8px; }
.reminders li { padding:6px 0; border-bottom:1px solid #374151; font-size:.9rem; }
.loading { text-align:center; padding:48px; color:var(--muted); }
.error { color:var(--red); font-size:.85rem; }
.token-badge { font-size:.7rem; color:var(--muted); float:right; }
</style>
</head>
<body>
<h1>⛽ Moto Agent <span class="token-badge">🔑 ${tokenParam}</span></h1>
<div class="row">
  <select id="vehicle"><option value="">All Vehicles</option></select>
  <select id="lang"><option value="zh">中文</option><option value="en">English</option></select>
</div>
<div class="row">
  <button data-days="30">30d</button><button data-days="60">60d</button><button data-days="90" class="active">90d</button><button data-days="180">180d</button>
</div>
<div class="cards" id="cards"></div>
<div class="chart-box"><canvas id="chart"></canvas></div>
<div class="reminders" id="reminders"></div>
<div id="loading" class="loading">Loading...</div>
<div id="error" class="error"></div>

<script>
const TOKEN = '${tokenParam}';
const L = {
  zh: { avg:'平均油耗', totalKm:'总里程', totalCost:'总花费', totalLiters:'总油量', reminder:'活跃提醒', loading:'加载中...', noData:'暂无数据', consumption:'油耗', km:'km', liters:'升', yuan:'元', maintenance:'保养', insurance:'保险', all:'全部车辆' },
  en: { avg:'Avg Consumption', totalKm:'Total Distance', totalCost:'Total Cost', totalLiters:'Total Fuel', reminder:'Active Reminders', loading:'Loading...', noData:'No data', consumption:'L/100km', km:'km', liters:'L', yuan:'¥', maintenance:'Maintenance', insurance:'Insurance', all:'All Vehicles' }
};
function t(key) { return (L[langSelect.value] || L.zh)[key] || key; }
const langSelect = document.getElementById('lang');

let chart;
async function fetchApi(path) {
  const v = vehicle.value;
  const sep = path.includes('?') ? '&' : '?';
  const q = v ? (sep + 'vehicle=' + encodeURIComponent(v)) : '';
  const r = await fetch(path + '?token=' + TOKEN + q);
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()));
  return r.json();
}

async function load() {
  error.textContent = ''; loading.style.display = 'block';
  const days = document.querySelector('button.active').dataset.days || 90;
  try {
    const [vehiclesData, statsData, remindersData] = await Promise.all([
      fetch('/api/v1/vehicles?token=' + TOKEN).catch(() => ({ vehicles:[] })),
      fetchApi('/api/v1/stats?days=' + days),
      fetch('/api/v1/reminders?token=' + TOKEN).catch(() => ({ reminders:[] }))
    ]);

    // vehicle dropdown
    vehicle.innerHTML = '<option value="">'+t('all')+'</option>' + vehiclesData.vehicles.map(v => ('<option>'+v.name+(v.alias?' ('+v.alias+')':'')+'</option>')).join('');
    vehicle.value = new URLSearchParams(window.location.search).get('vehicle') || '';

    // cards
    cards.innerHTML = '';
    ['avg','totalKm','totalCost','totalLiters'].forEach(k => {
      const val = k==='avg' ? statsData.avg.toFixed(2)+' L/100km' : k==='totalKm' ? statsData.totalKm.toLocaleString()+' '+t('km') : k==='totalCost' ? '¥'+statsData.totalCost.toLocaleString() : statsData.totalLiters.toFixed(1)+' '+t('liters');
      cards.innerHTML += '<div class="card"><div class="label">'+t(k)+'</div><div class="value">'+val+'</div></div>';
    });

    // chart
    const ctx = document.getElementById('chart').getContext('2d');
    if (chart) chart.destroy();
    const data = statsData.records.filter(p => p.consumption != null);
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(p => p.date),
        datasets: [
          { label: t('consumption')+' (L/100km)', data: data.map(p => p.consumption), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
          { label: t('totalCost')+' ('+t('yuan')+')', data: data.map(p => p.cost), borderColor: '#10b981', backgroundColor: 'transparent', borderDash: [4,4], yAxisID: 'y1' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9ca3af', font: { size:11 } } } },
        scales: {
          x: { ticks: { color: '#6b7280', maxTicksLimit: 12 } },
          y:  { type: 'linear', position: 'left',  title: { display: true, text:'L/100km', color:'#f59e0b' }, ticks:{color:'#9ca3af'} },
          y1: { type: 'linear', position: 'right', title: { display: true, text:t('yuan'), color:'#10b981' }, grid:{drawOnChartArea:false}, ticks:{color:'#9ca3af'} },
        }
      }
    });

    // reminders
    reminders.innerHTML = '<div class="label">🔔 '+t('reminder')+' ('+remindersData.reminders.length+')</div>';
    reminders.innerHTML += remindersData.reminders.length ? '<ul>'+remindersData.reminders.map(r=>'<li>'+r.type+' · '+r.trigger+(r.vehicle?' ('+r.vehicle+')':'')+'</li>').join('')+'</ul>' : '<p style="color:var(--muted);margin-top:8px">'+t('noData')+'</p>';

    loading.style.display = 'none';
  } catch(e) {
    loading.style.display = 'none';
    error.textContent = e.message;
  }
}

vehicle.addEventListener('change', load);
langSelect.addEventListener('change', load);
document.querySelectorAll('button[data-days]').forEach(b => b.onclick = () => { document.querySelectorAll('button[data-days]').forEach(x => x.classList.remove('active')); b.classList.add('active'); load(); });
load();
</script>
</body>
</html>`;
}
