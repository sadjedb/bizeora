import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests.
 *
 * Node by default: the tests that matter most are domain tests — pricing,
 * totals, state machines — and those are pure functions with no DOM
 * (docs/BUSINESS-RULES.md section 16). Design-system tests genuinely need a
 * DOM, so files under `tests/components/` opt into jsdom with a
 * `@vitest-environment jsdom` docblock and get the Testing Library matchers
 * from `tests/setup/dom.ts`. Keeping jsdom opt-in means the domain suite still
 * runs in milliseconds.
 *
 * End-to-end tests belong to Playwright and are excluded here.
 *
 * `server-only` is aliased to its own empty module. That package throws unless
 * the `react-server` export condition is set, and Vite externalises it before
 * conditions apply. The authentication boundary marks itself server-only and
 * these tests exercise it from Node — which is the server — so without the
 * alias, importing `lib/auth` throws before a single assertion runs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/components/**/*.test.tsx',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    setupFiles: ['tests/setup/dom.ts'],
    globals: false,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
});
