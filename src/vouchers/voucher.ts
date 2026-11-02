import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { formatAmount, parseAmount, AmountError } from '../amount.js';
import { NETWORK_PASSPHRASES, assertAllowedNetwork } from '../networks.js';
import { buildPreimage, type VoucherDomain, VoucherFormatError } from './format.js';

/** Wire voucher; field names match sideband-protocol `VoucherFrame`. */
export interface Voucher {
  readonly channelRef: string;
  /** Canonical decimal string, 7 fractional digits max. */
  readonly cumulativeAmount: string;
  /** hex sha256(preimage) */
  readonly commitment: string;
  /** hex ed25519 signature over preimage */
  readonly signature: string;
}

/** Signing abstraction: secret material stays behind this interface. */
export interface VoucherSigner {
  readonly publicKey: string;
  sign(message: Uint8Array): Uint8Array;
}

/** Test/dev signer over a stellar-sdk Keypair. Never persist its secret. */
export function keypairSigner(kp: Keypair): VoucherSigner {
  return { publicKey: kp.publicKey(), sign: (m) => kp.sign(Buffer.from(m)) };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha256hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export function createVoucher(
  signer: VoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Voucher {
  assertAllowedNetwork(domain.networkPassphrase);
  if (signer.publicKey !== domain.payer) {
    throw new VoucherFormatError('Signer is not the channel payer');
  }
  const preimage = buildPreimage(domain, cumulativeStroops);
  return {
    channelRef: domain.channelId,
    cumulativeAmount: formatAmount(cumulativeStroops),
    commitment: sha256hex(preimage),
    signature: hex(signer.sign(preimage)),
  };
}

export type VerifyFailure =
  'malformed' | 'wrong_channel' | 'wrong_network' | 'commitment_mismatch' | 'bad_signature';

export type VerifyResult =
  { ok: true; cumulative: bigint } | { ok: false; code: VerifyFailure; detail: string };

const HEX_SIG = /^[0-9a-f]{128}$/;
const HEX_COMMIT = /^[0-9a-f]{64}$/;

function verifyAgainst(domain: VoucherDomain, v: Voucher, cumulative: bigint): boolean {
  const pre = buildPreimage(domain, cumulative);
  if (sha256hex(pre) !== v.commitment) return false;
  return Keypair.fromPublicKey(domain.payer).verify(
    Buffer.from(pre),
    Buffer.from(v.signature, 'hex'),
  );
}

/**
 * Pure cryptographic + domain verification of one voucher against the
 * provider's cached channel binding. Does NOT check monotonicity or budget:
 * that is stateful and belongs in `acceptVoucher`.
 */
export function verifyVoucher(domain: VoucherDomain, v: Voucher): VerifyResult {
  let cumulative: bigint;
  try {
    assertAllowedNetwork(domain.networkPassphrase);
    cumulative = parseAmount(v.cumulativeAmount);
    if (formatAmount(cumulative) !== v.cumulativeAmount) {
      return { ok: false, code: 'malformed', detail: 'Non-canonical amount string' };
    }
    if (!HEX_SIG.test(v.signature) || !HEX_COMMIT.test(v.commitment)) {
      return { ok: false, code: 'malformed', detail: 'Signature/commitment must be lowercase hex' };
    }
  } catch (e) {
    if (e instanceof AmountError) return { ok: false, code: 'malformed', detail: e.message };
    return { ok: false, code: 'malformed', detail: (e as Error).message };
  }
  if (v.channelRef !== domain.channelId) {
    return { ok: false, code: 'wrong_channel', detail: 'Voucher channel differs from binding' };
  }
  let valid: boolean;
  try {
    valid = verifyAgainst(domain, v, cumulative);
  } catch (e) {
    return { ok: false, code: 'malformed', detail: (e as Error).message };
  }
  if (valid) return { ok: true, cumulative };

  // Diagnose: does it verify under a different known network? Then it is a
  // cross-network replay, which deserves a distinct error code.
  for (const pass of Object.values(NETWORK_PASSPHRASES)) {
    if (pass === domain.networkPassphrase) continue;
    try {
      if (verifyAgainst({ ...domain, networkPassphrase: pass }, v, cumulative)) {
        return { ok: false, code: 'wrong_network', detail: 'Voucher signed for another network' };
      }
    } catch {
      /* ignore */
    }
  }
  const pre = buildPreimage(domain, cumulative);
  if (sha256hex(pre) !== v.commitment) {
    return { ok: false, code: 'commitment_mismatch', detail: 'Commitment does not match domain' };
  }
  return { ok: false, code: 'bad_signature', detail: 'Signature invalid for payer key' };
}
