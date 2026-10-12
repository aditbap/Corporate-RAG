/** The slice of an ioredis client the limiter needs (also what the unit-test fake implements). */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
}

/**
 * Fixed-window counter: at most `limit` hits per `windowSeconds` for `key`.
 *
 * The expiry is (re)applied whenever the key has none, so a crash between INCR and EXPIRE can't
 * leave a counter that never resets. If Redis is unavailable the request is allowed — rate
 * limiting is protection, not a reason to take the API down.
 */
export async function consumeRateLimit(
  redis: RateLimitRedis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const count = await redis.incr(key);
    if (count === 1 || (await redis.ttl(key)) === -1) {
      await redis.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}
