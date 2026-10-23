import { defineConfig } from 'vitest/config';

// Тестируется только логика из src/lib — она не зависит от React Native.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
