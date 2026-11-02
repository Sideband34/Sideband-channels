import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { assertAllowedNetwork } from '../networks.js';
import { verifyVoucher, type Voucher } from '../vouchers/voucher.js';
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelBinding,
  type OpenParams,
  type SettleResult,
  type TxReceipt,
} from './types.js';

/**
 * TEST ADAPTER. Emulates the intended channel contract semantics in memory:
 * no network, no ledger, no real funds. Every receipt is `synthetic: true`.
 * It exists so SDK/gateway/mobile logic can be tested for failure paths; it
 * proves nothing about on-chain behavior (see contracts/ for that).
 */
export class InMemoryChannelAdapter implements ChannelAdapter {
  private readonly channels = new Map<string, ChannelBinding>();
  private readonly byKey = new Map<string, string>();
  private counter = 0;

  constructor(private readonly now: () => number) {}

  private receipt(kind: string, id: string): TxReceipt {
    return { txRef: `synthetic:${kind}:${id}`, synthetic: true };
  }

  async open(p: OpenParams) {
    assertAllowedNetwork(p.networkPassphrase);
    if (p.deposit <= 0n) throw new ChannelError('invalid_params', 'Deposit must be positive');
    if (p.expiresAt <= this.now()) throw new ChannelError('invalid_params', 'Already expired');
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
      status: 'open',
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

  async close(channelId: string, voucher: Voucher): Promise<SettleResult> {
    const c = this.mustGet(channelId);
    if (c.status !== 'open') throw new ChannelError('already_settled', `Channel is ${c.status}`);
    const v = verifyVoucher(c, voucher);
    if (!v.ok) throw new ChannelError('invalid_voucher', `${v.code}: ${v.detail}`);
    if (v.cumulative > c.deposit) throw new ChannelError('invalid_voucher', 'over_deposit');
    const toPayer = c.deposit - v.cumulative;
    this.channels.set(channelId, {
      ...c,
      status: 'closed',
      settledToProvider: v.cumulative,
      refundedToPayer: toPayer,
    });
    return { ...this.receipt('close', channelId), toProvider: v.cumulative, toPayer };
  }

  async refund(channelId: string): Promise<SettleResult> {
    const c = this.mustGet(channelId);
    if (c.status !== 'open') throw new ChannelError('already_settled', `Channel is ${c.status}`);
    if (this.now() < c.expiresAt) throw new ChannelError('not_expired', 'Channel not yet expired');
    this.channels.set(channelId, {
      ...c,
      status: 'refunded',
      settledToProvider: 0n,
      refundedToPayer: c.deposit,
    });
    return { ...this.receipt('refund', channelId), toProvider: 0n, toPayer: c.deposit };
  }
}
