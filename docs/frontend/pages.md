# Frontend Pages

## Source Of Truth

The active frontend files live in `public/`.

The root-level `js/` and `css/` directories appear to be duplicate copies of the `public/js/` and `public/css/` assets and are not the best place to make future edits unless the duplication is intentionally preserved.

## Page Inventory

### `public/home.html`

Purpose:

- Main marketing landing page for Upscale Marketing Solutions
- Presents broader agency branding beyond just the YouTube promotion offer

Characteristics:

- Inline CSS-heavy page
- Includes social metadata and hosted image assets
- Acts as the homepage served from `/`

### `public/index.html`

Purpose:

- Main checkout funnel for YouTube promotion services

Characteristics:

- Four-step single-page checkout
- Loads PayPal SDK
- Loads `public/js/app.js`
- Uses `public/css/styles.css`

### `public/admin.html`

Purpose:

- Admin dashboard for order review and updates

Characteristics:

- Firebase Auth-based login
- Loads `public/js/firebase-config.js`
- Loads `public/js/admin.js`
- Uses `public/css/admin.css`

### `public/success.html`

Purpose:

- Post-payment confirmation page

Characteristics:

- Reads order data from query params
- Falls back to `GET /api/get-order` when needed

### `public/terms.html`
### `public/privacy.html`
### `public/refund.html`

Purpose:

- Legal and policy pages linked from the checkout footer

Characteristics:

- Mostly static content
- Share the general visual language of the checkout site

## Shared Frontend Assets

### `public/css/styles.css`

Main styling for:

- Checkout page
- Success page
- Legal pages

### `public/css/admin.css`

Styling for:

- Admin login screen
- Admin dashboard
- Table, modal, filters, and stats UI

### `public/js/firebase-config.js`

Initializes:

- Firebase app
- Realtime Database
- Firebase Auth

This module is imported by both public checkout/admin JavaScript.

## Frontend Style Notes

The frontend is plain HTML/CSS/JavaScript with no framework, build step, or component system. That makes it easy to understand, but it also means:

- UI logic is coupled directly to DOM IDs and selectors
- Reuse is limited
- Styling is page-oriented rather than component-oriented
- Future redesign work can be done incrementally or through a full rewrite
