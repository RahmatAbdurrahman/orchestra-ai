/**
 * Same-origin proxy to the Orchestra API. The browser only talks to the web
 * origin, so the HttpOnly session cookie never crosses origins, and the API
 * address is configured at runtime (API_INTERNAL_URL).
 */
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
// Bearer token for an API behind an authenticating gateway, e.g. a private Hugging Face Space
// (an HF access token with read access). Server-side only; never sent to the browser.
const API_AUTH_TOKEN = process.env.API_INTERNAL_AUTH_TOKEN?.trim() || null;
const FORWARD_REQUEST_HEADERS = ['content-type', 'cookie', 'accept', 'user-agent', 'x-correlation-id', 'x-forwarded-for'];
const DROP_RESPONSE_HEADERS = new Set(['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF check for the proxy: a state-changing browser request must come from the host it was sent to.
 * The browser Origin is not forwarded, because the web app can be served under several hostnames
 * (e.g. a host's production domain, per-deployment URLs). The API then sees a server-to-server
 * call; its own origin allowlist still protects anyone calling it directly.
 */
function isCrossOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get('origin');
  if (!origin) return false; // non-browser clients
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return !host || new URL(origin).host !== host.split(',')[0]!.trim();
  } catch {
    return true; // "null" or malformed origin
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (isCrossOrigin(request)) {
    return Response.json(
      { error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected', correlationId: null } },
      { status: 403 },
    );
  }
  const { path } = await context.params;
  const search = new URL(request.url).search;
  const target = `${API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (API_AUTH_TOKEN) headers.set('authorization', `Bearer ${API_AUTH_TOKEN}`);
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual', cache: 'no-store' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The Orchestra API is not reachable', correlationId: null } },
      { status: 502 },
    );
  }
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
