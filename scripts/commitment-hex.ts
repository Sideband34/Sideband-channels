/** Prints the hex of the local sideband-commit-v2 preimage, for the on-chain parity check in smoke-testnet.sh.
 *  usage: npx tsx scripts/commitment-hex.ts <channelId> <payerG> <providerG> <stroops> */
import { NETWORK_PASSPHRASES } from '../src/index.js';
import { buildPreimage } from '../src/vouchers/format.js';

const [channelId, payer, provider, stroops] = process.argv.slice(2);
if (!channelId || !payer || !provider || !stroops) {
  console.error('usage: commitment-hex.ts <channelId> <payer> <provider> <stroops>');
  process.exit(2);
}
const bytes = buildPreimage(
  { networkPassphrase: NETWORK_PASSPHRASES.testnet, channelId, payer, provider },
  BigInt(stroops),
);
console.log(Buffer.from(bytes).toString('hex'));
