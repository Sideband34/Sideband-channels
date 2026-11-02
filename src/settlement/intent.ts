import { createHash } from 'node:crypto';
import type { ChannelBinding } from '../channels/types.js';
import type { StoredVoucher } from '../vouchers/store.js';

/** States from docs/TECHNICAL_BUILD.md. CONFIRMED requires finality evidence. */
export type IntentState =
  'CREATED' | 'AUTHORIZED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'RECONCILING';

export interface FinalityEvidence {
  readonly network: string;
  readonly txHash: string;
  readonly ledger: number;
}

export interface SettlementIntent {
  readonly id: string; // idempotency key; stable for (channel, amount)
  readonly channelId: string;
  readonly network: string;
  readonly amount: bigint; // what the provider claims
  readonly voucher: StoredVoucher['voucher'];
  readonly state: IntentState;
  readonly txHash?: string;
  readonly evidence?: FinalityEvidence;
  readonly failure?: string;
}

export class IntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntentError';
  }
}

const ALLOWED: Record<IntentState, IntentState[]> = {
  CREATED: ['AUTHORIZED', 'FAILED'],
  AUTHORIZED: ['SUBMITTED', 'FAILED'],
  // A timeout after submission must go to RECONCILING, never FAILED.
  SUBMITTED: ['CONFIRMED', 'RECONCILING', 'FAILED'],
  RECONCILING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
};

/** Prepares (does not submit) a settlement for the provider's highest voucher. */
export function prepareSettlement(
  binding: ChannelBinding,
  highest: StoredVoucher,
): SettlementIntent {
  if (binding.status !== 'open') throw new IntentError(`Channel already ${binding.status}`);
  if (highest.cumulative > binding.deposit) throw new IntentError('Voucher exceeds deposit');
  const id = createHash('sha256')
    .update(`${binding.networkPassphrase}|${binding.channelId}|${highest.cumulative}`)
    .digest('hex');
  return {
    id,
    channelId: binding.channelId,
    network: binding.networkPassphrase,
    amount: highest.cumulative,
    voucher: highest.voucher,
    state: 'CREATED',
  };
}

export function transition(
  intent: SettlementIntent,
  next: IntentState,
  extra: { txHash?: string; evidence?: FinalityEvidence; failure?: string } = {},
): SettlementIntent {
  if (intent.state === next) return intent; // idempotent re-delivery
  if (!ALLOWED[intent.state].includes(next)) {
    throw new IntentError(`Illegal transition ${intent.state} -> ${next}`);
  }
  if (next === 'SUBMITTED' && !extra.txHash) throw new IntentError('SUBMITTED needs txHash');
  if (next === 'CONFIRMED') {
    const e = extra.evidence;
    if (!e) throw new IntentError('CONFIRMED requires finality evidence');
    if (e.network !== intent.network) throw new IntentError('Evidence is for another network');
    if (intent.txHash && e.txHash !== intent.txHash) throw new IntentError('Evidence tx mismatch');
  }
  return {
    ...intent,
    state: next,
    ...(extra.txHash ? { txHash: extra.txHash } : {}),
    ...(extra.evidence ? { evidence: extra.evidence } : {}),
    ...(extra.failure ? { failure: extra.failure } : {}),
  };
}
