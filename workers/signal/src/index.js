const ALLOWED_INTERESTS = new Set([
  'serum-presets',
  'unreleased-drops',
  'production-notes',
  'shows',
]);

const DEFAULT_ALLOWED_ORIGINS = [
  'https://banthedj.com',
  'https://www.banthedj.com',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function getAllowedOrigins(env) {
  const configured = env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(',');
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = getAllowedOrigins(env);
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((cookie) => cookie.trim().split('='))
      .filter(([key, value]) => key && value)
  );
}

function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;

  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cookies = parseCookies(request);

  return (
    url.searchParams.get('token') === env.ADMIN_TOKEN ||
    bearerToken === env.ADMIN_TOKEN ||
    cookies.signal_admin === env.ADMIN_TOKEN
  );
}

function requireAdmin(request, env) {
  if (isAuthorized(request, env)) return null;

  if (!env.ADMIN_TOKEN) {
    return new Response('Admin view is not configured. Set ADMIN_TOKEN on this Worker.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response('Unauthorized. Add ?token=YOUR_ADMIN_TOKEN to open the email list.', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readPayload(request) {
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return request.json();
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  throw new Error('Unsupported content type.');
}

async function handleSubscribe(request, env) {
  if (!env.DB) {
    return json({ error: 'Signal database is not configured.' }, 500, corsHeaders(request, env));
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch {
    return json({ error: 'Send the form as JSON or form data.' }, 400, corsHeaders(request, env));
  }

  if (String(payload.website || '').trim()) {
    return json({ ok: true }, 200, corsHeaders(request, env));
  }

  const email = normalizeEmail(payload.email);
  const interest = ALLOWED_INTERESTS.has(payload.interest) ? payload.interest : 'serum-presets';
  const message = String(payload.message || '').trim().slice(0, 1000);

  if (!isValidEmail(email)) {
    return json({ error: 'Use a valid email address.' }, 400, corsHeaders(request, env));
  }

  const now = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 500);
  const ipHash = ip ? await sha256(`${ip}:${env.IP_HASH_SALT || 'banthedj'}`) : '';

  await env.DB.prepare(
    `INSERT INTO subscribers (email, interest, message, source, ip_hash, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       interest = excluded.interest,
       message = excluded.message,
       source = excluded.source,
       ip_hash = excluded.ip_hash,
       user_agent = excluded.user_agent,
       updated_at = excluded.updated_at`
  )
    .bind(email, interest, message, 'website', ipHash, userAgent, now, now)
    .run();

  return json({ ok: true }, 200, corsHeaders(request, env));
}

async function handleAdmin(request, env) {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  if (url.searchParams.get('token') === env.ADMIN_TOKEN) {
    const redirectUrl = new URL(request.url);
    redirectUrl.searchParams.delete('token');
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.toString(),
        'Set-Cookie': `signal_admin=${env.ADMIN_TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
      },
    });
  }

  const { results } = await env.DB.prepare(
    `SELECT email, interest, message, created_at, updated_at
     FROM subscribers
     ORDER BY updated_at DESC
     LIMIT 500`
  ).all();

  const rows = results
    .map((subscriber) => (
      `<tr>
        <td>${escapeHtml(subscriber.email)}</td>
        <td>${escapeHtml(subscriber.interest)}</td>
        <td>${escapeHtml(subscriber.message)}</td>
        <td>${escapeHtml(subscriber.created_at)}</td>
        <td>${escapeHtml(subscriber.updated_at)}</td>
      </tr>`
    ))
    .join('');

  return new Response(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>BANTHEDJ Signal Admin</title>
        <style>
          :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          body { margin: 0; background: #000; color: #fff; }
          main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
          header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
          h1 { margin: 0; font-size: clamp(2rem, 6vw, 5rem); line-height: .9; font-family: Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif; letter-spacing: .02em; }
          p { color: #aaa; margin: 8px 0 0; font-size: 13px; }
          a { color: #fff; border: 1px solid #1f1abc; background: #1f1abc; padding: 12px 14px; text-decoration: none; text-transform: uppercase; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #222; }
          th, td { padding: 12px; border-bottom: 1px solid #181818; text-align: left; vertical-align: top; font-size: 13px; }
          th { color: #1f1abc; text-transform: uppercase; letter-spacing: .12em; font-size: 11px; }
          tr:nth-child(even) td { background: #070707; }
          .empty { border: 1px solid #222; padding: 18px; color: #aaa; }
          @media (max-width: 760px) {
            header { display: block; }
            header a { display: inline-block; margin-top: 16px; }
            table, thead, tbody, th, td, tr { display: block; }
            thead { display: none; }
            td { border-bottom: 0; padding: 8px 12px; }
            tr { border-bottom: 1px solid #222; padding: 8px 0; }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <div>
              <h1>Signal List</h1>
              <p>${results.length} subscriber${results.length === 1 ? '' : 's'} shown. Most recent updates first.</p>
            </div>
            <a href="/admin/subscribers.csv">Download CSV</a>
          </header>
          ${results.length ? `<table>
            <thead>
              <tr><th>Email</th><th>Interest</th><th>Message</th><th>Created</th><th>Updated</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>` : '<div class="empty">No subscribers yet.</div>'}
        </main>
      </body>
    </html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function csvCell(value) {
  return `"${String(value || '').replaceAll('"', '""')}"`;
}

async function handleCsv(request, env) {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  const { results } = await env.DB.prepare(
    `SELECT email, interest, message, source, created_at, updated_at
     FROM subscribers
     ORDER BY updated_at DESC`
  ).all();
  const csv = [
    ['email', 'interest', 'message', 'source', 'created_at', 'updated_at'].map(csvCell).join(','),
    ...results.map((subscriber) => [
      subscriber.email,
      subscriber.interest,
      subscriber.message,
      subscriber.source,
      subscriber.created_at,
      subscriber.updated_at,
    ].map(csvCell).join(',')),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="banthedj-signal-subscribers.csv"',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/health') {
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        return await handleSubscribe(request, env);
      } catch (error) {
        console.error(error);
        return json({ error: 'Signal could not be stored.' }, 500, headers);
      }
    }

    if (url.pathname === '/admin' && request.method === 'GET') {
      return handleAdmin(request, env);
    }

    if (url.pathname === '/admin/subscribers.csv' && request.method === 'GET') {
      return handleCsv(request, env);
    }

    return json({ error: 'Not found.' }, 404, headers);
  },
};
