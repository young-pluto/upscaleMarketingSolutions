# Upscale Marketing Solutions Docs

This folder documents the current state of the `UpscaleMarketingSolutions` codebase so future revamp work can start from a clear baseline.

The app is a small vanilla JavaScript marketing site with:

- A public landing page at `/`
- A YouTube promotion checkout flow at `/index.html`
- A PayPal-based payment flow
- Firebase-backed order storage
- A Firebase-authenticated admin dashboard at `/admin`

Important: these docs describe the code as it exists today, including inconsistencies and risks that should be addressed during the next phase of work.

## Docs Map

- [Architecture Overview](./architecture/overview.md)
- [File Map](./architecture/file-map.md)
- [System Flows](./architecture/system-flows.md)
- [Frontend Pages](./frontend/pages.md)
- [Checkout Frontend](./frontend/checkout-flow.md)
- [Backend API Routes](./backend/api-routes.md)
- [Public Site Feature](./features/public-site.md)
- [Admin Dashboard Feature](./features/admin-dashboard.md)
- [PayPal Integration](./integrations/paypal.md)
- [Firebase Integration](./integrations/firebase.md)
- [Development and Deployment](./operations/development-deployment.md)
- [Known Issues and Revamp Backlog](./operations/known-issues.md)

## Repo Snapshot

Current top-level structure:

```text
api/               Serverless-style API route handlers
public/            Actual static frontend used by Express/Vercel
css/               Duplicate copy of public/css
js/                Duplicate copy of public/js
server.js          Local Express dev server
vercel.json        Vercel config
env                Tracked environment file with secrets
```

## What Matters Most For Future Work

- `public/` is the source of truth for the current frontend runtime.
- `server.js` mounts the API handlers for local development.
- The checkout flow is centered in `public/index.html` and `public/js/app.js`.
- The admin workflow is centered in `public/admin.html` and `public/js/admin.js`.
- Order data is stored in Firebase Realtime Database under `orders/`.
- Payment creation and capture are handled through PayPal server-side API calls.

## Documentation Philosophy

These docs intentionally separate:

- What the app does today
- How the pieces connect
- Where the code is inconsistent
- What should be cleaned up during the revamp

That way we can use this folder both as onboarding material and as a migration checklist later.
