import 'server-only';

/**
 * The outbound-email boundary's public surface.
 *
 * Application code imports from here, never from a provider. What crosses is
 * two functions and a document type; what does not is the transport, the API
 * key, the HTTP call and the notion of a provider at all.
 *
 * The two credential e-mails are **sent immediately** rather than queued, and
 * that is a deliberate exception to the outbox (`ARCHITECTURE.md` section 11).
 * A verification code lives fifteen minutes and a reset link one hour, so a
 * dispatcher running every few minutes would spend a meaningful part of that
 * budget waiting — and the outbox stores payloads, so queueing them would mean
 * a database dump containing live reset links (`SECURITY.md` 2.1). Everything
 * that is not a credential goes through the outbox.
 */

export {
  sendPasswordReset,
  sendVerificationCode,
} from '@/server/services/notification-service';
export { renderEmail, type RenderedEmail } from './templates';
export type { EmailMessage, EmailTransport, DeliveryResult } from './transport';
export {
  emailTransport,
  sentEmails,
  clearSentEmails,
  failEmailsMatching,
} from './transport';
