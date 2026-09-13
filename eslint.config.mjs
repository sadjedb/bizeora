import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/**
 * Architecture boundaries (docs/ARCHITECTURE.md section 17).
 *
 * Dependency direction is strictly downward:
 *
 *   app/components  ->  server  ->  domain
 *                       lib (infrastructure)
 *
 * The domain layer is the one that matters. It must stay pure: no framework,
 * no ORM, no infrastructure, no browser API. That purity is what makes
 * pricing, totals and state machines testable in milliseconds without a
 * database — so it is enforced here rather than left to review.
 */

const DOMAIN_FORBIDDEN = [
  {
    group: [
      'next',
      'next/*',
      'react',
      'react-dom',
      'react/*',
      'server-only',
      'client-only',
    ],
    message:
      'domain/ must stay framework-independent. Move framework code to app/, components/ or server/.',
  },
  {
    group: [
      '@prisma/client',
      '.prisma/*',
      'prisma',
      'prisma/*',
      // The generated client is what this project actually imports; the
      // package names above are the ones a habit reaches for.
      '@/generated/prisma',
      '@/generated/prisma/*',
    ],
    message:
      'domain/ must not import Prisma. Only server/repositories/ may query the database.',
  },
  {
    group: ['better-auth', 'better-auth/*', '@better-auth/*', '@node-rs/argon2'],
    message:
      'domain/ must not import the auth library. Better Auth answers who the user is; domain/permissions answers what they may do, over a plain Actor (ADR-006).',
  },
  {
    group: ['@aws-sdk/*', 'sharp'],
    message:
      'domain/ must not import a storage or media SDK. File rules are pure functions over bytes; the provider lives behind lib/storage (ADR-009).',
  },
  {
    group: ['@/lib', '@/lib/*', '@/server', '@/server/*', '@/app/*', '@/components/*'],
    message:
      'domain/ must not depend on infrastructure, services or UI. Dependencies point downward only — pass plain data in.',
  },
];

const COMPONENT_FORBIDDEN = [
  {
    group: [
      '@/server/services',
      '@/server/services/*',
      '@/server/repositories',
      '@/server/repositories/*',
    ],
    message:
      'Components must not reach into services or repositories. Fetch in a server component or call a server action.',
  },
  {
    group: ['@prisma/client', '.prisma/*', '@/generated/prisma', '@/generated/prisma/*'],
    message: 'Only server/repositories/ and lib/db/ may import Prisma.',
  },
  {
    group: ['@/lib/db', '@/lib/db/*'],
    message:
      'Components must not open a database connection. Fetch in a server component or a server action and pass data down.',
  },
  {
    group: [
      '@/lib/storage',
      '@/lib/storage/*',
      '@/lib/media/raster',
      '@aws-sdk/*',
      'sharp',
    ],
    message:
      'Components must not reach object storage or decode an image. A component receives a signed URL it was given; the provider and the decoder live behind lib/storage and lib/media (ADR-009).',
  },
  {
    group: [
      'better-auth',
      'better-auth/*',
      '@better-auth/*',
      '@/lib/auth',
      '@/lib/auth/*',
    ],
    message:
      'Components must not contain auth persistence logic. Resolve the actor in a server component or a server action and pass it down.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      // The parallel development build used by the design-system E2E project.
      '.next-dev/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextCoreWebVitals,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  /* ---------------------------------------------------------------------
   * Type-aware linting, scoped to application and test sources. Config
   * files at the repository root are not part of the TypeScript project
   * and must not be linted with type information.
   * ------------------------------------------------------------------ */
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  /* ---------------------------------------------------------------------
   * The domain layer must import nothing but itself.
   * ------------------------------------------------------------------ */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DOMAIN_FORBIDDEN }],
      // Browser and Node globals are not available to pure domain code.
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'domain/ must not depend on browser APIs.' },
        { name: 'document', message: 'domain/ must not depend on browser APIs.' },
        { name: 'localStorage', message: 'domain/ must not depend on browser APIs.' },
        { name: 'navigator', message: 'domain/ must not depend on browser APIs.' },
        {
          name: 'fetch',
          message: 'domain/ must be free of I/O. Pass data in as arguments.',
        },
        {
          name: 'process',
          message: 'domain/ must not read the environment. Pass configuration in.',
        },
      ],
    },
  },

  /* ---------------------------------------------------------------------
   * Presentation must not reach past the entry-point layer.
   * ------------------------------------------------------------------ */
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: COMPONENT_FORBIDDEN }],
    },
  },

  /* ---------------------------------------------------------------------
   * Prisma is confined to the repository layer.
   * ------------------------------------------------------------------ */
  {
    // `no-restricted-imports` options do NOT merge across config blocks — the
    // last matching block wins. src/domain and src/components are excluded
    // here because they declare their own, stricter set (which already
    // includes Prisma). Removing these exclusions would silently disable the
    // domain boundary; the probe in tests/README.md exists to catch that.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/server/repositories/**',
      'src/lib/db/**',
      // The two modules that exist to wrap a provider. They are the boundary,
      // so they are the only places allowed through it.
      'src/lib/storage/**',
      'src/lib/media/**',
      'src/domain/**',
      'src/components/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-sdk/*'],
              message:
                'Only lib/storage may import the storage SDK. Everything else asks the adapter for a signed URL (docs/ARCHITECTURE.md section 9, ADR-009).',
            },
            {
              group: ['sharp'],
              message:
                'Only lib/media may decode an image, under the pixel limits in domain/design-file (docs/SECURITY.md section 6).',
            },
            {
              group: [
                '@prisma/client',
                '.prisma/*',
                // `prisma.config.ts` generates the client into
                // `src/generated/prisma`, so this — not `@prisma/client` — is
                // the path a stray query would actually be written against.
                // Leaving it out made this whole rule decorative outside
                // src/components, which declares its own list.
                '@/generated/prisma',
                '@/generated/prisma/*',
              ],
              message:
                'Only server/repositories/ and lib/db/ may import Prisma (docs/ARCHITECTURE.md section 6).',
            },
          ],
        },
      ],
    },
  },

  /* ---------------------------------------------------------------------
   * Server environment must never be imported by a client component.
   * ------------------------------------------------------------------ */
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'] > Identifier.property[name=/^(?!NEXT_PUBLIC_)/]",
          message:
            'Read environment variables through @/lib/env, which validates them and keeps server values off the client.',
        },
      ],
    },
  },
  {
    // env.ts is the one place process.env is read directly.
    files: ['src/lib/env.ts', 'next.config.ts', '*.config.{ts,mjs,js}'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  /* ---------------------------------------------------------------------
   * Seed and CLI scripts: progress output is the point.
   * ------------------------------------------------------------------ */
  {
    files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  /* ---------------------------------------------------------------------
   * Tests
   * ------------------------------------------------------------------ */
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
