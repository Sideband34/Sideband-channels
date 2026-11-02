import type { Voucher } from '../vouchers/voucher.js';

export type ChannelStatus = 'open' | 'closed' | 'refunded';

/** Provider/payer cached view of a funded channel. */
export interface ChannelBinding {
  readonly channelId: string; // C... contract id
  readonly networkPassphrase: string;
  readonly payer: string; // G... commitment key
  readonly provider: string; // G...
  /** Asset label only (e.g. a Testnet test token); not an issuer claim. */
  readonly asset: string;
  readonly deposit: bigint;
  readonly expiresAt: number; // unix seconds
  readonly status: ChannelStatus;
  /** Set when status != open. */
  readonly settledToProvider?: bigint;
  readonly refundedToPayer?: bigint;
}

export interface OpenParams {
  readonly networkPassphrase: string;
  readonly payer: string;
  readonly provider: string;
  readonly asset: string;
  readonly deposit: bigint;
  readonly expiresAt: number;
  /** Idempotency key: the same key must yield the same channel, once. */
  readonly idempotencyKey: string;
}

export interface TxReceipt {
  /** Opaque tx reference. For test adapters this is clearly synthetic. */
  readonly txRef: string;
  readonly synthetic: boolean;
}

export interface SettleResult extends TxReceipt {
  readonly toProvider: bigint;
  readonly toPayer: bigint;
}

export class ChannelError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'already_settled'
      | 'not_expired'
      | 'invalid_voucher'
      | 'not_open'
      | 'invalid_params',
    message: string,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}

/**
 * Chain boundary. Implementations: `InMemoryChannelAdapter` (labeled test
 * adapter, no chain) and, in future, a Soroban RPC adapter. Callers must treat
 * a result as CONFIRMED only when an adapter reports finality evidence.
 */
export interface ChannelAdapter {
  open(params: OpenParams): Promise<{ binding: ChannelBinding } & TxReceipt>;
  getBinding(channelId: string): Promise<ChannelBinding | undefined>;
  /** Provider closes with its highest voucher; pays provider, refunds the rest. */
  close(channelId: string, voucher: Voucher): Promise<SettleResult>;
  /** Payer reclaims the deposit after expiry if the provider never closed. */
  refund(channelId: string): Promise<SettleResult>;
}

/**
 * Thrown by chain adapters when a submission's outcome is unknown (timeout,
 * lost connection). `txHash` MUST be known before submission so callers
 * reconcile by hash instead of blindly retrying.
 */
export class SubmissionTimeoutError extends Error {
  constructor(
    readonly txHash: string,
    message = 'Submission outcome unknown',
  ) {
    super(message);
    this.name = 'SubmissionTimeoutError';
  }
}
