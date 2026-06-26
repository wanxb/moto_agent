// 存量单用户数据迁移（spec 016 T11）：把迁移前归属未定（user_id IS NULL）的数据挂到管理员。
// 纯逻辑、可测；CLI 入口见 scripts/migrate-single-user.ts。
// 幂等：INSERT ... ON CONFLICT DO NOTHING + UPDATE ... WHERE user_id IS NULL，重跑不再命中。
// 关键：reminders.chat_id（cron 推送目标）原值保留，只填新列 user_id（design §10）。

// 仅这几张表有 user_id 列；表名为常量（非用户输入），字符串拼接安全。
const BACKFILL_TABLES = ['vehicles', 'fuel_records', 'mileage_records', 'maintenance_records', 'reminders'] as const;

export interface MigrateResult {
  adminId: number;
  backfilled: Record<string, number>;   // 每张表本次回填的行数
}

export async function migrateSingleUser(db: D1Database, adminChatId: string): Promise<MigrateResult> {
  if (!adminChatId) throw new Error('migrateSingleUser: 缺少 adminChatId（ALLOWED_CHAT_ID）');

  // Step 1: 创建管理员（幂等）
  await db.prepare(
    `INSERT INTO users (telegram_id, email, nickname, lang, is_admin)
     VALUES (?, NULL, 'Admin', 'zh', 1)
     ON CONFLICT(telegram_id) DO NOTHING`
  ).bind(adminChatId).run();

  const admin = await db.prepare('SELECT id FROM users WHERE telegram_id = ?')
    .bind(adminChatId).first<{ id: number }>();
  if (!admin) throw new Error('migrateSingleUser: 管理员账号创建后仍查不到');
  const adminId = admin.id;

  // Step 2/3: 只填空，不覆盖已有 user_id；reminders.chat_id 不动
  const backfilled: Record<string, number> = {};
  for (const tbl of BACKFILL_TABLES) {
    const res = await db.prepare(`UPDATE ${tbl} SET user_id = ? WHERE user_id IS NULL`).bind(adminId).run();
    backfilled[tbl] = res.meta.changes ?? 0;
  }

  return { adminId, backfilled };
}
