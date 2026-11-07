# Sideband architecture

Sideband lets a phone pay a nearby device for a small metered service over Bluetooth LE or local Wi-Fi, with no internet during the session. The
payer funds a Stellar (Soroban) payment channel while online, signs cumulative vouchers locally while offline, and the provider settles on-chain
later. A voucher is a commitment against funds that are already locked. It is not a completed payment.

## Four repositories, one responsibility each

| Repository | Owns | Output | Consumers |
|---|---|---|---|
| [Sideband-protocol](https://github.com/Sideband34/Sideband-protocol) | Versioned session frames, canonical encoding, the session state machine, metering, the transport contract | Dart package | Sideband-mobile; frame names and limits are mirrored in Sideband-gateway |
| [Sideband-channels](https://github.com/Sideband34/Sideband-channels) | The Soroban channel contract, the cumulative voucher format, channel adapters, settlement intents | Rust contract and TypeScript SDK | Sideband-gateway; Sideband-mobile has a Dart port checked against golden vectors |
| [Sideband-gateway](https://github.com/Sideband34/Sideband-gateway) | The provider runtime: signed service manifest, metered demo service, HTTP 402 flow, anti-replay voucher validation, settlement preparation, the landing site | TypeScript service and Next.js site | Payers over HTTP or the local transport |
| [Sideband-mobile](https://github.com/Sideband34/Sideband-mobile) | The payer app: discovery, spend limits, key storage, voucher signing, session journal, receipts | Flutter app (Android APK) | People |

Each repository builds, tests and releases on its own. No payment signing lives in transport code, and no chain logic lives in the app.

## Request and payment path

```
Sideband-mobile <--> Sideband-protocol frames <--> Sideband-gateway (provider)
      |                                                   |
      +--------- signed cumulative vouchers --------------+
      |                                                   |
      +--- voucher format (Dart port, golden vectors) ----+--> Sideband-channels --> Stellar channel contract
```

1. **Fund (online).** The payer deposits a Testnet asset into a Soroban channel bound to one provider.
2. **Discover and agree (local).** The provider advertises a signed service manifest. The payer checks the provider identity, the price and the spending cap,
   and binds the funded channel.
3. **Stream vouchers (offline).** Each metered unit raises a cumulative, domain-separated voucher signed on the phone. The provider verifies the signature, the
   channel, the network and the monotonic amount with an atomic compare-and-swap, and rejects replay and rollback.
4. **Settle (online).** The provider withdraws up to its highest voucher. `settle` keeps the channel open. `close` ends it and refunds the rest. A payer can start a
   close at any time, and the provider then has a dispute window to submit its highest voucher before the payer reclaims the remainder.

If there is no funded channel and no internet, the app refuses to start a paid session. Nothing is shown as settled until Stellar confirms it.

## Contracts between the repositories

- Voucher bytes: `fixtures/voucher-vectors.json` in Sideband-channels is the source of truth. The TypeScript SDK and the Dart port both check against it.
- Session frames: the field names and limits in Sideband-protocol are mirrored in the gateway, with a synthetic session transcript fixture that both sides test.
- Settlement intents move `CREATED`, `AUTHORIZED`, `SUBMITTED`, `CONFIRMED`, and go to `RECONCILING` after a timeout following submission. `CONFIRMED` needs finality
  evidence from the right network.
- The public network is refused everywhere. An unknown network passphrase fails closed.

## Hosted demo topology

```
browser --> Vercel (landing site, built from Sideband-gateway/apps/landing)
payer   --> Render (Sideband-gateway, free plan, synthetic test adapter)
                      |
                      +--> Stellar Testnet RPC (only with ADAPTER=soroban and a provider key)
```

The hosted gateway runs the synthetic test adapter: its receipts are labeled synthetic and nothing settles on-chain. The live adapter (`ADAPTER=soroban`) needs a Testnet
provider secret that only the operator may set, so it is not enabled on the hosted instance. The on-chain evidence for the channel contract is in
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) of Sideband-channels.

## Failure modes the design accounts for

| Failure | What happens |
|---|---|
| Replayed or lower voucher | Rejected by the provider's compare-and-swap, never settled |
| Voucher for another network, channel or provider | Rejected by domain separation and binding checks |
| Provider goes away | The payer starts a close and reclaims the remainder after the dispute window |
| Payer goes away | The provider settles its highest voucher whenever it is online |
| Settlement submission times out | The intent moves to `RECONCILING` and resolves from ledger evidence, never by resubmitting blindly |
| Spending cap reached | The session closes; no voucher above the cap is accepted |

See [`SECURITY.md`](./SECURITY.md) for the trust boundaries and what is not covered.
