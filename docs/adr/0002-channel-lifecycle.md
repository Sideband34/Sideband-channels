# ADR 0002 — Channel lifecycle parity with one-way-channel

Status: accepted (M3). Amends the "Consequences" of ADR 0001.

## Context
The first reference contract had a single-shot provider `close` and a payer
`refund` after a fixed expiry. Upstream `stellar-experimental/one-way-channel`
(inspected at `25dea1b`, Apache-2.0, unaudited) additionally has `top_up`,
partial `settle` without closing, and a payer-initiated `close_start` with a
waiting period in which the recipient can still withdraw with its latest
commitment. Without those, a long-running provider must close (and the payer
re-fund) to get paid, and a payer whose provider disappears can only wait for
expiry.

## Decision
`contracts/channel` implements:

| Call | Who | Allowed in | Effect |
| --- | --- | --- | --- |
| `init(token, payer, provider, payer_key, deposit, expires_at, close_wait)` | payer | — | deposit; `Open` |
| `top_up(amount)` | payer | `Open` | `deposit += amount` (checked) |
| `settle(cumulative, sig)` | provider | `Open`, `Closing` | pays `cumulative - paid_to_provider`; stays live |
| `close(cumulative, sig)` | provider | `Open`, `Closing` | pays up to `cumulative`, refunds the rest; `Closed` |
| `close_start()` | payer | `Open` | `Closing`, `close_effective_at = max(now + close_wait, expires_at)` |
| `refund()` | payer | `Closing`, after `close_effective_at` | refunds the rest; `Refunded` |
| `get`, `balance`, `status`, `prepare_commitment(amount)` | anyone | any | read-only |

- `close_wait` is bounded to 60 s … 31 days; payer and provider must differ.
- Every mutation requires the acting party's auth; a voucher must be strictly
  above `paid_to_provider` (`StaleVoucher`) and at most `deposit`
  (`OverDeposit`). `close` at exactly `paid_to_provider` needs no new voucher.
- `Closed` / `Refunded` are terminal: every mutation then fails with `NotOpen`,
  which is the single-close guarantee.
- All arithmetic is checked (`Overflow`), and the release profile keeps
  `overflow-checks = true`.
- Events (`#[contractevent]`): `opened`, `topped_up`, `settled`,
  `close_started`, `closed`, `refunded`.
- `prepare_commitment` mirrors upstream so off-chain encoders can be
  parity-checked against a deployed instance.

A property test (`proptest_conservation.rs`) drives random sequences of all
calls and clock moves and asserts after every step:
`deposit == paid_to_provider + refunded_to_payer + balance`, the contract's
token balance equals `balance`, no tokens are created or destroyed, the
provider's withdrawn amount never decreases, and terminal channels never change.

## Remaining differences from upstream
- Initialisation is an `init` call after deployment (upstream uses a
  constructor). The SDK deploys with a deterministic salt and treats an
  already-initialised instance as idempotent success.
- `expires_at` is kept: a payer close can never complete before it, which gives
  providers a guaranteed service horizon for cached deposit proofs.
- Upstream's `refund` can be called repeatedly; ours is terminal.

## Consequences
- The TS `ChannelAdapter` gains `topUp`, `settle`, `closeStart`; `refund`
  now requires `closeStart` first. Contract error codes 7–10 map to
  `stale_voucher`, `not_closing`, `invalid_params` (overflow), `already_closing`.
- Settlement intents carry `kind: 'settle' | 'close'`; `close` keeps the
  historical intent id.
- Still unaudited, still not deployed: `scripts/deploy-testnet.sh` and
  `scripts/smoke-testnet.sh` document the stellar-cli path but have not been run.
