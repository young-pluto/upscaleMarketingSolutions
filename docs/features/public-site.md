# Public Site Feature

## Purpose

The public site does two jobs:

- Present Upscale Marketing Solutions as a premium digital marketing brand
- Funnel visitors into the YouTube promotion checkout experience

## Main Public Experiences

### Homepage

File:

- `public/home.html`

This is the top-level marketing page served at `/`.

It contains:

- brand positioning
- visual hero content
- service messaging
- links into the offer flow

### YouTube Promotion Offer / Checkout

File:

- `public/index.html`

This is the actual sales and conversion page for purchasing a YouTube promotion package.

It contains:

- package amount selector
- viewer range/value framing
- contact and YouTube link collection
- PayPal payment UI
- links to legal documents

### Success Confirmation

File:

- `public/success.html`

This closes the funnel after payment and sets expectations for fulfillment.

## Business Promise Reflected In UI

The public UI is optimized around:

- low-friction amount selection
- perceived premium positioning
- quick trust signals
- immediate checkout progression
- a promise of campaign setup and growth support

## Couplings To Be Aware Of

The public site is tightly coupled to:

- PayPal for payment
- Firebase for order storage visibility later
- hardcoded copy around viewer expectations and timelines

If the product offering changes later, the checkout copy and pricing logic will need to change together.
