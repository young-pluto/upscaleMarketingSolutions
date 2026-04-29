# Known Issues And Revamp Backlog

This page captures the main cleanup targets exposed by the current codebase.

## High-Priority Risks

### Secrets are committed to the repo

Observed issues:

- tracked `env` file contains secrets
- Firebase Admin private key values are hardcoded in API files
- payment config is split between env values and hardcoded frontend values

Why it matters:

- major security risk
- difficult environment management
- unclear production/sandbox separation

### Admin API access is not server-authorized

Observed issues:

- `GET /api/get-orders` and `GET /api/get-order` do not verify admin identity
- admin updates are written directly from the browser to Firebase

Why it matters:

- server-side authorization is weak or absent
- behavior depends heavily on Firebase rules

## Medium-Priority Structural Problems

### Duplicate asset trees

Observed issues:

- `public/js` and `js` are duplicates
- `public/css` and `css` are duplicates

Why it matters:

- easy to edit the wrong copy
- unclear source of truth

### Repeated initialization code

Observed issues:

- Firebase Admin initialization repeated across multiple API handlers
- PayPal client setup repeated across payment handlers

Why it matters:

- harder maintenance
- inconsistent future changes likely

### Inconsistent business constraints

Observed issues:

- slider max is `200`
- custom amount max is `500`
- API create-order max is `1000`

Why it matters:

- business rules are not centralized
- frontend and backend can drift

### README drift

Observed issues:

- README says Firestore
- code uses Realtime Database

Why it matters:

- onboarding confusion
- integration mistakes during future work

## Product And UX Limitations

- Checkout business logic lives directly in page JavaScript
- Success and error handling in admin is basic
- No analytics or observability layer
- No automated tests
- No formal API schema or validation layer
- No server-side reconciliation or webhook-driven payment auditing

## Good Revamp Starting Points

1. Fix secret management first.
2. Establish a single config module for environment values.
3. Remove duplicated `css/` and `js/` copies or declare one source of truth.
4. Extract Firebase and PayPal helper modules for the backend.
5. Decide whether admin updates should move behind authenticated backend routes.
6. Decide whether the next frontend should remain static/vanilla or move to a framework.
7. Revisit the data model and whether Realtime Database still fits future reporting needs.
