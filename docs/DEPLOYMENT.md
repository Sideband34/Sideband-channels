# Sideband — Environment, Deployment and Recovery

## Environment boundaries
- Local: deterministic Docker Compose services, Stellar local network/Testnet, synthetic users/fixtures.
- Staging: separate database, bucket, API credentials, signing identities, Testnet assets/contracts, observability.
- Production: requires security audit, real issuer/provider agreements and relevant jurisdictional legal/compliance review. Not included in preimplementation scaffold.

## Suggested variables (non-secret examples only)
```dotenv
APP_ENV=development
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
DATABASE_URL=postgresql://localhost:5432/sideband
REDIS_URL=redis://localhost:6379
API_BASE_URL=http://localhost:3001
CHAIN_START_LEDGER=0
LOG_LEVEL=info
```
- Credentials to sign on-chain go into a secure secret manager or hardware-backed user wallet, never into a public mobile/web bundle.
- Signed store badge links are configured after actual publication; no fabricated App Store or Google Play app URLs.

## CI & GitHub setup
- GitHub Actions per repo: formatting/lint, schema checks, unit tests, dependency scanning; chain/devices smoke tests where supported.
- Branch protection and PR review recommended.
- Release tag points to tested sibling versions in an integration lockfile.
- All paths use offline/synthetic test fixtures, not real user financial records.

## Failure recovery
- Rebuild indexers from ledger cursor; compare DB projection vs chain truth.
- Restore DB backups after verifying transaction-intent reconciliation.
- Never republish user transactions solely because a client request timed out.
- Test signing-key rotation, dependency outages, stale quotes, malicious user input, insufficient balances and duplicate delivery.
- External reference infrastructure may change; check upstream project versions and licenses at build time.

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
