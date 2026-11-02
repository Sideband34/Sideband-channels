# Sideband — Master Context / Index

This is the full product context of the Sideband four-repo system. Docs are mirrored here to keep every repo standalone for coding agents. **The canonical maintained copy is in `sideband-gateway`.** Before merging breaking changes sync all mirrors via a script/CI.

# Sideband — Product Requirements Document

**Status:** technical product specification, preimplementation. **Platform:** Flutter mobile (iOS/Android) + local provider/gateway + landing in gateway.  **Target:** Stellar Testnet demo, real adoption only after risk/legal validation.

## Vision
A local service microcommerce protocol. Compatible nearby devices negotiate a metered service over Bluetooth/local Wi-Fi and exchange signed cumulative payment commitments. A payer has previously funded a Stellar channel while online; offline service usage is later settled on-chain when connectivity returns. The voucher itself is not instant final money transfer.

## Who needs it
Local providers of genuinely useful digital services: demo text conversion, local captions, metered edge processing or local network access where permitted.

## Core user outcomes
- advertise and discover supported metered local services
- verify local provider identity and service manifest
- open or bind a previously funded Stellar payment channel online
- negotiate service units, price cap, expiry and refund policy
- consume a local service with monotonic signed payment commitments
- close/settle the channel when connectivity returns and verify statement

## Core customer journey
1. Provider announces a local test service and a signed price/units manifest.
2. Payer pre-funds a supported Stellar channel while online.
3. Two physical devices discover and negotiate over BLE/local Wi-Fi, then go offline.
4. Provider delivers a small locally hosted service; usage meter emits verifiable units.
5. Payer authorizes incremental cumulative signed commitments under an explicit spending cap.
6. Provider verifies vouchers locally without claiming final settlement.
7. On reconnect, channel settlement is submitted to Stellar and shown as confirmed after chain verification.

## Functional requirements
- advertise and discover supported metered local services
- verify local provider identity and service manifest
- open or bind a previously funded Stellar payment channel online
- negotiate service units, price cap, expiry and refund policy
- consume a local service with monotonic signed payment commitments
- close/settle the channel when connectivity returns and verify statement

## Non-goals for first MVP
- claim that brand-new parties can freely exchange final Stellar money with zero connectivity
- unbounded off-chain credits
- automatic access to other people’s network or paid service without permission
- full decentralized roaming service marketplace or production cash payouts

## Safety and commercial reality
- A brand new payer/provider channel normally needs connectivity before use.
- Signed offline vouchers are commitments, not settled cash. The provider bears channel/settlement risk.
- BLE throughput is small; negotiate over BLE then prefer local Wi-Fi for sustained service transfer.
- Android/iOS Bluetooth background/discovery permissions vary; physical-device testing required.
- Experimental one-way-channel contracts require security review before real-money deployment.

## Core success measures
- time to discover+pair
- offline voucher verification latency
- usage meter discrepancy
- successful settlement after reconnect
- replay/rollback rejection
- real device compatibility matrix

## Acceptance tests
- Two physical phones discover and pair locally using BLE/local Wi-Fi.
- A Testnet channel was funded while online, before disconnected session.
- With internet disabled, a metered synthetic service delivers units and multiple valid vouchers.
- Replay, lower cumulative amount, unauthorized device and incorrect channel domain are rejected.
- After internet returns, provider closes channel and amount matches authorized usage.
- Offline UI never claims final settlement prior to on-chain confirmation.

## Repository architecture
See `ARCHITECTURE.md`. Exactly four repos are proposed as stable engineering ownership boundaries. Reducing or increasing them requires a written technical justification, not reward optimization.

---
# Sideband — Software Requirements & Domain Specification

## System boundaries
A local service microcommerce protocol. Compatible nearby devices negotiate a metered service over Bluetooth/local Wi-Fi and exchange signed cumulative payment commitments. A payer has previously funded a Stellar channel while online; offline service usage is later settled on-chain when connectivity returns. The voucher itself is not instant final money transfer.

### Domain objects (minimum initial schema)
- DeviceIdentity: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- ServiceOffer: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- LocalSession: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- RatePlan: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- UsageMeter: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- ChannelBinding: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- Voucher: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- ReplayWindow: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- SettlementAttempt: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- ProviderReceipt: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields
- TransportDiagnostic: UUID/opaque public ref + timestamps + status/metadata, no unverified external fields

### State transitions
- financial request/transaction: DRAFT -> VERIFIED -> AWAITING_SIGNATURE -> SUBMITTED -> CONFIRMED; failures go to FAILED or RECONCILING.
- authorization is evaluated server-side before signature requests.
- network confirmations trigger reconciliation; queued retries are idempotent and observable.
- ledger watchers must process duplicate events safely and replay historical ranges.

### Stable public API endpoints (v1 initial contract)
- GET /v1/health
- GET /.well-known/sideband-service.json
- POST /v1/sessions/offer
- POST /v1/sessions/accept
- POST /v1/sessions/:id/meter
- POST /v1/sessions/:id/vouchers
- GET /v1/sessions/:id/usage
- POST /v1/channels/:id/settle
- GET /v1/channels/:id/status

**Request/response convention:** JSON keys camelCase; public IDs opaque; `requestId` and `schemaVersion` included in asynchronous requests; error schema `{"error":{"code":"STRING_ENUM","message":"safe summary","requestId":"opaque"}}`. All writes requiring on-chain action return a stateful intent, not a fake immediate success. Produce OpenAPI documentation and integration fixtures before client implementation.

### Authoritative data ownership
- The main API owns users, policy, product workflow and off-chain financial obligations.
- The Stellar owner repo owns network adapters and ledger protocol semantics; do not duplicate transaction-building code in web/mobile.
- The user signs funds movement; server signing, if any, must use scoped secure keys and explicit sponsorship logic.
- Client caches are not accounting books.

### Failure modes to design first
- A brand new payer/provider channel normally needs connectivity before use.
- Signed offline vouchers are commitments, not settled cash. The provider bears channel/settlement risk.
- BLE throughput is small; negotiate over BLE then prefer local Wi-Fi for sustained service transfer.
- Android/iOS Bluetooth background/discovery permissions vary; physical-device testing required.
- Experimental one-way-channel contracts require security review before real-money deployment.
- repeated HTTP submit with same idempotency key -> exactly one business intent;
- chain timeout after submission -> RECONCILING, never assume failed or retry with changed parameters;
- stale quote / stale pool state / expired channel -> require new user approval;
- unrecognized network passphrase or issuer -> fail closed;
- disconnect / process crash -> resumable, replayable state;
- reconciliation discrepancy -> pause sensitive actions pending investigation.

### Performance baselines (engineering targets, not guarantees)
- local API reads p95 < 500ms under synthetic demo load;
- ledger confirmation times must reflect actual Testnet conditions, never a fixed animation;
- background jobs: retry bounded with dead-letter visibility;
- mobile poor-network state includes retry, offline read-only and recovery messaging;
- audit records capture actor, scope, action, time, object and request id, never secret keys.

### Security
- secure device key storage; no raw signing seeds in browser persistent storage;
- RBAC per role and resource; validated typed schemas for all inputs;
- TLS for network APIs, explicit local peer protocol auth for Sideband;
- no fake fiat settlement or institutional verification;
- rate limits, security logging without sensitive leakage, backup/restore, secret rotation;
- Testnet is default; Mainnet requires external review and compliance planning.

### QA
- domain state-machine unit tests; API integration tests; chain/sandbox end-to-end tests;
- on-chain amount and signature tests; invalid/missing auth; replay/rollback tests;
- client error/offline/permission tests; no secrets in builds;
- reproducible full product demo with documented assertions.

---
# Sideband — Cross-repository Architecture

## Why exactly four repositories?
These are four distinct deployable/reusable engineering domains. They must remain independently testable and publishable. Splitting arbitrary features into extra repos solely for Wave incentives is prohibited.

| Repository | Independent ownership | Outputs | Consumers |
|---|---|---|---|
| `sideband-mobile` | Nearby service discovery UX, local sessions, payer/provider modes, secure signing, spending limits, usage history and receipts | Flutter mobile | product users or other repo services |
| `sideband-protocol` | BLE/local-Wi-Fi discovery, pairing, authenticated session frames, transport retries, metering message schema, backpressure and session IDs | Dart package + native transport adapters | other project repos via versioned API/SDK |
| `sideband-gateway` | Local service hosting, provider authentication, usage meter, anti-replay voucher validation, metered-demo service, settlement preparation, product marketing web | TypeScript gateway + small landing site | product users or other repo services |
| `sideband-channels` | Stellar channel deployment/adapters, prefunding, domain-separated cumulative commitments, close/refund, on-chain settlement and contract tests | Rust contract integration + TS SDK | other project repos via versioned API/SDK |

## Request and ownership paths
```
Sideband Flutter <--> sideband-protocol <--> sideband-gateway (provider)
       |                                         |
       +---- signed cumulative vouchers --------+
       |                                         |
       +---- sideband-channels SDK --------------+----> Stellar channel settlement
```
The protocol is transport/metering metadata and is usable without importing UI or gateway implementations. Gateway is the paid service/provider runtime and includes the standalone marketing website (not a fifth repo). Channels owns the payment-specific cryptography/settlement adapters; no payment signing inside BLE transport code.

## Stellar integration: essential system, not decoration
- An online setup transaction deposits a supported Stellar asset into a Soroban one-way payment channel bound to a provider and payer commitment key.
- During disconnected usage the payer signs domain-separated, monotonically increasing cumulative commitments locally.
- Provider verifies signatures, current cached channel binding, price cap and anti-replay state without making a payment transaction each time.
- After reconnect the provider closes/settles the channel and the remainder becomes refundable under the verified contract rules.
- Use stellar-mpp-sdk / stellar-experimental one-way-channel as reviewed dependencies or reference implementations; never assume experimental code is audited.

## Service and package contracts
- OpenAPI for network APIs; generated Dart/TypeScript clients; schema snapshots checked into CI.
- Published package semver for reusable SDK/contract bindings; explicit peer version compatibility table.
- Idempotency tokens across all state-changing network/ledger operations.
- Reconciliation event contract: `{id, sourceRepo, schemaVersion, network, ledgerCursor, entityRef, status, observedAt}`.
- Never assume a wallet knows off-chain business rights or that an API database can overrule confirmed on-chain state.

## Integration test order
1. Each repository passes independent lint/build/unit tests.
2. Publish local SDKs and generated interfaces.
3. Run network local/sandbox or Testnet tests.
4. Run API/service orchestration tests with fake wallets and then test wallets.
5. Run frontend/device E2E.
6. Verify failure and recovery (network loss, duplicate event, stale authorization, partial settlement).

## Long-term release strategy
- Independent tags/releases in each repo.
- Project-wide integration lockfile references tested SHAs/tags of dependencies.
- Before shipping any release, each repo README links the matching version of its three siblings.

---
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

---
# Sideband — Threat Model / Trust & Safety

## Core assets to protect
- end-user wallet authorization and secrets;
- canonical ledger truth, quotes, settlement state, pool/channel collateral;
- merchant/provider or membership authority and representation;
- customer privacy, audit history, and safe account recovery.

## Threats and mitigations
- **Fake asset/issuer/provider** -> verify addresses/network and issuer/identity evidence, show issuer status and require explicit user confirmation.
- **Stale rate or condition** -> expiring quote/offer/maturity/channel state; revalidate before signature.
- **Transaction submitted but response lost** -> idempotent reconcile by stable tx hash; no blind double pay.
- **Replay or old signatures** -> domain separation, nonce/session ID, monotonic states, scoped expiry.
- **Key compromise** -> hardware-backed secure storage when available; rotate server secrets and support freeze/recovery flows.
- **Ledger indexing drift** -> process durable cursors, replay from known ledger, verify source and rehydrate read models.
- **Privacy leakage** -> do not put PII, contact data or commercial secrets into on-chain metadata or public source code.
- **Supply-chain attacks** -> pinned/reviewed dependencies, license inspection, security scanning, CI role separation.
- **Client manipulation** -> server validates authorization, user signs critical financial actions; clients not authoritative.

## Domain risks
- A brand new payer/provider channel normally needs connectivity before use.
- Signed offline vouchers are commitments, not settled cash. The provider bears channel/settlement risk.
- BLE throughput is small; negotiate over BLE then prefer local Wi-Fi for sustained service transfer.
- Android/iOS Bluetooth background/discovery permissions vary; physical-device testing required.
- Experimental one-way-channel contracts require security review before real-money deployment.

## Go-live restriction
MVP is Testnet/synthetic only. Prior to production or external real-money custody, obtain applicable legal/compliance review, security audit, incident response/insurance assessment, operational risk acceptance, verified issuer/provider integrations and UX consumer disclosures. Do not claim that a Stellar transaction alone establishes a valid real-world legal claim.

---
# Sideband — Approved Logo & Flexible Product Design

![Sideband logo](../brand/icon.svg)

**Logo approved as the project identity:** use `../brand/icon.svg` and `../brand/mark.svg` consistently. Do not revert to previously proposed placeholder logos.

**Approved palette:** primary `#FF8B24`, background `#130B12`, light `#FCF7EF`; all fills are solid flat colors.

**Logo meaning:** Interlocking exchange paths, separated but connected by a local signal, convey proximity and pay-per-use service exchange.

**Design flexibility:** This approval is about the logo only. Claude or another build agent can improve UI, typography, layout, animation and information architecture; it must preserve financial truth and accessibility.

---

## Interface principles
- Financial truth comes before animation. Always show recipient/issuer, asset/currency, quoted rate, network, fees, authorization, and settlement state precisely.
- No fake 'approved' ticks or unverified trust claims.
- Include skeleton, empty, partial-confirmation, failure, retry, and low-connectivity states.
- Provide dark and light themes; respect reduced-motion preferences.
- Motion can be sophisticated but cannot delay important actions or disguise pending money.

## Mobile app store landing requirements
- The consumer download landing belongs to `sideband-gateway/apps/landing` (no artificial fifth repository).
- Use actual Apple and Google provided badges once app listings exist, under platform branding terms. Do not fabricate store links.
- Keep gateway provider docs and mobile marketing routes separate within the repo.

---
# Sideband — Implementation Roadmap & Quality Gates

- Two physical phones discover and pair locally using BLE/local Wi-Fi.
- A Testnet channel was funded while online, before disconnected session.
- With internet disabled, a metered synthetic service delivers units and multiple valid vouchers.
- Replay, lower cumulative amount, unauthorized device and incorrect channel domain are rejected.
- After internet returns, provider closes channel and amount matches authorized usage.
- Offline UI never claims final settlement prior to on-chain confirmation.

## Milestones
M0. Four GitHub repos exist under one organization; readmes and versioned API/ABI plan checked in. All repos have meaningful independent deliverables.

M1. Stellar-native protocol slice proven on Local/Testnet with reproducible transaction hashes and failure tests.

M2. Persistent service, API, reconciliation and identity layer with synthetic fixtures, migrations and observable jobs.

M3. Mobile/web UI working with real M1/M2 integration, including offline/error/retry states.

M4. Reliability: chain lag/replay, permission revocation, transaction idempotency, security review, key-management, data export.

M5. Release readiness: comprehensive README and onboarding, CI green, reproducible E2E from clean checkout; collect product feedback.

## Wave contributor lanes
- Repo-specific open issues only after a minimal working foundation exists.
- Each issue has motivation, target repo, interface touchpoints, acceptance tests, complexity and non-goals.
- Do not manufacture duplicated repos, duplicate work or fake contributions.
- Do not claim approval, future earnings or fixed Wave schedules.


# Wave preparation and execution

Before requesting a Stellar Wave listing:
1. Implement an actual vertical slice, not only documentation or placeholder code.
2. Ensure all repos are public, substantive, licensable, tested and actively maintained.
3. Split public contributor issues along the **real** repo boundaries described in ARCHITECTURE.
4. Issues must be specific, appropriately sized and testable. Do not fabricate meaningless tasks to increase repo count or rewards.
5. Set up GitHub labels (good first issue, bug, documentation, stellar, blocked) and PR templates.
6. Onboard each organization using the Drips maintainers flow, install the Drips GitHub App, sync repos and apply (subject to approval and per-user/per-org limits).
7. A shared maintainer application limit may prevent submitting 12 repos in a single Wave cycle. Do not assume approval or payment.

Official: https://docs.drips.network/wave/maintainers/participating-in-a-wave/
Limits: https://docs.drips.network/wave/maintainers/repo-application-limits/


---
# Sideband — Local Service + Stellar Payment-Channel Protocol

## Essential truth
Offline usage does **not** mean new final money transfers happen without internet. The payer first funds a Stellar channel on-chain **while connected**. After funding, the payer and provider exchange authenticated cumulative payment commitments over BLE/local Wi-Fi while disconnected. Final settlement is on-chain later.

## Baseline upstreams
- `https://github.com/stellar/stellar-mpp-sdk` — official Stellar MPP SDK, including channel support.
- `https://github.com/stellar-experimental/one-way-channel` — experimental unaudited Soroban channel reference. Use Testnet and review/track upstream changes; do not copy into production unchecked.
- `https://pub.dev/packages/nearby` — candidate Flutter local transport; verify physical Android/iOS devices.
- `https://pub.dev/packages/stellar_flutter_sdk` — candidate wallet/chain adapter.

## Handshake
1. Provider advertises signed `ServiceManifest` with `serviceId`, `providerPublicKey`, `units`, `pricePerUnit`, `currency`, `maxSessionUnits`, `expiry`, `channelPolicy`, and `protocolVersion`.
2. Payer connects locally via ephemeral authenticated session, validates provider identity/manifests and price, and binds a **previously funded channel** for that exact provider/token/network.
3. Devices agree on a session ID, unit interval, maximum session spend, metering evidence hash, and voucher format.
4. Provider emits metered units; payer can verify or challenge the meter, and signs incremental cumulative commitments (never blank checks). Provider verifies each signature, channel ID and monotonic cumulative amount locally.
5. Session closes or budget cap reached; both devices store a transcript hash and highest valid voucher. Later, provider submits the highest voucher for on-chain close/settle.

## Local frames (versioned protocol, illustrative)
```json
{"type":"service_offer","v":1,"session":"opaque","serviceId":"caption-demo","pricePerUnit":"0.0001","unit":"second","currency":"TEST_ASSET","expiresAt":0}
{"type":"session_accept","v":1,"session":"opaque","channelRef":"contract-ID","maxSpend":"0.0200","nonce":"random"}
{"type":"meter_sample","v":1,"session":"opaque","cumulativeUnits":10,"sampleHash":"sha256"}
{"type":"voucher","v":1,"session":"opaque","channelRef":"contract-ID","cumulativeAmount":"0.0010","commitment":"encoded-canonical-credential","signature":"ed25519"}
```
These are protocol **design sketches**; use the actual upstream canonical XDR/signature format for channel settlement, including network/domain separation. Avoid inventing your own signed bytes without explicit security review.

## Security and liveness
- Peer service discovery identity is untrusted until authenticated.
- Prevent duplicate/replayed/lesser cumulative commitments, stale session IDs, wrong network, wrong token/provider/contract.
- Use atomic/linearizable monotonic voucher state at the provider (not eventual get-then-put).
- One channel per provider/session policy to reduce concurrency issues; do not automatically share a deposit across unknown providers.
- BLE for discovery/control; prefer Wi-Fi Direct/local LAN for larger data where possible; test OS background permission behavior.
- If there is no pre-funded channel and internet is unavailable, the app **must refuse to begin a paid session**.
- Provider may decline service if cached deposit proof is stale/insufficient. No guarantee of offline redemption or finality.
- Partial service delivery and metering disputes stay off-chain audit events; they cannot be magically solved by the contract.

## Test scenario
A provider offers a synthetic local captions/text transformation service at a fixed amount per unit. While online, payer funds one channel on Testnet. Disconnect both devices from internet, establish peer link, exchange 10+ units and multiple monotonically increasing vouchers. Reconnect provider, settle once, assert final amount equals last valid voucher. Test rollback/replay, wrong network, stale manifest, budget cap and provider shutdown.

---
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

---
# Sideband — Environment, Deployment and Recovery

## Environment boundaries
- Local: deterministic Docker Compose services, Stellar local network/Testnet, synthetic users/fixtures.
- Staging: separate database, bucket, API credentials, signing identities, Testnet assets/contracts, observability.
- Production: requires security audit, real issuer/provider agreements and relevant jurisdictional legal/compliance review. Not included in preimplementation scaffold.

## Suggested variables (non-secret examples only)
```dotenv
APP_ENV=development
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
DATABASE_URL=postgresql://localhost:5432/sideband
REDIS_URL=redis://localhost:6379
API_BASE_URL=http://localhost:3001
CHAIN_START_LEDGER=0
LOG_LEVEL=info
```
- Credentials to sign on-chain go into a secure secret manager or hardware-backed user wallet, never into a public mobile/web bundle.
- Signed store badge links are configured after actual publication; no fabricated App Store or Google Play app URLs.

## CI & GitHub setup
- GitHub Actions per repo: formatting/lint, schema checks, unit tests, dependency scanning; chain/devices smoke tests where supported.
- Branch protection and PR review recommended.
- Release tag points to tested sibling versions in an integration lockfile.
- All paths use offline/synthetic test fixtures, not real user financial records.

## Failure recovery
- Rebuild indexers from ledger cursor; compare DB projection vs chain truth.
- Restore DB backups after verifying transaction-intent reconciliation.
- Never republish user transactions solely because a client request timed out.
- Test signing-key rotation, dependency outages, stale quotes, malicious user input, insufficient balances and duplicate delivery.
- External reference infrastructure may change; check upstream project versions and licenses at build time.

---
# Scoped Potential Contributor Issues (not yet created on GitHub)

These are **potential tasks**, not manufactured or claimed completed contributions. Create issues only when actual dependencies and acceptance tests are ready.

- [ ] Define published cross-repo schema and OpenAPI/ABI golden fixture
- [ ] Create repository-specific CI checks and minimal sample test
- [ ] Build idempotent transaction intent state machine and reconciliation harness
- [ ] Add testnet happy-path E2E and timeout recovery
- [ ] Write contributor reproduction guide and dependency boundary tests
- [ ] BLE/Wi-Fi physical-device compatibility harness
- [ ] Protocol frame canonical serialization
- [ ] Monotonic cumulative voucher state with atomic compare-and-swap
- [ ] Experimental channel Testnet open/close integration tests
