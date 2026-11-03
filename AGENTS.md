# AI Coding Agent Instructions — sideband-channels

## Mission
Implement **only the `sideband-channels` subsystem** as defined in `docs/PROJECT_MASTER.md`, `docs/ARCHITECTURE.md`, `docs/SRD.md`, and `docs/TECHNICAL_BUILD.md`. The entire product is Sideband: A local service microcommerce protocol. Compatible nearby devices negotiate a metered service over Bluetooth/local Wi-Fi and exchange signed cumulative payment commitments. A payer has previously funded a Stellar channel while online; offline service usage is later settled on-chain when connectivity returns. The voucher itself is not instant final money transfer.

## Neighbor repositories
`sideband-mobile`, `sideband-protocol`, `sideband-gateway`. You are responsible for your own component and versioned integrations; do not duplicate their owners' logic.

## Current state (read before trusting older docs)

This repository is **built and CI-verified, not yet run against a live network**. Code, tests, docs, the
landing page and release workflows are complete and on `main`. What has never been done: deploying to Stellar
Testnet, running on real phones or with a real wallet, any security audit, any store listing, any
Drips Wave approval. Do not describe those as done. Older text in `docs/` that says the repo is only a
scaffold is superseded by `README.md` (status table) and `CHANGELOG.md`.

## Execution
1. Read all project docs and verify the **domain safety constraints** first.
2. Define your contracts with sibling repos using schema/ABI and fixtures. Agree on versioned handshake.
3. Complete M0 and M1 before style polish or unrelated new features.
4. Make small, testable commits (PRs only if the owner asks) and record architecture changes in ADRs.
5. Never pretend missing product or chain integrations are working; use clearly labeled test adapters.
6. Write real tests for system logic and failure paths, not only mocked happy paths.
7. Don't ask for production funds/credentials; use Testnet and synthetic providers.
8. Keep UI architecture flexible and let design be refined while respecting the brand's flat-icon and functional requirements.

---

> You are in `Sideband-channels` (GitHub `Sideband34/Sideband-channels`). The sections below apply to the whole Sideband project (4 repos).
> Run the runbook from the repo it names; stay inside this project's repos.

## START HERE: how to use this file

You are an AI coding agent working **on the owner's own computer** (not the cloud sandbox that built
this code). When the owner says only "read AGENTS.md", do this:

1. Read this whole file, then `docs/PROJECT_MASTER.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`
   and `CHANGELOG.md` of the repo you are in.
2. Detect the workspace (section "Workspace layout"), fetch any missing sibling repos.
3. Run the **Local continuation runbook** below, phase by phase, in order. Do all the work you can
   do yourself. Stop and ask the owner only at the points marked **HUMAN**.
4. When the phases are done, produce the **Final checklist for the owner** (last section) with the
   real values you obtained (contract ids, URLs, hashes) filled in. That checklist is the final
   deliverable. After the owner completes it, the project is ready to submit to Drips Wave.

### Why this section exists

The code was written in a cloud sandbox with **no route to Stellar Testnet, no stellar-cli, no
Android SDK and no real wallet or phone**. Everything that needs those was written and tested
offline (unit tests, property tests, golden vectors, fake adapters) but **never run for real**.
Running it for real, fixing whatever breaks, and recording the evidence is your job.

## Truth rules (non-negotiable)

- Never claim that something works, is deployed, audited or listed unless **you ran it and saw the
  output**. Quote the command and result in your commit message or in `docs/DEPLOYMENT.md`.
- Never invent a contract id, transaction hash, URL, store listing, metric, user or partner.
- If a script, command or test fails, **fix the root cause** (script flags, RPC parameters, fees,
  code) and rerun. Do not skip, delete or weaken a test to get green. Do not mark a step done on a
  partial success.
- If something cannot be done on this machine (wallet click, phone, store account), say so plainly and
  put it in the owner's checklist instead of faking it.
- Everything is **Stellar Testnet and synthetic data only**. Never use Mainnet or real funds. The
  deploy scripts refuse Mainnet; do not remove that guard.

## Secrets and safety rules

- Never commit, print, log or paste into chat any secret key, seed phrase, keystore, token, password
  or `.env` file. Use `stellar keys` **aliases** (the key stays in the local stellar-cli keystore).
  `stellar keys show <alias>` prints a secret: never run it where the output is recorded; the Sideband
  smoke script uses it only inside a pipe.
- `.env` files are gitignored. Only `.env.example` (placeholders) is committed. Before every commit run
  `git diff --cached` and look for keys (`S` + 55 characters is a Stellar secret seed), tokens and
  passwords. Check that generated files such as `.testnet-channel.env` are gitignored or contain
  only public ids (add them to `.gitignore` if not).
- Committing contract ids, wasm hashes, Testnet account **public** addresses and transaction hashes
  is correct and expected (they are public). Commit them under `deployments/` and in the README.
- Do not call any paid or third-party service, create accounts, or sign up for anything for the owner.

## Git rules

- Work on `main`. Make small commits, one logical change each, with an honest message (`fix(scripts):
  pass --source-account to stellar contract invoke`). Run the repo's full check before each commit.
- Do not backdate, squash to hide history, force-push, rewrite published history, open pull
  requests, or push tags/releases unless the owner asks. Releases are created by the owner in the GitHub UI
  with a **lowercase** tag such as `v0.1.0`, because the release workflows trigger on `v*`.
- Keep the author identity from the machine's git config. Follow any commit trailer your own tool
  requires. Never put a model name in code comments or docs.

## Workspace layout

The repos reference each other by relative path (`file:../Sideband-channels`, `../Unbound-stellar`,
`../Sideband-gateway`, ...), and several cross-repo tests are skipped when a sibling is missing. So the
sibling folder names must match the GitHub repo names exactly. Supported layouts:

```
A) one folder per project (4 repos)      B) one folder with all 12 repos
   Unbound/                                 workspace/
     Unbound-core/ Unbound-stellar/           Unbound-core/  Unbound-stellar/  Unbound-site/  Unbound-mobile/
     Unbound-site/ Unbound-mobile/            Torrent-api/   Torrent-contracts/ Torrent-indexer/ Torrent-web/
                                              Sideband-protocol/ Sideband-channels/ Sideband-gateway/ Sideband-mobile/
```

Detect with `pwd` and `ls ..`. For any sibling of **your project** that is missing, clone it next to
this repo: `git clone https://github.com/<Org>/<Repo> ../<Repo>` (orgs: `Unbound224`, `Torrent998`,
`Sideband34`). Never clone into, or modify, another project's repos unless the owner asks.
In layout B, work only on the project the owner names (or the repo you are standing in) and leave the
other projects alone.

## Tools to install first (check with `command -v`; ask the owner before installing anything global)

| Tool | Needed for | Notes |
|---|---|---|
| git, curl, jq, bash | everything | jq and curl are used by the deploy scripts |
| Node.js 22.13+ and npm | TypeScript repos | `node -v` |
| Rust stable + `rustup target add wasm32v1-none` | Soroban contracts | the old `wasm32-unknown-unknown` target is not used |
| stellar-cli 25.2 or newer (28.x recommended) | deploy and smoke scripts | see https://developers.stellar.org/docs/tools/cli/install-cli ; verify with `stellar --version` |
| Flutter stable (Dart 3.13+) | mobile repos | `flutter doctor`; Android toolchain only for APK builds |
| shellcheck | CI runs it on the scripts | optional locally |
| Playwright browsers | only for screenshots | optional |

If you build a contract with plain `cargo` (not `stellar contract build`) export
`SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1`. `stellar contract build` is the canonical way
and does the spec shaking soroban-sdk 29 expects.

## Funding and keys on Testnet

```
stellar network ls                                   # testnet should be listed; add it if not
stellar keys generate --fund <alias> --network testnet   # creates a key in the local keystore and funds it with friendbot
stellar keys address <alias>                         # PUBLIC address, safe to print and commit
```

If friendbot is rate-limited, wait and retry; do not create keys with real funds. Aliases used by the
scripts are named in each project's runbook.

## Definition of done for every phase

A phase is done only when: the commands ran on this machine, their output is recorded in
`docs/DEPLOYMENT.md` (date, command, ids/hashes, result), the repo's full check is green, the change is
committed and pushed to `main`, and CI on `main` is green (check the repo's Actions tab, or
`gh run list` if the GitHub CLI is installed).

---

## Project: Sideband (org `Sideband34`)

Sideband lets a phone pay a nearby provider for metered usage with off-chain signed vouchers that settle
on a Stellar/Soroban one-way payment channel (voucher format `sideband-commit-v2` = upstream
`Commitment` XDR map {amount, channel, domain "chancmmt", network}). Repos and roles:

| Repo | Role | Check command | Run for real |
|---|---|---|---|
| `Sideband-protocol` | Dart package: frames, handshake state machine, meter, transport interface (protocol v2 adds `session_accept.baseline`) | `dart format --set-exit-if-changed . && dart analyze && dart test` | library only |
| `Sideband-channels` | Soroban channel contract (top_up, settle, close_start, close, refund) + TypeScript SDK (in-memory and Soroban adapters) | `npm run check`; `cargo fmt --check && cargo clippy -- -D warnings && cargo test` | `scripts/deploy-testnet.sh`, `scripts/smoke-testnet.sh` |
| `Sideband-gateway` | Provider gateway (HTTP 402, sessions, settlement) + `apps/landing` Next.js landing page | `npm run check`; in `apps/landing`: `npm run lint && npm test && npm run build` | `npm start` with `ADAPTER=soroban` |
| `Sideband-mobile` | Flutter app: secure key storage, session journal, channel tab, BLE/LAN transports | `dart format --set-exit-if-changed . && flutter analyze && flutter test` | `flutter run` on a phone |

`Sideband-gateway` depends on `file:../Sideband-channels` (build it first: `cd ../Sideband-channels && npm ci
&& npm run build`). `Sideband-mobile` depends on `Sideband-protocol` by git ref `main` and has an e2e test that
runs against `../Sideband-gateway` when present.

### Local continuation runbook (Sideband)

**Phase 0. Verify the baseline.** Pull and run every check in the table. All must pass.

**Phase 1. Deploy and exercise the channel on Testnet (Sideband-channels).**
1. `rustup target add wasm32v1-none`; `stellar --version`.
2. `scripts/deploy-testnet.sh` creates and friendbot-funds identities `sideband-payer` and
   `sideband-provider` (override with `PAYER`, `PROVIDER`), deploys the wasm, opens one channel
   (defaults: `DEPOSIT=10000000` stroops = 1 XLM, `TTL_SECONDS=86400`, `CLOSE_WAIT=600`) and writes
   `.testnet-channel.env` (CHANNEL_ID, WASM_HASH, TOKEN, addresses). It has **never run**. Fix real
   failures (CLI flags, token/SAC handling, constructor arguments) and rerun. Confirm the file contains
   no secret and is gitignored (add `.testnet-channel.env` to `.gitignore` if it is not).
3. `scripts/smoke-testnet.sh` runs: prepare_commitment parity (on-chain bytes equal the local encoder),
   top_up, settle with voucher 0.3, replayed settle refused, close_start, provider disputes with a higher
   voucher 0.5, refund refused during the window, and asserts final amounts. If parity fails, the encoder
   and the contract disagree: fix the one that deviates from the upstream one-way-channel semantics, update
   golden vectors, rerun all checks.
4. Wait out `CLOSE_WAIT` in a second run and verify `refund` after the dispute window on a fresh channel.
5. Record channel id, wasm hash, the deploy ledger and every transaction hash in `docs/DEPLOYMENT.md` and the
   README "Deployments" section (with Stellar Expert Testnet links). Commit. Compare the wasm built by
   `stellar contract build` against the CI artifact and note the sha256.

**Phase 2. Gateway on the real channel (Sideband-gateway).**
1. Build the channels SDK, then in the gateway set `ADAPTER=soroban`, `STELLAR_RPC_URL`, and the channel
   details from `.testnet-channel.env`. Read `src/main.ts` for exactly which variables the Soroban adapter
   uses; add any that are missing to `.env.example` and the README. Set `SESSION_SECRET` to a fresh random
   value (never commit it). Start with `npm start`.
2. Drive a full session with a script or curl: offer, accept (with baseline), metered requests, 402, voucher,
   settle, status, close. Verify balances on Testnet with `stellar contract invoke ... balance`.
   Fix gateway/adapter bugs this exposes. Exercise `SETTLE_MODE=settle|close`, `AUTO_SETTLE_AMOUNT`,
   the payer-initiated `close_start` handling, and `POST /settle`.
3. Settlement intents are in memory only (known gap): either persist them (SQLite via `DB_PATH`) with
   tests, or document the limit prominently.

**Phase 3. Mobile on a real device (HUMAN needed for the phone).**
1. `flutter doctor` must show the Android toolchain; `flutter build apk --release` must succeed. This is
   the first real Gradle build with `flutter_secure_storage` and `universal_ble`; fix any Gradle, minSdk
   or manifest problems and keep the release workflow (`.github/workflows/release.yml`) consistent.
2. With the gateway running on the LAN, ask the owner to install the APK on a phone, point the app at the
   gateway, and run a session end to end. Collect errors, fix, add tests.
3. BLE transport has only been tested with fakes. If two devices are available, test it; if not, say so in
   `docs/DEPLOYMENT.md` and leave it marked experimental. Never claim hardware validation you did not do.
4. The mobile channel actions (top-up, start close, refund) run against an on-device simulation. Replace the
   simulation with a real Soroban client (Dart): build, simulate, sign (key from secure storage) and submit
   `top_up`, `close_start`, `refund` through Soroban RPC, with the UI showing real transaction hashes. Use a
   maintained Dart Stellar SDK; check its license and pin the version. Keep the simulator behind the same
   interface for tests.

**Phase 4.** Produce the final checklist (last section).

### Sideband specifics for the final checklist

- Landing: Vercel project from `Sideband34/Sideband-gateway` with **Root Directory `apps/landing`**,
  framework Next.js. The Android button already links to
  `https://github.com/Sideband34/Sideband-mobile/releases/latest/download/sideband-android.apk`; iOS stays
  "Coming soon". Leave `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_PLAY_STORE_URL` unset until the listings are live.
- Release: the owner creates the release in the GitHub UI with a lowercase tag (`v0.1.0` style). The workflow
  builds `sideband-android.apk` + `.sha256` (debug-signed unless the four `ANDROID_*` secrets are set).
- The gateway is a long-running Node service: host on Render/Railway/Fly with its env, then point the app at it.
- Known gaps to state honestly: BLE hardware validation, no audit, in-memory settlement intents (unless you fixed it).

---

## Final checklist for the owner (the last thing you produce)

When the runbook phases are done, write `docs/OWNER_CHECKLIST.md` in the repo you are in (and print it in
the chat). Fill every `<...>` with the real value you obtained; remove items that no longer apply; keep the
steps that only the owner can do. Start with a short **status table** (phase, done/not done, evidence link).
Say honestly which items are still unverified. Include at least these sections, in this order:

1. **What is proven and what is not.** Contract ids and Testnet links, smoke-run results, tests, CI links.
   State plainly: no audit, Testnet only, which hardware or wallet paths were or were not tested.
2. **Releases (owner, GitHub UI).** For each mobile repo: Releases -> Draft a new release -> choose tag ->
   type a **lowercase** `vX.Y.Z` and "Create new tag on publish" -> target `main` -> tick "Set as the latest
   release" -> Publish -> wait for the `release` workflow (about 10 to 15 minutes) -> open the
   `/releases/latest/download/<name>-android.apk` link on a phone to confirm it downloads.
3. **Android signing (optional).** `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048
   -validity 10000 -alias upload`; `base64 -w0 release.jks`; add repository secrets `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` to the mobile repo. Keep the
   keystore backed up and never commit it.
4. **Vercel (landing page).** vercel.com -> sign in with GitHub, allow the org -> Add New -> Project ->
   import the repo -> set **Root Directory** exactly as in the project section above (Edit button next to
   Root Directory) -> framework Next.js -> add the environment variables for Production (project section)
   -> Deploy -> open the live URL and click every link and the download button. Then put the URL in the
   repo's Website field and the org profile. Docs: https://vercel.com/docs/monorepos
5. **Backends (if the project has one).** Create a Render, Railway or Fly service per Node service with a
   persistent disk for SQLite; paste the environment variables (generated secrets, never from the repo);
   check the health endpoint; set CORS and proxy variables to the Vercel URL; redeploy the landing page
   with the final backend URL.
6. **GitHub org and repo settings.** Per org: upload the avatar (`brand/org-avatar.png`); create a public
   `.github` repo with `profile/README.md` copied from `brand/ORG_PROFILE.md`. Per repo: Settings -> Code
   security -> enable private vulnerability reporting, Dependabot alerts and secret scanning; add topics
   (`stellar`, `soroban`, `drips-wave` plus the domain); add the website URL; pin the main repos.
7. **Drips Wave application.** Read the current maintainer steps at https://www.drips.network/wave , then:
   apply with the project's main repos; create real GitHub issues from `docs/CONTRIBUTOR_ISSUES.md` (clear
   scope, acceptance test, labels as Wave's docs require); complete any identity/KYC Drips asks for;
   describe the project truthfully using section 1.
8. **Store listings (optional, later).** Google Play developer account (one-time fee) and a signed app
   bundle; Apple Developer Program and a Mac for iOS builds. Only after a listing is live, set
   `NEXT_PUBLIC_PLAY_STORE_URL` / `NEXT_PUBLIC_APP_STORE_URL` on Vercel (https URLs on
   `play.google.com` / `apps.apple.com`) so the real badges appear. Until then the landing page correctly
   says "Coming soon" for iOS.
9. **Before Mainnet (not part of this application).** Independent security audit, a bug bounty, legal review,
   key-management plan. Do not describe the project as production-ready before this.
10. **Hand-back.** If anything in 1 to 9 fails, send the error text (never keys or seed phrases) back to a
    coding agent in this repo and tell it to read `AGENTS.md`.

Do not tick any item for the owner. Do not ask the owner for secrets: they type secrets only into
Vercel/Render/GitHub settings pages themselves.
