/**
 * Authorisation is pure, and this file proves it: every case below builds an
 * `Actor` by hand. No session, no database, no auth library, no network — which
 * is the whole point of keeping authorisation out of Better Auth (ADR-006).
 */

import { describe, expect, it } from 'vitest';

import {
  anonymousActor,
  isActive,
  isAuthenticated,
  type Actor,
  type Role,
} from '../../src/domain/auth/actor';
import {
  isAdmin,
  isCustomer,
  isStaff,
  mayAdjustStock,
  mayManageCatalogue,
  ownsResource,
  requiresEmailVerification,
} from '../../src/domain/permissions';

function actor(
  role: Role,
  overrides: Partial<{
    userId: string;
    emailVerified: boolean;
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  }> = {},
): Actor {
  return {
    kind: 'authenticated',
    userId: overrides.userId ?? 'user-1',
    role,
    emailVerified: overrides.emailVerified ?? true,
    status: overrides.status ?? 'ACTIVE',
  };
}

describe('actor', () => {
  it('distinguishes anonymous from authenticated', () => {
    expect(isAuthenticated(anonymousActor)).toBe(false);
    expect(isAuthenticated(actor('CUSTOMER'))).toBe(true);
  });

  it('treats a suspended account as authenticated but not active', () => {
    const suspended = actor('ADMIN', { status: 'SUSPENDED' });

    expect(isAuthenticated(suspended)).toBe(true);
    expect(isActive(suspended)).toBe(false);
  });
});

describe('permissions', () => {
  it('grants each role only its own predicate — roles are not hierarchical', () => {
    expect(isCustomer(actor('CUSTOMER'))).toBe(true);
    expect(isStaff(actor('CUSTOMER'))).toBe(false);
    expect(isAdmin(actor('CUSTOMER'))).toBe(false);

    expect(isCustomer(actor('STAFF'))).toBe(false);
    expect(isStaff(actor('STAFF'))).toBe(true);
    expect(isAdmin(actor('STAFF'))).toBe(false);

    // ADMIN is staff, per the section 12.1 matrix, but STAFF is never admin.
    expect(isStaff(actor('ADMIN'))).toBe(true);
    expect(isAdmin(actor('ADMIN'))).toBe(true);
  });

  it('refuses a suspended admin every capability', () => {
    const suspended = actor('ADMIN', { status: 'SUSPENDED' });

    expect(isStaff(suspended)).toBe(false);
    expect(isAdmin(suspended)).toBe(false);
    expect(ownsResource(suspended, 'user-1')).toBe(false);
  });

  it('refuses an anonymous actor every capability', () => {
    expect(isCustomer(anonymousActor)).toBe(false);
    expect(isStaff(anonymousActor)).toBe(false);
    expect(isAdmin(anonymousActor)).toBe(false);
    expect(ownsResource(anonymousActor, 'user-1')).toBe(false);
  });

  describe('ownership', () => {
    it('matches only the owning user', () => {
      expect(ownsResource(actor('CUSTOMER', { userId: 'user-1' }), 'user-1')).toBe(true);
      expect(ownsResource(actor('CUSTOMER', { userId: 'user-1' }), 'user-2')).toBe(false);
    });

    it('does not make staff an owner', () => {
      // Staff read a customer's resources through a staff capability, which is
      // audit-logged — never by being mistaken for the customer.
      expect(ownsResource(actor('STAFF', { userId: 'staff-1' }), 'user-1')).toBe(false);
    });

    it('never treats an unowned resource as owned', () => {
      // A guest order carries no userId. It must not fall to whoever asks.
      expect(ownsResource(actor('CUSTOMER'), null)).toBe(false);
      expect(ownsResource(anonymousActor, null)).toBe(false);
    });
  });

  describe('the catalogue, per 12.1', () => {
    it('lets staff and admin manage products and stock', () => {
      // "Manage products and categories: no / yes / yes". The workshop that
      // photographs and prices a piece is the workshop that puts it online;
      // reserving that for one account is how a catalogue goes stale.
      for (const role of ['STAFF', 'ADMIN'] as const) {
        expect(mayManageCatalogue(actor(role)), role).toBe(true);
        expect(mayAdjustStock(actor(role)), role).toBe(true);
      }
    });

    it('refuses a customer and a signed-out visitor', () => {
      expect(mayManageCatalogue(actor('CUSTOMER'))).toBe(false);
      expect(mayAdjustStock(actor('CUSTOMER'))).toBe(false);
      expect(mayManageCatalogue(anonymousActor)).toBe(false);
      expect(mayAdjustStock(anonymousActor)).toBe(false);
    });

    it('refuses a suspended staff account', () => {
      // Every predicate goes through `isActive`, so losing an account is
      // losing every capability at once rather than one at a time.
      const suspended = actor('STAFF', { status: 'SUSPENDED' });
      expect(mayManageCatalogue(suspended)).toBe(false);
      expect(mayAdjustStock(suspended)).toBe(false);
    });
  });

  it('requires verification only from an unverified, active account', () => {
    expect(requiresEmailVerification(actor('CUSTOMER', { emailVerified: false }))).toBe(
      true,
    );
    expect(requiresEmailVerification(actor('CUSTOMER', { emailVerified: true }))).toBe(
      false,
    );
    expect(requiresEmailVerification(anonymousActor)).toBe(false);
  });
});
