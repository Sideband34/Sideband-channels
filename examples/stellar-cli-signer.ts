/**
 * Custom `VoucherSigner` example backed by the `stellar-cli` keystore.
 *
 * The SDK (`createVoucher`, `signVoucher`, `SorobanChannelAdapter`, `RpcSorobanClient`)
 * only ever interacts with `{ publicKey(), sign(bytes) }` and never receives secret
 * material: `sign(bytes)` sees only the commitment preimage (or transaction hash)
 * bytes it is asked to sign.
 *
 * Run offline with a synthetic keystore stub (no chain, no real keys):
 *   npx tsx examples/stellar-cli-signer.ts
 *
 * Run against a local `stellar-cli` Testnet identity:
 *   STELLAR_IDENTITY=sideband-payer npx tsx examples/stellar-cli-signer.ts
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Keypair } from '@stellar/stellar-sdk';
import {
  InMemoryChannelAdapter,
  InMemoryVoucherStore,
  NETWORK_PASSPHRASES,
  acceptVoucher,
  signVoucher,
  verifyVoucher,
  type AsyncVoucherSigner,
} from '../src/index.js';

const execFile = promisify(execFileCb);

export interface KeystoreDriver {
  address(identity: string): Promise<string>;
  sign(identity: string, bytes: Uint8Array): Promise<Uint8Array>;
}

/**
 * Default `stellar-cli` keystore driver (`stellar keys address` / `stellar keys secret-key`).
 * Secret material stays confined inside the driver call and is zeroed immediately after signing;
 * callers and the Sideband SDK only ever hold the `VoucherSigner` handle.
 */
export function defaultStellarCliDriver(stellarBin = 'stellar'): KeystoreDriver {
  return {
    async address(identity: string): Promise<string> {
      const { stdout } = await execFile(stellarBin, ['keys', 'address', identity]);
      return stdout.trim();
    },
    async sign(identity: string, bytes: Uint8Array): Promise<Uint8Array> {
      let stdout: string;
      try {
        ({ stdout } = await execFile(stellarBin, ['keys', 'secret-key', identity]));
      } catch {
        // Older stellar-cli releases spell the subcommand `stellar keys show`.
        ({ stdout } = await execFile(stellarBin, ['keys', 'show', identity]));
      }
      const kp = Keypair.fromSecret(stdout.trim());
      try {
        return new Uint8Array(kp.sign(Buffer.from(bytes)));
      } finally {
        kp.rawSecretKey().fill(0);
      }
    },
  };
}

/**
 * Creates an {@link AsyncVoucherSigner} bound to a named `stellar-cli` identity.
 * Resolves the `G...` public key once up front so `publicKey()` is synchronous.
 */
export async function createStellarCliSigner(
  identity: string,
  driver: KeystoreDriver = defaultStellarCliDriver(),
): Promise<AsyncVoucherSigner> {
  const pub = await driver.address(identity);
  return {
    publicKey: () => pub,
    async sign(bytes: Uint8Array): Promise<Uint8Array> {
      return await driver.sign(identity, bytes);
    },
  };
}

/** Synthetic in-memory keystore driver for offline demos and tests (worthless test seed). */
function syntheticKeystoreDriver(): KeystoreDriver {
  const identities = new Map<string, Keypair>([
    ['demo-payer', Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11))],
  ]);
  return {
    async address(identity: string): Promise<string> {
      const kp = identities.get(identity);
      if (!kp) throw new Error(`Unknown synthetic identity: ${identity}`);
      return kp.publicKey();
    },
    async sign(identity: string, bytes: Uint8Array): Promise<Uint8Array> {
      const kp = identities.get(identity);
      if (!kp) throw new Error(`Unknown synthetic identity: ${identity}`);
      return new Uint8Array(kp.sign(Buffer.from(bytes)));
    },
  };
}

async function main() {
  const liveIdentity = process.env.STELLAR_IDENTITY;
  const payerSigner = liveIdentity
    ? await createStellarCliSigner(liveIdentity)
    : await createStellarCliSigner('demo-payer', syntheticKeystoreDriver());

  const providerAddress = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12)).publicKey();
  const clock = { t: 1_000 };
  const adapter = new InMemoryChannelAdapter(() => clock.t);
  const stroops = 10_000_000n;

  const { binding } = await adapter.open({
    networkPassphrase: NETWORK_PASSPHRASES.testnet,
    payer: payerSigner.publicKey(),
    provider: providerAddress,
    asset: 'TEST-TOKEN',
    deposit: 10n * stroops,
    expiresAt: 5_000,
    idempotencyKey: 'custom-signer-demo',
  });

  const voucher = await signVoucher(payerSigner, binding, 2n * stroops);
  const verified = verifyVoucher(binding, voucher);
  const store = new InMemoryVoucherStore();
  const accepted = await acceptVoucher(
    binding,
    {
      deposit: binding.deposit,
      maxSpend: 5n * stroops,
      expiresAt: binding.expiresAt,
      now: () => clock.t,
    },
    store,
    voucher,
  );

  console.log('signer publicKey:', payerSigner.publicKey());
  console.log('voucher verified:', verified);
  console.log('voucher accepted:', accepted);
}

if (process.argv[1]?.endsWith('stellar-cli-signer.ts')) {
  await main();
}
