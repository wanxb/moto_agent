<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getLang, tr } from '../lib/i18n';
  import { apiJson } from '../lib/api';
  import { getMe } from '../lib/session';
  import Chart from 'chart.js/auto';

  type Vehicle = { name: string; alias: string | null };
  type StatsPoint = { date: string; liters: number; cost: number; consumption: number | null };
  type Stats = { records: StatsPoint[]; avg: number; totalKm: number; totalCost: number; totalLiters: number };
  type FuelItem = { date: string; odometer: number; liters: number; cost: number; fuel_type: string };
  type MaintItem = { date: string; type: string; odometer: number | null; cost: number | null; note: string | null };
  type RemItem = { type: string; mode: string; trigger: string; vehicle: string | null };
  type Paged<T> = { records: T[]; total: number; page: number; totalPages: number };
  type PagedRem = { reminders: RemItem[]; total: number; page: number; totalPages: number };

  const lang = getLang();
  const PAGE = 10;
  const DAYS = [30, 60, 90, 180];

  let vehicles = $state<Vehicle[]>([]);
  let currentVehicle = $state('');
  let days = $state(30);
  let stats = $state<Stats | null>(null);
  let fuel = $state<Paged<FuelItem> | null>(null);
  let maint = $state<Paged<MaintItem> | null>(null);
  let rem = $state<PagedRem | null>(null);
  let loading = $state(true);
  let error = $state('');
  let noVehicles = $state(false);
  let fromTg = $state(false);   // TG 推送进入 → 不显示返回按钮（隔离 PWA chat）

  let canvas = $state<HTMLCanvasElement | undefined>();
  let chart: Chart | null = null;

  function q(path: string, extra: Record<string, string | number> = {}): string {
    const u = new URLSearchParams();
    if (currentVehicle) u.set('vehicle', currentVehicle);
    for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
    const qs = u.toString();
    return qs ? `${path}?${qs}` : path;
  }

  onMount(async () => {
    fromTg = new URLSearchParams(location.search).get('from') === 'tg';
    const me = await getMe();
    if (!me) { location.href = '/login'; return; }
    try {
      const v = await apiJson<{ vehicles: Vehicle[] }>('/api/v1/vehicles');
      vehicles = v.vehicles ?? [];
      currentVehicle = vehicles[0]?.name ?? '';
    } catch { /* 车辆拉取失败按空处理 */ }
    if (!vehicles.length) { noVehicles = true; loading = false; return; }
    await load();
  });

  onDestroy(() => chart?.destroy());

  async function load() {
    loading = true; error = '';
    try {
      stats = await apiJson<Stats>(q('/api/v1/stats', { days }));
      fuel  = await apiJson<Paged<FuelItem>>(q('/api/v1/fuel-records', { days, page: 1, limit: PAGE }));
      maint = await apiJson<Paged<MaintItem>>(q('/api/v1/maintenance', { page: 1, limit: PAGE }));
      rem   = await apiJson<PagedRem>(q('/api/v1/reminders', { page: 1, limit: PAGE }));
    } catch {
      error = tr(lang, 'dash_load_failed');
    } finally {
      loading = false;
    }
  }

  function selectVehicle(name: string) { if (name !== currentVehicle) { currentVehicle = name; load(); } }
  function selectDays(d: number) { if (d !== days) { days = d; load(); } }

  async function pageFuel(p: number)  { fuel  = await apiJson<Paged<FuelItem>>(q('/api/v1/fuel-records', { days, page: p, limit: PAGE })); }
  async function pageMaint(p: number) { maint = await apiJson<Paged<MaintItem>>(q('/api/v1/maintenance', { page: p, limit: PAGE })); }
  async function pageRem(p: number)   { rem   = await apiJson<PagedRem>(q('/api/v1/reminders', { page: p, limit: PAGE })); }

  const yuan = (n: number) => '¥' + n.toLocaleString();

  // stats 变化 → 重绘图表（只画有油耗的点）。复刻原 dashboard：柱(油量+费用) + 线(油耗)。
  $effect(() => {
    const pts = stats?.records?.filter((p) => p.consumption != null) ?? [];
    if (chart) { chart.destroy(); chart = null; }
    if (!canvas || !pts.length) return;
    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: pts.map((p) => p.date),
        datasets: [
          { label: tr(lang, 'chart_volume'), data: pts.map((p) => p.liters), backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1, yAxisID: 'y', type: 'bar' },
          { label: tr(lang, 'chart_cost'), data: pts.map((p) => p.cost), backgroundColor: 'rgba(16,185,129,0.6)', borderColor: '#10b981', borderWidth: 1, yAxisID: 'y1', type: 'bar' },
          { label: tr(lang, 'chart_consumption'), data: pts.map((p) => p.consumption), borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3, yAxisID: 'y', type: 'line', pointRadius: 3, pointBackgroundColor: '#f59e0b' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
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
</script>

{#snippet pager(p: number, total: number, go: (n: number) => void)}
  {#if total > 1}
    <div class="pager">
      <button disabled={p <= 1} onclick={() => go(p - 1)}>‹</button>
      <span>{p} / {total}</span>
      <button disabled={p >= total} onclick={() => go(p + 1)}>›</button>
    </div>
  {/if}
{/snippet}

<div class="wrap">
  <header>
    {#if fromTg}
      <span class="spacer"></span>
    {:else}
      <button class="link" onclick={() => { location.href = '/chat'; }}>‹ {tr(lang, 'back')}</button>
    {/if}
    <h1>⛽ {tr(lang, 'dashboard')}</h1>
    <span class="spacer"></span>
  </header>

  {#if noVehicles}
    <p class="empty">{tr(lang, 'no_vehicles')}</p>
  {:else}
    {#if vehicles.length > 1}
      <nav class="tabs">
        {#each vehicles as v}
          <button class="tab" class:active={v.name === currentVehicle} onclick={() => selectVehicle(v.name)}>
            🏍 {v.name}{v.alias ? ` (${v.alias})` : ''}
          </button>
        {/each}
      </nav>
    {/if}

    <div class="btn-row">
      {#each DAYS as d}
        <button class:active={d === days} onclick={() => selectDays(d)}>{d}{tr(lang, 'days_unit')}</button>
      {/each}
    </div>

    {#if error}<p class="err">{error}</p>{/if}

    {#if stats}
      <div class="cards">
        <div class="card"><div class="label">{tr(lang, 'avg_consumption')}</div><div class="value">{(stats.avg || 0).toFixed(2)} <small>{tr(lang, 'l_per_100')}</small></div></div>
        <div class="card"><div class="label">{tr(lang, 'total_liters')}</div><div class="value">{(stats.totalLiters || 0).toFixed(1)} L</div></div>
        <div class="card"><div class="label">{tr(lang, 'total_cost')}</div><div class="value">{yuan(stats.totalCost || 0)}</div></div>
        <div class="card"><div class="label">{tr(lang, 'total_km')}</div><div class="value">{(stats.totalKm || 0).toLocaleString()} km</div></div>
      </div>
    {/if}

    <div class="chart-box"><canvas bind:this={canvas}></canvas></div>

    <!-- 加油记录 -->
    <section>
      <h2>{tr(lang, 'fuel_records')} {#if fuel?.total}<span class="count">({fuel.total})</span>{/if}</h2>
      {#if fuel && fuel.records.length}
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>{tr(lang, 'col_date')}</th><th>{tr(lang, 'col_grade')}</th><th>{tr(lang, 'col_price')}</th>
              <th>{tr(lang, 'col_liters')}</th><th>{tr(lang, 'col_cost')}</th><th>{tr(lang, 'col_odo')}</th>
            </tr></thead>
            <tbody>
              {#each fuel.records as r}
                <tr>
                  <td>{r.date}</td>
                  <td>{r.fuel_type ? r.fuel_type + '#' : '—'}</td>
                  <td>¥{(r.liters > 0 ? r.cost / r.liters : 0).toFixed(2)}</td>
                  <td>{r.liters.toFixed(2)}</td>
                  <td>{yuan(r.cost)}</td>
                  <td>{r.odometer.toLocaleString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {@render pager(fuel.page, fuel.totalPages, pageFuel)}
      {:else if !loading}
        <p class="empty">{tr(lang, 'no_fuel')}</p>
      {/if}
    </section>

    <!-- 维保记录 -->
    <section>
      <h2>{tr(lang, 'maint_records')} {#if maint?.total}<span class="count">({maint.total})</span>{/if}</h2>
      {#if maint && maint.records.length}
        <ul class="item-list">
          {#each maint.records as r}
            <li>
              <div class="icon">🔧</div>
              <div class="body">
                <div class="title">{r.type}</div>
                <div class="meta"><span>{r.date}</span>{#if r.odometer}<span>{r.odometer.toLocaleString()} km</span>{/if}{#if r.note}<span>{r.note}</span>{/if}</div>
              </div>
              {#if r.cost != null}<span class="cost">{yuan(r.cost)}</span>{/if}
            </li>
          {/each}
        </ul>
        {@render pager(maint.page, maint.totalPages, pageMaint)}
      {:else if !loading}
        <p class="empty">{tr(lang, 'no_maint')}</p>
      {/if}
    </section>

    <!-- 提醒事项 -->
    <section>
      <h2>{tr(lang, 'reminders_h')} {#if rem?.total}<span class="count">({rem.total})</span>{/if}</h2>
      {#if rem && rem.reminders.length}
        <ul class="item-list">
          {#each rem.reminders as r}
            <li>
              <div class="icon">{r.mode === 'mileage' ? '📏' : '📅'}</div>
              <div class="body">
                <div class="title">{r.type}</div>
                <div class="meta"><span>{r.trigger}</span>{#if r.vehicle}<span>{r.vehicle}</span>{/if}</div>
              </div>
            </li>
          {/each}
        </ul>
        {@render pager(rem.page, rem.totalPages, pageRem)}
      {:else if !loading}
        <p class="empty">{tr(lang, 'no_rem')}</p>
      {/if}
    </section>

    {#if loading}<p class="loading">{tr(lang, 'dash_loading')}</p>{/if}
  {/if}
</div>

<style>
  .wrap { max-width: 640px; margin: 0 auto; padding: 0 14px 40px; }
  header { display: flex; align-items: center; gap: 8px; padding: 12px 0; }
  header h1 { font-size: 1.1rem; flex: 1; text-align: center; }
  .spacer { width: 48px; }
  .link { background: none; border: none; color: var(--accent); font-size: 0.95rem; }
  .tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { flex: 0 0 auto; padding: 7px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--card); color: var(--muted); font-size: 0.85rem; }
  .tab.active { background: var(--accent); color: #000; border-color: var(--accent); }
  .btn-row { display: flex; gap: 8px; margin: 4px 0 14px; }
  .btn-row button { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--muted); font-size: 0.85rem; }
  .btn-row button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .card .label { color: var(--muted); font-size: 0.72rem; margin-bottom: 4px; }
  .card .value { font-size: 1.15rem; font-weight: 600; white-space: nowrap; }
  .card .value small { font-size: 0.6rem; color: var(--muted); }
  .chart-box { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 14px; }
  .chart-box canvas { max-height: 260px; }
  section { margin-bottom: 18px; }
  h2 { font-size: 0.95rem; margin-bottom: 8px; }
  .count { color: var(--muted); font-size: 0.8rem; font-weight: 400; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th, td { padding: 8px 10px; text-align: left; white-space: nowrap; }
  thead th { color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); }
  tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border); }
  .item-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .item-list li { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
  .item-list .icon { font-size: 1.2rem; }
  .item-list .body { flex: 1; min-width: 0; }
  .item-list .title { font-size: 0.92rem; }
  .item-list .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 0.78rem; margin-top: 2px; }
  .item-list .cost { color: var(--green); font-size: 0.9rem; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 10px; color: var(--muted); font-size: 0.85rem; }
  .pager button { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .pager button:disabled { opacity: 0.4; }
  .empty, .loading { color: var(--muted); text-align: center; padding: 20px; }
  .err { color: var(--red); text-align: center; }
</style>
