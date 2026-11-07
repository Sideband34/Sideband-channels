# Changelog

All notable changes to Sideband-channels. Pre-release; Testnet/synthetic only; unaudited.

## [Unreleased]

### Changed (found by the first live Testnet run, 2026-11-04)
- `RpcSorobanClient.forUrl` and `ownKeypair`: avoid XDR mismatches between two copies of `@stellar/stellar-sdk`.
- Transactions get a 300 s validity window (configurable; 60 s expired on a slow link).
- `smoke-testnet.sh` asserts encoder/contract parity; new `smoke-refund-testnet.sh`; deployment and smoke results are in `docs/DEPLOYMENT.md`.

### Added
- Contract lifecycle parity with stellar-experimental/one-way-channel ([ADR 0002](docs/adr/0002-channel-lifecycle.md)):
  payer `top_up`, provider `settle` (withdraw without closing), payer `close_start` with a bounded
  dispute window (never before `expires_at`), `refund` of the remainder, `balance` / `status` /
  `prepare_commitment` getters and `#[contractevent]` events.
- Checked arithmetic (`Overflow`), auth on every mutating path, terminal single-close.
- Contract tests for every failure path, auth (missing and wrong party), overflow, golden
  `sideband-commit-v2` preimage and signature parity with the TS vectors, and a proptest for funds
  conservation (`deposit == paid + refunded + balance`).
- CI uploads the release WASM and its sha256 as a build artifact; shellchecks the scripts.
- `scripts/deploy-testnet.sh`, `scripts/smoke-testnet.sh`, `scripts/sign-voucher.ts` (stellar-cli;
  first run on Testnet on 2026-11-04, see `docs/DEPLOYMENT.md`).
- TS SDK: `ChannelAdapter.topUp/settle/closeStart`, voucher-less `close`, bindings with
  `withdrawn`, `closeWait`, `closeEffectiveAt`; settlement intents with `kind: settle | close`;
  `acceptVoucher` session `baseline` for several sessions per channel.

### Changed
- `init` takes `close_wait`; `refund` requires `close_start` and an elapsed window.
- Contract error codes 7–10 added (`StaleVoucher`, `NotClosing`, `Overflow`, `AlreadyClosing`).

## [0.1.0]
- Voucher format `sideband-commit-v2`, CAS acceptance, settlement intents, in-memory and Soroban
  adapters, reference contract with single-shot close and refund after expiry.
