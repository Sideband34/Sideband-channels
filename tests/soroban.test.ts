import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  scValToNative,
  xdr,
  rpc,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  ChannelError,
  NETWORK_PASSPHRASES,
  RpcSorobanClient,
  ownKeypair,
  SorobanChannelAdapter,
  SubmissionTimeoutError,
  bindingFromScVal,
  createVoucher,
  keypairSigner,
  mapContractError,
  type InvokeResult,
  type SorobanClient,
} from '../src/index.js';

const TESTNET = NETWORK_PASSPHRASES.testnet;
const payerKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const providerKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 5));
const CHANNEL = StrKey.encodeContract(Buffer.alloc(32, 9));
const S = 10_000_000n;

/** Builds the ScVal the contract's `get` returns (struct => sorted symbol map). */
function channelScVal(o: {
  status: 'Open' | 'Closing' | 'Closed' | 'Refunded';
  deposit?: bigint;
  paid?: bigint;
  refunded?: bigint;
  effectiveAt?: bigint;
}): xdr.ScVal {
  const sym = (s: string) => nativeToScVal(s, { type: 'symbol' });
  const entries: [string, xdr.ScVal][] = [
    ['close_effective_at', nativeToScVal(o.effectiveAt ?? 0n, { type: 'u64' })],
    ['close_wait', nativeToScVal(600n, { type: 'u64' })],
    ['deposit', nativeToScVal(o.deposit ?? 10n * S, { type: 'i128' })],
    ['expires_at', nativeToScVal(10_000n, { type: 'u64' })],
    ['paid_to_provider', nativeToScVal(o.paid ?? 0n, { type: 'i128' })],
    ['payer', new Address(payerKp.publicKey()).toScVal()],
    ['payer_key', xdr.ScVal.scvBytes(payerKp.rawPublicKey())],
    ['provider', new Address(providerKp.publicKey()).toScVal()],
    ['refunded_to_payer', nativeToScVal(o.refunded ?? 0n, { type: 'i128' })],
    ['status', xdr.ScVal.scvVec([sym(o.status)])],
    ['token', new Address(TOKEN).toScVal()],
  ];
  return xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: sym(k), val: v })));
}

class FakeClient implements SorobanClient {
  state: xdr.ScVal | undefined;
  calls: { method: string; args: xdr.ScVal[]; source: string }[] = [];
  deployed = 0;
  next: ((method: string) => InvokeResult | Error) | undefined;
  async readChannel() {
    return this.state;
  }
  txs = new Map<string, { status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND'; ledger?: number }>();
  async getTransaction(h: string) {
    return this.txs.get(h) ?? { status: 'NOT_FOUND' as const };
  }
  async deploy() {
    this.deployed++;
    return CHANNEL;
  }
  async invoke(a: { method: string; args: xdr.ScVal[]; source: Keypair }) {
    this.calls.push({ method: a.method, args: a.args, source: a.source.publicKey() });
    const r = this.next?.(a.method) ?? {
      hash: 'h-' + a.method,
      status: 'SUCCESS' as const,
      ledger: 7,
    };
    if (r instanceof Error) throw r;
    if (r.status === 'SUCCESS') {
      const amt = () => scValToNative(a.args[0]!) as bigint;
      if (a.method === 'init') this.state = channelScVal({ status: 'Open' });
      if (a.method === 'close')
        this.state = channelScVal({ status: 'Closed', paid: amt(), refunded: 10n * S - amt() });
      if (a.method === 'refund')
        this.state = channelScVal({ status: 'Refunded', refunded: 10n * S });
      if (a.method === 'settle') this.state = channelScVal({ status: 'Open', paid: amt() });
      if (a.method === 'top_up')
        this.state = channelScVal({ status: 'Open', deposit: 10n * S + amt() });
      if (a.method === 'close_start')
        this.state = channelScVal({ status: 'Closing', effectiveAt: 10_000n });
    }
    return r;
  }
}

function adapter(
  client: SorobanClient,
  over: Partial<ConstructorParameters<typeof SorobanChannelAdapter>[0]> = {},
) {
  return new SorobanChannelAdapter({
    client,
    networkPassphrase: TESTNET,
    wasmHash: Buffer.alloc(32, 7),
    signers: new Map([
      [payerKp.publicKey(), payerKp],
      [providerKp.publicKey(), providerKp],
    ]),
    commitmentKeys: new Map([[payerKp.publicKey(), payerKp.rawPublicKey()]]),
    now: () => 1000,
    ...over,
  });
}

const openParams = {
  networkPassphrase: TESTNET,
  payer: payerKp.publicKey(),
  provider: providerKp.publicKey(),
  asset: TOKEN,
  deposit: 10n * S,
  expiresAt: 10_000,
  idempotencyKey: 'k',
};

describe('binding mapping (fixtures of contract `get`)', () => {
  it('maps open and closed channel structs', () => {
    const open = bindingFromScVal(CHANNEL, TESTNET, channelScVal({ status: 'Open' }));
    expect(open).toMatchObject({
      status: 'open',
      deposit: 10n * S,
      expiresAt: 10_000,
      payer: payerKp.publicKey(),
      provider: providerKp.publicKey(),
      asset: TOKEN,
    });
    expect(open.settledToProvider).toBeUndefined();
    const closed = bindingFromScVal(
      CHANNEL,
      TESTNET,
      channelScVal({ status: 'Closed', paid: 3n * S, refunded: 7n * S }),
    );
    expect(closed).toMatchObject({
      status: 'closed',
      settledToProvider: 3n * S,
      refundedToPayer: 7n * S,
    });
    expect(scValToNative(channelScVal({ status: 'Refunded' })).status).toEqual(['Refunded']);
  });
  it('rejects unknown statuses', () => {
    expect(() =>
      bindingFromScVal(CHANNEL, TESTNET, channelScVal({ status: 'Weird' as 'Open' })),
    ).toThrow(ChannelError);
  });
});

describe('mapContractError', () => {
  it('maps contract error codes and crypto failures', () => {
    expect(mapContractError('HostError: Error(Contract, #4)').code).toBe('already_settled');
    expect(mapContractError('Error(Contract, #6)').code).toBe('not_expired');
    expect(mapContractError('Error(Contract, #5)').code).toBe('invalid_voucher');
    expect(mapContractError('Error(Contract, #2)').code).toBe('not_found');
    expect(mapContractError('HostError: Error(Crypto, InvalidInput)').code).toBe('invalid_voucher');
    expect(mapContractError('something else').code).toBe('invalid_params');
  });
});

describe('SorobanChannelAdapter (fake client)', () => {
  it('deploys then inits with payer signature and the commitment key, and is idempotent', async () => {
    const c = new FakeClient();
    const a = adapter(c);
    const r = await a.open(openParams);
    expect(r).toMatchObject({ synthetic: false, txRef: 'h-init' });
    expect(r.binding).toMatchObject({ channelId: CHANNEL, status: 'open' });
    expect(c.calls).toHaveLength(1);
    const call = c.calls[0]!;
    expect(call).toMatchObject({ method: 'init', source: payerKp.publicKey() });
    expect(call.args).toHaveLength(7);
    expect(scValToNative(call.args[6]!)).toBe(3600n); // DEFAULT_CLOSE_WAIT
    expect(scValToNative(call.args[4]!)).toBe(10n * S);
    expect(
      Buffer.from(scValToNative(call.args[3]!) as Uint8Array).equals(
        Buffer.from(payerKp.rawPublicKey()),
      ),
    ).toBe(true);
    const again = await a.open(openParams); // already initialized: no second init
    expect(again.binding.channelId).toBe(CHANNEL);
    expect(c.calls).toHaveLength(1);
  });

  it('refuses wrong/public network, missing signer, bad deposit', async () => {
    const a = adapter(new FakeClient());
    await expect(
      a.open({ ...openParams, networkPassphrase: NETWORK_PASSPHRASES.futurenet }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await expect(
      a.open({ ...openParams, networkPassphrase: NETWORK_PASSPHRASES.public }),
    ).rejects.toThrow();
    expect(() =>
      adapter(new FakeClient(), { networkPassphrase: NETWORK_PASSPHRASES.public }),
    ).toThrow();
    await expect(
      a.open({ ...openParams, payer: Keypair.random().publicKey() }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await expect(a.open({ ...openParams, deposit: 0n })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });

  it('close is signed by the provider and returns amounts read back from chain state', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    const a = adapter(c);
    const domain = {
      networkPassphrase: TESTNET,
      channelId: CHANNEL,
      payer: payerKp.publicKey(),
      provider: providerKp.publicKey(),
    };
    const v = createVoucher(keypairSigner(payerKp), domain, 3n * S);
    const r = await a.close(CHANNEL, v);
    expect(r).toMatchObject({
      toProvider: 3n * S,
      toPayer: 7n * S,
      synthetic: false,
      txRef: 'h-close',
    });
    expect(c.calls[0]).toMatchObject({ method: 'close', source: providerKp.publicKey() });
    expect(scValToNative(c.calls[0]!.args[0]!)).toBe(3n * S);
    expect(Buffer.from(scValToNative(c.calls[0]!.args[1]!) as Uint8Array).toString('hex')).toBe(
      v.signature,
    );
    await expect(a.close(CHANNEL, v)).rejects.toMatchObject({ code: 'already_settled' });
  });

  it('maps on-chain failure to ChannelError and keeps unknown outcomes as timeouts', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    const a = adapter(c);
    c.next = () => ({
      hash: 'x',
      status: 'FAILED',
      ledger: 1,
      errorMessage: 'Error(Contract, #5)',
    });
    const domain = {
      networkPassphrase: TESTNET,
      channelId: CHANNEL,
      payer: payerKp.publicKey(),
      provider: providerKp.publicKey(),
    };
    const v = createVoucher(keypairSigner(payerKp), domain, 3n * S);
    await expect(a.close(CHANNEL, v)).rejects.toMatchObject({ code: 'invalid_voucher' });
    c.next = () => new SubmissionTimeoutError('tx-unknown');
    await expect(a.close(CHANNEL, v)).rejects.toMatchObject({ txHash: 'tx-unknown' });
    // applied but state not visible yet => reconcile by hash, never "success"
    const stale = new FakeClient();
    stale.state = channelScVal({ status: 'Open' });
    stale.invoke = async () => ({ hash: 'h-applied', status: 'SUCCESS', ledger: 2 });
    await expect(adapter(stale).close(CHANNEL, v)).rejects.toBeInstanceOf(SubmissionTimeoutError);
  });

  it('findTransaction exposes lookups; unknown stays NOT_FOUND', async () => {
    const c = new FakeClient();
    c.txs.set('abc', { status: 'SUCCESS', ledger: 9 });
    const a = adapter(c);
    expect(await a.findTransaction('abc')).toEqual({ status: 'SUCCESS', ledger: 9 });
    expect(await a.findTransaction('nope')).toEqual({ status: 'NOT_FOUND' });
  });

  it('refund needs close_start and an elapsed window; it is signed by the payer', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    await expect(adapter(c).refund(CHANNEL)).rejects.toMatchObject({ code: 'not_closing' });
    c.state = channelScVal({ status: 'Closing', effectiveAt: 5_000n });
    await expect(adapter(c).refund(CHANNEL)).rejects.toMatchObject({ code: 'not_expired' });
    expect(c.calls).toHaveLength(0);
    const a = adapter(c, { now: () => 5_000 });
    expect(await a.refund(CHANNEL)).toMatchObject({ toPayer: 10n * S, toProvider: 0n });
    expect(c.calls[0]).toMatchObject({ method: 'refund', source: payerKp.publicKey() });
    await expect(adapter(new FakeClient()).refund(CHANNEL)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await adapter(new FakeClient()).getBinding(CHANNEL)).toBeUndefined();
  });
});

describe('SorobanChannelAdapter lifecycle (fake client)', () => {
  const domain = {
    networkPassphrase: TESTNET,
    channelId: CHANNEL,
    payer: payerKp.publicKey(),
    provider: providerKp.publicKey(),
  };
  const v = (n: bigint) => createVoucher(keypairSigner(payerKp), domain, n);

  it('maps closing state with its effective time', () => {
    const b = bindingFromScVal(
      CHANNEL,
      TESTNET,
      channelScVal({ status: 'Closing', paid: S, effectiveAt: 12_345n }),
    );
    expect(b).toMatchObject({
      status: 'closing',
      withdrawn: S,
      closeWait: 600,
      closeEffectiveAt: 12_345,
    });
    expect(b.settledToProvider).toBeUndefined();
  });

  it('topUp is payer-signed, positive only, and returns the new deposit', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    const a = adapter(c);
    expect(await a.topUp(CHANNEL, 2n * S)).toMatchObject({ deposit: 12n * S, txRef: 'h-top_up' });
    expect(c.calls[0]).toMatchObject({ method: 'top_up', source: payerKp.publicKey() });
    await expect(a.topUp(CHANNEL, 0n)).rejects.toMatchObject({ code: 'invalid_params' });
    c.state = channelScVal({ status: 'Closing', effectiveAt: 10_000n });
    await expect(a.topUp(CHANNEL, S)).rejects.toMatchObject({ code: 'not_open' });
  });

  it('settle is provider-signed, keeps the channel open, refuses stale vouchers locally', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open', paid: S });
    const a = adapter(c);
    const r = await a.settle(CHANNEL, v(4n * S));
    expect(r).toMatchObject({ amount: 3n * S, withdrawn: 4n * S, synthetic: false });
    expect(c.calls[0]).toMatchObject({ method: 'settle', source: providerKp.publicKey() });
    expect(scValToNative(c.calls[0]!.args[0]!)).toBe(4n * S);
    expect((await a.getBinding(CHANNEL))?.status).toBe('open');
    await expect(a.settle(CHANNEL, v(4n * S))).rejects.toMatchObject({ code: 'stale_voucher' });
    expect(c.calls).toHaveLength(1);
    expect(mapContractError('Error(Contract, #7)').code).toBe('stale_voucher');
  });

  it('close without a voucher closes at the withdrawn amount', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open', paid: 2n * S });
    const r = await adapter(c).close(CHANNEL, undefined);
    expect(scValToNative(c.calls[0]!.args[0]!)).toBe(2n * S);
    expect(r).toMatchObject({ toProvider: 2n * S, toPayer: 8n * S });
  });

  it('closeStart is payer-signed and reports the effective time; twice is refused', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    const a = adapter(c);
    expect(await a.closeStart(CHANNEL)).toMatchObject({ closeEffectiveAt: 10_000 });
    expect(c.calls[0]).toMatchObject({ method: 'close_start', source: payerKp.publicKey() });
    await expect(a.closeStart(CHANNEL)).rejects.toMatchObject({ code: 'already_closing' });
    expect(mapContractError('Error(Contract, #10)').code).toBe('already_closing');
    expect(mapContractError('Error(Contract, #8)').code).toBe('not_closing');
  });

  it('provider can still settle during the dispute window', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Closing', effectiveAt: 10_000n });
    const r = await adapter(c).settle(CHANNEL, v(3n * S));
    expect(r.withdrawn).toBe(3n * S);
  });

  it('terminal channels refuse every mutation before anything is sent', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Closed', paid: S, refunded: 9n * S });
    const a = adapter(c);
    for (const p of [
      a.topUp(CHANNEL, S),
      a.settle(CHANNEL, v(2n * S)),
      a.close(CHANNEL, v(2n * S)),
      a.closeStart(CHANNEL),
      a.refund(CHANNEL),
    ]) {
      await expect(p).rejects.toMatchObject({ code: 'already_settled' });
    }
    expect(c.calls).toHaveLength(0);
  });

  it('an applied settle whose effect is not visible yet is a timeout (reconcile)', async () => {
    const c = new FakeClient();
    c.state = channelScVal({ status: 'Open' });
    c.invoke = async () => ({ hash: 'h-hidden', status: 'SUCCESS', ledger: 3 });
    await expect(adapter(c).settle(CHANNEL, v(S))).rejects.toMatchObject({ txHash: 'h-hidden' });
  });
});

describe('RpcSorobanClient (fake rpc server)', () => {
  const simOk = (retval: xdr.ScVal = xdr.ScVal.scvVoid()) =>
    ({
      _parsed: true,
      id: '1',
      latestLedger: 1,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: '100',
      result: { auth: [], retval },
    }) as unknown as rpc.Api.SimulateTransactionResponse;

  function server(over: Record<string, unknown> = {}) {
    return {
      getAccount: async (id: string) => new Account(id, '1'),
      simulateTransaction: async () => simOk(),
      sendTransaction: async () => ({ status: 'PENDING' }),
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
      ...over,
    } as unknown as ConstructorParameters<typeof RpcSorobanClient>[0];
  }
  const args = { contractId: CHANNEL, method: 'refund', args: [], source: payerKp };

  it('readChannel returns the simulated value, undefined for missing, maps contract errors', async () => {
    const v = channelScVal({ status: 'Open' });
    const ok = new RpcSorobanClient(
      server({ simulateTransaction: async () => simOk(v) }),
      TESTNET,
      payerKp.publicKey(),
    );
    expect(await ok.readChannel(CHANNEL)).toBeDefined();
    const err = (e: string) =>
      new RpcSorobanClient(
        server({
          simulateTransaction: async () => ({
            error: e,
            id: '1',
            latestLedger: 1,
            events: [],
            _parsed: true,
          }),
        }),
        TESTNET,
        payerKp.publicKey(),
      );
    expect(await err('Error(Contract, #2)').readChannel(CHANNEL)).toBeUndefined();
    await expect(err('Error(Contract, #3)').readChannel(CHANNEL)).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });

  it('gives transactions a validity window long enough for a slow link (default 300 s, configurable)', async () => {
    const maxTimes: number[] = [];
    const capture = server({
      simulateTransaction: async (tx: { timeBounds?: { maxTime: string } }) => {
        maxTimes.push(Number(tx.timeBounds?.maxTime));
        return simOk();
      },
    } as never);
    const now = Math.floor(Date.now() / 1000);
    await new RpcSorobanClient(capture, TESTNET, payerKp.publicKey(), 1, 1)
      .invoke(args)
      .catch(() => undefined);
    await new RpcSorobanClient(capture, TESTNET, payerKp.publicKey(), 1, 1, 900)
      .invoke(args)
      .catch(() => undefined);
    expect(maxTimes[0]! - now).toBeGreaterThanOrEqual(295);
    expect(maxTimes[1]! - now).toBeGreaterThanOrEqual(895);
  });

  it('returns SUCCESS only when the network reports it, with a pre-computed hash', async () => {
    const c = new RpcSorobanClient(
      server({ getTransaction: async () => ({ status: 'SUCCESS', ledger: 42 }) }),
      TESTNET,
      payerKp.publicKey(),
      1,
      3,
    );
    const r = await c.invoke(args);
    expect(r).toMatchObject({ status: 'SUCCESS', ledger: 42 });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exhausted polling and send exceptions are timeouts carrying the hash, never failures', async () => {
    const slow = new RpcSorobanClient(server(), TESTNET, payerKp.publicKey(), 1, 2);
    const e1 = await slow.invoke(args).catch((e) => e);
    expect(e1).toBeInstanceOf(SubmissionTimeoutError);
    expect(e1.txHash).toMatch(/^[0-9a-f]{64}$/);
    const down = new RpcSorobanClient(
      server({
        sendTransaction: async () => {
          throw new Error('ECONNRESET');
        },
      }),
      TESTNET,
      payerKp.publicKey(),
      1,
      2,
    );
    expect(await down.invoke(args).catch((e) => e)).toBeInstanceOf(SubmissionTimeoutError);
  });

  it('getTransaction maps statuses and treats RPC errors as unknown', async () => {
    const mk = (g: () => Promise<unknown>) =>
      new RpcSorobanClient(server({ getTransaction: g }), TESTNET, payerKp.publicKey());
    expect(await mk(async () => ({ status: 'SUCCESS', ledger: 3 })).getTransaction('h')).toEqual({
      status: 'SUCCESS',
      ledger: 3,
    });
    expect(await mk(async () => ({ status: 'NOT_FOUND' })).getTransaction('h')).toEqual({
      status: 'NOT_FOUND',
    });
    expect(
      await mk(async () => {
        throw new Error('down');
      }).getTransaction('h'),
    ).toEqual({ status: 'NOT_FOUND' });
  });

  it('reports FAILED on-chain and rejected submissions as failures', async () => {
    const failed = new RpcSorobanClient(
      server({ getTransaction: async () => ({ status: 'FAILED', ledger: 5 }) }),
      TESTNET,
      payerKp.publicKey(),
      1,
      2,
    );
    expect((await failed.invoke(args)).status).toBe('FAILED');
    const rejected = new RpcSorobanClient(
      server({ sendTransaction: async () => ({ status: 'ERROR', errorResult: undefined }) }),
      TESTNET,
      payerKp.publicKey(),
      1,
      2,
    );
    expect((await rejected.invoke(args)).status).toBe('FAILED');
  });

  it('simulation errors surface as mapped ChannelErrors before anything is sent', async () => {
    let sent = false;
    const c = new RpcSorobanClient(
      server({
        simulateTransaction: async () => ({
          error: 'Error(Contract, #6)',
          id: '1',
          latestLedger: 1,
          events: [],
          _parsed: true,
        }),
        sendTransaction: async () => {
          sent = true;
          return { status: 'PENDING' };
        },
      }),
      TESTNET,
      payerKp.publicKey(),
    );
    await expect(c.invoke(args)).rejects.toMatchObject({ code: 'not_expired' });
    expect(sent).toBe(false);
  });

  it('refuses the public network', () => {
    expect(
      () => new RpcSorobanClient(server(), NETWORK_PASSPHRASES.public, payerKp.publicKey()),
    ).toThrow();
  });
});

describe('keypairs from another copy of the SDK', () => {
  it('are re-created from their seed so the transaction only holds XDR classes of this SDK copy', () => {
    const real = Keypair.random();
    // what a keypair from a second node_modules copy looks like to this module: same methods, different class
    const foreign = {
      publicKey: () => real.publicKey(),
      rawSecretKey: () => real.rawSecretKey(),
    } as unknown as Keypair;
    expect(foreign instanceof Keypair).toBe(false);
    const own = ownKeypair(foreign);
    expect(own instanceof Keypair).toBe(true);
    expect(own.publicKey()).toBe(real.publicKey());
    expect(ownKeypair(real)).toBe(real);
  });

  it('RpcSorobanClient.forUrl builds the server with the SDK of this package', () => {
    expect(
      RpcSorobanClient.forUrl(
        'https://soroban-testnet.stellar.org',
        NETWORK_PASSPHRASES.testnet,
        Keypair.random().publicKey(),
      ),
    ).toBeInstanceOf(RpcSorobanClient);
  });
});
