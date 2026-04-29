# Architecture Overview

## High-Level Summary

This project is a mostly static web application with a thin Node/Express wrapper for local development and a small set of serverless-style API handlers for payment and order management.

The main architectural pieces are:

- Static HTML/CSS/JS pages in `public/`
- Client-side PayPal checkout logic in `public/js/app.js`
- Client-side admin dashboard logic in `public/js/admin.js`
- API handlers in `api/`
- Firebase Realtime Database for order storage
- Firebase Auth for admin sign-in
- PayPal Orders API for payment creation and capture

## Runtime Model

There are effectively two runtime modes:

### 1. Local development

`server.js` starts an Express server, mounts the API route handlers, and serves `public/`.

### 2. Vercel deployment

Vercel can serve static files plus the files inside `api/` as serverless functions.

## Main User-Facing Routes

- `/` -> `public/home.html`
- `/index.html` -> checkout page
- `/admin` -> `public/admin.html`
- `/success` -> `public/success.html`
- `/terms.html` -> terms page
- `/privacy.html` -> privacy page
- `/refund.html` -> refund page

## Backend Surface Area

The backend is intentionally small:

- `POST /api/create-order`
- `POST /api/capture-order`
- `POST /api/submit-order`
- `GET /api/get-orders`
- `GET /api/get-order`

## Data Ownership

- PayPal owns payment creation/capture state
- Firebase Realtime Database owns internal order records
- Firebase Auth owns admin login state
- The browser owns most UI state during checkout

## Current Structural Oddities

There are several codebase quirks worth knowing before any refactor:

- `public/js/*` and `js/*` are duplicated.
- `public/css/*` and `css/*` are duplicated.
- The checked-in `README.md` describes Firestore, but the code actually uses Firebase Realtime Database.
- Sensitive credentials are present in tracked files and also hardcoded in server code.
- The Express server is useful for local development, but the project shape is still largely Vercel-style rather than a full MVC server app.

## Recommended Mental Model

Treat the current app as:

1. A static marketing frontend
2. A client-rendered checkout wizard
3. A tiny payment/order API layer
4. A separate admin console over the same order data

That model matches the actual code better than thinking of this as a traditional full-stack framework app.
