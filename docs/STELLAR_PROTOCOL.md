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
