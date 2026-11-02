# ADR 0001 — Voucher byte layout is a labeled test format

Status: accepted (M1). Revisit before any non-Testnet use.

## Context
`docs/TECHNICAL_BUILD.md` names `stellar-mpp-sdk` and
`stellar-experimental/one-way-channel` as reference implementations, to be
verified for license/API compatibility. Neither was vendored or audited here,
and we will not invent bytes and pretend they are upstream's.

## Decision
Define `sideband-test-format-v1` (layout in `src/vouchers/format.ts`): domain tag,
network id, raw channel id, payer key, provider key, 16-byte big-endian
cumulative amount; ed25519 signature over that preimage; `commitment` is
sha256(preimage). The same bytes are built by the TS SDK and by the Rust
contract (`contracts/channel`), and golden vectors in
`fixtures/voucher-vectors.json` prove TS-signed vouchers verify in the contract.

## Consequences
- Domain separation covers network, channel, payer and provider.
- Monotonicity is enforced off-chain by atomic CAS (`VoucherStore`) and on-chain
  by single-shot `close`.
- NOT compatible with upstream one-way-channel; NOT audited. A format change
  bumps the domain tag (`.../v2`) and the fixtures; consumers pin the fixture.
