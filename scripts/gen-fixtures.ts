/**
 * Generates fixtures/voucher-vectors.json: golden vectors for the
 * `sideband-test-format-v1` voucher layout, consumed by the TS tests, the Rust
 * contract tests, and (later) sideband-gateway / sideband-mobile.
 * Keys are deterministic SYNTHETIC test seeds (public, worthless).
 */
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  NETWORK_PASSPHRASES,
  VOUCHER_DOMAIN,
  VOUCHER_FORMAT,
  buildPreimage,
  createVoucher,
  keypairSigner,
} from '../src/index.js';

export function buildVectors() {
  const payerSeed = Buffer.alloc(32, 1);
  const providerSeed = Buffer.alloc(32, 2);
  const payer = Keypair.fromRawEd25519Seed(payerSeed);
  const provider = Keypair.fromRawEd25519Seed(providerSeed);
  const channelRaw = Buffer.alloc(32, 9);
  const domain = {
    networkPassphrase: NETWORK_PASSPHRASES.testnet,
    channelId: StrKey.encodeContract(channelRaw),
    payer: payer.publicKey(),
    provider: provider.publicKey(),
  };
  const amounts = ['0.0000001', '1', '2.5', '10'];
  return {
    format: VOUCHER_FORMAT,
    domainTag: VOUCHER_DOMAIN,
    warning: 'SYNTHETIC test vectors. Test format, not audited, not upstream-compatible.',
    networkPassphrase: domain.networkPassphrase,
    channelId: domain.channelId,
    channelIdHex: channelRaw.toString('hex'),
    payer: domain.payer,
    payerPublicKeyHex: Buffer.from(StrKey.decodeEd25519PublicKey(domain.payer)).toString('hex'),
    provider: domain.provider,
    providerPublicKeyHex: Buffer.from(StrKey.decodeEd25519PublicKey(domain.provider)).toString(
      'hex',
    ),
    vectors: amounts.map((a) => {
      const [w = '0', f = ''] = a.split('.');
      const cumulative = BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, '0'));
      const v = createVoucher(keypairSigner(payer), domain, cumulative);
      return {
        cumulativeAmount: v.cumulativeAmount,
        cumulativeStroops: cumulative.toString(),
        preimageHex: Buffer.from(buildPreimage(domain, cumulative)).toString('hex'),
        commitment: v.commitment,
        signature: v.signature,
      };
    }),
  };
}

if (process.argv[1]?.endsWith('gen-fixtures.ts')) {
  mkdirSync('fixtures', { recursive: true });
  writeFileSync('fixtures/voucher-vectors.json', JSON.stringify(buildVectors(), null, 2) + '\n');
  console.log('wrote fixtures/voucher-vectors.json');
}
