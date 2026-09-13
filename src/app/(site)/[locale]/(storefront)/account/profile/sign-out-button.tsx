'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useDictionary } from '@/i18n/client';

import { signOutAction } from '@/app/auth-actions';

/**
 * Sign out.
 *
 * A button in a form rather than a link, because signing out is a state change
 * and a `GET` that ends a session can be triggered by anything that can make
 * the browser fetch a URL. The action revokes the session server-side — the
 * cookie is not merely cleared — so the row is gone on the very next request,
 * everywhere (`SECURITY.md` section 2.1).
 */
export function SignOutButton() {
  const { t } = useDictionary();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      onClick={() => startTransition(() => signOutAction())}
    >
      {t.auth.signOut}
    </Button>
  );
}
