import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildVectors } from '../scripts/gen-fixtures.js';
import { NETWORK_PASSPHRASES, verifyVoucher } from '../src/index.js';

const committed = JSON.parse(readFileSync('fixtures/voucher-vectors.json', 'utf8'));

describe('golden voucher vectors', () => {
  it('committed fixture equals regenerated output (format drift guard)', () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildVectors())));
  });
  it('every vector verifies against its domain', () => {
    const domain = {
      networkPassphrase: NETWORK_PASSPHRASES.testnet,
      channelId: committed.channelId,
      payer: committed.payer,
      provider: committed.provider,
    };
    for (const v of committed.vectors) {
      const r = verifyVoucher(domain, {
        channelRef: committed.channelId,
        cumulativeAmount: v.cumulativeAmount,
        commitment: v.commitment,
        signature: v.signature,
      });
      expect(r.ok).toBe(true);
    }
  });
});
