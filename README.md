<img src="./brand/icon.svg" alt="Sideband logo" width="144" />

# sideband-channels

> Sideband — Nearby services. Metered value. Stellar settlement.

**Status: repository scaffold / not implemented.** This repo is one of **exactly four meaningful independent codebases** in the Sideband Stellar-native project. It is not a placeholder created merely to increase Drips Wave submissions.

## Owns
Stellar channel deployment/adapters, prefunding, domain-separated cumulative commitments, close/refund, on-chain settlement and contract tests

## Why it is separate
It has a distinct runtime/toolchain, external interface, tests, release cadence and maintainership boundary. Its siblings depend on its delivered interface, but implementation responsibilities must not be duplicated.

## Sibling repositories
- `sideband-mobile` — Nearby service discovery UX, local sessions, payer/provider modes, secure signing, spending limits, usage history and receipts
- `sideband-protocol` — BLE/local-Wi-Fi discovery, pairing, authenticated session frames, transport retries, metering message schema, backpressure and session IDs
- `sideband-gateway` — Local service hosting, provider authentication, usage meter, anti-replay voucher validation, metered-demo service, settlement preparation, product marketing web

## Architecture and development context
Start with:
- `AGENTS.md` — coding agent rules;
- `docs/PRD.md` — product purpose and MVP;
- `docs/SRD.md` — user/system requirements, APIs and state;
- `docs/ARCHITECTURE.md` — four-repository responsibilities, data and execution paths;
- `docs/TECHNICAL_BUILD.md` — recommended bootstrap, testing, phases;
- `docs/SECURITY.md` — security/trust boundaries;
- `docs/BRAND.md` — approved flat logo and flexible UI direction;
- `docs/ROADMAP.md` — milestone acceptance gates.

## Technical target
Rust contract integration + TS SDK. The actual product implementation starts at milestone M0; no real-money transactions or claims exist in this scaffold.

## Minimal integration contract
Always test the dependency path stated in ARCHITECTURE.md. Every new public endpoint/ABI/package message must be versioned and covered by consumer fixtures. See `docs/SRD.md` and `docs/TECHNICAL_BUILD.md`.

## Drips Wave
Stellar is essential: An online setup transaction deposits a supported Stellar asset into a Soroban one-way payment channel bound to a provider and payer commitment key. Approval/eligibility for Wave depends on substantive open-source implementation and organizer review, not repo count.


## Official project identity

The project uses the **approved flat SVG logo** in [`brand/icon.svg`](./brand/icon.svg), with an editable transparent vector mark in [`brand/mark.svg`](./brand/mark.svg). The [512 px GitHub organization avatar](./brand/org-avatar.png) is in the same directory. This logo is shared by all four project repositories. UI design remains intentionally flexible.
