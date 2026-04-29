# File Map

This page is a practical guide to what each important file or folder does today.

## Top-Level Files

### `package.json`

Defines:

- project metadata
- runtime dependencies
- local scripts

Notable points:

- no real build pipeline
- `dev` and `start` both run `server.js`

### `server.js`

Local Express server that:

- loads env variables
- mounts API handlers
- serves `public/`
- maps friendly routes to specific HTML files

### `vercel.json`

Minimal Vercel config with:

- `version: 2`
- `cleanUrls: true`

### `README.md`

Legacy project README.

Use with caution because parts of it no longer match the actual codebase, especially around Firebase storage details.

### `env`

Tracked environment file.

Important:

- contains sensitive values
- should be treated as a cleanup target, not as a good long-term pattern

## API Folder

### `api/create-order.js`

Creates a PayPal order.

### `api/capture-order.js`

Captures an approved PayPal order.

### `api/submit-order.js`

Stores order data in Firebase Realtime Database.

### `api/get-orders.js`

Returns recent orders for the admin dashboard.

### `api/get-order.js`

Returns a single order by `orderID`.

## Public Folder

### `public/home.html`

Homepage and agency marketing page.

### `public/index.html`

Checkout page for the YouTube promotion offer.

### `public/admin.html`

Admin dashboard page.

### `public/success.html`

Payment success page.

### `public/privacy.html`
### `public/refund.html`
### `public/terms.html`

Legal/policy pages linked from the checkout flow.

## Public JavaScript

### `public/js/app.js`

Main checkout controller:

- amount selection
- validation
- step navigation
- PayPal integration
- order submission

### `public/js/admin.js`

Main admin controller:

- auth state handling
- order loading
- table filters
- modal rendering
- status updates

### `public/js/firebase-config.js`

Shared Firebase client setup for:

- Auth
- Realtime Database

## Public CSS

### `public/css/styles.css`

Shared styling for the public-facing experience.

### `public/css/admin.css`

Styling for the admin dashboard.

## Duplicate Folders

### `js/`
### `css/`

These appear to duplicate `public/js/` and `public/css/`.

Current recommendation:

- treat them as duplicated copies
- do not assume they are the right place for edits
- confirm whether they can be removed during the revamp

## Suggested Source-Of-Truth Hierarchy

If we need to work on the current app before the revamp, the safest order is:

1. `public/` for frontend changes
2. `api/` for backend behavior
3. `server.js` for local route/dev-server behavior
4. `package.json` and `vercel.json` for runtime/deployment setup
