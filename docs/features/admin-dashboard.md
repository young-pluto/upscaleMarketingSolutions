# Admin Dashboard Feature

## Purpose

The admin dashboard is a lightweight internal tool for:

- logging in as an admin
- reviewing submitted orders
- checking customer details
- updating service delivery status
- saving admin notes

## Main Files

- `public/admin.html`
- `public/js/admin.js`
- `public/js/firebase-config.js`
- `public/css/admin.css`

## Authentication Model

The admin screen uses Firebase Auth email/password sign-in directly from the browser.

Flow:

1. Admin opens `/admin`
2. Firebase auth state listener runs
3. If signed out, login form is shown
4. If signed in, dashboard is shown

## Data Loading

After login, the dashboard fetches order data from:

- `GET /api/get-orders`

The UI stores the response in:

- `this.orders`
- `this.filteredOrders`

## Dashboard Capabilities

### Summary cards

Shows:

- total revenue
- total orders
- pending orders
- completed orders

### Table browsing

Supports:

- text search
- status filtering
- sort by date or amount

### Order modal

Shows:

- order ID
- date
- amount
- YouTube link
- customer identity/contact
- PayPal transaction ID
- service status selector
- admin notes textarea

### Status update

The modal saves changes directly to Firebase Realtime Database using the Firebase client SDK:

- updates `serviceStatus`
- updates `adminNotes`
- updates `updatedAt`

## Important Architecture Detail

The admin dashboard does not call a protected backend update route to save status changes. It writes directly from the client to Firebase.

That means access control depends heavily on Firebase rules and correct client auth setup, not on a server-side authorization layer.

## Current Limitations

- Success/error handling uses `alert(...)`
- No pagination
- Only last 100 orders are returned by the API
- No audit trail for admin edits
- No server-verified admin API layer
- No distinction between multiple admin roles

For a revamp, this area could become a stronger operations tool without requiring a huge rewrite.
