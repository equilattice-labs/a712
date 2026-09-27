export const CHAIN_ID = 46630
export const RPC = 'https://rpc.testnet.chain.robinhood.com'
export const EXPLORER = 'https://explorer.testnet.chain.robinhood.com'
export const chain = {
  chainId: '0xb626', chainName: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [RPC], blockExplorerUrls: [EXPLORER],
}

export function parsePostUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return ''
    return url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,30})\/?$/)?.[1] ?? ''
  } catch { return '' }
}

export function shortAddress(address: string) { return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '' }
export function friendlyError(error: unknown): string {
  const e = error as { code?: string | number; shortMessage?: string; message?: string; info?: { error?: { code?: number } } }
  if (e.code === 'ACTION_REJECTED' || e.code === 4001 || e.info?.error?.code === 4001) return 'Request cancelled in your wallet. Nothing was submitted.'
  if (e.code === 'INSUFFICIENT_FUNDS') return 'You need more test ETH for this reward and network gas. Use the testnet faucet.'
  if (e.code === 'NETWORK_ERROR') return 'The network changed. Reconnect your wallet and try again.'
  if (e.code === 'CALL_EXCEPTION') return 'The contract rejected this action. Refresh the reward and check its recipient, status, and expiry.'
  return (e.shortMessage || e.message || 'Something went wrong. Please try again.').slice(0, 220)
}
