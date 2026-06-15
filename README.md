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

GitHub Pages is static, so the signup form cannot store emails by itself. The form is present, but it currently shows:

```text
Signal backend coming soon.
```

When ready, create a separate free Cloudflare Worker + D1 database and set the form's `data-endpoint` in `src/pages/index.astro` to that Worker URL.

Create the D1 database:

```sh
npx wrangler d1 create banthedj_signals
```

Apply the schema:

```sh
npx wrangler d1 migrations apply banthedj_signals --remote
```

## Notes

- The release section automatically switches from countdown/pre-save to `OUT NOW`.
- The form stores email, interest, optional message, user agent, and a hashed IP.
- The form includes a hidden honeypot field for basic spam resistance.
- Turnstile can be added later if spam becomes a real issue.
