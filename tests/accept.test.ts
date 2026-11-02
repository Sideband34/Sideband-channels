import { describe, expect, it } from 'vitest';
import {
  InMemoryVoucherStore,
  acceptVoucher,
  createVoucher,
  type AcceptPolicy,
  type StoredVoucher,
  type VoucherStore,
} from '../src/index.js';
import { openChannel, payer, STROOPS } from './helpers.js';

async function setup() {
  const ch = await openChannel();
  const store = new InMemoryVoucherStore();
  const policy: AcceptPolicy = {
    deposit: ch.binding.deposit,
    maxSpend: 5n * STROOPS,
    expiresAt: ch.binding.expiresAt,
    now: () => ch.clock.t,
  };
  const mk = (n: bigint) => createVoucher(payer, ch.domain, n * STROOPS);
  return { ...ch, store, policy, mk };
}

describe('acceptVoucher', () => {
  it('accepts increasing vouchers and reports deltas', async () => {
    const s = await setup();
    expect(await acceptVoucher(s.domain, s.policy, s.store, s.mk(1n))).toMatchObject({
      ok: true,
      delta: STROOPS,
    });
    expect(await acceptVoucher(s.domain, s.policy, s.store, s.mk(3n))).toMatchObject({
      ok: true,
      delta: 2n * STROOPS,
    });
    expect((await s.store.get(s.domain.channelId))?.cumulative).toBe(3n * STROOPS);
  });

  it('rejects exact replay with code replay and leaves state unchanged', async () => {
    const s = await setup();
    const v = s.mk(2n);
    await acceptVoucher(s.domain, s.policy, s.store, v);
    expect(await acceptVoucher(s.domain, s.policy, s.store, v)).toMatchObject({
      ok: false,
      code: 'replay',
    });
    expect((await s.store.get(s.domain.channelId))?.cumulative).toBe(2n * STROOPS);
  });

  it('rejects rollback to a lower cumulative amount', async () => {
    const s = await setup();
    await acceptVoucher(s.domain, s.policy, s.store, s.mk(4n));
    const r = await acceptVoucher(s.domain, s.policy, s.store, s.mk(2n));
    expect(r).toMatchObject({ ok: false, code: 'non_monotonic' });
    expect((await s.store.get(s.domain.channelId))?.cumulative).toBe(4n * STROOPS);
  });

  it('treats an equal-amount re-signed voucher as replay (ed25519 is deterministic)', async () => {
    const s = await setup();
    const v = s.mk(2n);
    await acceptVoucher(s.domain, s.policy, s.store, v);
    // ed25519 is deterministic so an equal-amount voucher is byte-identical -> replay
    expect(await acceptVoucher(s.domain, s.policy, s.store, s.mk(2n))).toMatchObject({
      code: 'replay',
    });
  });

  it('enforces session budget and channel deposit', async () => {
    const s = await setup();
    expect(await acceptVoucher(s.domain, s.policy, s.store, s.mk(6n))).toMatchObject({
      ok: false,
      code: 'over_budget',
    });
    const loose = { ...s.policy, maxSpend: 100n * STROOPS };
    expect(await acceptVoucher(s.domain, loose, s.store, s.mk(11n))).toMatchObject({
      ok: false,
      code: 'over_deposit',
    });
    expect(await s.store.get(s.domain.channelId)).toBeUndefined();
  });

  it('rejects vouchers once the channel expired', async () => {
    const s = await setup();
    s.clock.t = s.binding.expiresAt;
    expect(await acceptVoucher(s.domain, s.policy, s.store, s.mk(1n))).toMatchObject({
      code: 'channel_expired',
    });
  });

  it('propagates crypto failures without touching the store', async () => {
    const s = await setup();
    const v = { ...s.mk(1n), cumulativeAmount: '2' };
    expect(await acceptVoucher(s.domain, s.policy, s.store, v)).toMatchObject({
      ok: false,
      code: 'commitment_mismatch',
    });
    expect(await s.store.get(s.domain.channelId)).toBeUndefined();
  });

  it('is linearizable under concurrent submissions (CAS)', async () => {
    const s = await setup();
    // Store that yields between read and CAS to force interleavings.
    const inner = new InMemoryVoucherStore();
    const slow: VoucherStore = {
      async get(id) {
        const r = await inner.get(id);
        await new Promise((res) => setTimeout(res, Math.random() * 3));
        return r;
      },
      compareAndSet: (id, e, n: StoredVoucher) => inner.compareAndSet(id, e, n),
    };
    const amounts = [1n, 2n, 3n, 4n, 5n, 1n, 2n, 5n];
    const results = await Promise.all(
      amounts.map((a) => acceptVoucher(s.domain, { ...s.policy, maxRetries: 50 }, slow, s.mk(a))),
    );
    expect((await inner.get(s.domain.channelId))?.cumulative).toBe(5n * STROOPS);
    // Accepted deltas must telescope to the final value: no double counting.
    const total = results.reduce((acc, r) => (r.ok ? acc + r.delta : acc), 0n);
    expect(total).toBe(5n * STROOPS);
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(5);
  });

  it('store refuses non-increasing writes even if called directly', async () => {
    const s = await setup();
    const v = s.mk(3n);
    expect(
      await s.store.compareAndSet(s.domain.channelId, 0n, { cumulative: 3n * STROOPS, voucher: v }),
    ).toBe(true);
    expect(
      await s.store.compareAndSet(s.domain.channelId, 3n * STROOPS, {
        cumulative: 2n * STROOPS,
        voucher: s.mk(2n),
      }),
    ).toBe(false);
    expect(
      await s.store.compareAndSet(s.domain.channelId, 0n, {
        cumulative: 9n * STROOPS,
        voucher: s.mk(9n),
      }),
    ).toBe(false);
  });
});
