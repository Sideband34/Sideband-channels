# ADR 0001 — Voucher signed bytes

Status: accepted, revised in M2 (supersedes the initial `sideband-test-format-v1`).

## Context
The original design named `stellar-mpp-sdk` and
`stellar-experimental/one-way-channel` as reference implementations. The first
M1 cut invented its own byte layout and labeled it a test format because the
upstream sources had not been inspected.

## Findings (upstream inspected at one-way-channel `25dea1b`, stellar-mpp-sdk main)
- Both are reachable and Apache-2.0 licensed; both say the contract is unaudited.
- A commitment is `XDR(ScVal::Map{ amount: I128, channel: Address,
  domain: Symbol("chancmmt"), network: Bytes32(sha256(passphrase)) })`, signed
  with the channel's ed25519 `commitment_key`. Amounts are cumulative.
  `stellar-mpp-sdk` builds the same bytes locally (`buildCommitmentMessage`) and
  guards drift with a live parity test against `prepare_commitment`.
- Payer key and recipient are fixed at channel deployment, so they are not part
  of the signed bytes.

## Decision
Adopt the upstream commitment bytes (`sideband-commit-v2`) for vouchers in the
TS SDK (`src/vouchers/format.ts`, built with `@stellar/stellar-sdk` XDR) and in
the reference contract (`Commitment` struct, same field names so Soroban emits
the identical map). A test compares the SDK output against an independent
hand-written XDR encoder. Sideband's wire `commitment` field stays
sha256(preimage) and `signature` stays the hex ed25519 signature.

## Consequences
- Vouchers are now byte-identical in layout to upstream; they are not yet
  verified against an upstream contract instance on Testnet (no network run).
  Upstream's `commitment-parity` live test should be mirrored once Testnet
  deployment exists.
- Our reference contract is NOT upstream. Since ADR 0002 it has upstream's
  `top_up`, `settle`, `close_start` and waiting period; the remaining
  differences are listed there. For real use still prefer reviewing and
  deploying the upstream contract.
- Format changes bump the tag (`sideband-commit-v3`) and regenerate fixtures;
  gateway and mobile pin the fixture.
