# BANTHEDJ

Astro site for `banthedj.com`, deployed on Cloudflare Workers.

## Local Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Free Email Capture Setup

The signup form posts to `/api/subscribe`. It expects a Cloudflare D1 binding named `DB`.

Create the free D1 database:

```sh
npx wrangler d1 create banthedj_signals
```

Copy the returned `database_id` into `wrangler.jsonc` by uncommenting the `d1_databases` block.

Apply the schema:

```sh
npx wrangler d1 migrations apply banthedj_signals --remote
```

Deploy:

```sh
npm run deploy
```

Until the D1 binding is configured, the form UI will load but submissions will return:

```text
Signal storage is not configured yet.
```

## Notes

- The release section automatically switches from countdown/pre-save to `OUT NOW`.
- The form stores email, interest, optional message, user agent, and a hashed IP.
- The form includes a hidden honeypot field for basic spam resistance.
- Turnstile can be added later if spam becomes a real issue.
