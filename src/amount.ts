/**
 * Fixed-point amounts: 7 fractional digits (stroops), stored as bigint.
 * Mirrors `Amount` in sideband-protocol (Dart): same grammar, same canonical
 * string. No floats anywhere.
 */
export const SCALE = 7;
const UNIT = 10n ** BigInt(SCALE);
/** Voucher amounts are encoded as i128 in the contract; keep below 2^127. */
export const MAX_STROOPS = (1n << 127n) - 1n;

const AMOUNT_RE = /^(\d{1,18})(?:\.(\d{1,7}))?$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

/** Parses a non-negative decimal string like `0.0010` into stroops. */
export function parseAmount(s: string): bigint {
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new AmountError(`Invalid amount: ${JSON.stringify(s)}`);
  const whole = BigInt(m[1] as string);
  const frac = BigInt((m[2] ?? '').padEnd(SCALE, '0'));
  return whole * UNIT + frac;
}

/** Canonical string, identical to Dart `Amount.toString()`. */
export function formatAmount(stroops: bigint): string {
  if (stroops < 0n) throw new AmountError('Amount cannot be negative');
  const whole = stroops / UNIT;
  const frac = (stroops % UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}` : `${whole}.${frac}`;
}
