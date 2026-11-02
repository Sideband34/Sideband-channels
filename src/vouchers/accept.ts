import type { VoucherDomain } from './format.js';
import type { VoucherStore } from './store.js';
import { verifyVoucher, type Voucher, type VerifyFailure } from './voucher.js';

export type AcceptFailure =
  | VerifyFailure
  | 'replay'
  | 'non_monotonic'
  | 'over_deposit'
  | 'over_budget'
  | 'channel_expired'
  | 'contention';

export type AcceptResult =
  | { ok: true; cumulative: bigint; delta: bigint }
  | { ok: false; code: AcceptFailure; detail: string };

export interface AcceptPolicy {
  /** Channel deposit in stroops (cached binding; from the online funding proof). */
  readonly deposit: bigint;
  /** Session budget agreed in `session_accept.maxSpend`, in stroops. */
  readonly maxSpend: bigint;
  /** Channel expiry, unix seconds. */
  readonly expiresAt: number;
  /** Unix seconds. */
  readonly now: () => number;
  /** Bounded CAS retries before giving up with `contention`. */
  readonly maxRetries?: number;
}

/**
 * Verifies a voucher and atomically advances the stored highest cumulative
 * amount. Order: crypto/domain -> expiry -> deposit/budget -> monotonic CAS.
 *
 * A voucher is a commitment, not settlement: `ok` means "provider may rely on
 * this up to `cumulative`", never "funds moved".
 */
export async function acceptVoucher(
  domain: VoucherDomain,
  policy: AcceptPolicy,
  store: VoucherStore,
  voucher: Voucher,
): Promise<AcceptResult> {
  const fail = (code: AcceptFailure, detail: string): AcceptResult => ({ ok: false, code, detail });
  const verified = verifyVoucher(domain, voucher);
  if (!verified.ok) return fail(verified.code, verified.detail);
  const amount = verified.cumulative;

  if (policy.now() >= policy.expiresAt) return fail('channel_expired', 'Channel expired');
  if (amount > policy.deposit) return fail('over_deposit', 'Voucher exceeds channel deposit');
  if (amount > policy.maxSpend) return fail('over_budget', 'Voucher exceeds session budget');

  const retries = policy.maxRetries ?? 8;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const cur = await store.get(domain.channelId);
    const curAmount = cur?.cumulative ?? 0n;
    if (amount === curAmount && cur?.voucher.signature === voucher.signature) {
      return fail('replay', 'Voucher already accepted');
    }
    if (amount <= curAmount) {
      return fail('non_monotonic', 'Cumulative amount must strictly increase');
    }
    const swapped = await store.compareAndSet(domain.channelId, curAmount, {
      cumulative: amount,
      voucher,
    });
    if (swapped) return { ok: true, cumulative: amount, delta: amount - curAmount };
    // Lost a race: re-read and re-evaluate against the new highest.
  }
  return fail('contention', 'Could not advance voucher state; retry');
}
