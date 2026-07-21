import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/migrate.ts',
        '**/seed.ts',
        '**/server.ts',
        '**/config/**',
        '**/*.d.ts',
        '**/types/**',
        '**/workers/cron-entry.ts',
        'src/**/*.test.ts',
        'test/**',
      ],
    },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
  },
});
