/**
 * 存量单用户数据迁移 CLI（spec 016 T11）。
 * 把迁移前 user_id IS NULL 的车辆/记录/提醒挂到管理员（ALLOWED_CHAT_ID 对应的用户）。
 * 幂等：可重复执行；reminders.chat_id 保持不动。迁移逻辑见 src/migrate.ts（单测覆盖）。
 *
 * 使用：
 *   npx tsx scripts/migrate-single-user.ts <chatId>            # 线上 D1（默认）
 *   npx tsx scripts/migrate-single-user.ts <chatId> --local    # 本地 D1
 *   chatId 省略时尝试从 .dev.vars 的 ALLOWED_CHAT_ID 读取。
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const BACKFILL_TABLES = ['vehicles', 'fuel_records', 'mileage_records', 'maintenance_records', 'reminders'];

function readAllowedChatId(): string | undefined {
  try {
    const m = readFileSync('.dev.vars', 'utf8').match(/^ALLOWED_CHAT_ID\s*=\s*(.+)$/m);
    return m?.[1].trim().replace(/^["']|["']$/g, '');
  } catch { return undefined; }
}

function exec(sql: string, remote: boolean): string {
  const flag = remote ? '--remote' : '--local';
  return execSync(`npx wrangler d1 execute moto-agent-db ${flag} --command "${sql}" --json`, {
    cwd: process.cwd(),
  }).toString();
}

function main(): void {
  const args = process.argv.slice(2);
  const remote = !args.includes('--local');
  const chatId = args.find(a => !a.startsWith('--')) ?? readAllowedChatId();
  if (!chatId) {
    console.error('❌ 缺少 chatId：作为参数传入，或在 .dev.vars 设 ALLOWED_CHAT_ID');
    process.exit(1);
  }
  console.log(`迁移目标：${remote ? '线上 D1（--remote）' : '本地 D1（--local）'}，管理员 chatId=${chatId}\n`);

  // Step 1: 创建管理员（幂等）
  exec(
    `INSERT INTO users (telegram_id, email, nickname, lang, is_admin) VALUES ('${chatId}', NULL, 'Admin', 'zh', 1) ON CONFLICT(telegram_id) DO NOTHING`,
    remote,
  );
  const out = exec(`SELECT id FROM users WHERE telegram_id = '${chatId}'`, remote);
  const adminId = (JSON.parse(out) as { results: { id: number }[] }[])[0]?.results?.[0]?.id;
  if (adminId == null) { console.error('❌ 管理员账号创建后仍查不到'); process.exit(1); }
  console.log(`✅ 管理员 user_id = ${adminId}\n`);

  // Step 2/3: 回填 user_id（只填空；reminders.chat_id 不动）
  for (const tbl of BACKFILL_TABLES) {
    exec(`UPDATE ${tbl} SET user_id = ${adminId} WHERE user_id IS NULL`, remote);
    console.log(`→ ${tbl} 已回填`);
  }
  console.log('\n✅ 迁移完成（幂等，可重复执行）');
}

main();
