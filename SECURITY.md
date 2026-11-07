# Security policy

Sideband is **pre-release software for Stellar Testnet and synthetic assets only**. The channel
contract, voucher format and key handling have **not** been audited. Do not use any Sideband
component with real funds or production keys.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes: security fixes land here first |
| Tagged pre-releases (`v0.x`) | Best effort; upgrade to the latest tag |

There is no Mainnet deployment and no production release to patch.

## Reporting a vulnerability

Please **do not open a public issue** for anything that could put funds, keys or users at risk.

1. Use GitHub private vulnerability reporting:
   [Sideband-channels → Security → Report a vulnerability](https://github.com/Sideband34/Sideband-channels/security/advisories/new).
2. If that form is unavailable, open a minimal public issue titled "Security contact request"
   **without technical details**, and a maintainer will reply with a private channel.

Include the affected repository and commit, the impact, and steps or a test that reproduces it.
This is a volunteer-run project, so we answer on a best-effort basis, usually within a week, and agree a fix and
disclosure timeline with you. Credit is given in the advisory unless you prefer otherwise. There is no paid
bug bounty.

## Scope

In scope: anything that lets a voucher be replayed, rolled back, forged, reused on another
network/channel/provider, accepted above a spending cap, or shown as settled before on-chain
finality; key or secret exposure; denial of service of the gateway API; supply-chain issues in
this repository's build and release pipeline.

Out of scope: findings that require Mainnet (unsupported), social engineering, and issues in
upstream dependencies that should be reported upstream (please still tell us).

See [`docs/SECURITY.md`](./docs/SECURITY.md) for the threat model and trust boundaries.
