import { runNotificationSweep } from '@/server/services/notification-service';
import { serverEnv } from '@/lib/env';
import { sweepRateLimits } from '@/lib/rate-limit';

/**
 * The scheduler's one door.
 *
 * `ARCHITECTURE.md` section 11 asks for a dispatcher, not a job platform, so
 * this is the smallest thing that can be invoked on a timer: a `POST` that runs
 * the sweep once and reports what it did. Any scheduler that can make an HTTP
 * request drives it — Vercel Cron, a `curl` in crontab, a GitHub Action:
 *
 *     POST /api/jobs/notifications
 *     Authorization: Bearer $JOBS_SECRET
 *
 * **A cadence of every five minutes is enough.** The two expiry sweeps only
 * make stored statuses agree with what every reader already computes lazily
 * (7.4, 7.10.2), the warning window is two days wide, and a confirmation e-mail
 * arriving within five minutes reads as immediate.
 *
 * Three deliberate choices:
 *
 *   - **`POST`, not `GET`.** It changes state, and a `GET` that sends e-mail is
 *     one prefetch away from sending it twice.
 *   - **A shared secret, compared in constant time.** Without `JOBS_SECRET`
 *     configured the route refuses outright rather than running unauthenticated
 *     — an open endpoint that flushes the outbox is a way to make the workshop
 *     e-mail itself.
 *   - **No session.** The scheduler is not a person, and `requireStaff` would
 *     mean giving a cron job an account.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function refuse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Length-independent comparison, so a timing signal cannot leak the secret. */
function matches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return difference === 0;
}

export async function POST(request: Request): Promise<Response> {
  const expected = serverEnv.JOBS_SECRET;

  if (!expected) {
    return refuse(503, 'Scheduled jobs are not configured. Set JOBS_SECRET.');
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!provided || !matches(provided, expected)) {
    return refuse(401, 'Unauthorized.');
  }

  const summary = await runNotificationSweep();

  /*
   * And a sweep of the rate-limit table, on the same tick.
   *
   * Its rows are dead the moment their window closes, and a delete that takes
   * milliseconds does not deserve a cron entry of its own — a second scheduled
   * job is a second thing to configure, monitor and forget. It runs after the
   * notifications so a failure here cannot cost a delivery.
   */
  const expired = await sweepRateLimits().catch(() => 0);

  // A summary, not a list: the response goes into a scheduler's log, and the
  // recipients and subjects of what was just delivered do not belong there.
  return Response.json({ ok: true, ...summary, rateLimitsSwept: expired });
}
