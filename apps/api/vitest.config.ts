import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Тесты используют общие Postgres и Redis — запускаем файлы последовательно.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
