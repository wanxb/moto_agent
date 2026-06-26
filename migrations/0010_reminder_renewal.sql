-- 提醒续期改为仅在用户记录保养时触发（spec 016 修订），不是 cron 推送时触发。
-- 新增 remind_count：记录 cron 已推送次数，满 3 次后标记完成（不再推送）。
-- ALTER TABLE 非幂等，重复执行报 "duplicate column" 即已迁移。
ALTER TABLE reminders ADD COLUMN remind_count INTEGER NOT NULL DEFAULT 0;
