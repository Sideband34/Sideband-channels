import type { Voucher } from '../vouchers/voucher.js';

/**
 * `closing`: the payer called `close_start`; the provider can still settle or
 * close with a higher voucher until `closeEffectiveAt`, then the payer may
 * refund the remainder. `closed` / `refunded` are terminal.
 */
export type ChannelStatus = 'open' | 'closing' | 'closed' | 'refunded';

/** Dispute-window bounds enforced by contracts/channel (seconds). */
export const MIN_CLOSE_WAIT = 60;
export const MAX_CLOSE_WAIT = 31 * 24 * 60 * 60;
/** Default dispute window for new channels (1 hour). */
export const DEFAULT_CLOSE_WAIT = 3600;

/** Provider/payer cached view of a funded channel. */
export interface ChannelBinding {
  readonly channelId: string; // C... contract id
  readonly networkPassphrase: string;
  readonly payer: string; // G... commitment key
  readonly provider: string; // G...
  /** Asset label only (e.g. a Testnet test token); not an issuer claim. */
  readonly asset: string;
  /** Total ever deposited (initial deposit + top-ups). */
  readonly deposit: bigint;
  /** Earliest time a payer-initiated close can complete; unix seconds. */
  readonly expiresAt: number;
  /** Dispute window after `closeStart`, seconds. */
  readonly closeWait: number;
  readonly status: ChannelStatus;
  /** Cumulative amount already withdrawn by the provider (settle/close). */
  readonly withdrawn: bigint;
  /** When `refund` becomes possible. Present only while `closing`. */
  readonly closeEffectiveAt?: number;
  /** Set when the channel is terminal (`closed` / `refunded`). */
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
  /** Dispute window in seconds; defaults to DEFAULT_CLOSE_WAIT. */
  readonly closeWait?: number;
  /** Idempotency key: the same key must yield the same channel, once. */
  readonly idempotencyKey: string;
}

export interface TxReceipt {
  /** Opaque tx reference. For test adapters this is clearly synthetic. */
  readonly txRef: string;
  readonly synthetic: boolean;
  /** Ledger the transaction was applied in. Present only for real chain adapters. */
  readonly ledger?: number;
}

export interface TxLookup {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
  ledger?: number;
}

/** Result of a terminal `close` / `refund`: the final split of the deposit. */
export interface SettleResult extends TxReceipt {
  /** Total paid to the provider over the channel's life. */
  readonly toProvider: bigint;
  readonly toPayer: bigint;
}

/** Result of a non-terminal provider `settle` (partial withdrawal). */
export interface WithdrawResult extends TxReceipt {
  /** Paid out by this call. */
  readonly amount: bigint;
  /** Cumulative withdrawn after this call. */
  readonly withdrawn: bigint;
}

export interface TopUpResult extends TxReceipt {
  /** Total deposit after the top-up. */
  readonly deposit: bigint;
}

export interface CloseStartResult extends TxReceipt {
  /** Unix seconds after which the payer may `refund`. */
  readonly closeEffectiveAt: number;
}

/** Remaining unsettled funds of a binding. */
export function channelBalance(b: ChannelBinding): bigint {
  return b.deposit - b.withdrawn - (b.refundedToPayer ?? 0n);
}

export function isTerminal(status: ChannelStatus): boolean {
  return status === 'closed' || status === 'refunded';
}

export class ChannelError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'already_settled'
      | 'not_expired'
      | 'invalid_voucher'
      | 'not_open'
      | 'not_closing'
      | 'already_closing'
      | 'stale_voucher'
      | 'invalid_params',
    message: string,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}

/**
 * Chain boundary. Implementations: `InMemoryChannelAdapter` (labeled test
 * adapter, no chain) and `SorobanChannelAdapter` (contracts/channel over RPC). Callers must treat
 * a result as CONFIRMED only when an adapter reports finality evidence.
 */
export interface ChannelAdapter {
  open(params: OpenParams): Promise<{ binding: ChannelBinding } & TxReceipt>;
  getBinding(channelId: string): Promise<ChannelBinding | undefined>;
  /** Payer adds funds to an open channel. */
  topUp(channelId: string, amount: bigint): Promise<TopUpResult>;
  /**
   * Provider withdraws up to `voucher` without closing (long-running
   * providers). Allowed while `open` or `closing`.
   */
  settle(channelId: string, voucher: Voucher): Promise<WithdrawResult>;
  /**
   * Provider closes with its highest voucher; pays the provider up to it and
   * refunds the rest. Pass `undefined` to close at the already-withdrawn
   * amount without a new voucher. Terminal.
   */
  close(channelId: string, voucher: Voucher | undefined): Promise<SettleResult>;
  /** Payer starts closing; opens the provider's dispute window. */
  closeStart(channelId: string): Promise<CloseStartResult>;
  /** Payer reclaims the unsettled remainder after the dispute window. Terminal. */
  refund(channelId: string): Promise<SettleResult>;
  /** Looks a transaction up by hash (for reconciliation). Optional. */
  findTransaction?(txHash: string): Promise<TxLookup>;
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
