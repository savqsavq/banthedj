# BANTHEDJ

Astro site for `banthedj.com`, deployed by GitHub Pages.

## Local Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

GitHub Actions deploys `dist` to Pages on pushes to `main`.

## Free Email Capture Setup

GitHub Pages is static, so the signup form posts to a separate Cloudflare Worker + D1 database. The default endpoint is:

```text
https://banthedj-signal.savannahksummers.workers.dev/subscribe
```

To override it during a static build, set `PUBLIC_SIGNAL_ENDPOINT`.

Create the D1 database:

```sh
npx wrangler d1 create banthedj_signals
```

Copy the returned database ID into `workers/signal/wrangler.toml`.

Apply the schema:

```sh
npm run db:migrate:signal
```

Deploy the Worker:

```sh
npm run deploy:signal
```

Optionally connect the Worker to `signal.banthedj.com` in Cloudflare, then rebuild with:

```sh
PUBLIC_SIGNAL_ENDPOINT=https://signal.banthedj.com/subscribe npm run build
```

## Viewing Subscribers

The easiest view is the private Worker admin page:

```text
https://banthedj-signal.savannahksummers.workers.dev/admin?token=YOUR_ADMIN_TOKEN
```

After the first successful visit, the Worker stores a secure browser cookie, so future visits can use:

```text
https://banthedj-signal.savannahksummers.workers.dev/admin
```

The admin page also includes a CSV download.

Set or replace the private token with:

```sh
npx wrangler secret put ADMIN_TOKEN --config workers/signal/wrangler.toml
```

## Web Analytics

Cloudflare Web Analytics setup:

1. Open the Cloudflare dashboard and go to Web Analytics.
2. Select Add a site.
3. Add `banthedj.com`.
4. Copy the token from the JavaScript snippet.
5. Build the site with:

```sh
PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=YOUR_TOKEN npm run build
```

Cloudflare says the JS snippet goes before the closing body tag and data can take a few minutes to appear.

## Notes

- The release section automatically switches from countdown/pre-save to `OUT NOW`.
- The form stores email, interest, optional message, user agent, and a hashed IP.
- The form includes a hidden honeypot field for basic spam resistance.
- Turnstile can be added later if spam becomes a real issue.
