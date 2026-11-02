import { describe, expect, it } from 'vitest';
import {
  ChannelError,
  IntentError,
  NETWORK_PASSPHRASES,
  NetworkError,
  createVoucher,
  prepareSettlement,
  transition,
} from '../src/index.js';
import { TESTNET, openChannel, payer, STROOPS } from './helpers.js';

describe('InMemoryChannelAdapter (test adapter)', () => {
  it('open is idempotent per key and refuses the public network', async () => {
    const { adapter, binding } = await openChannel();
    const again = await adapter.open({
      networkPassphrase: TESTNET,
      payer: binding.payer,
      provider: binding.provider,
      asset: 'TEST-TOKEN',
      deposit: binding.deposit,
      expiresAt: binding.expiresAt,
      idempotencyKey: 'k1',
    });
    expect(again.binding.channelId).toBe(binding.channelId);
    await expect(
      adapter.open({
        networkPassphrase: NETWORK_PASSPHRASES.public,
        payer: binding.payer,
        provider: binding.provider,
        asset: 'X',
        deposit: 1n,
        expiresAt: 99999,
        idempotencyKey: 'k9',
      }),
    ).rejects.toThrow(NetworkError);
  });

  it('close pays the provider the voucher amount and refunds the remainder', async () => {
    const { adapter, domain, binding } = await openChannel();
    const r = await adapter.close(domain.channelId, createVoucher(payer, domain, 3n * STROOPS));
    expect(r).toMatchObject({ toProvider: 3n * STROOPS, toPayer: 7n * STROOPS, synthetic: true });
    expect(r.toProvider + r.toPayer).toBe(binding.deposit);
    expect((await adapter.getBinding(domain.channelId))?.status).toBe('closed');
  });

  it('cannot close twice or refund after close', async () => {
    const { adapter, domain, clock, binding } = await openChannel();
    await adapter.close(domain.channelId, createVoucher(payer, domain, STROOPS));
    await expect(
      adapter.close(domain.channelId, createVoucher(payer, domain, 2n * STROOPS)),
    ).rejects.toMatchObject({ code: 'already_settled' });
    clock.t = binding.expiresAt + 1;
    await expect(adapter.refund(domain.channelId)).rejects.toMatchObject({
      code: 'already_settled',
    });
  });

  it('provider shutdown: payer refunds only after expiry, getting the full deposit', async () => {
    const { adapter, domain, clock, binding } = await openChannel();
    await expect(adapter.refund(domain.channelId)).rejects.toMatchObject({ code: 'not_expired' });
    clock.t = binding.expiresAt;
    const r = await adapter.refund(domain.channelId);
    expect(r).toMatchObject({ toProvider: 0n, toPayer: binding.deposit });
  });

  it('close rejects forged, over-deposit and unknown-channel vouchers', async () => {
    const { adapter, domain } = await openChannel();
    const good = createVoucher(payer, domain, STROOPS);
    await expect(
      adapter.close(domain.channelId, { ...good, cumulativeAmount: '9' }),
    ).rejects.toBeInstanceOf(ChannelError);
    await expect(
      adapter.close(domain.channelId, createVoucher(payer, domain, 11n * STROOPS)),
    ).rejects.toMatchObject({ code: 'invalid_voucher' });
    await expect(adapter.close('C' + 'A'.repeat(55), good)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await adapter.getBinding(domain.channelId))?.status).toBe('open');
  });
});

describe('settlement intents', () => {
  async function prepared() {
    const ch = await openChannel();
    const v = createVoucher(payer, ch.domain, 4n * STROOPS);
    const intent = prepareSettlement(ch.binding, { cumulative: 4n * STROOPS, voucher: v });
    return { ...ch, intent };
  }

  it('is deterministic per (network, channel, amount)', async () => {
    const a = await prepared();
    const again = prepareSettlement(a.binding, {
      cumulative: 4n * STROOPS,
      voucher: a.intent.voucher,
    });
    expect(again.id).toBe(a.intent.id);
    expect(a.intent.state).toBe('CREATED');
  });

  it('walks CREATED -> AUTHORIZED -> SUBMITTED -> CONFIRMED only with evidence', async () => {
    const { intent } = await prepared();
    const i1 = transition(intent, 'AUTHORIZED');
    expect(() => transition(i1, 'SUBMITTED')).toThrow(IntentError);
    const i2 = transition(i1, 'SUBMITTED', { txHash: 'abc' });
    expect(() => transition(i2, 'CONFIRMED')).toThrow(/finality evidence/);
    expect(() =>
      transition(i2, 'CONFIRMED', {
        evidence: { network: NETWORK_PASSPHRASES.futurenet, txHash: 'abc', ledger: 1 },
      }),
    ).toThrow(/another network/);
    expect(() =>
      transition(i2, 'CONFIRMED', { evidence: { network: TESTNET, txHash: 'zzz', ledger: 1 } }),
    ).toThrow(/mismatch/);
    const done = transition(i2, 'CONFIRMED', {
      evidence: { network: TESTNET, txHash: 'abc', ledger: 7 },
    });
    expect(done.state).toBe('CONFIRMED');
    expect(transition(done, 'CONFIRMED')).toBe(done); // idempotent redelivery
    expect(() => transition(done, 'FAILED')).toThrow(IntentError);
  });

  it('timeout after submission goes to RECONCILING and can still confirm', async () => {
    const { intent } = await prepared();
    const sub = transition(transition(intent, 'AUTHORIZED'), 'SUBMITTED', { txHash: 'abc' });
    const rec = transition(sub, 'RECONCILING');
    expect(
      transition(rec, 'CONFIRMED', { evidence: { network: TESTNET, txHash: 'abc', ledger: 9 } })
        .state,
    ).toBe('CONFIRMED');
    expect(() =>
      transition(intent, 'CONFIRMED', { evidence: { network: TESTNET, txHash: 'abc', ledger: 9 } }),
    ).toThrow(/Illegal/);
  });

  it('refuses to prepare for a settled channel or an over-deposit voucher', async () => {
    const { adapter, domain, binding } = await openChannel();
    const v = createVoucher(payer, domain, STROOPS);
    await adapter.close(domain.channelId, v);
    const closed = (await adapter.getBinding(domain.channelId))!;
    expect(() => prepareSettlement(closed, { cumulative: STROOPS, voucher: v })).toThrow(
      /already closed/,
    );
    expect(() => prepareSettlement(binding, { cumulative: 11n * STROOPS, voucher: v })).toThrow(
      /exceeds deposit/,
    );
  });
});
