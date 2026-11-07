import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { assertAllowedNetwork } from '../networks.js';
import { verifyVoucher, type Voucher } from '../vouchers/voucher.js';
import {
  ChannelError,
  DEFAULT_CLOSE_WAIT,
  MAX_CLOSE_WAIT,
  MIN_CLOSE_WAIT,
  channelBalance,
  isTerminal,
  type ChannelAdapter,
  type ChannelBinding,
  type CloseStartResult,
  type OpenParams,
  type SettleResult,
  type TopUpResult,
  type TxReceipt,
  type WithdrawResult,
} from './types.js';

/**
 * TEST ADAPTER. Emulates the semantics of contracts/channel in memory (top-up,
 * partial settle, close, close_start + dispute window, refund): no network, no
 * ledger, no real funds. Every receipt is `synthetic: true`. It exists so
 * SDK/gateway/mobile logic can be tested for failure paths; it proves nothing
 * about on-chain behavior (see contracts/ for that).
 */
export class InMemoryChannelAdapter implements ChannelAdapter {
  private readonly channels = new Map<string, ChannelBinding>();
  private readonly byKey = new Map<string, string>();
  private counter = 0;
  private seq = 0;

  constructor(private readonly now: () => number) {}

  private receipt(kind: string, id: string): TxReceipt {
    return { txRef: `synthetic:${kind}:${id}:${++this.seq}`, synthetic: true };
  }

  async open(p: OpenParams) {
    assertAllowedNetwork(p.networkPassphrase);
    if (p.deposit <= 0n) throw new ChannelError('invalid_params', 'Deposit must be positive');
    if (p.expiresAt <= this.now()) throw new ChannelError('invalid_params', 'Already expired');
    const closeWait = p.closeWait ?? DEFAULT_CLOSE_WAIT;
    if (closeWait < MIN_CLOSE_WAIT || closeWait > MAX_CLOSE_WAIT) {
      throw new ChannelError('invalid_params', 'closeWait out of range');
    }
    if (p.payer === p.provider) throw new ChannelError('invalid_params', 'payer == provider');
    const existing = this.byKey.get(p.idempotencyKey);
    if (existing) {
      return {
        binding: this.channels.get(existing) as ChannelBinding,
        ...this.receipt('open', existing),
      };
    }
    const raw = createHash('sha256').update(`synthetic-channel:${++this.counter}`).digest();
    const channelId = StrKey.encodeContract(raw);
    const binding: ChannelBinding = {
      channelId,
      networkPassphrase: p.networkPassphrase,
      payer: p.payer,
      provider: p.provider,
      asset: p.asset,
      deposit: p.deposit,
      expiresAt: p.expiresAt,
      closeWait,
      status: 'open',
      withdrawn: 0n,
    };
    this.channels.set(channelId, binding);
    this.byKey.set(p.idempotencyKey, channelId);
    return { binding, ...this.receipt('open', channelId) };
  }

  async getBinding(channelId: string) {
    return this.channels.get(channelId);
  }

  private mustGet(id: string): ChannelBinding {
    const c = this.channels.get(id);
    if (!c) throw new ChannelError('not_found', 'Unknown channel');
    return c;
  }

  private mustBeLive(c: ChannelBinding) {
    if (isTerminal(c.status)) throw new ChannelError('already_settled', `Channel is ${c.status}`);
  }

  /** Verifies `voucher` and returns its amount if it is above `withdrawn`. */
  private checkVoucher(c: ChannelBinding, voucher: Voucher): bigint {
    const v = verifyVoucher(c, voucher);
    if (!v.ok) throw new ChannelError('invalid_voucher', `${v.code}: ${v.detail}`);
    if (v.cumulative <= c.withdrawn) {
      throw new ChannelError('stale_voucher', 'Voucher not above withdrawn amount');
    }
    if (v.cumulative > c.deposit) throw new ChannelError('invalid_voucher', 'over_deposit');
    return v.cumulative;
  }

  async topUp(channelId: string, amount: bigint): Promise<TopUpResult> {
    const c = this.mustGet(channelId);
    if (c.status !== 'open') throw new ChannelError('not_open', `Channel is ${c.status}`);
    if (amount <= 0n) throw new ChannelError('invalid_params', 'Top-up must be positive');
    const deposit = c.deposit + amount;
    this.channels.set(channelId, { ...c, deposit });
    return { ...this.receipt('top_up', channelId), deposit };
  }

  async settle(channelId: string, voucher: Voucher): Promise<WithdrawResult> {
    const c = this.mustGet(channelId);
    this.mustBeLive(c);
    const cumulative = this.checkVoucher(c, voucher);
    this.channels.set(channelId, { ...c, withdrawn: cumulative });
    return {
      ...this.receipt('settle', channelId),
      amount: cumulative - c.withdrawn,
      withdrawn: cumulative,
    };
  }

  async close(channelId: string, voucher: Voucher | undefined): Promise<SettleResult> {
    const c = this.mustGet(channelId);
    this.mustBeLive(c);
    const withdrawn = voucher ? this.checkVoucher(c, voucher) : c.withdrawn;
    const toPayer = c.deposit - withdrawn;
    this.channels.set(channelId, {
      ...c,
      withdrawn,
      status: 'closed',
      settledToProvider: withdrawn,
      refundedToPayer: toPayer,
    });
    return { ...this.receipt('close', channelId), toProvider: withdrawn, toPayer };
  }

  async closeStart(channelId: string): Promise<CloseStartResult> {
    const c = this.mustGet(channelId);
    if (c.status === 'closing') throw new ChannelError('already_closing', 'Already closing');
    this.mustBeLive(c);
    const closeEffectiveAt = Math.max(this.now() + c.closeWait, c.expiresAt);
    this.channels.set(channelId, { ...c, status: 'closing', closeEffectiveAt });
    return { ...this.receipt('close_start', channelId), closeEffectiveAt };
  }

  async refund(channelId: string): Promise<SettleResult> {
    const c = this.mustGet(channelId);
    if (c.status === 'open') throw new ChannelError('not_closing', 'Call closeStart first');
    this.mustBeLive(c);
    if (this.now() < (c.closeEffectiveAt ?? Infinity)) {
      throw new ChannelError('not_expired', 'Dispute window still open');
    }
    const toPayer = channelBalance(c);
    this.channels.set(channelId, {
      ...c,
      status: 'refunded',
      settledToProvider: c.withdrawn,
      refundedToPayer: toPayer,
    });
    return { ...this.receipt('refund', channelId), toProvider: c.withdrawn, toPayer };
  }
}
