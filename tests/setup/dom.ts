/**
 * Test setup.
 *
 * Runs for every test file, including the Node-environment domain and database
 * suites, so it must not assume a DOM exists. The Testing Library matchers are
 * registered only when `document` is present — that is, only for the files that
 * opted into jsdom with a `@vitest-environment jsdom` docblock.
 */

import { afterEach, vi } from 'vitest';
import type * as Navigation from 'next/navigation';

// Registers the Testing Library matchers on vitest's `expect` and augments its
// `Assertion` type. Imported for the type augmentation even in Node runs; the
// registration itself is harmless without a DOM.
import '@testing-library/jest-dom/vitest';

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');

  // Unmount between tests so a query cannot match a previous test's tree.
  afterEach(() => {
    cleanup();
  });

  /**
   * jsdom implements neither of these, and Radix uses both: `matchMedia` for
   * responsive behaviour and `ResizeObserver` inside the Select and Popover
   * positioning. Without the stubs, opening any overlay throws.
   */
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

/**
 * The App Router, for component tests.
 *
 * `Link`, `LocaleSwitcher` and the account navigation all read the current
 * pathname — that is how the language prefix reaches every internal href
 * without being threaded through sixty call sites. Rendering any of them
 * outside a Next tree throws "invariant expected app router to be mounted",
 * which says nothing about the component under test.
 *
 * The stub answers with a French path, which is what the storefront component
 * tests assert against. A test that needs another language mocks the module
 * itself.
 */
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof Navigation>('next/navigation');

  return {
    ...actual,
    usePathname: () => '/fr',
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
      prefetch: () => {},
    }),
    useSearchParams: () => new URLSearchParams(),
  };
});
