# UX Routes & Brand Delivery (implementation brief, not locked art direction)

## Primary experience map
1. Mobile local-permission onboarding
2. Nearby service discovery
3. Provider identity and metered rate review
4. Channel pre-funding while online
5. Peer connection state and spend cap
6. Live metering + voucher authorization
7. Offline session closure and pending settlement
8. Reconnection, final on-chain settlement and receipts

## Landing / discoverability
`sideband-gateway/apps/landing`: dedicated mobile marketing homepage, device capability matrix, how offline vouchers work vs real settlement, provider/developer docs, privacy/safety FAQs, official Apple and Google download badges when published.

## Interaction rules
- Do not imply a payment finalized until Stellar confirms it.
- Prefer one unmistakable primary CTA and clear financial disclosure over experimental visual gimmicks.
- Accessibility: keyboard and screen-reader semantics on web, reduced motion, useful focus, large tap targets on mobile.
- All transitions, fonts, layouts and hero art are open to revision by the building/design agent, with explicit design review.
- Official store badge guidance: https://developer.apple.com/app-store/marketing/guidelines/ and Google Play brand resources. Do not recreate the vendor badges with generative art.
