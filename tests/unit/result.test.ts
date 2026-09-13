import { describe, expect, it } from 'vitest';

import {
  type DomainError,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  ok,
  unwrapOr,
} from '@/domain/result';

interface TestError extends DomainError {
  readonly code: 'TEST_FAILURE';
  readonly detail: string;
}

const failure: TestError = { code: 'TEST_FAILURE', detail: 'boom' };

describe('Result', () => {
  it('ok carries the value and narrows through isOk', () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);

    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('err carries the error and narrows through isErr', () => {
    const result = err(failure);

    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.error.code).toBe('TEST_FAILURE');
      expect(result.error.detail).toBe('boom');
    }
  });

  it('map transforms a success', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it('map leaves a failure untouched and does not call the function', () => {
    let called = false;

    const result = map(err(failure), () => {
      called = true;
      return 1;
    });

    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, error: failure });
  });

  it('flatMap chains fallible steps', () => {
    const double = (n: number) => ok(n * 2);

    expect(flatMap(ok(5), double)).toEqual({ ok: true, value: 10 });
  });

  it('flatMap short-circuits on the first failure', () => {
    let called = false;

    const result = flatMap(err(failure), () => {
      called = true;
      return ok('unreachable');
    });

    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, error: failure });
  });

  it('unwrapOr returns the value on success and the fallback on failure', () => {
    expect(unwrapOr(ok('value'), 'fallback')).toBe('value');
    expect(unwrapOr(err(failure) as never, 'fallback')).toBe('fallback');
  });
});
