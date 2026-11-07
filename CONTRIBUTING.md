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

1. Pick an open issue (the ones labelled `Stellar Wave` are scoped and ready, and `good first issue` is the easy start), and comment that you are
   working on it. Wait for a maintainer to assign it before you start, so two people do not build the same thing.
2. Branch from `main`, keep commits small, and use [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
3. Open a pull request using the template: describe the change, the tests you ran, and any
   integration impact on sibling repos.
4. Architecture changes need a short ADR under `docs/adr/`.

## Drips Wave

Sideband applies to the [Drips Wave](https://docs.drips.network/wave) program on Stellar. Participation and rewards depend on the program
organizers' approval and are not guaranteed. Wave issues are real, scoped work with acceptance criteria. Complexity labels follow the Drips scale:

| Label | Meaning | Wave points |
|---|---|---|
| `trivial` | Small, clearly bounded change with obvious acceptance criteria | 100 |
| `medium` | Standard feature or logic touching several parts of the codebase | 150 |
| `high` | Complex engineering such as an integration or an architectural change | 200 |

One issue per pull request. A pull request is reviewed against the acceptance criteria in its issue, so tick them off in the description. Please do not
open duplicate or filler pull requests.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Security problems go
through [SECURITY.md](./SECURITY.md), not public issues. Contributions are licensed under the MIT
License.
