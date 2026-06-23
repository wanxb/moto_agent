/**
 * 历史加油数据导入脚本（直接写 D1，不依赖 wrangler dev）
 * 使用方式：npx tsx scripts/seed-fuel.ts
 */

import { execSync } from 'child_process';

const RECORDS = [
  { date: '2026-05-26', liters: 4.72, price: 41.25, odometer: 33735, fuelType: '92' },
  { date: '2026-06-01', liters: 4.35, price: 38.01, odometer: 33941, fuelType: '92' },
  { date: '2026-06-05', liters: 4.37, price: 36.35, odometer: 34169, fuelType: '92' },
  { date: '2026-06-11', liters: 4.35, price: 36.19, odometer: 34330, fuelType: '92' },
  { date: '2026-06-17', liters: 4.16, price: 34.61, odometer: 34543, fuelType: '92' },
] as const;

function insertSQL(r: typeof RECORDS[number]): string {
  return `INSERT INTO fuel_records (date, odometer, liters, price_total, fuel_type) VALUES ('${r.date}', ${r.odometer}, ${r.liters}, ${r.price}, '${r.fuelType}');`;
}

function run(sql: string, remote: boolean): void {
  const flag = remote ? '--remote' : '--local';
  execSync(`npx wrangler d1 execute moto-agent-db ${flag} --command "${sql}"`, {
    stdio: 'pipe',
    cwd: process.cwd(),
  });
}

async function main() {
  const remote = !process.argv.includes('--local');
  console.log(`写入目标：${remote ? '线上 D1（--remote）' : '本地 D1（--local）'}`);
  console.log(`共 ${RECORDS.length} 条记录...\n`);

  for (const record of RECORDS) {
    const sql = insertSQL(record);
    process.stdout.write(`→ ${record.date}  ${record.odometer}km  ${record.liters}L  ¥${record.price}  `);
    try {
      run(sql, remote);
      console.log('✅');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ ${msg.split('\n')[0]}`);
    }
  }

  // 验证写入结果
  console.log('\n── 写入结果验证 ──');
  try {
    const flag = remote ? '--remote' : '--local';
    const out = execSync(
      `npx wrangler d1 execute moto-agent-db ${flag} --command "SELECT date, odometer, liters, price_total FROM fuel_records ORDER BY odometer ASC" --json`,
      { cwd: process.cwd() }
    ).toString();
    const rows = (JSON.parse(out) as { results: unknown[] }[])[0]?.results ?? [];
    console.log(`共 ${rows.length} 条记录：`);
    (rows as { date: string; odometer: number; liters: number; price_total: number }[]).forEach(r => {
      const consumption = r.liters > 0 ? '' : '';
      console.log(`  ${r.date}  ${r.odometer}km  ${r.liters}L  ¥${r.price_total} ${consumption}`);
    });
  } catch {
    console.log('（验证查询失败，请手动确认）');
  }
}

main();
