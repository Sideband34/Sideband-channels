# Contributor issues — Sideband-channels

Scoped work for **Sideband-channels**, taken from the gaps listed in the README status table. These are
candidates, not yet all opened on GitHub; a maintainer opens an issue (labels: `good first issue`,
`bug`, `documentation`, `stellar`, `blocked`) once its dependencies are ready. Each item names its
interface touchpoints, acceptance tests and non-goals. Size: S (< 1 day), M (1–3 days), L (> 3 days).

Rules: Testnet/synthetic only; no real keys or funds; tests for failure paths; one repository
boundary per issue. Cross-repo work is listed at the end and needs a linked PR in each repo.

## Open work

- [ ] **Testnet deploy script.** Upload the WASM with `stellar-cli`, instantiate a channel, record
  the contract id and hashes in `deployments/testnet.json`. *Acceptance:* reproducible from a
  clean checkout with a funded Testnet account; no secrets committed. *Size:* M. Label: `stellar`.
- [ ] **Live `SorobanChannelAdapter` integration test.** Run open → close → refund against Testnet
  behind an opt-in env flag. *Acceptance:* receipts carry real ledger numbers; timeouts end in
  `RECONCILING`, never `FAILED`. *Size:* M. Label: `stellar`.
- [ ] **Cross-check voucher bytes with the upstream one-way-channel contract.** *Acceptance:* the
  golden vectors verify on a deployed upstream contract, or an ADR documents the difference.
  *Size:* M.
- [ ] **Publish the TS SDK as a versioned package** so the gateway no longer needs a sibling
  `file:` checkout. *Acceptance:* gateway CI installs a tagged version. *Size:* S.
- [ ] **Contract property tests.** Randomised close/refund sequences never pay out more than the
  deposit. *Size:* S. `good first issue`.

## Cross-repository

- [ ] **Integration lockfile.** A file in each repo pinning the tested sibling tags/SHAs, checked in
  CI. *Acceptance:* CI fails when a pinned sibling fixture differs. *Size:* M.
- [ ] **Testnet end-to-end demo.** Fund → offline session → settle on Testnet with recorded
  transaction hashes, driven from a clean checkout. *Blocked on:* channels Testnet deploy, gateway
  Soroban wiring. *Size:* L.
- [ ] **Physical-device compatibility harness.** Two-phone BLE/Wi-Fi run with a published matrix.
  *Blocked on:* protocol transport adapters. *Size:* L.
