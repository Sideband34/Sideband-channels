#!/usr/bin/env bash
# Exercises the full channel lifecycle on Stellar TESTNET against a channel
# created by scripts/deploy-testnet.sh:
#
#   top_up -> settle (voucher 0.3) -> settle replay refused -> close_start
#   -> provider dispute: close with a higher voucher (0.5) -> refund refused
#
# and asserts the final on-chain amounts. Not run in CI. Run on Stellar Testnet on 2026-11-04 (results in
# docs/DEPLOYMENT.md). Testnet XLM only. EXPERIMENTAL, NOT AUDITED.
#
# Usage: scripts/smoke-testnet.sh [.testnet-channel.env]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-.testnet-channel.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${CHANNEL_ID:?missing}" "${PAYER:?missing}" "${PROVIDER:?missing}" "${PROVIDER_ADDR:?missing}"
[[ "$NETWORK" != "mainnet" && "$NETWORK" != "public" ]] || { echo "Testnet only" >&2; exit 1; }

as_payer() { stellar contract invoke --id "$CHANNEL_ID" --source "$PAYER" --network "$NETWORK" -- "$@"; }
as_provider() { stellar contract invoke --id "$CHANNEL_ID" --source "$PROVIDER" --network "$NETWORK" -- "$@"; }
field() { node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(c[process.argv[1]])" "$1"; }

voucher() { # amount -> "stroops signatureHex"
  SIDEBAND_PAYER_SECRET="$(stellar keys show "$PAYER")" \
    npx --prefix "$ROOT" tsx "$ROOT/scripts/sign-voucher.ts" "$CHANNEL_ID" "$PROVIDER_ADDR" "$1" |
    node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(v.cumulativeStroops, v.signature)"
}
expect_fail() {
  if "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi
  echo "ok: refused as expected: ${*:1:3}"
}

echo "== prepare_commitment parity (on-chain bytes vs local encoder)"
ONCHAIN="$(as_payer prepare_commitment --amount 3000000 | tr -d '"')"
LOCAL="$(npx --prefix "$ROOT" tsx "$ROOT/scripts/commitment-hex.ts" "$CHANNEL_ID" "$PAYER_ADDR" "$PROVIDER_ADDR" 3000000)"
[[ "$ONCHAIN" == "$LOCAL" ]] || { echo "PARITY FAILED: on-chain $ONCHAIN != local $LOCAL" >&2; exit 1; }
echo "parity ok: the local encoder and the contract produce identical bytes (${#LOCAL} hex chars)"

echo "== top_up 0.2"
as_payer top_up --amount 2000000

read -r A1 S1 < <(voucher 0.3)
echo "== settle 0.3 (channel stays open)"
as_provider settle --cumulative "$A1" --signature "$S1"
expect_fail as_provider settle --cumulative "$A1" --signature "$S1"

echo "== close_start (payer)"
as_payer close_start
expect_fail as_payer refund

read -r A2 S2 < <(voucher 0.5)
echo "== provider disputes inside the window with a higher voucher"
as_provider close --cumulative "$A2" --signature "$S2"
expect_fail as_payer refund

STATE="$(as_payer get)"
echo "$STATE"
[[ "$(echo "$STATE" | field status)" == *Closed* ]] || { echo "status not Closed" >&2; exit 1; }
[[ "$(echo "$STATE" | field paid_to_provider)" == "$A2" ]] || { echo "provider not paid $A2" >&2; exit 1; }
echo "smoke OK: provider paid $A2 stroops, remainder refunded"
