/**
 * The Device X browser API: four same-origin JSON routes on the DSH Web
 * server, each behind the shipped Connection trust fence (the page's signed
 * session cookie authenticates the caller; foreign origins are rejected by
 * the Host/Origin fence). Route handlers never shell out themselves — they
 * call the shared operation surface, exactly like the agent tools.
 *
 * @module @cfour-hi/dsh-devicex/host/transport
 */

/** URL prefix owned by this plugin. */
const API_PREFIX = '/devicex/api';

/** Action request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 256 * 1024;

/** Reject malformed or unknown section names before they reach collection. */
function isSection(value) {
  return typeof value === 'string' && value.length > 0;
}

/** JSON response, always uncached: device facts are live facts. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader('allow', allow);
  res.end();
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling. */
async function readBoundedBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/** Apply the connection trust fence; true when the request was rejected. */
function rejected(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

/** Parse the request URL against a placeholder origin (only path/query matter). */
function requestUrl(req) {
  try {
    return new URL(String(req.url), 'http://localhost');
  } catch {
    return new URL('http://localhost/');
  }
}

/** Answer a GET/HEAD route, containing any handler failure as a 500. */
function guarded(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        res.destroy();
      }
    }
  };
}

/**
 * Register every Device X route as one disposable effect.
 * @param ctx - the plugin context carrying `webServer` and `connection`.
 * @param operations - the shared operation surface.
 * @returns the disposer removing every route.
 */
export function registerRoutes(ctx, operations) {
  const disposers = [];

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/metrics`,
    handler: guarded(async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
      const metrics = await operations.collectMetrics();
      sendJson(res, 200, { ok: true, metrics });
    }),
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/inventory`,
    handler: guarded(async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
      const url = requestUrl(req);
      const section = url.searchParams.get('section');
      const fresh = url.searchParams.get('fresh') === '1';
      if (section !== null && section !== '') {
        if (!isSection(section) || !operations.SECTIONS.includes(section)) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'unknown-section', message: `unknown section: ${section}` },
          });
          return;
        }
        const data = await operations.collectSection(section, { fresh });
        sendJson(res, 200, { ok: true, section, data });
        return;
      }
      const data = await operations.collectInventory({ fresh });
      sendJson(res, 200, { ok: true, section: null, data });
    }),
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/actions`,
    handler: guarded(async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
      sendJson(res, 200, {
        ok: true,
        platform: operations.PLATFORM,
        sections: operations.SECTIONS,
        actions: operations.actionCatalog(),
        history: operations.actionHistory(),
      });
    }),
  }));

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/action`,
    handler: guarded(async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
      const contentType = String(req.headers['content-type'] ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/json') {
        sendJson(res, 415, {
          ok: false,
          error: { code: 'unsupported-media-type', message: 'content-type must be application/json' },
        });
        return;
      }
      let text;
      try {
        text = await readBoundedBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'bad-request', message: 'request body unreadable' },
        });
        return;
      }
      if (text === null) {
        sendJson(res, 413, {
          ok: false,
          error: { code: 'payload-too-large', message: 'request body is too large' },
        });
        return;
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      if (typeof body !== 'object' || body === null || typeof body.action !== 'string') {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: 'bad-request',
            message: 'body must be a JSON object with a string "action" and optional object "params"',
          },
        });
        return;
      }
      const params = typeof body.params === 'object' && body.params !== null ? body.params : {};
      const result = await operations.runAction(body.action, params);
      sendJson(res, 200, result);
    }),
  }));

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        // A route disposer that already ran must not block the rest.
      }
    }
  };
}
