// Full UI flow against an isolated local EVM. Never reads the supplied deployment key.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BrowserProvider, ContractFactory, Contract } from 'ethers';

const root = path.resolve(import.meta.dirname, '../..');
const contractRequire = createRequire(path.join(root, 'contracts/package.json'));
const ganache = contractRequire('ganache');
const evm = ganache.provider({ logging: { quiet: true }, chain: { chainId: 46630 }, wallet: { totalAccounts: 3 } });
const provider = new BrowserProvider(evm, 46630);
const signer = await provider.getSigner();
const address = await signer.getAddress();
const artifact = JSON.parse(await fs.readFile(path.join(root, 'contracts/artifacts/PostRewardEscrow.json'), 'utf8'));
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
await contract.waitForDeployment();
const deployedAddress = await contract.getAddress();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', e => browserErrors.push(e.message));
await page.exposeFunction('__walletRpc', async ({ method, params }) => {
  try { return { result: await evm.request({ method, params: params ?? [] }) }; }
  catch (e) { return { error: { message: e.message, code: e.code ?? -32603 } }; }
});
await page.addInitScript(() => {
  const listeners = new Map();
  window.__testWallet = { chainId: '0x1', reject: false, switched: false };
  const provider = {
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' && window.__testWallet.reject) { window.__testWallet.reject = false; throw Object.assign(new Error('User rejected'), { code: 4001 }); }
      if (method === 'eth_chainId') return window.__testWallet.chainId;
      if (method === 'wallet_switchEthereumChain') { window.__testWallet.chainId = params[0].chainId; window.__testWallet.switched = true; for (const fn of listeners.get('chainChanged') ?? []) fn(params[0].chainId); return null; }
      const answer = await window.__walletRpc({ method: method === 'eth_requestAccounts' ? 'eth_accounts' : method, params });
      if (answer.error) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
      return answer.result;
    },
    on: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    removeListener: (name, fn) => listeners.set(name, (listeners.get(name) ?? []).filter(x => x !== fn)),
  };
  window.ethereum = provider;
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'local-qa-wallet', name: 'QA local wallet' }, provider } })));
});
await page.route('**/deployment.json', route => route.fulfill({ json: { address: deployedAddress, chainId: 46630 } }));
await page.route('https://rpc.testnet.chain.Solana.com/**', async route => {
  const body = route.request().postDataJSON();
  const handle = async request => {
    try { return { id: request.id, jsonrpc: '2.0', result: await evm.request({ method: request.method, params: request.params ?? [] }) }; }
    catch (e) { return { id: request.id, jsonrpc: '2.0', error: { code: e.code ?? -32603, message: e.message } }; }
  };
  await route.fulfill({ json: Array.isArray(body) ? await Promise.all(body.map(handle)) : await handle(body), headers: { 'access-control-allow-origin': '*' } });
});

try {
  await page.goto(process.env.QA_URL ?? 'http://127.0.0.1:5177', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.evaluate(() => { window.__testWallet.reject = true; });
  await page.getByRole('button', { name: 'QA local wallet' }).click();
  await page.getByRole('alert').filter({ hasText: 'cancelled' }).waitFor();
  await page.getByRole('button', { name: 'QA local wallet' }).click();
  await page.getByRole('button', { name: 'Wallet pilot', exact: true }).click();
  await page.getByLabel('X post URL', { exact: true }).fill('https://x.com/qa/status/123456789');
  await page.getByLabel('Creator鈥檚 wallet address').fill('0x0');
  await page.getByRole('button', { name: 'Send reward', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'valid, non-zero' }).waitFor();
  await page.getByLabel('Creator鈥檚 wallet address').fill(address);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send reward', exact: true }).click();
  await page.getByText('Reward #1 is funded.', { exact: false }).waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__testWallet.switched), true, 'wrong chain was switched');
  assert.equal((await contract.rewards(1)).status, 1n);
  await page.getByLabel('Reward ID', { exact: true }).fill('999');
  await page.getByRole('button', { name: 'Copy receipt', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /reward=1$/, 'receipt bound to loaded ID');
  await page.getByRole('button', { name: 'Claim reward', exact: true }).click();
  await page.getByText('Reward claimed. The test ETH is in your wallet.').waitFor({ timeout: 30000 });
  assert.equal((await contract.rewards(1)).status, 2n, 'claim targets loaded reward, not edited input');

  // Second complete loop: UI creates, local EVM advances, UI refunds.
  await page.getByRole('tab', { name: 'Send a reward' }).click();
  await page.locator('.studio-dialog:not(.x-studio-dialog)').getByLabel('Claim window').selectOption('3600');
  await page.getByRole('button', { name: 'Send reward', exact: true }).click();
  await page.getByText('Reward #2 is funded.', { exact: false }).waitFor({ timeout: 30000 });
  await evm.request({ method: 'evm_increaseTime', params: [3602] });
  await evm.request({ method: 'evm_mine', params: [] });
  await page.getByRole('button', { name: 'Refresh receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Refund to sender', exact: true }).click();
  await page.getByText('Reward refunded to the original sender.').waitFor({ timeout: 30000 });
  assert.equal((await contract.rewards(2)).status, 3n);
  assert.equal(await contract.totalEscrowed(), 0n);
  await page.getByLabel('Reward ID', { exact: true }).fill('999');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('alert').filter({ hasText: 'No reward exists' }).waitFor();
  await page.getByRole('button', { name: 'Close reward studio' }).click();
  await page.getByRole('button', { name: /0x.*鈥? }).click();
  await page.getByRole('button', { name: 'Disconnect from Voxaura' }).click();
  assert.equal(await page.getByRole('button', { name: 'Connect wallet', exact: true }).isVisible(), true);
  assert.deepEqual(browserErrors, []);
  console.log('PASS: browser EIP-6963 discovery, rejected connection, retry, wrong-chain switch, invalid recipient, create, receipt identity, claim, refund, unknown ID and disconnect. Isolated local EVM; no supplied key used.');
} finally {
  await browser.close();
  await provider.destroy();
  await evm.disconnect();
}

