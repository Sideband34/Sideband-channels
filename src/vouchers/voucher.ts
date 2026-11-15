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

/**
 * Signing abstraction for hardware wallets, KMS, keystores, or remote signers.
 * Secret material stays behind this interface; the SDK only ever passes the
 * exact bytes to be signed (`Uint8Array`) and reads the Stellar `G...` public key.
 */
export interface VoucherSigner {
  publicKey(): string;
  sign(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** Synchronous {@link VoucherSigner} refinement (for example {@link keypairSigner}). */
export interface SyncVoucherSigner extends VoucherSigner {
  publicKey(): string;
  sign(bytes: Uint8Array): Uint8Array;
}

/** Asynchronous {@link VoucherSigner} refinement (hardware wallet, KMS, CLI keystore). */
export interface AsyncVoucherSigner extends VoucherSigner {
  publicKey(): string;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

/**
 * @deprecated Implement `publicKey(): string` on {@link VoucherSigner} instead
 * of a `publicKey` string property. Retained for one release.
 */
export interface LegacyVoucherSigner {
  readonly publicKey: string;
  sign(message: Uint8Array): Uint8Array;
}

/** Test/dev signer over a stellar-sdk Keypair. Never persist its secret. */
export function keypairSigner(kp: Keypair): SyncVoucherSigner {
  const pub = kp.publicKey();
  return {
    publicKey: () => pub,
    sign: (bytes: Uint8Array) => new Uint8Array(kp.sign(Buffer.from(bytes))),
  };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha256hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<T>).then === 'function'
  );
}

function isKeypairLike(
  candidate: VoucherSigner | Keypair | LegacyVoucherSigner,
): candidate is Keypair {
  return (
    candidate instanceof Keypair ||
    (typeof (candidate as Keypair).publicKey === 'function' &&
      typeof (candidate as Keypair).rawSecretKey === 'function')
  );
}

/**
 * Normalizes a {@link VoucherSigner} or a deprecated `Keypair` / legacy property
 * signer into a {@link VoucherSigner}.
 */
export function toVoucherSigner(
  signer: VoucherSigner | Keypair | LegacyVoucherSigner,
): VoucherSigner {
  if (isKeypairLike(signer)) {
    return keypairSigner(signer);
  }
  if (typeof (signer as LegacyVoucherSigner).publicKey === 'string') {
    const legacy = signer as LegacyVoucherSigner;
    return {
      publicKey: () => legacy.publicKey,
      sign: (bytes: Uint8Array) => legacy.sign(bytes),
    };
  }
  return signer as VoucherSigner;
}

function finalizeVoucher(
  domain: VoucherDomain,
  cumulativeStroops: bigint,
  commitment: string,
  sig: Uint8Array,
): Voucher {
  if (!(sig instanceof Uint8Array) || sig.byteLength !== 64) {
    throw new VoucherFormatError('Signer must return a 64-byte ed25519 signature');
  }
  return {
    channelRef: domain.channelId,
    cumulativeAmount: formatAmount(cumulativeStroops),
    commitment,
    signature: hex(sig),
  };
}

export function createVoucher(
  signer: SyncVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Voucher;
export function createVoucher(
  signer: AsyncVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Promise<Voucher>;
export function createVoucher(
  signer: VoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Voucher | Promise<Voucher>;
/**
 * @deprecated Pass a {@link VoucherSigner} (for example `keypairSigner(kp)` or a
 * custom hardware/KMS signer) instead of a `Keypair` or legacy property signer.
 * Retained for one release.
 */
export function createVoucher(
  signer: Keypair | LegacyVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Voucher;
export function createVoucher(
  signer: VoucherSigner | Keypair | LegacyVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Voucher | Promise<Voucher> {
  assertAllowedNetwork(domain.networkPassphrase);
  const resolved = toVoucherSigner(signer);
  if (resolved.publicKey() !== domain.payer) {
    throw new VoucherFormatError('Signer is not the channel payer');
  }
  const preimage = buildPreimage(domain, cumulativeStroops);
  const commitment = sha256hex(preimage);
  // Pass an isolated copy so custom signers only observe the commitment bytes to sign.
  const signed = resolved.sign(new Uint8Array(preimage));
  if (isPromiseLike(signed)) {
    return Promise.resolve(signed).then((sig) =>
      finalizeVoucher(domain, cumulativeStroops, commitment, sig),
    );
  }
  return finalizeVoucher(domain, cumulativeStroops, commitment, signed);
}

/** Async convenience wrapper around {@link createVoucher} that always returns a Promise. */
export async function signVoucher(
  signer: VoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Promise<Voucher>;
/**
 * @deprecated Pass a {@link VoucherSigner} instead of a `Keypair` or legacy signer.
 * Retained for one release.
 */
export async function signVoucher(
  signer: Keypair | LegacyVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Promise<Voucher>;
export async function signVoucher(
  signer: VoucherSigner | Keypair | LegacyVoucherSigner,
  domain: VoucherDomain,
  cumulativeStroops: bigint,
): Promise<Voucher> {
  return await createVoucher(signer as VoucherSigner, domain, cumulativeStroops);
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
