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
