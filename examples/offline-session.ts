/**
 * Synthetic end-to-end walk-through (no chain, no funds):
 * open (online) -> offline vouchers -> provider verifies -> close/settle.
 * Run: npx tsx examples/offline-session.ts
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  InMemoryChannelAdapter,
  InMemoryVoucherStore,
  NETWORK_PASSPHRASES,
  acceptVoucher,
  createVoucher,
  keypairSigner,
  prepareSettlement,
} from '../src/index.js';

const S = 10_000_000n;
const payerKp = Keypair.random();
const providerKp = Keypair.random();
const clock = { t: 1_000 };
const adapter = new InMemoryChannelAdapter(() => clock.t);

const { binding, synthetic } = await adapter.open({
  networkPassphrase: NETWORK_PASSPHRASES.testnet,
  payer: payerKp.publicKey(),
  provider: providerKp.publicKey(),
  asset: 'TEST-TOKEN',
  deposit: 10n * S,
  expiresAt: 5_000,
  idempotencyKey: 'demo',
});
console.log('opened (synthetic:', synthetic, ')', binding.channelId);

const domain = { ...binding };
const store = new InMemoryVoucherStore();
const policy = {
  deposit: binding.deposit,
  maxSpend: 5n * S,
  expiresAt: binding.expiresAt,
  now: () => clock.t,
};
const signer = keypairSigner(payerKp);
for (const n of [1n, 2n, 2n, 1n, 3n]) {
  const r = await acceptVoucher(domain, policy, store, createVoucher(signer, domain, n * S));
  console.log(`voucher ${n}:`, r.ok ? `accepted (cumulative ${r.cumulative})` : `rejected ${r.code}`);
}
const highest = (await store.get(binding.channelId))!;
const intent = prepareSettlement(binding, highest);
console.log('settlement intent', intent.state, 'amount', intent.amount);
console.log('close ->', await adapter.close(binding.channelId, highest.voucher));
