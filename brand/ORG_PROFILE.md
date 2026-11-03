<!--
GitHub organization profile for Sideband34. To publish it, copy this file to
profile/README.md in a public repository named `.github` under the organization.
Images use absolute URLs so they render there. Keep every claim true: update the
status table only from merged, tested work.
-->

<div align="center">

<img src="https://raw.githubusercontent.com/Sideband34/Sideband-gateway/main/brand/icon.svg" alt="Sideband logo" width="120" />

# Sideband

**Nearby services. Metered value. Stellar settlement.**

Pay a nearby device by the unit over Bluetooth or local Wi-Fi, using signed vouchers against a
Stellar payment channel you funded while online, and settle on-chain when you are back.

`pre-release` · `Stellar Testnet only` · `unaudited` · `MIT`

</div>

---

### How it works

| | Step | Connectivity |
|---|---|---|
| 1 | **Fund a channel**: deposit a Testnet asset into a Soroban payment channel bound to one provider | Online |
| 2 | **Discover nearby**: verify the provider's signed manifest, agree on price, units and a spend cap | Local |
| 3 | **Stream with vouchers**: sign a cumulative, domain-separated voucher per metered unit; the provider verifies locally and rejects replays | Offline |
| 4 | **Settle later**: the provider submits its highest voucher; the remaining deposit is refundable | Online |

A voucher is a commitment against locked funds, not a completed payment. Nothing is shown as
settled until Stellar confirms it.

### Repositories

| Repository | Stack | What it owns | Status |
|---|---|---|---|
| [Sideband-mobile](https://github.com/Sideband34/Sideband-mobile) | Flutter | Payer app: discovery UX, spend limits, voucher signing, receipts | Payer domain + app shell on a synthetic provider |
| [Sideband-protocol](https://github.com/Sideband34/Sideband-protocol) | Dart | Session frames, canonical encoding, state machine, metering, transport contract | Core + loopback; BLE/Wi-Fi adapters planned |
| [Sideband-gateway](https://github.com/Sideband34/Sideband-gateway) | TypeScript | Provider runtime: metered service, anti-replay voucher checks, settlement prep; landing site | v1 API on a test channel adapter |
| [Sideband-channels](https://github.com/Sideband34/Sideband-channels) | Rust · TypeScript | Soroban channel contract, voucher format, chain adapters, settlement intents | Contract tested in the SDK env; not deployed |

### Where we are

- Working today: voucher signing in Dart and TypeScript (matching golden vectors), local
  verification with atomic anti-replay, spend caps, a metered demo service, settlement intents
  that never claim finality early, and a cross-repo end-to-end test.
- Not done yet: Testnet deployment, Bluetooth/Wi-Fi transports, keystore-backed keys, device
  testing, any security audit. No app store listings exist.

### Get involved

Each repository has a `CONTRIBUTING.md` and a scoped `docs/CONTRIBUTOR_ISSUES.md` with acceptance
tests. Sideband intends to take part in [Drips Wave](https://docs.drips.network/wave/maintainers/participating-in-a-wave/)
on Stellar (subject to organizer approval). Report security issues privately via each
repository's `SECURITY.md`.
