import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // 用 wrangler.test.toml（无 [ai] 绑定）：Workers AI 在本地测试运行时不可用
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: {
          // Provide test values for secrets (not in wrangler.toml)
          bindings: {
            TELEGRAM_BOT_TOKEN:      'test-bot-token',
            TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
            DEEPSEEK_API_KEY:        'test-deepseek-key',
            ANTHROPIC_API_KEY:       'test-anthropic-key',
            ALLOWED_CHAT_ID:         '999999',
            DASHBOARD_TOKEN:         'test-db-token',
          },
        },
      },
    },
  },
});
