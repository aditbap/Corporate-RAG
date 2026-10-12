import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeRateLimit, type RateLimitRedis } from '../../src/lib/rate-limit.js';

/** In-memory stand-in for Redis with controllable TTL bookkeeping. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const calls: string[] = [];
  const redis: RateLimitRedis = {
    async incr(k) { calls.push(`incr ${k}`); counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k)!; },
    async ttl(k) { return ttls.get(k) ?? -1; },
    async expire(k, s) { calls.push(`expire ${k} ${s}`); ttls.set(k, s); return 1; },
  };
  return { redis, counts, ttls, calls };
}

describe('consumeRateLimit', () => {
  it('allows up to the limit and blocks the next hit', async () => {
    const { redis } = fakeRedis();
    for (let i = 1; i <= 3; i++) assert.deepEqual(await consumeRateLimit(redis, 'k', 3, 60), { allowed: true, count: i });
    assert.deepEqual(await consumeRateLimit(redis, 'k', 3, 60), { allowed: false, count: 4 });
  });

  it('keeps keys independent', async () => {
    const { redis } = fakeRedis();
    await consumeRateLimit(redis, 'a', 1, 60);
    assert.equal((await consumeRateLimit(redis, 'a', 1, 60)).allowed, false);
    assert.equal((await consumeRateLimit(redis, 'b', 1, 60)).allowed, true);
  });

  it('sets the window expiry on the first hit', async () => {
    const { redis, ttls } = fakeRedis();
    await consumeRateLimit(redis, 'k', 5, 42);
    assert.equal(ttls.get('k'), 42);
  });

  it('repairs a counter that lost its expiry (crash between INCR and EXPIRE)', async () => {
    const { redis, counts, ttls } = fakeRedis();
    counts.set('k', 7); // exists, no TTL
    await consumeRateLimit(redis, 'k', 100, 60);
    assert.equal(ttls.get('k'), 60);
  });

  it('fails open when Redis is unavailable', async () => {
    const broken: RateLimitRedis = {
      async incr() { throw new Error('down'); },
      async ttl() { throw new Error('down'); },
      async expire() { throw new Error('down'); },
    };
    assert.deepEqual(await consumeRateLimit(broken, 'k', 1, 60), { allowed: true, count: 0 });
  });
});
