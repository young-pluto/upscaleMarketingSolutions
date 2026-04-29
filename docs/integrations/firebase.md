# Firebase Integration

## What Firebase Is Used For

Firebase currently handles two separate concerns:

- Realtime Database for order storage
- Firebase Auth for admin login

## Frontend Firebase Usage

File:

- `public/js/firebase-config.js`

This file initializes:

- Firebase app
- Realtime Database
- Firebase Auth

It is imported by:

- `public/js/app.js`
- `public/js/admin.js`

## Backend Firebase Usage

The API handlers `api/submit-order.js`, `api/get-orders.js`, and `api/get-order.js` use `firebase-admin`.

They initialize a Firebase Admin app and then read/write:

- `orders/` in Realtime Database

## Data Shape

An order currently includes fields such as:

- `orderID`
- `amount`
- `currency`
- `youtubeLink`
- `fullName`
- `email`
- `phone`
- `timestamp`
- `status`
- `createdAt`
- `updatedAt`
- `paypalTransactionId`
- `paypalStatus`
- `paypalCreateTime`
- `paypalUpdateTime`
- `ipAddress`
- `userAgent`
- `serviceStatus`
- `notes`
- `adminNotes`

## Query Patterns

### Fetch recent orders

- order by `createdAt`
- limit to last 100

### Fetch a single order

- filter where `orderID` matches the PayPal order ID

### Update order from admin UI

- direct client update to `orders/{firebaseKey}`

## Security Reality Today

The project currently has serious secret-management issues:

- service account values appear in tracked files
- service account values are hardcoded directly in backend files
- frontend Firebase config is checked in

Checking in frontend Firebase config can be normal depending on rules and design, but checking in admin credentials or private keys is not.

## Documentation Correction

The repository README mentions Firestore, but the actual code uses Firebase Realtime Database.

Any future docs, refactors, or migrations should use Realtime Database as the baseline unless the data layer is intentionally changed.

## Revamp Opportunities

- Move Firebase Admin initialization into one shared module
- Read secrets only from environment variables
- Add explicit server-side admin authorization for management actions
- Revisit whether Realtime Database is still the right fit or whether Firestore would better match future querying needs
