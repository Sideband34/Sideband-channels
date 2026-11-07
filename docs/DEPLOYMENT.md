# Deploying the Sideband channel contract

The channel contract and its TypeScript SDK are in this repository. Everything below is **Stellar Testnet only**. The contract is experimental and **not audited**.

## Requirements

- stellar-cli 25.2 or newer (the runs below used 27.1.0)
- Rust stable with `rustup target add wasm32v1-none`
- Node 22 or newer, `jq` and `curl` (the scripts use them)

## Scripts

| Script | What it does |
|---|---|
| `scripts/deploy-testnet.sh` | Creates and funds the payer and provider identities through friendbot, deploys the wasm, opens one channel and writes its public ids to `.testnet-channel.env` |
| `scripts/smoke-testnet.sh` | Runs the lifecycle on a channel: `top_up`, `settle`, replayed settle refused, `close_start`, provider disputes with a higher voucher, refund refused, with on-chain assertions |
| `scripts/smoke-refund-testnet.sh` | The payer's `refund` after the dispute window on a fresh channel |
| `scripts/sign-voucher.ts` | Signs a voucher with a key from the local stellar-cli keystore (read in memory, never printed) |

Environment for `deploy-testnet.sh` (all optional): `NETWORK` (testnet), `PAYER` (`sideband-payer`), `PROVIDER` (`sideband-provider`), `DEPOSIT` (`10000000` stroops, 1 XLM),
`TTL_SECONDS` (`86400`), `CLOSE_WAIT` (dispute window in seconds, 60 to 2678400, default `600`), `OUT` (`.testnet-channel.env`). The generated `.testnet-channel*.env` files hold public ids
only and are gitignored. Keys stay in the local stellar-cli keystore and are referenced by alias.

Run stellar-cli from a directory without a `.env` file: stellar-cli loads one from its working directory, and a `SOROBAN_RPC_URL` there makes it demand `--network-passphrase`.

## Building the wasm

```bash
cd contracts
stellar contract build
```

CI builds the release wasm with plain cargo (`SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1`) and uploads it with its sha256. The hashes differ by build method, so no reproducible-build
claim is made. Compare a deployed wasm hash with a build you made yourself from the same commit and toolchain.

## Recovery

- A settlement whose outcome is unknown goes to `RECONCILING` and is resolved from ledger evidence, never by blind resubmission.
- A payer who loses the provider starts `close_start` and refunds after the dispute window and the channel expiry.
- Rotate keys by deploying a new channel; a channel is bound to one payer and one provider for its life.

## Testnet run log (2026-11-04)

Everything here ran on **Stellar Testnet** with throwaway accounts (stellar-cli 27.1.0; Rust MSVC toolchain on Windows). Public data only.
The channel contract is experimental and **not audited**.

### Deployment (`scripts/deploy-testnet.sh`)

| Item | Value |
|---|---|
| Wasm hash (sha256 of the uploaded wasm) | `8912942ed2dcf59a71b189c3eb8377264c04f72476d148a5ed84fd62f1ec71cb` |
| Payer (public) | `GC7ZWRDXDPR6OFB6R72463R6PQQJHOEII5EVEEKOSK5ZQDQRYJSHPHRX` |
| Provider (public) | `GBGVFJ3SDXJMUHW7WDZQSV6GXNU6MVY2BMTK2G6QREAZYW7OI64J75MP` |
| Asset | Testnet native asset contract `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Smoke channel | [`CD67A4SD2ZWA4BPWVCJKSJ3AI4TJCHEJRUJIDUPPOWT4CEQAJOMS5OTS`](https://stellar.expert/explorer/testnet/contract/CD67A4SD2ZWA4BPWVCJKSJ3AI4TJCHEJRUJIDUPPOWT4CEQAJOMS5OTS) (deploy [1d2a0b4e90…](https://stellar.expert/explorer/testnet/tx/1d2a0b4e907b501c9d97466c92085c92b3eec74f29d7f81d653115fcaef491b8), init [2e822d01b1…](https://stellar.expert/explorer/testnet/tx/2e822d01b19fc70317b1f44e65e7c5a4bfe3b3b446ac7d6e085e42b1bdf2d8d7), ledger 5557371) |

The script needed no change to deploy. The first attempt of the day failed once with a transient
`Access is denied` while compiling and was rerun; one channel was left half-used when two of my own scripts
submitted transactions for the same account at once (`TxBadSeq`); it is not part of this log.

### Smoke run (`scripts/smoke-testnet.sh`, fresh channel)

| Step | Result | Tx |
|---|---|---|
| `prepare_commitment` parity | on-chain bytes equal the local encoder (384 hex chars). Asserted by the script since this run; the live check was done read-only on a deployed channel | n/a |
| top_up 0.2 | ok | [9c97ad72fb…](https://stellar.expert/explorer/testnet/tx/9c97ad72fba8f35d8777c8680cae1b3d46bb4a5733be7a5191723e81106376a8) |
| settle with voucher 0.3 (channel stays open) | ok | [8d3484b2a7…](https://stellar.expert/explorer/testnet/tx/8d3484b2a7e4adfeb4cb2d7081417f8e6c681a9d76cf564ad5aad34c0ac78621) |
| replayed settle | refused by the contract | n/a |
| close_start (payer) | ok | [55803c5047…](https://stellar.expert/explorer/testnet/tx/55803c5047ed85b78f93ae996c5471ddf0df768cd764537880dd130fe79c583f) |
| payer refund inside the window | refused | n/a |
| provider closes with the higher voucher 0.5 | ok, provider paid 5000000 stroops | [f13324b002…](https://stellar.expert/explorer/testnet/tx/f13324b00262b84983c94ae558323c1793edab337734649c264f0fcb66848559) |
| payer refund after the channel is closed | refused | n/a |

Checked on Horizon: top_up, settle, close_start, close and the init transaction are all `successful: true`.

### Refund after the dispute window (`scripts/smoke-refund-testnet.sh`)

Fresh channel [`CAVEKZGZD7373UPN3O5UJ4M26UHA7QHBCTV4AQERGEEZFWTWY7DTK2TK`](https://stellar.expert/explorer/testnet/contract/CAVEKZGZD7373UPN3O5UJ4M26UHA7QHBCTV4AQERGEEZFWTWY7DTK2TK) (deposit 10000000 stroops, close wait 60 s, TTL 3600 s): close_start, payer refund refused inside the window, waited, then the payer refund succeeded ([42e6dc300b…](https://stellar.expert/explorer/testnet/tx/42e6dc300bf21a3d3088079c4f40f9de6c27b6987114d57195234984b4681002)); on-chain status Refunded and the payer received the **whole** 10000000 stroops (script assertion). Result: **passed**.

Note: the contract allows the refund at the **later** of `expires_at` and the close window, so the wait is governed by the channel's expiry (the script uses a 1 hour TTL), not by `CLOSE_WAIT` alone.

### Wasm hashes differ by build method

| Build | sha256 |
|---|---|
| Uploaded to Testnet (plain `cargo build`, MSVC Windows, spec shaking env set) | `8912942ed2dcf59a71b189c3eb8377264c04f72476d148a5ed84fd62f1ec71cb` |
| `stellar contract build` on the same machine | `92b713c48d1cb04071a56bc87100c2a1c856c773c0d7c19c255660f06031f048` |
| CI artifact (`sideband-channel-wasm`, Linux, plain cargo, run 41883710396) | `7190d9fc396d94ec2296a0390cf78f9e489c98a43dba99234940788e48573d22` |

The three builds are functionally the same source but not byte-identical, so a reproducible-build claim is **not** made.
Anyone verifying a deployment should compare the on-chain wasm hash with a build they made themselves from the same commit
and toolchain, not with CI's artifact.

### Fixes this run made (all committed)

- `RpcSorobanClient.forUrl` and `ownKeypair`: a second copy of `@stellar/stellar-sdk` (the gateway's own `node_modules`)
  produced XDR objects this package rejected ("functionName: expected string, Uint8Array, or XdrString").
- The transaction validity window is now 300 s (configurable). With 60 s the ledger rejected live transactions as too late
  (`txTOO_LATE`) because simulation took too long from this machine.
- `smoke-testnet.sh` now asserts encoder parity instead of only printing the bytes; `smoke-refund-testnet.sh` is new.
- `.gitignore` covers every generated `.testnet-channel*.env` (public ids only, still not committed).
