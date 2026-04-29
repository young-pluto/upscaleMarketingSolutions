# Checkout Frontend

## Main Files

- `public/index.html`
- `public/js/app.js`
- `public/css/styles.css`

## Checkout Structure

The checkout page is a four-step wizard:

1. Choose Package
2. Campaign Details
3. Your Information
4. Complete Order

All steps live on the same page and are shown/hidden by JavaScript.

## Core Client Class

`public/js/app.js` defines `YouTubePromotionApp`, which owns most checkout behavior:

- amount selection
- step navigation
- field validation
- PayPal button setup
- payment capture handling
- order submission
- loading overlays and messages

## Amount Selection Rules

Current rules in the UI:

- Slider range: `$10` to `$200`
- Slider snaps to `$5` increments
- Custom amount allows `$10` to `$500`
- Quick-pick buttons provide common amounts

Viewer range estimation is calculated from the amount:

- Base at `$10`: `1000-1500`
- Each additional `$5`: add `500` to both min and max

This is purely a frontend display rule and not an API-managed pricing model.

## Form Requirements

Required:

- `youtubeLink`
- at least one of `email` or `phone`

Optional:

- `fullName`

Validation is handled client-side before PayPal setup proceeds.

## PayPal Button Lifecycle

When the user reaches step 4:

1. The app checks whether `window.paypal` exists
2. The existing PayPal container is cleared
3. `window.paypal.Buttons({...}).render(...)` is called

The client handles these PayPal callbacks:

- `createOrder`
- `onApprove`
- `onError`
- `onCancel`
- `onInit`

## Payment Flow In The Browser

### `createOrder`

Client sends:

```json
{
  "amount": 10,
  "currency": "USD"
}
```

to `POST /api/create-order`.

### `onApprove`

After approval:

1. Client shows a full-page loading overlay
2. Client calls `POST /api/capture-order`
3. Client validates the PayPal response shape
4. Client extracts capture or authorization data
5. Client calls `storeOrderData(...)`
6. Client redirects to `/success`

### `storeOrderData`

Client sends this order payload to `POST /api/submit-order`:

- `orderID`
- `amount`
- `currency`
- `youtubeLink`
- `fullName`
- `email`
- `phone`
- `timestamp`
- `paypalData`
- `status`

## UX Behavior

The checkout JS includes several UX-focused details:

- Inline step progress states
- Expand/collapse campaign preview
- Separate loading overlays for payment states
- Custom error messages for several PayPal failure scenarios
- Auto-hiding result messages

## Current Limitations

- Business rules are embedded directly in the browser code.
- Pricing logic is not centralized on the server.
- The page mixes marketing copy, business logic, and payment orchestration.
- The PayPal client ID is embedded directly in HTML.
- There is no server-side validation tying submitted order details to the captured payment amount.

These are good candidates for the revamp.
