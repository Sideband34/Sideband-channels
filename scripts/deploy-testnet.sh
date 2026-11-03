#!/usr/bin/env bash
# Deploys one Sideband reference channel to Stellar TESTNET with stellar-cli.
#
# NOT RUN IN THIS REPO'S CI and never run by the authors against a live
# network yet: no transaction hashes or contract ids are published anywhere.
# The contract is EXPERIMENTAL and NOT AUDITED. Testnet XLM only.
#
# Requirements: stellar-cli >= 23 (`cargo install --locked stellar-cli`),
# the wasm32v1-none Rust target, node >= 22 (for the payer key helper).
#
# Usage:
#   scripts/deploy-testnet.sh                # creates/funds identities via friendbot
#   DEPOSIT=10000000 CLOSE_WAIT=600 scripts/deploy-testnet.sh
#
# Environment (all optional):
#   NETWORK      stellar-cli network name             (default: testnet)
#   PAYER        stellar-cli identity of the payer    (default: sideband-payer)
#   PROVIDER     stellar-cli identity of the provider (default: sideband-provider)
#   DEPOSIT      initial deposit in stroops           (default: 10000000 = 1 XLM)
#   TTL_SECONDS  channel expiry from now              (default: 86400)
#   CLOSE_WAIT   dispute window in seconds, 60..2678400 (default: 600)
#   OUT          file the resulting env is written to (default: .testnet-channel.env)
#
# Output: OUT contains CHANNEL_ID, WASM_HASH, TOKEN, PAYER_ADDR, PROVIDER_ADDR
# for scripts/smoke-testnet.sh.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
PAYER="${PAYER:-sideband-payer}"
PROVIDER="${PROVIDER:-sideband-provider}"
DEPOSIT="${DEPOSIT:-10000000}"
TTL_SECONDS="${TTL_SECONDS:-86400}"
CLOSE_WAIT="${CLOSE_WAIT:-600}"
OUT="${OUT:-.testnet-channel.env}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$NETWORK" == "mainnet" || "$NETWORK" == "public" ]]; then
  echo "refusing to deploy to $NETWORK: Testnet/synthetic only" >&2
  exit 1
fi
command -v stellar >/dev/null || { echo "stellar-cli not found" >&2; exit 1; }

ensure_identity() {
  if ! stellar keys address "$1" >/dev/null 2>&1; then
    echo "creating identity $1 (funded by friendbot)"
    stellar keys generate "$1" --network "$NETWORK" --fund
  fi
}
ensure_identity "$PAYER"
ensure_identity "$PROVIDER"
PAYER_ADDR="$(stellar keys address "$PAYER")"
PROVIDER_ADDR="$(stellar keys address "$PROVIDER")"

echo "building wasm"
(cd "$ROOT/contracts" && SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 \
  cargo build --release --target wasm32v1-none -p sideband-channel)
WASM="$ROOT/contracts/target/wasm32v1-none/release/sideband_channel.wasm"

echo "uploading wasm"
WASM_HASH="$(stellar contract upload --wasm "$WASM" --source "$PAYER" --network "$NETWORK")"

echo "deploying channel instance"
CHANNEL_ID="$(stellar contract deploy --wasm-hash "$WASM_HASH" --source "$PAYER" --network "$NETWORK")"

# The Testnet native asset contract (worthless test XLM).
TOKEN="$(stellar contract id asset --asset native --network "$NETWORK")"

# Commitment key = the payer account's raw ed25519 key (hex).
PAYER_KEY_HEX="$(cd "$ROOT" && node --input-type=module -e \
  "import {StrKey} from '@stellar/stellar-sdk';
   console.log(Buffer.from(StrKey.decodeEd25519PublicKey(process.argv[1])).toString('hex'))" \
  "$PAYER_ADDR")"

EXPIRES_AT="$(( $(date +%s) + TTL_SECONDS ))"
echo "init: deposit=$DEPOSIT stroops, expires_at=$EXPIRES_AT, close_wait=$CLOSE_WAIT"
stellar contract invoke --id "$CHANNEL_ID" --source "$PAYER" --network "$NETWORK" -- \
  init \
  --token "$TOKEN" \
  --payer "$PAYER_ADDR" \
  --provider "$PROVIDER_ADDR" \
  --payer_key "$PAYER_KEY_HEX" \
  --deposit "$DEPOSIT" \
  --expires_at "$EXPIRES_AT" \
  --close_wait "$CLOSE_WAIT"

cat >"$OUT" <<ENV
NETWORK=$NETWORK
PAYER=$PAYER
PROVIDER=$PROVIDER
PAYER_ADDR=$PAYER_ADDR
PROVIDER_ADDR=$PROVIDER_ADDR
WASM_HASH=$WASM_HASH
CHANNEL_ID=$CHANNEL_ID
TOKEN=$TOKEN
DEPOSIT=$DEPOSIT
EXPIRES_AT=$EXPIRES_AT
CLOSE_WAIT=$CLOSE_WAIT
ENV
echo "wrote $OUT"
stellar contract invoke --id "$CHANNEL_ID" --source "$PAYER" --network "$NETWORK" -- get
