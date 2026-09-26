import test from 'node:test';
import assert from 'node:assert/strict';
import { noteLength, validPublicNote, rewardAmounts, parseRewardAmount, normalizeReward, rewardStatus, displayAmount } from '../src/rewards-v2.ts';

test('native and 6-decimal token fee amounts conserve value without floating-point loss', () => {
  const token = parseRewardAmount('10.000001', 'tUSD');
  const split = rewardAmounts(token);
  assert.equal(token, 10000001n);
  assert.equal(split.fee, 300000n);
  assert.equal(split.creator, 9700001n);
  assert.equal(split.fee + split.creator, token);
  assert.equal(displayAmount(split.creator, 'tUSD'), '9.700001');
  const eth = parseRewardAmount('0.000000000000000001', 'ETH');
  assert.deepEqual(rewardAmounts(eth), { gross: 1n, fee: 0n, creator: 1n });
});

test('amount validation rejects unsupported precision and misleading numeric formats', () => {
  for (const value of ['0', '-1', '1e2', '0x10', '1,000', '.1', 'NaN', 'Infinity', '00.1', '1000.000001']) assert.throws(() => parseRewardAmount(value, 'tUSD'), value);
  assert.throws(() => parseRewardAmount('0.0000001', 'tUSD'));
  assert.throws(() => parseRewardAmount('0.100000000000000001', 'ETH'));
  assert.equal(parseRewardAmount(' 0.1 ', 'ETH'), 100000000000000000n);
});

test('public notes count Unicode characters and reject invalid scalar values', () => {
  const emoji = '🌟'.repeat(140);
  assert.equal(noteLength(emoji), 140);
  assert.equal(validPublicNote(emoji), true);
  assert.equal(validPublicNote(emoji + 'a'), false);
  assert.equal(validPublicNote('\ud800'), false);
  assert.equal(validPublicNote('Useful research. Thank you.'), true);
});

test('receipt normalization preserves large integer amounts and expiry boundary', () => {
  const record = normalizeReward({ id: '42', payer: '0x0000000000000000000000000000000000000001', token: '0x0000000000000000000000000000000000000000', amount: '999999999999999999', expiresAt: 2000, status: 1, postId: '123', authorId: '456', note: 'Thanks' });
  assert.equal(record.amount, 999999999999999999n);
  assert.equal(rewardStatus(record, 1999), 'Awaiting author');
  assert.equal(rewardStatus(record, 2000), 'Refund available');
  assert.equal(rewardStatus({ ...record, status: 2 }, 3000), 'Claimed');
  assert.throws(() => normalizeReward({ ...record, token: 'wrong' }));
});

