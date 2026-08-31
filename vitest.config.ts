import { defineConfig } from 'vitest/config';

/**
 * 測試資料庫預設指向獨立的 _test 資料庫。
 *
 * 各 postgres 測試檔內建的 fallback 指向開發資料庫，而它們的 beforeEach
 * 會清空 packages、versions 等資料表——直接跑測試會毀掉開發資料。
 * 在此統一注入，讓保護不依賴執行者記得帶環境變數。
 *
 * 明確設定 TEST_DATABASE_URL 時以該值為準，CI 可指向自己的實例。
 */
process.env.TEST_DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform_test';

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'json', 'html']
    },
    restoreMocks: true
  }
});
