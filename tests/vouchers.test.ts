import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  InMemoryVoucherStore,
  NETWORK_PASSPHRASES,
  NetworkError,
  VoucherFormatError,
  acceptVoucher,
  buildPreimage,
  createVoucher,
  formatAmount,
  keypairSigner,
  networkId,
  parseAmount,
  signVoucher,
  verifyVoucher,
  type AsyncVoucherSigner,
  type LegacyVoucherSigner,
  type VoucherSigner,
} from '../src/index.js';
import { createStellarCliSigner } from '../examples/stellar-cli-signer.js';
import { attackerKp, openChannel, payer, payerKp, STROOPS } from './helpers.js';

describe('amount', () => {
  it('round-trips canonical strings like the Dart Amount', () => {
    expect(parseAmount('0.0010')).toBe(10_000n);
    expect(formatAmount(10_000n)).toBe('0.001');
    expect(formatAmount(parseAmount('12'))).toBe('12');
    expect(formatAmount(0n)).toBe('0');
  });
  it('rejects bad grammar', () => {
    for (const s of ['-1', '1e3', ' 1', '1.12345678', '', '.5', '1.']) {
      expect(() => parseAmount(s), s).toThrow();
    }
  });
});

describe('upstream commitment layout', () => {
  it('equals an independent hand-written XDR encoding of the one-way-channel Commitment', async () => {
    const { domain } = await openChannel();
    const u32 = (n: number) =>
      Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    const sym = (s: string) =>
      Buffer.concat([
        u32(15),
        u32(s.length),
        Buffer.from(s.padEnd(Math.ceil(s.length / 4) * 4, '\0')),
      ]);
    const amount = 25_000_000n;
    const i128 = Buffer.alloc(16);
    i128.writeBigInt64BE(amount >> 64n, 0);
    i128.writeBigUInt64BE(amount & ((1n << 64n) - 1n), 8);
    const raw = Buffer.from(StrKey.decodeContract(domain.channelId));
    const expected = Buffer.concat([
      u32(17),
      u32(1),
      u32(4), // SCV_MAP, present, 4 entries
      sym('amount'),
      u32(10),
      i128, // SCV_I128
      sym('channel'),
      u32(18),
      u32(1),
      raw, // SCV_ADDRESS, contract
      sym('domain'),
      sym('chancmmt'),
      sym('network'),
      u32(13),
      u32(32),
      Buffer.from(networkId(domain.networkPassphrase)),
    ]);
    expect(Buffer.from(buildPreimage(domain, amount)).equals(expected)).toBe(true);
  });
  it('does not bind payer or provider (fixed per channel at deployment)', async () => {
    const { domain } = await openChannel();
    const other = { ...domain, payer: attackerKp.publicKey(), provider: attackerKp.publicKey() };
    expect(Buffer.from(buildPreimage(other, STROOPS))).toEqual(
      Buffer.from(buildPreimage(domain, STROOPS)),
    );
  });
});

describe('voucher create/verify', () => {
  it('verifies a freshly created voucher', async () => {
    const { domain } = await openChannel();
    const v = createVoucher(payer, domain, 2n * STROOPS);
    expect(v.cumulativeAmount).toBe('2');
    expect(v.channelRef).toBe(domain.channelId);
    expect(buildPreimage(domain, 2n * STROOPS)).toHaveLength(192);
    expect(verifyVoucher(domain, v)).toEqual({ ok: true, cumulative: 2n * STROOPS });
  });

  it('rejects a voucher signed by a different key', async () => {
    const { domain } = await openChannel();
    const forged = createVoucher(
      keypairSigner(attackerKp),
      { ...domain, payer: attackerKp.publicKey() },
      STROOPS,
    );
    const r = verifyVoucher(domain, forged);
    expect(r.ok).toBe(false);
  });

  it('refuses to sign when signer is not the channel payer', async () => {
    const { domain } = await openChannel();
    expect(() => createVoucher(keypairSigner(attackerKp), domain, STROOPS)).toThrow(
      /not the channel payer/,
    );
  });

  it('rejects an amount tampered after signing', async () => {
    const { domain } = await openChannel();
    const v = createVoucher(payer, domain, STROOPS);
    const r = verifyVoucher(domain, { ...v, cumulativeAmount: '5' });
    expect(r).toMatchObject({ ok: false, code: 'commitment_mismatch' });
  });

  it('rejects a good commitment with a corrupted signature', async () => {
    const { domain } = await openChannel();
    const v = createVoucher(payer, domain, STROOPS);
    const sig = (v.signature[0] === '0' ? '1' : '0') + v.signature.slice(1);
    expect(verifyVoucher(domain, { ...v, signature: sig })).toMatchObject({
      ok: false,
      code: 'bad_signature',
    });
  });

  it('rejects a voucher for another channel (wrong domain)', async () => {
    const a = await openChannel();
    const { adapter } = a;
    const { binding: other } = await adapter.open({
      networkPassphrase: a.domain.networkPassphrase,
      payer: a.domain.payer,
      provider: a.domain.provider,
      asset: 'TEST-TOKEN',
      deposit: 10n * STROOPS,
      expiresAt: 10_000,
      idempotencyKey: 'k2',
    });
    const vOther = createVoucher(payer, { ...a.domain, channelId: other.channelId }, STROOPS);
    expect(verifyVoucher(a.domain, vOther)).toMatchObject({ ok: false, code: 'wrong_channel' });
    // relabelled to look like channel A: signature domain no longer matches
    const relabelled = { ...vOther, channelRef: a.domain.channelId };
    expect(verifyVoucher(a.domain, relabelled).ok).toBe(false);
  });

  it('flags a voucher signed for another network as wrong_network', async () => {
    const { domain } = await openChannel();
    const other = { ...domain, networkPassphrase: NETWORK_PASSPHRASES.futurenet };
    const v = createVoucher(payer, other, STROOPS);
    expect(verifyVoucher(domain, v)).toMatchObject({ ok: false, code: 'wrong_network' });
  });

  it('refuses the public network and unknown passphrases (fail closed)', async () => {
    const { domain } = await openChannel();
    expect(() =>
      createVoucher(payer, { ...domain, networkPassphrase: NETWORK_PASSPHRASES.public }, STROOPS),
    ).toThrow(NetworkError);
    expect(() =>
      createVoucher(payer, { ...domain, networkPassphrase: 'Mystery Net' }, STROOPS),
    ).toThrow(NetworkError);
    const v = createVoucher(payer, domain, STROOPS);
    expect(verifyVoucher({ ...domain, networkPassphrase: 'Mystery Net' }, v)).toMatchObject({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects malformed fields', async () => {
    const { domain } = await openChannel();
    const v = createVoucher(payer, domain, STROOPS);
    for (const bad of [
      { ...v, cumulativeAmount: '1.0' }, // non-canonical
      { ...v, cumulativeAmount: '-1' },
      { ...v, signature: v.signature.toUpperCase() },
      { ...v, commitment: 'zz' },
    ]) {
      expect(verifyVoucher(domain, bad)).toMatchObject({ ok: false, code: 'malformed' });
    }
  });

  it('cannot create zero or out-of-range vouchers', async () => {
    const { domain } = await openChannel();
    expect(() => createVoucher(payer, domain, 0n)).toThrow();
    expect(() => createVoucher(payer, domain, 1n << 127n)).toThrow();
  });

  it('signs through an async recording VoucherSigner that only sees commitment bytes', async () => {
    const { domain, binding, clock } = await openChannel();
    const recordedCalls: Uint8Array[] = [];
    const remoteKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));

    const recordingSigner: AsyncVoucherSigner = {
      publicKey: () => remoteKp.publicKey(),
      async sign(bytes: Uint8Array): Promise<Uint8Array> {
        recordedCalls.push(new Uint8Array(bytes));
        const sig = new Uint8Array(remoteKp.sign(Buffer.from(bytes)));
        // Mutate the passed buffer in place to prove the SDK isolated its preimage buffer.
        bytes.fill(0xff);
        return sig;
      },
    };

    expect('secret' in recordingSigner).toBe(false);
    expect('rawSecretKey' in recordingSigner).toBe(false);

    const vAsync = await createVoucher(recordingSigner, domain, 2n * STROOPS);
    const vViaSignHelper = await signVoucher(recordingSigner, domain, 3n * STROOPS);
    const vKeypair = createVoucher(payer, domain, 2n * STROOPS);

    expect(vAsync).toEqual(vKeypair);
    expect(recordedCalls).toHaveLength(2);
    expect(Buffer.from(recordedCalls[0]!)).toEqual(
      Buffer.from(buildPreimage(domain, 2n * STROOPS)),
    );
    expect(Buffer.from(recordedCalls[1]!)).toEqual(
      Buffer.from(buildPreimage(domain, 3n * STROOPS)),
    );
    expect(verifyVoucher(domain, vAsync)).toEqual({ ok: true, cumulative: 2n * STROOPS });

    const store = new InMemoryVoucherStore();
    const policy = {
      deposit: binding.deposit,
      maxSpend: 5n * STROOPS,
      expiresAt: binding.expiresAt,
      now: () => clock.t,
    };
    expect(await acceptVoucher(domain, policy, store, vAsync)).toMatchObject({
      ok: true,
      cumulative: 2n * STROOPS,
    });
    expect(await acceptVoucher(domain, policy, store, vViaSignHelper)).toMatchObject({
      ok: true,
      cumulative: 3n * STROOPS,
    });
  });

  it('supports the stellar-cli keystore signer adapter with a recorded driver', async () => {
    const { domain } = await openChannel();
    const driverCalls: { op: 'address' | 'sign'; identity: string; bytes?: Uint8Array }[] = [];
    const signer = await createStellarCliSigner('payer-id', {
      async address(identity) {
        driverCalls.push({ op: 'address', identity });
        return payerKp.publicKey();
      },
      async sign(identity, bytes) {
        driverCalls.push({ op: 'sign', identity, bytes: new Uint8Array(bytes) });
        return new Uint8Array(payerKp.sign(Buffer.from(bytes)));
      },
    });

    const voucher = await signVoucher(signer, domain, STROOPS);
    expect(verifyVoucher(domain, voucher)).toEqual({ ok: true, cumulative: STROOPS });
    expect(driverCalls).toHaveLength(2);
    expect(driverCalls[0]).toEqual({ op: 'address', identity: 'payer-id' });
    expect(driverCalls[1]?.op).toBe('sign');
    expect(Buffer.from(driverCalls[1]!.bytes!)).toEqual(
      Buffer.from(buildPreimage(domain, STROOPS)),
    );
  });

  it('rejects malformed signature lengths from custom signers', async () => {
    const { domain } = await openChannel();
    const badSigner: VoucherSigner = {
      publicKey: () => payerKp.publicKey(),
      sign: () => new Uint8Array(32),
    };
    expect(() => createVoucher(badSigner, domain, STROOPS)).toThrow(VoucherFormatError);
  });

  it('keeps deprecated Keypair and property-based signer overloads working for one release', async () => {
    const { domain } = await openChannel();
    const fromKeypair = createVoucher(payerKp, domain, STROOPS);
    const legacySigner: LegacyVoucherSigner = {
      publicKey: payerKp.publicKey(),
      sign: (m) => payerKp.sign(Buffer.from(m)),
    };
    const fromLegacy = createVoucher(legacySigner, domain, STROOPS);
    const canonical = createVoucher(keypairSigner(payerKp), domain, STROOPS);
    expect(fromKeypair).toEqual(canonical);
    expect(fromLegacy).toEqual(canonical);
  });
});
