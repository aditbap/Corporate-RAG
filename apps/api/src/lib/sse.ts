/** CORS headers for hijacked SSE responses (Fastify's cors plugin doesn't run after hijack). */
export function sseCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim());
  if (!allowed) return { 'Access-Control-Allow-Origin': '*' };
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
    : {};
}
