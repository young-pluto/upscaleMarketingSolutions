# Development and Deployment

## Local Development

Primary local command:

```bash
npm run dev
```

This starts `server.js`, which:

- loads environment variables
- mounts API routes
- serves static assets from `public/`
- maps friendly routes like `/`, `/admin`, and `/success`

Default port:

- `3000` unless `PORT` is set

## Package Scripts

From `package.json`:

- `npm run dev` -> run local Express server
- `npm run build` -> placeholder echo
- `npm start` -> run local Express server
- `npm run deploy` -> `vercel --prod`

## Deployment Model

The intended deployment target is Vercel.

`vercel.json` currently contains:

- version `2`
- `cleanUrls: true`

That is a minimal setup and suggests the app relies on Vercel defaults for static files plus the `api/` directory.

## Environment Variables

The code expects values for:

- PayPal credentials
- Firebase Admin values
- Firebase web config values
- `NODE_ENV`
- `PORT` for local server, if needed

## Current Environment Problems

The repo currently contains a tracked `env` file with sensitive values, and backend files also embed Firebase admin secrets directly in source code.

Before any real deployment or collaboration expansion, secret handling should be corrected.

## Useful Working Assumptions

- `public/` is the deployable static app
- `api/` is the deployable backend surface
- `server.js` exists for local convenience rather than as the main production runtime

## Suggested Future Ops Improvements

- add `.env.example`
- remove tracked secret files
- centralize config loading
- add linting/formatting/test scripts
- add staging vs production environment separation
- document domain, PayPal, and Firebase setup in a deployment checklist
