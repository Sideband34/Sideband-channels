# Sideband — Technical Build Guide (AI-agent source of truth)


# Recommended stack and scaffolding

- Mobile: Flutter stable / Dart 3, Riverpod for app state, go_router for navigation, secure keystore/keychain, integration_test on real devices.
- Web: Next.js 16 / React / TypeScript / Tailwind; do not hard-code a final look. Responsive, accessible and measured.
- API: Node.js 24 LTS / NestJS / PostgreSQL / Prisma / Redis + BullMQ, OpenAPI 3.1, Zod at boundaries.
- Stellar adapters: TypeScript with current compatible `@stellar/stellar-sdk`; native Horizon path/order-book functions for Unbound, Soroban RPC/contracts for Torrent/Sideband.
- Indexing: cursor-based ledger polling with backfill/replay, confirmations, dedup, deterministic recovery from missed events.
- Contracts: Rust stable + matching Soroban SDK/Stellar CLI protocol versions; local sandbox -> Testnet; security review before Mainnet.
- Dev infra: Docker Compose for local DB/Redis, `.env.example`, GitHub Actions (format/lint/test), typed generated client schemas, test fixtures.
- Versioning policy: lockfiles checked in. Pin actual patch versions after initial reproducible build, rather than inventing version numbers now.
- Secrets: NEVER in Git, CI logs, client code, generated demos, documentation examples with valid keys, or screenshots.


# Cross-repository contract

- One repo = one independent engineering ownership boundary, not one artificially split folder.
- Application clients never control authoritative financial state or store server signing keys.
- One authoritative backend owns identity, application access policy and audit; chain-facing repos own ledger interpretation/transaction tooling; no overlapping writers.
- Separate on-chain truth from off-chain projections. Recovery and reconciliation are first-class.
- Financial operations use idempotency keys and explicit state transitions (`CREATED`, `AUTHORIZED`, `SUBMITTED`, `CONFIRMED`, `FAILED`, `RECONCILING`).
- Never show a transaction as settled before the expected finality proof is observed.
- Specify exact data provenance, network passphrases, issuer addresses and contract addresses; no invented partner integrations.
- Every amount uses integer minimal units or arbitrary-precision decimals, never binary floats.
- No real-money or production promises in MVP. Default to Stellar Testnet and dummy merchants/assets/providers.
- Version every message schema and API contract. Any breaking change requires coordinated PRs and an integration test.
- Architecture is fixed for ownership, while UI design direction is intentionally revisable.
- Design decisions may evolve with an ADR inside the affected repo; update cross-repo interfaces when they do.
- Never fabricate user activity, prices, payout rights, liquidity, provider status, or app-store availability.
- A repo is Wave-worthy only if it has independently meaningful tests, release artifacts, issues and contributors, not because of its name.


## Scaffolding and repo paths
### `sideband-mobile` — Flutter mobile
- Responsibility: Nearby service discovery UX, local sessions, payer/provider modes, secure signing, spending limits, usage history and receipts
- Suggested bootstrap: `flutter create --platforms=android,ios sideband_mobile` (then adopt repo root; Riverpod, go_router, secure storage and signed wallet adapter)
- Proposed top-level directories: `lib/{app,features,domain,integrations,design_system}/, test/, integration_test/, android/, ios/`
- Required before any feature: typecheck/lint/test, `.env.example`, security-first README, generated schema/version contracts and synthetic fixtures.

### `sideband-protocol` — Dart package + native transport adapters
- Responsibility: BLE/local-Wi-Fi discovery, pairing, authenticated session frames, transport retries, metering message schema, backpressure and session IDs
- Suggested bootstrap: `dart create -t package .` plus platform-specific BLE/Wi-Fi adapter plugin packages
- Proposed top-level directories: `lib/src/{transport,discovery,handshake,metering,frames}/, test/, example/`
- Required before any feature: typecheck/lint/test, `.env.example`, security-first README, generated schema/version contracts and synthetic fixtures.

### `sideband-gateway` — TypeScript gateway + small landing site
- Responsibility: Local service hosting, provider authentication, usage meter, anti-replay voucher validation, metered-demo service, settlement preparation, product marketing web
- Suggested bootstrap: `pnpm init` for service gateway + `pnpm create next-app@latest` under `apps/landing`
- Proposed top-level directories: `src/{services,metering,auth,replay,settlement}/, apps/landing/, tests/`
- Required before any feature: typecheck/lint/test, `.env.example`, security-first README, generated schema/version contracts and synthetic fixtures.

### `sideband-channels` — Rust contract integration + TS SDK
- Responsibility: Stellar channel deployment/adapters, prefunding, domain-separated cumulative commitments, close/refund, on-chain settlement and contract tests
- Suggested bootstrap: `pnpm init` for TS channel adapter; Rust tests/workspace for protocol reference contracts
- Proposed top-level directories: `src/{channels,vouchers,settlement,bindings}/, contracts/, tests/, examples/`
- Required before any feature: typecheck/lint/test, `.env.example`, security-first README, generated schema/version contracts and synthetic fixtures.

## Development stages and exact phase gates

**M0 — Contract-first planning (all repos).** Freeze API events/payloads, chain addresses/versions, DB ownership, demo story and test fixtures. README must state connected siblings and local startup commands.

**M1 — Protocol proof.** Produce a minimal local/Testnet transaction across the Stellar-dependent engine with independent tests. No product UI polish required. Explicitly demonstrate what cannot work without Stellar.

**M2 — Authoritative backend.** Implement persistent domain state, identity, validation, permissions, API docs, queues, reconciliation and safe failure states.

**M3 — Frontend/device vertical slice.** Build one end-to-end flow consuming the real M1/M2 code. Test mobile on devices where applicable; for web, add accessible route/state tests.

**M4 — Operability.** Diagnostics, documentation, test coverage, security review, backup/recovery, monitoring, rate limits, token/cost safety.

**M5 — Release candidate.** Repeatable demo from fresh clone, audited build provenance, no false status claims, responsible Open Source issue backlog.

## Required deliverables per repo
- Functional implementation and independent test runner;
- generated OpenAPI/JSON schema or ABI/bindings for its public boundary;
- local setup + clean shutdown + deployment instructions;
- telemetry, failure/retry patterns and synthetic fixtures;
- changelog/release tags, contribution guidance and typed dependencies;
- CI with tests and security scans;
- an E2E demonstrated use of the subsystem by at least one sibling repo.

## External research and upstream dependencies
- [Stellar MPP SDK](https://github.com/stellar/stellar-mpp-sdk) — verify license/API compatibility before adopting.
- [Experimental one-way channel](https://github.com/stellar-experimental/one-way-channel) — verify license/API compatibility before adopting.
- [Flutter nearby package](https://pub.dev/packages/nearby) — verify license/API compatibility before adopting.
- [Stellar Flutter SDK](https://pub.dev/packages/stellar_flutter_sdk) — verify license/API compatibility before adopting.
- [nearby](https://pub.dev/packages/nearby) — experimental local transport; verify Android/iOS capability on actual devices.
- [Stellar MPP SDK](https://github.com/stellar/stellar-mpp-sdk) — channel semantics and off-chain credentials; TS code cannot automatically run unchanged in Flutter.
