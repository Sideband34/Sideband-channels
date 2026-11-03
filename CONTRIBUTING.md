# Contributing to Sideband-channels

Thanks for helping build Sideband. This repository owns one part of a four-repository system
(see the README); please keep changes inside that boundary and coordinate interface changes with
the sibling repositories.

## Ground rules

- **Testnet and synthetic data only.** Never commit or paste keys, seeds, `.env` files or real
  customer data. Do not add Mainnet configuration.
- **Financial truth first.** Nothing may present a voucher as settled money before on-chain
  finality is observed.
- **Honest status.** Do not claim device support, store listings, audits, users or partners that
  do not exist. Label test adapters and synthetic data clearly.
- **Tests with every change**, including failure paths (replay, rollback, wrong network/channel,
  expiry, timeouts) where relevant.
- Versioned interfaces: a breaking change to frames, voucher bytes, API or contract ABI needs a
  version bump, updated fixtures and a linked change in each consuming sibling.

## Development

```
npm ci
npm run check            # prettier, eslint, tsc, vitest
cd contracts && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI runs the same checks on every push and pull request; a PR is mergeable only when they pass.

## Workflow

1. Pick an issue, or one of the scoped items in [`docs/CONTRIBUTOR_ISSUES.md`](./docs/CONTRIBUTOR_ISSUES.md),
   and comment that you are working on it.
2. Branch from `main`, keep commits small, and use [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
3. Open a pull request using the template: describe the change, the tests you ran, and any
   integration impact on sibling repos.
4. Architecture changes need a short ADR under `docs/adr/`.

## Drips Wave

Sideband intends to take part in [Drips Wave](https://docs.drips.network/wave/maintainers/participating-in-a-wave/)
on Stellar. Participation and rewards depend on organizer approval and are not guaranteed. Wave
issues will be real, scoped work with acceptance tests; please do not open duplicate or filler
PRs to farm rewards.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Security problems go
through [SECURITY.md](./SECURITY.md), not public issues. Contributions are licensed under the MIT
License.
