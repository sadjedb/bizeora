'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/layout/layout';

import { registerAction, signInAction } from '@/app/auth-actions';
import { useDictionary } from '@/i18n/client';

/**
 * The credentials form, in both its modes.
 *
 * One component because the two forms differ by a single field and a verb, and
 * two near-identical files drift. It renders its own error rather than throwing
 * it away: a failed sign-in is a designed state (`UX.md` section 13), not a
 * page that silently does nothing.
 */
export function CredentialsForm({
  mode,
  redirectTo,
}: {
  mode: 'sign-in' | 'register';
  redirectTo: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage(null);

    startTransition(async () => {
      const payload = {
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
        password: String(data.get('password') ?? ''),
        redirectTo,
      };

      // Both actions redirect on success and never return, so anything that
      // comes back is a failure with a sentence in it.
      const result =
        mode === 'sign-in' ? await signInAction(payload) : await registerAction(payload);

      if (result && !result.ok) setMessage(result.message);
    });
  }

  const { t } = useDictionary();

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={5}>
        {message && (
          <Alert tone="danger" title={t.auth.failed}>
            {message}
          </Alert>
        )}

        {mode === 'register' && (
          <FormField label={t.auth.fullName} required>
            {(props) => (
              <Input
                {...props}
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
            )}
          </FormField>
        )}

        <FormField label={t.checkout.email} required>
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              maxLength={255}
              required
            />
          )}
        </FormField>

        <FormField
          label={t.auth.password}
          required
          description={mode === 'register' ? t.auth.passwordHint : undefined}
        >
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 10 : 1}
              maxLength={256}
              required
            />
          )}
        </FormField>

        <Button type="submit" variant="primary" loading={pending} fullWidth>
          {mode === 'sign-in' ? t.auth.signIn : t.auth.signUp}
        </Button>
      </Stack>
    </form>
  );
}
