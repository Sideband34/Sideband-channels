import { createHash } from 'node:crypto';

/** Well-known network passphrases (public constants, not secrets). */
export const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
  sandbox: 'Local Sandbox Stellar Network ; September 2022',
  standalone: 'Standalone Network ; February 2017',
  /** Listed ONLY so it can be refused; this project is Testnet/synthetic only. */
  public: 'Public Global Stellar Network ; September 2015',
} as const;

export type NetworkName = keyof typeof NETWORK_PASSPHRASES;

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Fails closed: unknown passphrases and the public network are refused. */
export function assertAllowedNetwork(passphrase: string): void {
  if (passphrase === NETWORK_PASSPHRASES.public) {
    throw new NetworkError('Public network is forbidden: Testnet/synthetic only');
  }
  const known = Object.values(NETWORK_PASSPHRASES) as string[];
  if (!known.includes(passphrase)) {
    throw new NetworkError('Unrecognized network passphrase');
  }
}

/** Stellar network id: SHA-256 of the passphrase. */
export function networkId(passphrase: string): Uint8Array {
  return createHash('sha256').update(passphrase, 'utf8').digest();
}
