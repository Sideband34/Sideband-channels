# Sideband — checklist for the owner

Written after the local continuation runbook was run on the owner's Windows machine on **2026-11-04**.
Everything below is **Stellar Testnet and synthetic data only**. There is **no audit**. Only items that
were run and observed are marked as done; everything else is listed as not done.

## Status

| Phase | Status | Evidence |
|---|---|---|
| 0. Baseline checks, all four repos | Done | channels 67 tests + cargo fmt/clippy/test (23); gateway 69 tests + landing build; protocol; mobile 95 tests (3 skipped); format and analyze clean |
| 1. Deploy the channel to Testnet | Done | contract, wasm hash and transactions below |
| 1. Smoke: top_up, settle, replay refusal, close_start, dispute with higher voucher, refund refusal | Done | transactions below |
| 1. Encoder vs contract parity | Done | `prepare_commitment` bytes equal the local encoder (384 hex chars), read-only check on a live channel |
| 1. Payer refund after the dispute window | Done | `scripts/smoke-refund-testnet.sh`, refund tx 42e6dc300b |…
| 1. wasm compared with `stellar contract build` | Done: hashes differ by build method | docs/DEPLOYMENT.md |
| 2. Gateway on the real channel (`ADAPTER=soroban`) | Done | settle, close, threshold auto-settle and payer-close answering all confirmed on Testnet |
| 2. Settlement intents persist | Done | SQLite via `DB_PATH` (already implemented; used in the live run) |
| 3. `flutter build apk --release` | Done | `app-release.apk`, 50.6 MB, built locally. **Not installed on any phone** |
| 3. Phone session | **Not done (needs you)** | script in section 3 |
| 3. BLE on two devices | **Not done** | still experimental, tested with fakes only |
| 3. Real Soroban client in the app | Built and tested, **not wired into the UI** | one real `top_up` through the Dart client on Testnet |
| CI on `main` | Green for the commits that existed before this run | check the Actions tabs again for the latest commits |
| Drips Wave, store listings, audit | **Not done (owner)** | sections 7 to 9 |

## 1. What is proven and what is not

Testnet, native-asset (XLM) channels, accounts created for this test only:

- Payer `GC7ZWRDXDPR6OFB6R72463R6PQQJHOEII5EVEEKOSK5ZQDQRYJSHPHRX`, provider `GBGVFJ3SDXJMUHW7WDZQSV6GXNU6MVY2BMTK2G6QREAZYW7OI64J75MP` (public addresses).
- Channel wasm hash (sha256 of the uploaded wasm): `8912942ed2dcf59a71b189c3eb8377264c04f72476d148a5ed84fd62f1ec71cb`.
- Testnet native asset contract: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.

| What ran | Channel | Result |
|---|---|---|
| Contract smoke (`scripts/smoke-testnet.sh`) | `CD67A4SD2ZWA4BPWVCJKSJ3AI4TJCHEJRUJIDUPPOWT4CEQAJOMS5OTS` | top_up, settle 0.3, replayed settle refused, close_start, refund refused in the window, provider closed with voucher 0.5, final provider payout 5000000 stroops |
| Gateway live session, `settle` | `CDDKJTRAJW64GEABEPH6BBPMTZSC7Z3ERALFPGWGRGZ26H2DYMN2RLER` | offer, accept (gateway read the channel from Soroban), 402, voucher, replay refused, served, settle CONFIRMED, channel still open, withdrawn 0.002 |
| Gateway live session, `close` | `CBLNJF3LQTS2XZICOF5ELI5UXH6WBNZKRHARNWT2SHHV4SAWZWRE3YWF` | same, then close CONFIRMED, channel Closed |
| Auto-settle threshold | `CAP3LTZDGPCDBSVHSB5EIM4NZIZXILPICYBSKRS6VSPAUIVBNOIVIKG3` | with `AUTO_SETTLE_AMOUNT=0.001` the gateway withdrew 0.002 by itself (event `Settled`, ledger 5558664) before the payer's close_start |
| Payer-initiated close answered | `CA7M24HM6TGJIX36E32Q2IBSODMBORSM4GDEDVT6MWVUOGFL7KPVTH2Q` | threshold set so it could not trigger; payer `close_start` then the gateway closed with the highest voucher inside the dispute window (events `CloseStarted` ledger 5558749, `Closed` ledger 5558753) |
| Dart client | `CDDKJTRAJW64GEABEPH6BBPMTZSC7Z3ERALFPGWGRGZ26H2DYMN2RLER` | one real `top_up` from the Flutter SDK client |

Transaction links (all checked as successful on Horizon unless marked):

- Deploy (contract instance for the smoke channel): <https://stellar.expert/explorer/testnet/tx/1d2a0b4e907b501c9d97466c92085c92b3eec74f29d7f81d653115fcaef491b8> and init <https://stellar.expert/explorer/testnet/tx/2e822d01b19fc70317b1f44e65e7c5a4bfe3b3b446ac7d6e085e42b1bdf2d8d7>
- top_up <https://stellar.expert/explorer/testnet/tx/9c97ad72fba8f35d8777c8680cae1b3d46bb4a5733be7a5191723e81106376a8>
- settle 0.3 <https://stellar.expert/explorer/testnet/tx/8d3484b2a7e4adfeb4cb2d7081417f8e6c681a9d76cf564ad5aad34c0ac78621> (not separately checked on Horizon; the smoke script asserted the result)
- close_start <https://stellar.expert/explorer/testnet/tx/55803c5047ed85b78f93ae996c5471ddf0df768cd764537880dd130fe79c583f> (same note)
- close with voucher 0.5 <https://stellar.expert/explorer/testnet/tx/f13324b00262b84983c94ae558323c1793edab337734649c264f0fcb66848559>
- Gateway settle <https://stellar.expert/explorer/testnet/tx/ebee4c51945b10479c335cbe1dd92d93bcb5ad8f00db85b7dbb84114057059a0>
- Gateway close <https://stellar.expert/explorer/testnet/tx/7cb93601ec15dd96ef6a475f435cb5c869254d8f4964ff0f0b0b04df706080e7> (checked by the gateway; not separately on Horizon)
- Answered payer close, gateway close <https://stellar.expert/explorer/testnet/tx/6de34d0a046a1dcc4dd88dff03c1b6a6759614f226d511ee227066301a55c884>
- Dart client top_up <https://stellar.expert/explorer/testnet/tx/7371d023595756969251ac6e0aa2f6605031fb048f17749c8ff470fc2fc19f63> (public hash from the live test output)

Raw evidence: `Sideband-gateway/docs/testnet-session-*.json`.

**Not proven, stated plainly:**

- No security audit. The channel contract is experimental. Testnet only; never use Mainnet or real funds.
- **No phone has run the app.** The release APK builds, but no one has installed it or run a session on a device.
- **BLE has never been tested on hardware.** It is unit-tested with fakes only and stays experimental.
- The app's channel screen still uses the on-device simulation by default; the real Soroban client exists and is tested (fake chain + one live Testnet call) but is not selected by the UI yet.
- Settlement outcomes were confirmed by the gateway reading Testnet; there is no independent monitoring or alerting.
- The gateway holds the provider secret in an environment variable (`PROVIDER_SECRET`); there is no HSM or secret-manager integration.
- Only native-asset channels were exercised.

Problems the live run found and fixed (all committed): two copies of the Stellar SDK made the gateway's transactions invalid;
the 60-second transaction window expired on a slow link; the gateway hid the real cause of 500 errors; the database directory
was not created on a first start; the smoke script printed but did not assert encoder parity; the mobile Gradle build needed a
newer `compileSdk` and `kotlin.incremental=false` on a two-drive Windows setup.

## Pending items

Both finished:

- **Payer refund after the dispute window** (`scripts/smoke-refund-testnet.sh`): **passed**, channel CAVEKZGZD7373UPN3O5UJ4M26UHA7QHBCTV4AQERGEEZFWTWY7DTK2TK, refund tx 42e6dc300bf21a3d3088079c4f40f9de6c27b6987114d57195234984b4681002 (full deposit returned)
- **wasm built by `stellar contract build` vs the uploaded wasm**: the three builds differ (uploaded 8912942e…, `stellar contract build` 92b713c4…, CI 7190d9fc…); not reproducible across toolchains, see docs/DEPLOYMENT.md

## 2. Releases (owner, GitHub UI)

For `Sideband-mobile`: Releases -> Draft a new release -> Choose a tag -> type a **lowercase** `v0.1.0` and "Create new tag on
publish" -> target `main` -> tick "Set as the latest release" -> Publish -> wait for the `release` workflow (about 10 to 15
minutes) -> open
`https://github.com/Sideband34/Sideband-mobile/releases/latest/download/sideband-android.apk` on a phone and confirm it
downloads. Note: the workflow runs on GitHub's Linux runners; it has not been exercised by this run (the local build was on
Windows and needed two Windows-specific Gradle settings, which are harmless on Linux).

## 3. Phone click-through (needs you and an Android phone)

1. On the machine running the gateway: `cd Sideband-gateway`, copy `.env.example` to `.env`, set `ADAPTER=soroban`,
   `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`, `CHANNEL_WASM_HASH=8912942ed2dcf59a71b189c3eb8377264c04f72476d148a5ed84fd62f1ec71cb`,
   a fresh random `SESSION_SECRET` and `ADMIN_TOKEN`, `HOST=0.0.0.0` (so the phone can reach it), `PORT=5001`, `DB_PATH=./data/gateway.db`,
   and `PROVIDER_SECRET` (a **Testnet** provider secret; type it yourself, never paste it anywhere else). Run `npm start`.
2. Find the machine's LAN address (for example `ipconfig`). Allow port 5001 through the firewall on a private network only.
3. Build the APK (`flutter build apk --release` in `Sideband-mobile`) or use the release APK once published. On the phone, allow
   installation from this source and install `app-release.apk`.
4. Open the app and create the wallet. Back up the recovery key if the app offers it.
5. Fund the app's address with Testnet XLM through friendbot (`https://friendbot.stellar.org/?addr=<public address>`).
6. Open a funded channel to your gateway's provider address. (Today this needs `Sideband-channels/scripts/deploy-testnet.sh`
   run with `PAYER` set to the app's key; the in-app open-channel flow is not built.)
7. In the app, point it at `http://<LAN address>:5001`, start a session, send metered requests, accept the 402 and sign a voucher.
8. On the gateway machine, settle with `POST /v1/channels/<channel id>/settle` (header `x-admin-token`), then confirm the new
   balance with `stellar contract invoke --id <channel> ... -- get`.
9. Try "Check status", "Top up", "Start close" and "Refund" on the channel tab. Today these use the on-device simulation;
   tell me if you see the word "Simulated" (expected) or any error.
10. Copy every error message (never a seed phrase or key) and send it to a coding agent in this repo with "read AGENTS.md".

## 4. Android signing (optional)

`keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`; `base64 -w0 release.jks`;
add repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` to
`Sideband-mobile`. Keep the keystore backed up and never commit it. Without these the release is debug-signed.

## 5. Vercel (landing page)

vercel.com -> sign in with GitHub -> allow the `Sideband34` org -> Add New -> Project -> import `Sideband34/Sideband-gateway` ->
Edit next to Root Directory and set **`apps/landing`** -> framework Next.js -> Deploy -> open the live URL and click every link
and the download button. Leave `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_PLAY_STORE_URL` unset until listings are live (iOS
correctly says "Coming soon"). Then put the URL in each repo's Website field and the org profile. The landing page builds
locally (`npm run build` in `apps/landing`, verified).

## 6. Hosting the gateway

Render, Railway or Fly: a Node service with a persistent disk for the SQLite file. Paste the environment variables yourself
(`ADAPTER`, `SOROBAN_RPC_URL`, `CHANNEL_WASM_HASH`, `PROVIDER_SECRET`, `SESSION_SECRET`, `ADMIN_TOKEN`, `DB_PATH`, `PORT`, `HOST`,
`PRICE_PER_UNIT`, `SETTLE_MODE`, `AUTO_SETTLE_AMOUNT`). Generate fresh secrets; never reuse the ones from this machine. Check
`/v1/health`, then point the app at the public URL.

## 7. GitHub org (remaining manual items)

The org settings, repo topics, security settings and the `.github` profile repos were already done by the owner and the main
session. Still manual: upload the org avatar (`brand/org-avatar.png`) and pin the main repos.

## 8. Drips Wave application

Read the current maintainer steps at <https://www.drips.network/wave>. Apply with the project's main repos; create real GitHub
issues from `docs/CONTRIBUTOR_ISSUES.md` (clear scope, acceptance test, labels as Wave's docs require); complete any
identity/KYC Drips asks for; describe the project truthfully using section 1 (Testnet only, no audit, no phone or BLE test yet).

## 9. Store listings (optional, later)

Google Play developer account (one-time fee) and a signed app bundle; Apple Developer Program and a Mac for iOS builds. Only
after a listing is live, set `NEXT_PUBLIC_PLAY_STORE_URL` / `NEXT_PUBLIC_APP_STORE_URL` on Vercel (https URLs on
`play.google.com` / `apps.apple.com`).

## 10. Before Mainnet (not part of this application)

Independent security audit of the contract and gateway, a bug bounty, legal review, a key-management plan (HSM or secret
manager for the provider key), monitoring and alerting. Do not describe the project as production-ready before this.

## 11. Hand-back

If anything above fails, send the error text (never keys or seed phrases) to a coding agent in this repo and tell it to read
`AGENTS.md`.

## Things this run could not do on the owner's behalf

- Accept the Android SDK licences (`flutter doctor --android-licenses`): the doctor reports them as not accepted. The release
  APK still built here, but run this yourself if Android tooling complains.
- Install the app on a phone, use two BLE devices, use a real wallet, create store or Vercel/Render accounts, or complete the
  Drips application.
