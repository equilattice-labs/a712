import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostUrl, friendlyError } from '../src/lib.ts';

test('accepts canonical X and legacy Twitter status links with query metadata', () => {
  assert.equal(parsePostUrl('https://x.com/creator/status/1836000000000000001?s=20'), '1836000000000000001');
  assert.equal(parsePostUrl('https://twitter.com/creator_123/status/123/'), '123');
});
test('rejects misleading hosts, unsupported protocols, incomplete IDs and non-status URLs', () => {
  for (const url of ['https://x.com.evil.test/a/status/123', 'https://x.com@evil.test/a/status/123', 'javascript:alert(1)', 'http://x.com/a/status/123', 'https://x.com/a/status/abc', 'https://x.com/a/status/123/photo/1', 'https://x.com/home', 'garbage']) {
    assert.equal(parsePostUrl(url), '', url);
  }
});
test('wallet rejection and insufficient funds give actionable, non-sensitive errors', () => {
  assert.match(friendlyError({ code: 'ACTION_REJECTED' }), /cancelled/);
  assert.match(friendlyError({ code: 'INSUFFICIENT_FUNDS' }), /test ETH/);
  assert.match(friendlyError({ code: 'CALL_EXCEPTION', data: 'private implementation detail' }), /contract rejected/);
  assert.ok(friendlyError({ message: 'a'.repeat(1000) }).length <= 220);
});
