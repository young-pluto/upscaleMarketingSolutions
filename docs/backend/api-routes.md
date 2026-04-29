# Backend API Routes

## Overview

The backend consists of five API handlers in `api/`. They are written as default-exported request handlers and are compatible with both:

- Express mounting in `server.js`
- Vercel-style serverless routing

All handlers set permissive CORS headers and respond to `OPTIONS`.

## Route List

### `POST /api/create-order`

File:

- `api/create-order.js`

Purpose:

- Creates a PayPal order for the selected amount

Input:

```json
{
  "amount": 25,
  "currency": "USD"
}
```

Behavior:

- Rejects amounts below `10`
- Rejects amounts above `1000`
- Builds a single-item purchase unit
- Sets PayPal application context return and cancel URLs from request origin
- Returns the PayPal order payload

Notes:

- Server-side amount ceiling is `1000`
- Frontend custom amount ceiling is `500`
- Slider ceiling is `200`

These limits are inconsistent today.

### `POST /api/capture-order`

File:

- `api/capture-order.js`

Purpose:

- Captures an approved PayPal order

Input:

```json
{
  "orderID": "PAYPAL_ORDER_ID"
}
```

Behavior:

- Validates `orderID`
- Calls PayPal capture API
- Returns the PayPal capture payload

### `POST /api/submit-order`

File:

- `api/submit-order.js`

Purpose:

- Stores the completed order in Firebase Realtime Database

Required fields:

- `orderID`
- `amount`
- `youtubeLink`
- at least one of `email` or `phone`

Stored fields include:

- customer info
- PayPal metadata
- timestamps
- IP address
- user agent
- `serviceStatus`
- `adminNotes`

Database location:

- `orders/` in Firebase Realtime Database

### `GET /api/get-orders`

File:

- `api/get-orders.js`

Purpose:

- Fetches recent orders for the admin dashboard

Behavior:

- Queries `orders`
- Orders by `createdAt`
- Limits to the last `100`
- Reverses the result so newest items appear first

Response shape:

```json
{
  "success": true,
  "orders": [],
  "count": 0
}
```

### `GET /api/get-order`

File:

- `api/get-order.js`

Purpose:

- Fetches a single order by PayPal order ID

Query parameter:

- `orderId`

Behavior:

- Queries Firebase for records where `orderID === orderId`
- Returns the first match

## Local Server

`server.js` mounts the routes like this:

- `app.post('/api/create-order', createOrder)`
- `app.post('/api/capture-order', captureOrder)`
- `app.post('/api/submit-order', submitOrder)`
- `app.get('/api/get-orders', getOrders)`
- `app.get('/api/get-order', getOrder)`

It also serves static pages from `public/`.

## Backend Design Observations

- There is no shared service layer between handlers.
- Firebase initialization logic is repeated across multiple files.
- PayPal client initialization is duplicated across payment handlers.
- Authentication and authorization are not enforced on `get-orders` and `get-order`.
- The admin UI relies on Firebase Auth in the browser, but the API itself does not validate admin identity.

Those points should shape a cleanup plan during the revamp.
