# Contributor issues — Sideband-channels

Scoped work for **Sideband-channels**, taken from the gaps listed in the README status table. These are
candidates, not yet all opened on GitHub; a maintainer opens an issue (labels: `good first issue`,
`bug`, `documentation`, `stellar`, `blocked`) once its dependencies are ready. Each item names its
interface touchpoints, acceptance tests and non-goals. Size: S (< 1 day), M (1–3 days), L (> 3 days).

Rules: Testnet/synthetic only; no real keys or funds; tests for failure paths; one repository
boundary per issue. Cross-repo work is listed at the end and needs a linked PR in each repo.

## Open work

- [ ] **Run the Testnet deploy and smoke scripts.** `scripts/deploy-testnet.sh` and
  `scripts/smoke-testnet.sh` exist but have never been run. *Acceptance:* a clean run records the
  wasm hash, contract id and transaction hashes in `deployments/testnet.json`; the smoke script's
  final assertions pass. No secrets committed. *Size:* M. Label: `stellar`.
- [ ] **Live `SorobanChannelAdapter` integration test.** Opt-in (env flag) test for open → top_up →
  settle → close_start → close against Testnet. *Acceptance:* receipts carry real ledger numbers;
  a forced timeout ends in `RECONCILING`, never `FAILED`. *Size:* M. Label: `stellar`.
- [ ] **On-chain `prepare_commitment` parity check.** *Acceptance:* the golden vectors'
  `preimageHex` equals `prepare_commitment` on a deployed instance (ours and upstream
  one-way-channel), or an ADR documents the difference. *Size:* S.
- [ ] **Publish the TS SDK as a versioned package** so the gateway no longer needs a sibling
  `file:` checkout. *Acceptance:* gateway CI installs a tagged version. *Size:* S.
- [ ] **Contract upgrade / TTL runbook.** Document instance TTL extension and what happens to an
  archived channel. *Acceptance:* a test that bumps the ledger past the TTL threshold and shows the
  state is still readable after an `extend_ttl` call. *Size:* S. `good first issue`.

## Cross-repository

- [ ] **Integration lockfile.** A file in each repo pinning the tested sibling tags/SHAs, checked in
  CI. *Acceptance:* CI fails when a pinned sibling fixture differs. *Size:* M.
- [ ] **Testnet end-to-end demo.** Fund → offline session (two sessions on one channel) → settle on
  Testnet with recorded transaction hashes, driven from a clean checkout. *Blocked on:* running
  `scripts/deploy-testnet.sh` in Sideband-channels, gateway Soroban wiring. *Size:* L.
- [ ] **Physical-device compatibility harness.** Two-phone BLE run of the mobile `BleTransport`
  with a published matrix. *Acceptance:* a frame exchange of 10+ vouchers recorded per device
  pair; no row marked supported without a run. *Size:* L.
