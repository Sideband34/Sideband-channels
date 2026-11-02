<img src="./brand/icon.svg" alt="Sideband logo" width="144" />

# sideband-channels

> Sideband — Nearby services. Metered value. Stellar settlement.

**Status: M0/M1 core implemented (see Status section below); Testnet integration NOT done.** This repo is one of **exactly four meaningful independent codebases** in the Sideband Stellar-native project. It is not a placeholder created merely to increase Drips Wave submissions.

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


## Status: M0/M1 core (v0.1.0)

**Implemented and tested**

- `src/vouchers`: domain-separated cumulative voucher creation/verification (ed25519 via `@stellar/stellar-sdk`), binding network, channel, payer and provider. Atomic compare-and-swap acceptance (`acceptVoucher` + `VoucherStore`): replay, rollback, over-deposit, over-budget, expiry, wrong network/channel, tamper and concurrent-race cases.
- `src/channels`: `ChannelAdapter` interface + `InMemoryChannelAdapter`, a **labeled test adapter** (every receipt is `synthetic: true`; no ledger).
- `src/settlement`: settlement intent state machine (`CREATED -> AUTHORIZED -> SUBMITTED -> CONFIRMED`, `RECONCILING` after a post-submit timeout; `CONFIRMED` needs finality evidence for the right network).
- `contracts/channel`: Soroban reference contract (`init` / provider `close` / payer `refund` after expiry) with Rust tests run in the Soroban test environment, including TS-signed golden vectors, wrong network, wrong channel, tamper, double close and provider-shutdown refund.
- Network policy: public network refused, unknown passphrases fail closed.

**Verified:** `npm run check` (prettier, eslint, tsc, 32 vitest tests) and `cd contracts && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (9 tests).

**NOT done / unverified**

- No Testnet deployment, no real transaction hashes: the Soroban RPC adapter does not exist yet, and the contract has only been run in the SDK test environment (the WASM build needs `stellar-cli`, not run here).
- The voucher layout is `sideband-test-format-v1`, **not** upstream `one-way-channel`/`stellar-mpp-sdk` compatible and **not audited** (see `docs/adr/0001-voucher-test-format.md`). Testnet/synthetic only.
- Dev-tooling `npm audit` reports a moderate `minimatch` advisory via eslint; production dependencies are unaffected.

## Quick start

```
npm ci
npm run check          # format, lint, typecheck, tests
npm run fixtures       # regenerate fixtures/voucher-vectors.json
npx tsx examples/offline-session.ts
cd contracts && cargo test
```

## Siblings and compatibility

| Repo | Contract |
|---|---|
| `sideband-protocol` v0.1.0 | `VoucherFrame {channelRef, cumulativeAmount, commitment, signature}`: `cumulativeAmount` uses the same canonical 7-decimal string; `commitment` = hex sha256(preimage), `signature` = hex ed25519 |
| `sideband-gateway` | consumes `acceptVoucher`, `VoucherStore`, `prepareSettlement` |
| `sideband-mobile` | needs a Dart port of `buildPreimage`/signing, validated against `fixtures/voucher-vectors.json` |
