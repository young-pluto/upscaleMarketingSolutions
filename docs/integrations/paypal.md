# PayPal Integration

## Purpose

PayPal is used to:

- create payment orders
- render the checkout UI in the browser
- capture approved payments

## Integration Split

The integration is split across frontend and backend.

### Frontend

`public/index.html` loads the PayPal JS SDK script.

`public/js/app.js` uses:

- `window.paypal`
- `window.paypal.Buttons(...)`

### Backend

`api/create-order.js` and `api/capture-order.js` use:

- `@paypal/paypal-server-sdk`

## Current PayPal Flow

1. Browser loads PayPal SDK
2. Browser calls `POST /api/create-order`
3. Server creates PayPal order
4. User approves payment in PayPal UI
5. Browser calls `POST /api/capture-order`
6. Server captures order through PayPal
7. Browser sends final order metadata to `POST /api/submit-order`

## Purchase Unit Shape

The server currently builds a single purchase unit for:

- `YouTube Promotion Package`
- quantity `1`
- dynamic amount based on the chosen package

It also sends:

- `customId`
- `invoiceId`
- `softDescriptor`
- `brandName`
- `returnUrl`
- `cancelUrl`

## Environment Handling Today

The server reads:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

However, there are current inconsistencies:

- The frontend PayPal client ID is hardcoded in `public/index.html`
- The tracked `env` file contains PayPal credentials
- The server code is configured for `Environment.Production`
- The tracked `env` file comment says "Sandbox"

That means the current repo has environment hygiene issues and likely deployment ambiguity.

## Error Handling

The frontend contains custom messages for:

- timeouts
- invalid request errors
- payment source verification failures
- processor declines
- unsupported payment methods
- network failures
- user cancellation

This is one of the more detailed parts of the current client UX.

## Revamp Recommendations

- Move PayPal client ID configuration out of raw HTML
- Align sandbox/production behavior across frontend and backend
- Centralize payment configuration
- Add server-side reconciliation between captured amount and stored order amount
- Add webhook support if payment lifecycle tracking becomes more sophisticated
