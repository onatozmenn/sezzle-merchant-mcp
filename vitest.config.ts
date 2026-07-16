import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/api/errors.ts',
        'src/api/request.ts',
        'src/api/schemas/**/*.ts',
        'src/config/**/*.ts',
        'src/domain/**/*.ts',
        'src/logging/redaction.ts',
        'src/services/diagnostics-engine.ts',
        'src/services/event-store.ts',
        'src/services/mutation-guard.ts',
        'src/services/support-policy-engine.ts',
        'src/services/webhook-verifier.ts',
        'src/storage/**/*.ts',
        'src/utils/**/*.ts',
      ],
      thresholds: {
        branches: 60,
        functions: 75,
        lines: 80,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
