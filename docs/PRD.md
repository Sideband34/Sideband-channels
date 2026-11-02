# Sideband — Product Requirements Document

**Status:** technical product specification, preimplementation. **Platform:** Flutter mobile (iOS/Android) + local provider/gateway + landing in gateway.  **Target:** Stellar Testnet demo, real adoption only after risk/legal validation.

## Vision
A local service microcommerce protocol. Compatible nearby devices negotiate a metered service over Bluetooth/local Wi-Fi and exchange signed cumulative payment commitments. A payer has previously funded a Stellar channel while online; offline service usage is later settled on-chain when connectivity returns. The voucher itself is not instant final money transfer.

## Who needs it
Local providers of genuinely useful digital services: demo text conversion, local captions, metered edge processing or local network access where permitted.

## Core user outcomes
- advertise and discover supported metered local services
- verify local provider identity and service manifest
- open or bind a previously funded Stellar payment channel online
- negotiate service units, price cap, expiry and refund policy
- consume a local service with monotonic signed payment commitments
- close/settle the channel when connectivity returns and verify statement

## Core customer journey
1. Provider announces a local test service and a signed price/units manifest.
2. Payer pre-funds a supported Stellar channel while online.
3. Two physical devices discover and negotiate over BLE/local Wi-Fi, then go offline.
4. Provider delivers a small locally hosted service; usage meter emits verifiable units.
5. Payer authorizes incremental cumulative signed commitments under an explicit spending cap.
6. Provider verifies vouchers locally without claiming final settlement.
7. On reconnect, channel settlement is submitted to Stellar and shown as confirmed after chain verification.

## Functional requirements
- advertise and discover supported metered local services
- verify local provider identity and service manifest
- open or bind a previously funded Stellar payment channel online
- negotiate service units, price cap, expiry and refund policy
- consume a local service with monotonic signed payment commitments
- close/settle the channel when connectivity returns and verify statement

## Non-goals for first MVP
- claim that brand-new parties can freely exchange final Stellar money with zero connectivity
- unbounded off-chain credits
- automatic access to other people’s network or paid service without permission
- full decentralized roaming service marketplace or production cash payouts

## Safety and commercial reality
- A brand new payer/provider channel normally needs connectivity before use.
- Signed offline vouchers are commitments, not settled cash. The provider bears channel/settlement risk.
- BLE throughput is small; negotiate over BLE then prefer local Wi-Fi for sustained service transfer.
- Android/iOS Bluetooth background/discovery permissions vary; physical-device testing required.
- Experimental one-way-channel contracts require security review before real-money deployment.

## Core success measures
- time to discover+pair
- offline voucher verification latency
- usage meter discrepancy
- successful settlement after reconnect
- replay/rollback rejection
- real device compatibility matrix

## Acceptance tests
- Two physical phones discover and pair locally using BLE/local Wi-Fi.
- A Testnet channel was funded while online, before disconnected session.
- With internet disabled, a metered synthetic service delivers units and multiple valid vouchers.
- Replay, lower cumulative amount, unauthorized device and incorrect channel domain are rejected.
- After internet returns, provider closes channel and amount matches authorized usage.
- Offline UI never claims final settlement prior to on-chain confirmation.

## Repository architecture
See `ARCHITECTURE.md`. Exactly four repos are proposed as stable engineering ownership boundaries. Reducing or increasing them requires a written technical justification, not reward optimization.
