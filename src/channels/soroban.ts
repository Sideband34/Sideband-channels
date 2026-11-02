import { createHash } from 'node:crypto';
import {
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Keypair,
} from '@stellar/stellar-sdk';
import { assertAllowedNetwork } from '../networks.js';
import { parseAmount } from '../amount.js';
import type { Voucher } from '../vouchers/voucher.js';
import {
  ChannelError,
  SubmissionTimeoutError,
  type ChannelAdapter,
  type ChannelBinding,
  type ChannelStatus,
  type OpenParams,
  type SettleResult,
  type TxLookup,
  type TxReceipt,
} from './types.js';

/** Contract `Error` discriminants of contracts/channel (keep in sync). */
const CONTRACT_ERRORS: Record<number, ChannelError['code']> = {
  1: 'invalid_params', // AlreadyInitialized
  2: 'not_found', // NotInitialized
  3: 'invalid_params', // InvalidParams
  4: 'already_settled', // NotOpen
  5: 'invalid_voucher', // OverDeposit
  6: 'not_expired', // NotExpired
};

/** Maps a Soroban simulation/transaction error string to a ChannelError. */
export function mapContractError(message: string): ChannelError {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  if (m) {
    const code = CONTRACT_ERRORS[Number(m[1])];
    if (code) return new ChannelError(code, message);
  }
  // Failed ed25519 verification surfaces as a crypto host error.
  if (/Error\(Crypto,/.test(message)) return new ChannelError('invalid_voucher', message);
  return new ChannelError('invalid_params', message);
}

/** Raw `Channel` struct as emitted by the contract's `get`. */
export interface RawChannel {
  token: string;
  payer: string;
  provider: string;
  deposit: bigint;
  expires_at: bigint;
  status: ['Open'] | ['Closed'] | ['Refunded'];
  paid_to_provider: bigint;
  refunded_to_payer: bigint;
}

export function bindingFromScVal(
  channelId: string,
  networkPassphrase: string,
  value: xdr.ScVal,
): ChannelBinding {
  const raw = scValToNative(value) as RawChannel;
  const status = (Array.isArray(raw.status) ? raw.status[0] : raw.status) as string;
  const lower = status.toLowerCase();
  if (lower !== 'open' && lower !== 'closed' && lower !== 'refunded') {
    throw new ChannelError('invalid_params', `Unknown channel status ${status}`);
  }
  const s = lower as ChannelStatus;
  return {
    channelId,
    networkPassphrase,
    payer: raw.payer,
    provider: raw.provider,
    asset: raw.token,
    deposit: BigInt(raw.deposit),
    expiresAt: Number(raw.expires_at),
    status: s,
    ...(s !== 'open'
      ? {
          settledToProvider: BigInt(raw.paid_to_provider),
          refundedToPayer: BigInt(raw.refunded_to_payer),
        }
      : {}),
  };
}

export interface InvokeResult {
  hash: string;
  /** 'SUCCESS' only after the network reports the transaction applied. */
  status: 'SUCCESS' | 'FAILED';
  ledger: number;
  returnValue?: xdr.ScVal;
  errorMessage?: string;
}

/** The minimal chain surface the adapter needs. */
export interface SorobanClient {
  /** Read-only simulation of `get`; undefined if the contract does not exist. */
  readChannel(contractId: string): Promise<xdr.ScVal | undefined>;
  /** Deploys an instance of an uploaded wasm; returns the new contract id. */
  deploy(args: { wasmHash: Uint8Array; salt: Uint8Array; source: Keypair }): Promise<string>;
  /** Looks a transaction up by hash; NOT_FOUND means unknown, not failed. */
  getTransaction(
    hash: string,
  ): Promise<{ status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND'; ledger?: number }>;
  /**
   * Builds, signs and submits a contract call, waits for the result.
   * Must throw SubmissionTimeoutError (with the hash) if the outcome is unknown.
   */
  invoke(args: {
    contractId: string;
    method: string;
    args: xdr.ScVal[];
    source: Keypair;
  }): Promise<InvokeResult>;
}

export interface SorobanAdapterConfig {
  client: SorobanClient;
  networkPassphrase: string;
  /** Uploaded wasm hash of contracts/channel (testnet/test networks only). */
  wasmHash: Uint8Array;
  /** Stellar account keys the adapter may sign with, by public key. */
  signers: ReadonlyMap<string, Keypair>;
  /** Commitment (voucher) public keys by payer address, for `init`. */
  commitmentKeys: ReadonlyMap<string, Uint8Array>;
  /** Raw token contract address used as the channel asset. */
  now: () => number;
}

/**
 * Soroban-backed adapter. NOT exercised against a live network in this repo:
 * unit tests drive it through a fake `SorobanClient` with mapped fixtures.
 */
export class SorobanChannelAdapter implements ChannelAdapter {
  constructor(private readonly c: SorobanAdapterConfig) {
    assertAllowedNetwork(c.networkPassphrase);
  }

  private signer(address: string): Keypair {
    const k = this.c.signers.get(address);
    if (!k) throw new ChannelError('invalid_params', `No signer configured for ${address}`);
    return k;
  }

  private receipt(r: InvokeResult): TxReceipt {
    return { txRef: r.hash, synthetic: false, ledger: r.ledger };
  }

  private async call(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    source: Keypair,
  ): Promise<InvokeResult> {
    const r = await this.c.client.invoke({ contractId, method, args, source });
    if (r.status === 'FAILED') throw mapContractError(r.errorMessage ?? 'transaction failed');
    return r;
  }

  async open(p: OpenParams) {
    assertAllowedNetwork(p.networkPassphrase);
    if (p.networkPassphrase !== this.c.networkPassphrase) {
      throw new ChannelError('invalid_params', 'Network differs from adapter network');
    }
    if (p.deposit <= 0n) throw new ChannelError('invalid_params', 'Deposit must be positive');
    const payer = this.signer(p.payer);
    const key = this.c.commitmentKeys.get(p.payer);
    if (!key) throw new ChannelError('invalid_params', 'No commitment key for payer');
    // Deterministic salt => the same idempotency key yields the same address.
    const salt = createHash('sha256').update(`sideband-open:${p.idempotencyKey}`).digest();
    const channelId = await this.c.client.deploy({
      wasmHash: this.c.wasmHash,
      salt,
      source: payer,
    });
    const existing = await this.c.client.readChannel(channelId).catch(() => undefined);
    if (existing) {
      // Already deployed AND initialized by an earlier attempt: idempotent.
      return {
        binding: bindingFromScVal(channelId, this.c.networkPassphrase, existing),
        txRef: `existing:${channelId}`,
        synthetic: false,
      };
    }
    const r = await this.call(
      channelId,
      'init',
      [
        new Address(p.asset).toScVal(),
        new Address(p.payer).toScVal(),
        new Address(p.provider).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(key)),
        nativeToScVal(p.deposit, { type: 'i128' }),
        nativeToScVal(p.expiresAt, { type: 'u64' }),
      ],
      payer,
    );
    const binding = await this.getBinding(channelId);
    if (!binding) throw new ChannelError('not_found', 'Channel not readable after init');
    return { binding, ...this.receipt(r) };
  }

  async getBinding(channelId: string): Promise<ChannelBinding | undefined> {
    const v = await this.c.client.readChannel(channelId);
    return v ? bindingFromScVal(channelId, this.c.networkPassphrase, v) : undefined;
  }

  private async settle(channelId: string, method: 'close' | 'refund', args: xdr.ScVal[]) {
    const b = await this.getBinding(channelId);
    if (!b) throw new ChannelError('not_found', 'Unknown channel');
    if (b.status !== 'open') throw new ChannelError('already_settled', `Channel is ${b.status}`);
    const source = this.signer(method === 'close' ? b.provider : b.payer);
    const r = await this.call(channelId, method, args, source);
    // SUCCESS only means the transaction applied; read the final state back.
    const after = await this.getBinding(channelId);
    if (!after || after.status === 'open') {
      throw new SubmissionTimeoutError(r.hash, 'Applied but state not yet visible');
    }
    return {
      ...this.receipt(r),
      toProvider: after.settledToProvider ?? 0n,
      toPayer: after.refundedToPayer ?? 0n,
    } satisfies SettleResult;
  }

  async findTransaction(txHash: string): Promise<TxLookup> {
    return this.c.client.getTransaction(txHash);
  }

  close(channelId: string, voucher: Voucher): Promise<SettleResult> {
    return this.settle(channelId, 'close', [
      nativeToScVal(parseAmount(voucher.cumulativeAmount), { type: 'i128' }),
      xdr.ScVal.scvBytes(Buffer.from(voucher.signature, 'hex')),
    ]);
  }

  refund(channelId: string): Promise<SettleResult> {
    return this.settle(channelId, 'refund', []);
  }
}

/** Real client over a Soroban RPC server. Unverified against a live network. */
export class RpcSorobanClient implements SorobanClient {
  constructor(
    private readonly server: Pick<
      rpc.Server,
      'getAccount' | 'simulateTransaction' | 'sendTransaction' | 'getTransaction'
    >,
    private readonly networkPassphrase: string,
    private readonly readSource: string,
    private readonly pollMs = 1000,
    private readonly maxPolls = 30,
  ) {
    assertAllowedNetwork(networkPassphrase);
  }

  private async build(source: string, op: xdr.Operation) {
    const acct = await this.server.getAccount(source);
    return new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();
  }

  async readChannel(contractId: string): Promise<xdr.ScVal | undefined> {
    const tx = await this.build(
      this.readSource,
      Operation.invokeContractFunction({ contract: contractId, function: 'get', args: [] }),
    );
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      if (/Error\(Contract, #2\)|non-existent|not found|MissingValue/i.test(sim.error)) {
        return undefined;
      }
      throw mapContractError(sim.error);
    }
    return sim.result?.retval;
  }

  private async submit(source: Keypair, op: xdr.Operation): Promise<InvokeResult> {
    const raw = await this.build(source.publicKey(), op);
    const sim = await this.server.simulateTransaction(raw);
    if (rpc.Api.isSimulationError(sim)) throw mapContractError(sim.error);
    const tx = rpc.assembleTransaction(raw, sim).build();
    tx.sign(source);
    const hash = Buffer.from(tx.hash()).toString('hex'); // known BEFORE submission
    let send;
    try {
      send = await this.server.sendTransaction(tx);
    } catch {
      throw new SubmissionTimeoutError(hash, 'sendTransaction failed; outcome unknown');
    }
    if (send.status === 'ERROR') {
      return {
        hash,
        status: 'FAILED',
        ledger: 0,
        errorMessage: 'sendTransaction rejected (status ERROR)',
      };
    }
    for (let i = 0; i < this.maxPolls; i++) {
      let got;
      try {
        got = await this.server.getTransaction(hash);
      } catch {
        got = undefined;
      }
      if (got?.status === 'SUCCESS') {
        return {
          hash,
          status: 'SUCCESS',
          ledger: got.ledger,
          ...(got.returnValue ? { returnValue: got.returnValue } : {}),
        };
      }
      if (got?.status === 'FAILED') {
        return {
          hash,
          status: 'FAILED',
          ledger: got.ledger,
          errorMessage: 'transaction failed on-chain',
        };
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    // NOT_FOUND after the polling budget: unknown, never "failed".
    throw new SubmissionTimeoutError(hash);
  }

  async getTransaction(hash: string) {
    try {
      const g = await this.server.getTransaction(hash);
      return g.status === 'SUCCESS' || g.status === 'FAILED'
        ? { status: g.status, ledger: g.ledger }
        : { status: 'NOT_FOUND' as const };
    } catch {
      return { status: 'NOT_FOUND' as const }; // unreachable RPC => unknown
    }
  }

  async deploy(a: { wasmHash: Uint8Array; salt: Uint8Array; source: Keypair }): Promise<string> {
    const r = await this.submit(
      a.source,
      Operation.createCustomContract({
        address: new Address(a.source.publicKey()),
        wasmHash: Buffer.from(a.wasmHash),
        salt: Buffer.from(a.salt),
      }),
    );
    if (r.status !== 'SUCCESS' || !r.returnValue) {
      throw mapContractError(r.errorMessage ?? 'deploy failed');
    }
    return Address.fromScVal(r.returnValue).toString();
  }

  invoke(a: {
    contractId: string;
    method: string;
    args: xdr.ScVal[];
    source: Keypair;
  }): Promise<InvokeResult> {
    return this.submit(
      a.source,
      Operation.invokeContractFunction({
        contract: a.contractId,
        function: a.method,
        args: a.args,
      }),
    );
  }
}
