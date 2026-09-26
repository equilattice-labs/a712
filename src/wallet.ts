import { ref, shallowRef } from 'vue'
import { BrowserProvider, formatEther } from 'ethers'
import { chain, CHAIN_ID } from './lib'

export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
}
export type WalletOption = { id: string; name: string; provider: InjectedProvider }
declare global { interface Window { ethereum?: InjectedProvider } }

export const walletAddress = ref('')
export const walletBalance = ref('')
export const walletChain = ref(0)
export const wallets = shallowRef<WalletOption[]>([])
let selected: InjectedProvider | undefined
const accountsChanged = (accounts: string[]) => { walletAddress.value = accounts[0] ?? ''; void refreshWallet() }
const chainChanged = (id: string) => { walletChain.value = Number(id); void refreshWallet() }

export function discoverWallets() {
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
    const { info, provider } = event.detail ?? {}
    if (!info?.uuid || !provider?.request || wallets.value.some(w => w.id === info.uuid)) return
    wallets.value = [...wallets.value.filter(w => w.id !== 'injected'), { id: info.uuid, name: String(info.name).slice(0, 40), provider }]
  }) as EventListener)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  if (window.ethereum && !wallets.value.length) wallets.value = [{ id: 'injected', name: 'Browser wallet', provider: window.ethereum }]
}

export async function refreshWallet() {
  if (!selected || !walletAddress.value) { walletBalance.value = ''; return }
  try {
    walletChain.value = Number(await selected.request({ method: 'eth_chainId' }))
    if (walletChain.value === CHAIN_ID) {
      const provider = new BrowserProvider(selected)
      walletBalance.value = Number(formatEther(await provider.getBalance(walletAddress.value))).toFixed(6)
    } else walletBalance.value = ''
  } catch { walletBalance.value = '' }
}

export async function connectWallet(option: WalletOption) {
  const accounts = await option.provider.request({ method: 'eth_requestAccounts' }) as string[]
  if (!accounts[0]) throw new Error('Your wallet did not return an account.')
  disconnectWallet()
  selected = option.provider
  walletAddress.value = accounts[0]
  selected.on?.('accountsChanged', accountsChanged)
  selected.on?.('chainChanged', chainChanged)
  await refreshWallet()
}

export function disconnectWallet() {
  selected?.removeListener?.('accountsChanged', accountsChanged)
  selected?.removeListener?.('chainChanged', chainChanged)
  selected = undefined
  walletAddress.value = ''; walletBalance.value = ''; walletChain.value = 0
}

export async function walletSigner() {
  if (!selected || !walletAddress.value) throw new Error('Connect your wallet to continue.')
  if (Number(await selected.request({ method: 'eth_chainId' })) !== CHAIN_ID) {
    try { await selected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainId }] }) }
    catch (e: any) {
      if (e.code === 4902 || e.data?.originalError?.code === 4902) {
        await selected.request({ method: 'wallet_addEthereumChain', params: [chain] })
        await selected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainId }] })
      } else throw e
    }
  }
  await refreshWallet()
  if (walletChain.value !== CHAIN_ID) throw new Error('Switch your wallet to Robinhood Chain Testnet to continue.')
  const provider = new BrowserProvider(selected, CHAIN_ID)
  return provider.getSigner(walletAddress.value)
}


