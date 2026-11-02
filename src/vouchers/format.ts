import { StrKey } from '@stellar/stellar-sdk';
import { MAX_STROOPS } from '../amount.js';
import { networkId } from '../networks.js';

/**
 * SIDEBAND TEST FORMAT v1 (`sideband-test-format-v1`).
 *
 * This is the byte layout Sideband signs for cumulative vouchers. It is a
 * Sideband-defined, domain-separated layout; it is NOT claimed to be wire
 * compatible with stellar-experimental/one-way-channel or stellar-mpp-sdk and
 * has NOT been security reviewed. Before real funds, replace/verify against
 * the reviewed upstream format. Testnet/synthetic use only.
 *
 * preimage = DOMAIN(19 ascii) || 0x00
 *         || networkId(32)          sha256(network passphrase)
 *         || channelId(32)          raw contract id (strkey C... decoded)
 *         || payer(32)              raw ed25519 key (strkey G... decoded)
 *         || provider(32)           raw ed25519 key
 *         || cumulative(16)         unsigned big-endian stroops, < 2^127
 *
 * commitment = lowercase hex sha256(preimage)
 * signature  = lowercase hex ed25519 signature over preimage (64 bytes)
 */
export const VOUCHER_FORMAT = 'sideband-test-format-v1';
export const VOUCHER_DOMAIN = 'sideband/voucher/v1';
export const PREIMAGE_LENGTH = VOUCHER_DOMAIN.length + 1 + 32 * 4 + 16;

export interface VoucherDomain {
  /** Network passphrase the channel lives on. */
  readonly networkPassphrase: string;
  /** Contract id, `C...` strkey. */
  readonly channelId: string;
  /** Payer commitment key, `G...` strkey. */
  readonly payer: string;
  /** Provider key, `G...` strkey. */
  readonly provider: string;
}

export class VoucherFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoucherFormatError';
  }
}

export function buildPreimage(domain: VoucherDomain, cumulative: bigint): Uint8Array {
  if (cumulative <= 0n || cumulative > MAX_STROOPS) {
    throw new VoucherFormatError('Cumulative amount out of range');
  }
  let channel: Uint8Array, payer: Uint8Array, provider: Uint8Array;
  try {
    channel = StrKey.decodeContract(domain.channelId);
    payer = StrKey.decodeEd25519PublicKey(domain.payer);
    provider = StrKey.decodeEd25519PublicKey(domain.provider);
  } catch {
    throw new VoucherFormatError('Invalid channel/payer/provider strkey');
  }
  const out = new Uint8Array(PREIMAGE_LENGTH);
  let o = 0;
  out.set(Buffer.from(VOUCHER_DOMAIN, 'ascii'), o);
  o += VOUCHER_DOMAIN.length;
  out[o++] = 0;
  out.set(networkId(domain.networkPassphrase), o);
  o += 32;
  out.set(channel, o);
  o += 32;
  out.set(payer, o);
  o += 32;
  out.set(provider, o);
  o += 32;
  let v = cumulative;
  for (let i = 15; i >= 0; i--) {
    out[o + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
