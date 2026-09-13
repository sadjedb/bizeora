'use client';

import { useEffect } from 'react';

import { useDictionary } from '@/i18n/client';

/**
 * Route-level error boundary.
 *
 * Never renders a stack trace or an internal message (docs/SECURITY.md
 * section 11, docs/ARCHITECTURE.md section 14). The digest is the correlation
 * id a customer can quote to support.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useDictionary();

  useEffect(() => {
    // Replaced by the Sentry reporter in Phase 18.
    console.error(error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-narrow flex-1 flex-col justify-center px-4 py-20"
    >
      <h1 className="text-display-md text-fg">{t.errors.unexpectedTitle}</h1>
      <p className="text-body text-fg-muted mt-4">{t.errors.unexpectedBody}</p>

      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex h-12 w-fit items-center rounded-md bg-fg px-6 text-body font-medium text-fg-inverted transition-colors duration-fast hover:bg-fg-hover"
      >
        {t.errors.retry}
      </button>

      {error.digest ? (
        <p className="mt-8 font-mono text-mono-sm text-fg-subtle">
          {t.errors.reference} : {error.digest}
        </p>
      ) : null}
    </main>
  );
}
