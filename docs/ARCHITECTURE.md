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
