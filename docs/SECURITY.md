# Sideband threat model

Scope: the four Sideband repositories as they exist today. Sideband is a **Testnet prototype**. Nothing here has been audited.

## What is protected

| Asset | Why it matters |
|---|---|
| Payer signing key | It signs vouchers and channel top-ups. Anyone with it can spend the payer's deposit. |
| Provider signing key | It settles and closes channels and receives the funds. |
| Channel deposit | Locked in the Soroban channel contract until settled or refunded. |
| Voucher accounting | The provider's record of the highest valid cumulative voucher per channel. |
| Settlement state | Whether a settlement is only prepared, submitted, or confirmed on the ledger. |

## Trust boundaries

```
payer phone  <-- untrusted local link (BLE / Wi-Fi) -->  provider gateway  <-- RPC -->  Stellar Testnet
 (holds key)                                              (holds provider key)           (final truth)
```

- The local link is untrusted. Identity, price and channel binding are checked from signed data, never from the transport.
- The ledger is the only source of final truth. A voucher is a commitment, not a payment, and nothing is shown as settled before Stellar confirms it.
- Clients are not authoritative: the provider validates every voucher itself.

## Threats and what answers them

| Threat | Mitigation | Where it is enforced |
|---|---|---|
| Replayed or lower voucher | Cumulative amounts must strictly increase. Acceptance is an atomic compare-and-swap, tested under concurrent races. | Sideband-channels (`acceptVoucher`, `VoucherStore`), Sideband-gateway |
| Voucher reused on another network, channel or provider | Domain-separated commitment bound to network passphrase, channel and parties. The contract exposes `prepare_commitment` so encoders can be checked byte for byte. | Sideband-channels (SDK and contract), Sideband-mobile (Dart port against golden vectors) |
| Spending above the cap or above the deposit | Per-session budget measured from the channel baseline, a provider cap, and a check against the deposit. | Sideband-protocol (`SessionMachine`), Sideband-channels |
| Fake provider | Signed service manifest; the payer binds a channel funded for that exact provider. | Sideband-gateway, Sideband-protocol |
| Lost or duplicated settlement | Settlement intents move through explicit states. A timeout after submission goes to `RECONCILING` and resolves from ledger evidence, never by blind resubmission. | Sideband-channels (`src/settlement`) |
| Provider disappears | The payer calls `close_start`. After the dispute window and the channel expiry the payer can `refund` the remainder. | Sideband-channels contract |
| Payer disappears | The provider settles its highest voucher at any time. | Sideband-channels contract |
| Payer closes while the provider holds a higher voucher | During the dispute window the provider can still close with the higher voucher. | Sideband-channels contract, Sideband-gateway (auto-settle answers `close_start`) |
| Admin endpoint abuse | Admin routes are disabled unless `ADMIN_TOKEN` is set. | Sideband-gateway |
| Request flooding | Configurable rate limit (`RATE_LIMIT_BURST`, `RATE_LIMIT_PER_SEC`). | Sideband-gateway |
| Mainnet by accident | The public network is refused and an unknown network passphrase fails closed. | Sideband-channels (`src/networks.ts`), Sideband-gateway (`src/config.ts`) |
| Key theft from the phone | Key generated on the device and kept in the platform secure store (Keychain or Keystore). | Sideband-mobile |
| Supply chain | Lockfiles, Dependabot, CI on every push, a documented dependency list. | all repositories |

## What is not covered

- **No security audit.** The channel contract follows the lifecycle of the experimental one-way-channel reference (itself unaudited) and has only been exercised on Testnet.
- **The provider secret sits in an environment variable** when the live adapter is on. There is no hardware-backed or managed key for the provider.
- **BLE and local Wi-Fi sessions have not been tested on real devices.** The transports are unit-tested with fakes.
- **The hosted demo gateway uses a synthetic test adapter.** Its receipts are labeled synthetic and nothing settles on-chain. It runs on a free instance that sleeps and loses its data on restart.
- **Metering disputes** (a payer says a unit was not delivered) are an off-chain audit matter. The contract cannot judge service quality.
- **Privacy:** the provider sees how much a payer used. Nothing personal is meant to go into on-chain data, but no privacy review has been done.
- **No legal or compliance review.** A Stellar transaction alone does not establish a legal claim.

## Before any real funds

Independent audit of the contract and voucher format, device testing of the transports, a managed provider key, a legal and compliance review, and an operational plan for incidents and key rotation. Until then, Testnet and synthetic assets only.

Report vulnerabilities privately: see [`SECURITY.md`](../SECURITY.md).
