import { Address, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { MAX_STROOPS } from '../amount.js';
import { networkId } from '../networks.js';

/**
 * Voucher signed bytes: `sideband-commit-v2`, i.e. the commitment format of
 * stellar-experimental/one-way-channel (Apache-2.0), commit 25dea1b:
 *
 *   preimage = XDR( ScVal::Map {
 *     amount:  I128(cumulative stroops),
 *     channel: Address(channel contract),
 *     domain:  Symbol("chancmmt"),
 *     network: Bytes(sha256(network passphrase)),
 *   } )                       // keys in ascending order, as Soroban requires
 *
 * This matches `Commitment::into_bytes` / `prepare_commitment` upstream and
 * `buildCommitmentMessage` in stellar/stellar-mpp-sdk. The channel address
 * binds the voucher to one channel whose payer key and provider are fixed at
 * deployment, so payer/provider are NOT part of the bytes.
 * Not verified here against a live upstream deployment (no Testnet run yet),
 * and upstream is itself unaudited. See docs/adr/0001.
 *
 * Sideband wire fields (protocol `VoucherFrame`):
 *   commitment = lowercase hex sha256(preimage)   (integrity binding)
 *   signature  = lowercase hex ed25519 signature over preimage (64 bytes)
 */
export const VOUCHER_FORMAT = 'sideband-commit-v2';
export const COMMITMENT_DOMAIN = 'chancmmt';

export interface VoucherDomain {
  /** Network passphrase the channel lives on. */
  readonly networkPassphrase: string;
  /** Contract id, `C...` strkey. */
  readonly channelId: string;
  /** Payer commitment key, `G...` strkey (verifies signatures). */
  readonly payer: string;
  /** Provider key, `G...` strkey (checked by adapters/gateway, not signed). */
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
  let channel: Address;
  try {
    channel = new Address(domain.channelId);
    StrKey.decodeEd25519PublicKey(domain.payer);
    StrKey.decodeEd25519PublicKey(domain.provider);
  } catch {
    throw new VoucherFormatError('Invalid channel/payer/provider strkey');
  }
  if (!StrKey.isValidContract(domain.channelId)) {
    throw new VoucherFormatError('Channel must be a contract address');
  }
  const sym = (s: string) => nativeToScVal(s, { type: 'symbol' });
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym('amount'), val: nativeToScVal(cumulative, { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: sym('channel'), val: channel.toScVal() }),
    new xdr.ScMapEntry({ key: sym('domain'), val: sym(COMMITMENT_DOMAIN) }),
    new xdr.ScMapEntry({
      key: sym('network'),
      val: xdr.ScVal.scvBytes(networkId(domain.networkPassphrase)),
    }),
  ]).toXdr();
}
