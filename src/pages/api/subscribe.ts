import type { APIRoute } from 'astro';

type RuntimeWithEnv = {
  runtime?: {
    env?: {
      DB?: {
        prepare: (query: string) => {
          bind: (...values: unknown[]) => {
            run: () => Promise<unknown>;
          };
        };
      };
    };
  };
};

const ALLOWED_INTERESTS = new Set([
  'serum-presets',
  'unreleased-drops',
  'production-notes',
  'shows',
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function hashText(value: string) {
  if (!value) return '';
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const POST: APIRoute = async (context) => {
  const db = (context.locals as RuntimeWithEnv).runtime?.env?.DB;
  if (!db) {
    return json({ error: 'Signal storage is not configured yet.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid submission.' }, 400);
  }

  const email = normalizeEmail(body.email);
  const interest = ALLOWED_INTERESTS.has(String(body.interest)) ? String(body.interest) : 'serum-presets';
  const message = cleanText(body.message, 500);
  const website = cleanText(body.website, 120);

  if (!isValidEmail(email)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }

  if (website) {
    return json({ ok: true });
  }

  const now = new Date().toISOString();
  const ip =
    context.request.headers.get('CF-Connecting-IP') ||
    context.request.headers.get('x-forwarded-for') ||
    '';
  const ipHash = await hashText(ip);
  const userAgent = context.request.headers.get('user-agent') || '';

  try {
    await db
      .prepare(`
        INSERT INTO subscribers (email, interest, message, source, ip_hash, user_agent, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'website', ?4, ?5, ?6, ?6)
        ON CONFLICT(email) DO UPDATE SET
          interest = excluded.interest,
          message = excluded.message,
          updated_at = excluded.updated_at
      `)
      .bind(email, interest, message, ipHash, userAgent.slice(0, 300), now)
      .run();

    return json({ ok: true });
  } catch {
    return json({ error: 'Could not save the signal. Try again later.' }, 500);
  }
};
