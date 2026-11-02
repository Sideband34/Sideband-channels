import type { Voucher } from './voucher.js';

export interface StoredVoucher {
  readonly cumulative: bigint;
  readonly voucher: Voucher;
}

/**
 * Provider-side persistence of the highest accepted voucher per channel.
 *
 * `compareAndSet` MUST be atomic in a real implementation (e.g. a SQL
 * `UPDATE ... WHERE cumulative = $expected`, or a Redis Lua script). It
 * succeeds only if the stored cumulative equals `expected` (0n = none stored).
 * The in-memory store below is the reference implementation for tests.
 */
export interface VoucherStore {
  get(channelId: string): Promise<StoredVoucher | undefined>;
  compareAndSet(channelId: string, expected: bigint, next: StoredVoucher): Promise<boolean>;
}

export class InMemoryVoucherStore implements VoucherStore {
  private readonly rows = new Map<string, StoredVoucher>();

  async get(channelId: string): Promise<StoredVoucher | undefined> {
    return this.rows.get(channelId);
  }

  async compareAndSet(channelId: string, expected: bigint, next: StoredVoucher): Promise<boolean> {
    // Single synchronous section: no await between check and write.
    const cur = this.rows.get(channelId)?.cumulative ?? 0n;
    if (cur !== expected) return false;
    if (next.cumulative <= cur) return false; // store itself refuses rollback
    this.rows.set(channelId, next);
    return true;
  }
}
