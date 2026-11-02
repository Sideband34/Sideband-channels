import { Keypair } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASES } from '../src/networks.js';
import { keypairSigner } from '../src/vouchers/voucher.js';
import type { VoucherDomain } from '../src/vouchers/format.js';
import { InMemoryChannelAdapter } from '../src/channels/memory.js';

/** Deterministic SYNTHETIC test keys. These seeds are public test data. */
export const payerKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
export const providerKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
export const attackerKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
export const payer = keypairSigner(payerKp);
export const TESTNET = NETWORK_PASSPHRASES.testnet;

export const STROOPS = 10_000_000n;

export async function openChannel(now = 1_000, deposit = 10n * STROOPS, expiresAt = 10_000) {
  const clock = { t: now };
  const adapter = new InMemoryChannelAdapter(() => clock.t);
  const { binding } = await adapter.open({
    networkPassphrase: TESTNET,
    payer: payerKp.publicKey(),
    provider: providerKp.publicKey(),
    asset: 'TEST-TOKEN',
    deposit,
    expiresAt,
    idempotencyKey: 'k1',
  });
  const domain: VoucherDomain = {
    networkPassphrase: TESTNET,
    channelId: binding.channelId,
    payer: binding.payer,
    provider: binding.provider,
  };
  return { clock, adapter, binding, domain };
}
