#!/usr/bin/env bash
# The path smoke-testnet.sh does not cover: the PAYER's refund after the dispute window, on a FRESH channel.
#
#   deploy (CLOSE_WAIT=60) -> close_start -> refund refused inside the window -> wait -> refund succeeds
#
# and asserts the on-chain status is Refunded and the full deposit went back. Testnet XLM only.
# Usage: scripts/smoke-refund-testnet.sh        (creates .testnet-channel-refund.env; needs the same tools as deploy-testnet.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".testnet-channel-refund.env"
OUT="$ENV_FILE" CLOSE_WAIT=60 DEPOSIT=10000000 TTL_SECONDS=3600 scripts/deploy-testnet.sh
# shellcheck disable=SC1090
source "$ENV_FILE"

as_payer() { stellar contract invoke --id "$CHANNEL_ID" --source "$PAYER" --network "$NETWORK" -- "$@"; }
field() { node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(c[process.argv[1]])" "$1"; }
expect_fail() { if "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; echo "ok: refused as expected: ${*:1:3}"; }

echo "== close_start (payer)"
as_payer close_start
expect_fail as_payer refund
EFFECTIVE="$(as_payer get | field close_effective_at)"
echo "== waiting for the dispute window (effective at $EFFECTIVE)"
while [ "$(date +%s)" -le $((EFFECTIVE + 15)) ]; do sleep 5; done
echo "== refund (payer), window elapsed"
as_payer refund
STATE="$(as_payer get)"
echo "$STATE"
[[ "$(echo "$STATE" | field status)" == *Refunded* ]] || { echo "status is not Refunded" >&2; exit 1; }
[[ "$(echo "$STATE" | field refunded_to_payer)" == "$DEPOSIT" ]] || { echo "payer was not refunded the full deposit" >&2; exit 1; }
echo "refund smoke OK: the payer got the whole $DEPOSIT stroops back after the window"
