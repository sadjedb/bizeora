-- ---------------------------------------------------------------------------
-- A demonstration administrator.
--
--     e-mail    admin@gmail.com
--     password  admin@gmail.com
--
-- FOR A DEMONSTRATION MACHINE ONLY. The password is written down in this file
-- and therefore in the repository, which makes this account a back door for
-- anyone who can read it. `prisma/seed.ts` deliberately creates no
-- administrator for exactly that reason (DATABASE.md section 19), and the
-- supported way to make one on a real deployment is to register through the
-- form and then run `npm run db:admin -- you@example.com`. Delete this account
-- before the site is reachable from anywhere but your own laptop.
--
-- The hash below is Argon2id with the parameters in `src/lib/auth/password.ts`
-- (19 MiB, 2 iterations, 1 lane). Its salt and parameters are inside the string,
-- so it verifies on any machine; it was produced from the password above and
-- checked against the running sign-in endpoint.
--
--     psql -U postgres -d <database> -f prisma/demo-admin.sql
--
-- Safe to run twice: the second run changes nothing.
-- ---------------------------------------------------------------------------

WITH new_admin AS (
  INSERT INTO users (name, email, email_verified, role, status, created_at, updated_at)
  VALUES ('Administrateur', 'admin@gmail.com', true, 'ADMIN', 'ACTIVE', now(), now())
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO accounts (user_id, account_id, provider_id, issuer, password, created_at, updated_at)
SELECT id,
       id::text,
       'credential',
       'local:credential',
       '$argon2id$v=19$m=19456,t=2,p=1$oPPxz5pz62YjgOMDLfAR/Q$0CZ0eiE5lpbOv9UymU9EgH8b3EwPI/7qoUq2BYt1k4M',
       now(),
       now()
FROM new_admin
ON CONFLICT DO NOTHING;

-- If the address already existed as a customer, this promotes it instead.
UPDATE users
   SET role = 'ADMIN', status = 'ACTIVE', email_verified = true, updated_at = now()
 WHERE email = 'admin@gmail.com'
   AND role <> 'ADMIN';
