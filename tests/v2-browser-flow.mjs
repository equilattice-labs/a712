// Real local contracts + real local API verification logic; only X identity responses are mocked.
// This test never reads key.txt and never contacts X or a remote chain for transactions.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BrowserProvider, ContractFactory, Wallet, getBytes, ZeroAddress } from 'ethers';
import { createApp } from '../../server/src/app.mjs';
import { createV2Chain } from '../../server/src/v2-chain.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const requireContracts = createRequire(path.join(root, 'contracts/package.json'));
const ganache = requireContracts('ganache');
const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 46630 }, wallet: { totalAccounts: 5 } });
const provider = new BrowserProvider(rpc, 46630);
provider.pollingInterval = 100;
const locals = Object.entries(rpc.getInitialAccounts()).map(([address, data]) => ({ address, wallet: new Wallet(data.secretKey, provider) }));
const payer = await provider.getSigner(0), relayer = locals[2].wallet, feeRecipient = locals[3].address;
const attestor = Wallet.createRandom();
const tokenArtifact = JSON.parse(await fs.readFile(path.join(root, 'contracts/artifacts/MockUSD.json'), 'utf8'));
const rewardArtifact = JSON.parse(await fs.readFile(path.join(root, 'contracts/artifacts/VoxdueRewards.json'), 'utf8'));
const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, payer).deploy();
await token.waitForDeployment();
const contract = await new ContractFactory(rewardArtifact.abi, rewardArtifact.bytecode, payer).deploy(attestor.address, feeRecipient, await token.getAddress());
await contract.waitForDeployment();
const deployment = {
  address: await contract.getAddress(), network: { chainId: 46630 },
  abi: rewardArtifact.abi, feeBps: 300, expirySeconds: 7776000,
  token: { address: await token.getAddress(), symbol: 'tUSD', decimals: 6, abi: tokenArtifact.abi },
  domain: { name: 'Voxdue Rewards', version: '2', chainId: 46630, verifyingContract: await contract.getAddress() },
  claimTypes: { Claim: [{ name: 'rewardId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'deadline', type: 'uint64' }] },
};
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'Meritiva-v2-qa-'));
const chain = createV2Chain({ deployment, provider, attestor, relayer, budgetFile: path.join(testDir, 'budget.json'), maxDailyWei: 10n ** 18n, maxTransactionWei: 10n ** 18n });
const origin = process.env.QA_URL ?? 'http://127.0.0.1:5177';
let authorId = '42';
const xClient = {
  authorizationUrl: (state, challenge) => `https://x.example.test/authorize?state=${state}&code_challenge=${challenge}`,
  exchange: async () => ({ id: authorId, username: 'qa_author', name: 'QA Author (mock identity)' }),
  getPost: async postId => ({ postId, authorId: '42', username: 'qa_author', text: 'A useful post used only for isolated local QA.' }),
};
const app = createApp({ origin, enabled: true, xClient, chain, v2: { enabled: true, relayEnabled: true, deployment, chain }, maxRequests: 10000 });
const apiServer = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

async function mockLogin(id = '42') {
  authorId = id;
  const start = await fetch(`${apiOrigin}/api/auth/x/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const initialCookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await fetch(`${apiOrigin}/api/auth/x/callback?state=${state}&code=mock-only-code`, { redirect: 'manual', headers: { cookie: initialCookie } });
  assert.equal(callback.status, 302);
  const sessionCookie = callback.headers.get('set-cookie').split(';')[0];
  const [name, value] = sessionCookie.split('=');
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: 'Lax' }]);
}
await mockLogin();
await page.exposeFunction('__walletRpc', async ({ method, params }, index) => {
  try {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return { result: [locals[index].address] };
    if (method === 'personal_sign') return { result: await locals[index].wallet.signMessage(getBytes(params[0])) };
    return { result: await rpc.request({ method, params: params ?? [] }) };
  } catch (e) { return { error: { message: e.message, code: e.code ?? -32603 } }; }
});
await page.addInitScript(() => {
  const handlers = new Map();
  window.__qaWalletIndex = 0;
  window.__qaWalletSet = index => { window.__qaWalletIndex = index; window.__walletRpc({ method: 'eth_accounts' }, index).then(({ result }) => (handlers.get('accountsChanged') ?? []).forEach(f => f(result))); };
  const provider = {
    request: async args => { const r = await window.__walletRpc(args, window.__qaWalletIndex); if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.result; },
    on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]),
    removeListener: (n, f) => handlers.set(n, (handlers.get(n) ?? []).filter(x => x !== f)),
  };
  window.ethereum = provider;
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'v2-qa-wallet', name: 'Local QA wallet' }, provider } })));
});
await page.route('**/v2-deployment.json', route => route.fulfill({ json: deployment }));
await page.route('**/api/**', async route => {
  const original = new URL(route.request().url());
  const response = await route.fetch({ url: apiOrigin + original.pathname + original.search });
  await route.fulfill({ response });
});
await page.route('https://rpc.testnet.chain.robinhood.com/**', async route => {
  const body = route.request().postDataJSON();
  const handle = async req => {
    try { return { id: req.id, jsonrpc: '2.0', result: await rpc.request({ method: req.method, params: req.params ?? [] }) }; }
    catch (e) { return { id: req.id, jsonrpc: '2.0', error: { code: e.code ?? -32603, message: e.message } }; }
  };
  await route.fulfill({ json: Array.isArray(body) ? await Promise.all(body.map(handle)) : await handle(body), headers: { 'access-control-allow-origin': '*' } });
});

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('header').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Local QA wallet' }).click();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  const dialog = page.locator('dialog:visible');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Get 1,000 tUSD' }).click();
  await page.waitForFunction(() => document.querySelector('.ra-balance-card')?.textContent?.includes('1000.0'));
  await dialog.getByLabel('Post URL', { exact: true }).fill('https://x.com/qa_author/status/123456789');
  await dialog.getByRole('button', { name: 'Find author', exact: true }).click();
  await dialog.locator('.ra-post-preview').waitFor();
  await dialog.getByLabel('A little note', { exact: false }).fill('\u{1F331}'.repeat(141));
  assert.equal(await dialog.getByRole('button', { name: 'Approve & fund reward', exact: true }).isDisabled(), true);
  await dialog.getByLabel('A little note', { exact: false }).fill('\u{1F331}'.repeat(140));
  assert.equal(await dialog.getByRole('button', { name: 'Approve & fund reward', exact: true }).isDisabled(), false);
  await dialog.getByLabel('A little note', { exact: false }).fill('A helpful explanation. Thank you!');
  await dialog.locator('form').getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Approve & fund reward', exact: true }).click();
  await dialog.locator('.ra-receipt-id').filter({ hasText: '#1' }).waitFor({ timeout: 30000 });
  assert.equal((await contract.rewards(1)).amount, 10000000n);
  assert.equal(await token.allowance(locals[0].address, deployment.address), 0n, 'exact token allowance consumed');
  await page.evaluate(() => window.__qaWalletSet(1));
  await dialog.locator('.ra-wallet').filter({ hasText: locals[1].address.slice(0, 6) }).waitFor();
  await dialog.getByRole('button', { name: /Verify wallet & claim.*gas covered/ }).click();
  await dialog.getByText('Reward claimed. The creator receives 97%; the 3% protocol fee is settled onchain.').waitFor({ timeout: 30000 });
  assert.equal(await token.balanceOf(locals[1].address), 9700000n);
  assert.equal(await token.balanceOf(feeRecipient), 300000n);
  assert.equal((await contract.rewards(1)).status, 2n);
  await dialog.getByRole('tab', { name: 'Received', exact: true }).click();
  await dialog.locator('.ra-reward-row').filter({ hasText: 'Reward #1' }).waitFor();

  // Native funding and self-paid claim, still using the real backend wallet proof and EIP-712 authorization.
  await page.evaluate(() => window.__qaWalletSet(0));
  await dialog.getByRole('tab', { name: 'Send a reward', exact: true }).click();
  await dialog.getByRole('button', { name: /Test ETH.*Native testnet asset/ }).click();
  await dialog.getByRole('button', { name: 'Fund reward', exact: true }).click();
  await dialog.locator('.ra-receipt-id').filter({ hasText: '#2' }).waitFor({ timeout: 30000 });
  await page.evaluate(() => window.__qaWalletSet(1));
  await dialog.locator('.ra-wallet').filter({ hasText: locals[1].address.slice(0, 6) }).waitFor();
  await dialog.getByLabel('Use sponsored claim gas.', { exact: false }).uncheck();
  await dialog.getByLabel('Open a receipt', { exact: true }).fill('999');
  await dialog.getByRole('button', { name: 'Copy receipt', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /v2Reward=2$/);
  await dialog.getByRole('button', { name: 'Verify wallet & claim', exact: true }).click();
  await dialog.getByText('Reward claimed. The creator receives 97%; the 3% protocol fee is settled onchain.').waitFor({ timeout: 30000 });
  assert.equal((await contract.rewards(2)).status, 2n);
  assert.equal(await contract.totalClaimed(ZeroAddress), 970000000000000n);
  assert.equal(await contract.totalFees(ZeroAddress), 30000000000000n);

  // A full refund after a local 90-day time advance, without X identity dependency.
  await page.evaluate(() => window.__qaWalletSet(0));
  await dialog.getByRole('button', { name: /tUSD.*Mock dollar/ }).click();
  await dialog.getByLabel('Reward amount', { exact: true }).fill('12');
  await dialog.getByRole('button', { name: 'Approve & fund reward', exact: true }).click();
  await dialog.locator('.ra-receipt-id').filter({ hasText: '#3' }).waitFor({ timeout: 30000 });
  await rpc.request({ method: 'evm_increaseTime', params: [90 * 86400 + 1] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await dialog.getByLabel('Open a receipt', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Look up reward receipt', exact: true }).click();
  await dialog.getByRole('button', { name: 'Refund full reward', exact: true }).click();
  await dialog.getByText('The full reward was refunded to its sender. No protocol fee was charged.').waitFor({ timeout: 30000 });
  assert.equal((await contract.rewards(3)).status, 3n);
  assert.equal(await token.balanceOf(locals[0].address), 990000000n);
  assert.equal(await contract.totalEscrowed(deployment.token.address), 0n);
  assert.equal(await contract.totalEscrowed(ZeroAddress), 0n);
  await dialog.getByRole('tab', { name: 'Sent', exact: true }).click();
  await dialog.locator('.ra-reward-row').filter({ hasText: 'Reward #3' }).waitFor();
  await dialog.getByRole('tab', { name: 'Activity', exact: true }).click();
  await dialog.locator('.ra-reward-row').filter({ hasText: 'Reward #2' }).waitFor();
  assert.equal(await dialog.locator('.ra-reward-row').count(), 3);
  const output = { checkedAt: new Date().toISOString(), result: 'PASS', network: 'isolated local EVM chain 46630', identity: 'mock X responses; real server OAuth/session/proof/attestation code', tests: ['tUSD faucet', 'exact token approval and funding', '140-character public note UI', 'distinct creator wallet', 'server-sponsored token claim', '97/3 token split', 'received feed', 'native funding', 'self-paid native claim', 'loaded receipt ID binding', '90-day full token refund', 'sent feed', 'public activity', 'zero outstanding escrow'], realXLogin: false, userKeyRead: false };
  await fs.writeFile(path.join(root, 'qa/v2-browser-flow.json'), JSON.stringify(output, null, 2) + '\n');
  console.log('PASS: V2 faucet, exact approval, token/native funding, real backend wallet proofs and authorizations, sponsored/self-paid claims, 97/3 payouts, full 90-day refund, receipts and filtered feeds. X identity mocked; isolated local EVM.');
  assert.deepEqual(errors, []);
} finally {
  // Allow in-flight API proxy callbacks to finish before disposing their request context.
  await page.unrouteAll({ behavior: 'wait' });
  await browser.close();
  await new Promise(resolve => apiServer.close(resolve));
  provider.destroy();
  await rpc.disconnect();
  const resolvedTemp = path.resolve(testDir);
  if (path.dirname(resolvedTemp).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(resolvedTemp).startsWith('Meritiva-v2-qa-')) throw new Error('Refusing cleanup outside the verified QA temp directory.');
  await fs.rm(resolvedTemp, { recursive: true, force: true });
}
