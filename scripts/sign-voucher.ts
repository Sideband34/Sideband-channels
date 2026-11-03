/**
 * Prints a sideband-commit-v2 voucher as JSON for the smoke test.
 *
 *   SIDEBAND_PAYER_SECRET=S... npx tsx scripts/sign-voucher.ts <channelId> <providerG> <amount>
 *
 * Testnet / test networks only (the SDK refuses the public network). The
 * secret is read from the environment so it never lands in shell history.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASES, createVoucher, keypairSigner, parseAmount } from '../src/index.js';

const [channelId, provider, amount] = process.argv.slice(2);
const secret = process.env.SIDEBAND_PAYER_SECRET;
if (!channelId || !provider || !amount || !secret) {
  console.error(
    'usage: SIDEBAND_PAYER_SECRET=S... sign-voucher.ts <channelId> <provider> <amount>',
  );
  process.exit(2);
}
const payer = Keypair.fromSecret(secret);
const passphrase = process.env.SIDEBAND_NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASES.testnet;
const stroops = parseAmount(amount);
const v = createVoucher(
  keypairSigner(payer),
  { networkPassphrase: passphrase, channelId, payer: payer.publicKey(), provider },
  stroops,
);
console.log(JSON.stringify({ ...v, cumulativeStroops: stroops.toString() }));
