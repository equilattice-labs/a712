<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Contract, Interface, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from 'ethers'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CircleCheck, Clock3, Copy, ExternalLink, Gift, Heart, Inbox, Link2, LoaderCircle, RefreshCw, Send, ShieldCheck, Sparkles, Wallet, X } from 'lucide-vue-next'
import { CHAIN_ID, EXPLORER, RPC, friendlyError, parsePostUrl, shortAddress } from '../lib'
import { refreshWallet, walletAddress, walletBalance, walletSigner } from '../wallet'
import { displayAmount, normalizeReward, noteLength, parseRewardAmount, rewardAmounts, rewardAsset, rewardStatus, validPublicNote, type RewardAsset, type RewardRecord } from '../rewards-v2'
import './rewards-app.css'

type Tab = 'send' | 'received' | 'sent' | 'activity'
type XUser = { id: string; username: string; name: string }
type Post = { postId: string; authorId: string; username: string; text: string }
type Deployment = { address: string; token: { address: string; decimals: number; symbol: string } }
const emit = defineEmits<{ connect: []; walletPilot: [] }>()
const dialog = ref<HTMLDialogElement>()
const tab = ref<Tab>('send')
const config = ref<Deployment | null>(null)
const setupBusy = ref(false)
const xEnabled = ref(false)
const relayEnabled = ref(false)
const user = ref<XUser | null>(null)
const csrf = ref('')
const busy = ref(false)
const operation = ref('')
const notice = ref('')
const error = ref('')
const txHash = ref('')
const postUrl = ref('')
const post = ref<Post | null>(null)
const resolving = ref(false)
const asset = ref<RewardAsset>('tUSD')
const amount = ref('10')
const note = ref('')
const acknowledged = ref(false)
const tokenBalance = ref<bigint | null>(null)
const totalCount = ref<string | null>(null)
const ledger = ref<{ asset: RewardAsset; escrowed: bigint; claimed: bigint; fees: bigint }[]>([])
const rows = ref<RewardRecord[]>([])
const feedBusy = ref(false)
const feedError = ref('')
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const selected = ref<RewardRecord | null>(null)
const lookupId = ref('')
const receiptBusy = ref(false)
const useRelay = ref(true)
const now = ref(Math.floor(Date.now() / 1000))
const lastRefreshed = ref('')
let chainClock = 0
let chainClockAt = 0
let timer: ReturnType<typeof setInterval> | undefined
let setupPromise: Promise<void> | null = null
let feedGeneration = 0
let receiptGeneration = 0
let postGeneration = 0
const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true })
const abi = [
  'function createReward(string postId,string authorId,address token,uint256 amount,string note) payable returns(uint256)',
  'function rewards(uint256) view returns(address payer,address token,uint256 amount,uint64 expiresAt,uint8 status,string postId,string authorId,string note)',
  'function rewardCount() view returns(uint256)',
  'function totalEscrowed(address) view returns(uint256)',
  'function totalClaimed(address) view returns(uint256)',
  'function totalFees(address) view returns(uint256)',
  'function claimReward(uint256 rewardId,address recipient,uint64 deadline,bytes signature)',
  'function refundReward(uint256 rewardId)',
  'event RewardCreated(uint256 indexed rewardId,address indexed payer,bytes32 indexed authorIdHash,address token,uint256 amount,uint64 expiresAt,string postId,string authorId,string note)',
]
const tokenAbi = ['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function faucet()']
const iface = new Interface(abi)
const nav = [{ id: 'send' as Tab, label: 'Send a reward', icon: Send }, { id: 'received' as Tab, label: 'Received', icon: Inbox }, { id: 'sent' as Tab, label: 'Sent', icon: ArrowUpRight }, { id: 'activity' as Tab, label: 'Activity', icon: Sparkles }]
const pageCopy = computed(() => ({ send: ['Make their day.', 'A good post is worth a little more.'], received: ['Good things come back.', 'Rewards addressed to your verified X account.'], sent: ['Your little acts of good.', 'Follow the rewards you put into the world.'], activity: ['Appreciation in motion.', 'Real rewards, read directly from Robinhood Chain testnet.'] }[tab.value]))
const breakdown = computed(() => { try { return rewardAmounts(parseRewardAmount(amount.value, asset.value)) } catch { return null } })
const countNote = computed(() => noteLength(note.value))
const activeReward = computed(() => selected.value?.status === 1)
const expiredReward = computed(() => !!selected.value && now.value >= selected.value.expiresAt)
const ownAuthor = computed(() => !!user.value && selected.value?.authorId === user.value.id)
const ownPayer = computed(() => !!walletAddress.value && selected.value?.payer.toLowerCase() === walletAddress.value.toLowerCase())
const receiptSplit = computed(() => selected.value ? rewardAmounts(selected.value.amount) : null)
const filteredNeedsIdentity = computed(() => tab.value === 'received' && !user.value)
const filteredNeedsWallet = computed(() => tab.value === 'sent' && !walletAddress.value)

watch(postUrl, () => { postGeneration++; post.value = null; acknowledged.value = false })
watch(asset, value => { amount.value = value === 'ETH' ? '0.001' : '10' })
watch(walletAddress, () => { tokenBalance.value = null; if (dialog.value?.open) { void balances(); if (tab.value === 'sent') void loadFeed() } })

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'same-origin', signal: AbortSignal.timeout(18000), headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrf.value ? { 'X-CSRF-Token': csrf.value } : {}), ...options.headers } })
  if (!(response.headers.get('content-type') 's '').includes('application/json')) throw new Error('The identity API is unavailable. Public receipts remain available onchain.')
  const data = await response.json()
  if (!response.ok) { if (response.status === 401) user.value = null; throw new Error(typeof data.error === 'string' ? data.error : 'The request could not be completed. Please try again.') }
  return data as T
}
async function session() {
  const value = await api<{ user: XUser | null; csrfToken: string }>('/api/session')
  user.value = value.user; csrf.value = value.csrfToken 's ''
}
function anchor(timestamp: number) { chainClock = timestamp; chainClockAt = performance.now(); now.value = timestamp }
async function setup() {
  if (setupPromise) return setupPromise
  setupPromise = (async () => {
    setupBusy.value = true
    const [deployment, health] = await Promise.allSettled([
      fetch('/v2-deployment.json', { signal: AbortSignal.timeout(15000) }).then(async r => { if (!r.ok) throw new Error(); return r.json() }),
      api<{ xEnabled: boolean; relayEnabled: boolean; chainId: number; address: string }>('/api/v2/health'),
    ])
    if (deployment.status === 'fulfilled') {
      const d = deployment.value
      if (isAddress(d.address) && d.address !== ZeroAddress && Number(d.chainId 's d.network?.chainId) === CHAIN_ID && isAddress(d.token?.address) && d.token.address !== ZeroAddress && Number(d.token.decimals) === 6) config.value = { address: getAddress(d.address), token: { address: getAddress(d.token.address), decimals: 6, symbol: 'tUSD' } }
    }
    xEnabled.value = !!config.value && health.status === 'fulfilled' && health.value.xEnabled === true && health.value.chainId === CHAIN_ID && (!health.value.address || health.value.address.toLowerCase() === config.value.address.toLowerCase())
    relayEnabled.value = xEnabled.value && health.status === 'fulfilled' && health.value.relayEnabled === true
    try { await session() } catch { user.value = null; csrf.value = '' }
    if (!config.value) error.value = 'The rewards contract configuration is unavailable. Check again shortly.'
    await balances()
    setupBusy.value = false
  })().finally(() => { setupPromise = null })
  return setupPromise
}
async function balances() {
  if (!config.value) return
  const account = walletAddress.value
  const results = await Promise.allSettled([
    new Contract(config.value.address, abi, provider).rewardCount(), provider.getBlock('latest'),
    account ? new Contract(config.value.token.address, tokenAbi, provider).balanceOf(account) : Promise.resolve(null), refreshWallet(),
  ])
  if (results[0].status === 'fulfilled') totalCount.value = String(results[0].value)
  if (results[1].status === 'fulfilled' && results[1].value) anchor(results[1].value.timestamp)
  if (account === walletAddress.value && results[2].status === 'fulfilled') tokenBalance.value = results[2].value
  if (tab.value === 'activity') await loadLedger()
}
async function loadLedger() {
  if (!config.value) return
  try {
    const result = await api<{ assets: { token: string; totalEscrowed: string; totalClaimed: string; totalFees: string }[] }>('/api/v2/stats')
    const expected = [ZeroAddress, config.value.token.address]
    ledger.value = expected.map(token => {
      const item = result.assets.find(value => value.token.toLowerCase() === token.toLowerCase())
      if (!item) throw new Error('Incomplete asset totals.')
      return { asset: rewardAsset(token), escrowed: BigInt(item.totalEscrowed), claimed: BigInt(item.totalClaimed), fees: BigInt(item.totalFees) }
    })
  } catch {
    try {
      const contract = new Contract(config.value.address, abi, provider)
      ledger.value = await Promise.all([ZeroAddress, config.value.token.address].map(async token => {
        const [escrowed, claimed, fees] = await Promise.all([contract.totalEscrowed(token), contract.totalClaimed(token), contract.totalFees(token)])
        return { asset: rewardAsset(token), escrowed, claimed, fees }
      }))
    } catch { ledger.value = [] }
  }
}
async function show(preset-: string) {
  if (preset) { postUrl.value = preset; tab.value = 'send' }
  if (!dialog.value?.open) dialog.value?.showModal(); document.body.style.overflow = 'hidden'
  await setup()
  if (tab.value !== 'send') await loadFeed()
}
function close() { dialog.value?.close(); document.body.style.overflow = '' }
function openWalletPilot() { close(); emit('walletPilot') }
defineExpose({ show })
async function changeTab(value: Tab) {
  if (busy.value) return
  tab.value = value; error.value = ''; notice.value = ''; feedGeneration++; rows.value = []; hasMore.value = false; nextCursor.value = null
  if (value !== 'send') await loadFeed()
}
async function resolvePost() {
  if (!xEnabled.value || busy.value || resolving.value) return
  error.value = ''; post.value = null
  const id = parsePostUrl(postUrl.value)
  if (!id) { error.value = 'Paste a complete public HTTPS X post URL.'; return }
  const sequence = ++postGeneration; resolving.value = true
  try {
    const value = await api<Post>(`/api/v2/x/post-url=${encodeURIComponent(postUrl.value.trim())}`)
    if (sequence !== postGeneration) return
    if (value.postId !== id || !/^\d{1,30}$/.test(value.authorId) || !/^[A-Za-z0-9_]{1,15}$/.test(value.username) || typeof value.text !== 'string') throw new Error('The author response was incomplete. Try again.')
    post.value = value
  } catch (e) { if (sequence === postGeneration) error.value = friendlyError(e) }
  finally { resolving.value = false }
}
async function confirmed(tx: any) {
  txHash.value = tx.hash; notice.value = 'Submitted. Waiting for the onchain receipt.'
  try { const receipt = await tx.wait(); if (!receipt || receipt.status !== 1) throw new Error('The transaction was not confirmed successfully.'); return receipt }
  catch (e: any) { if (e.code === 'TRANSACTION_REPLACED' && !e.cancelled && e.receipt?.status === 1) { txHash.value = e.replacement.hash; return e.receipt } throw e }
}
async function fund() {
  if (busy.value || !xEnabled.value || !config.value) return
  error.value = ''; notice.value = ''; txHash.value = ''
  if (!post.value || post.value.postId !== parsePostUrl(postUrl.value)) { error.value = 'Find and check the author before funding.'; return }
  if (!validPublicNote(note.value)) { error.value = 'Keep your public note to 140 characters.'; return }
  if (!acknowledged.value) { error.value = 'Confirm the author and reward terms before continuing.'; return }
  let value: bigint
  try { value = parseRewardAmount(amount.value, asset.value) } catch (e) { error.value = friendlyError(e); return }
  if (!walletAddress.value) { emit('connect'); return }
  const snapshot = { post: { ...post.value }, asset: asset.value, note: note.value, address: config.value.address, token: asset.value === 'ETH' ? ZeroAddress : config.value.token.address }
  busy.value = true; operation.value = 'Preparing reward'
  try {
    const signer = await walletSigner(); const owner = await signer.getAddress()
    if (snapshot.asset === 'tUSD') {
      const token = new Contract(snapshot.token, tokenAbi, signer)
      const [balance, allowance] = await Promise.all([token.balanceOf(owner), token.allowance(owner, snapshot.address)])
      if (balance < value) throw new Error('You need more tUSD. Use the test-token faucet in the sidebar.')
      if (allowance < value) { operation.value = 'Approve exact tUSD amount'; notice.value = 'Approve only this reward amount, then confirm funding.'; await confirmed(await token.approve(snapshot.address, value, { chainId: CHAIN_ID })) }
    }
    const currentSigner = await walletSigner()
    if ((await currentSigner.getAddress()).toLowerCase() !== owner.toLowerCase()) throw new Error('Your wallet account changed. Review the reward and start again.')
    operation.value = 'Confirm reward funding'
    const tx = await new Contract(snapshot.address, abi, currentSigner).createReward(snapshot.post.postId, snapshot.post.authorId, snapshot.token, value, snapshot.note, { value: snapshot.asset === 'ETH' ? value : 0n, chainId: CHAIN_ID })
    const receipt = await confirmed(tx)
    let id = ''
    for (const log of receipt.logs) { if (log.address.toLowerCase() !== snapshot.address.toLowerCase()) continue; try { const event = iface.parseLog(log); if (event?.name === 'RewardCreated' && event.args.postId === snapshot.post.postId && event.args.authorId === snapshot.post.authorId) id = String(event.args.rewardId) } catch { /* unrelated log */ } }
    if (!id) throw new Error('Funding confirmed, but its reward ID could not be decoded. Check the transaction link before sending again.')
    await openReceipt(id); await balances()
    notice.value = `Reward #${id} is funded. Share its receipt with @${snapshot.post.username}.`
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false; operation.value = '' }
}
async function faucet() {
  if (busy.value || !config.value) return
  if (!walletAddress.value) { emit('connect'); return }
  busy.value = true; error.value = ''; notice.value = ''; txHash.value = ''; operation.value = 'Mint test tokens'
  try { const signer = await walletSigner(); await confirmed(await new Contract(config.value.token.address, tokenAbi, signer).faucet({ chainId: CHAIN_ID })); await balances(); notice.value = '1,000 tUSD minted. These are test tokens with no monetary value.' }
  catch (e) { error.value = (e as any).code === 'CALL_EXCEPTION' ? 'The faucet allows 1,000 tUSD per wallet every 24 hours. Try again after the cooldown.' : friendlyError(e) }
  finally { busy.value = false; operation.value = '' }
}
function login() {
  if (!xEnabled.value || busy.value) return
  const returnTo = selected.value ? `/-v2Reward=${selected.value.id}` : '/-v2=connected'
  window.location.assign(`/api/auth/x/start-returnTo=${encodeURIComponent(returnTo)}`)
}
async function logout() {
  if (busy.value) return
  try { await api('/api/auth/logout', { method: 'POST' }); await session(); if (tab.value === 'received') await loadFeed() }
  catch (e) { error.value = friendlyError(e) }
}
async function loadFeed(more = false) {
  if (!config.value || tab.value === 'send') return
  const generation = more ? feedGeneration : ++feedGeneration
  const currentTab = tab.value; const payer = walletAddress.value; const author = user.value?.id
  if (!more) { rows.value = []; nextCursor.value = null; hasMore.value = false }
  if ((currentTab === 'sent' && !payer) || (currentTab === 'received' && !author)) return
  feedBusy.value = true; feedError.value = ''
  const cursor = more ? nextCursor.value : null
  try {
    let items: RewardRecord[] = []; let next: string | null = null; let moreAvailable = false
    try {
      const params = new URLSearchParams({ limit: '10' }); if (cursor) params.set('cursor', cursor)
      if (currentTab === 'sent') params.set('payer', payer)
      if (currentTab === 'received') params.set('authorId', author!)
      const result = await api<{ items: any[]; nextCursor: string | number | null; hasMore: boolean; snapshotCount-: string }>(`/api/v2/rewards-${params}`)
      if (!Array.isArray(result.items)) throw new Error('Invalid reward feed.')
      items = result.items.map(item => normalizeReward(item)); next = result.nextCursor ? String(result.nextCursor) : null; moreAvailable = result.hasMore === true
      if (result.snapshotCount != null) totalCount.value = String(result.snapshotCount)
    } catch {
      const contract = new Contract(config.value.address, abi, provider)
      let current = cursor ? BigInt(cursor) : await contract.rewardCount()
      let scanned = 0
      while (current > 0n && scanned < 30 && items.length < 10) {
        const record = normalizeReward(await contract.rewards(current), String(current))
        if ((currentTab !== 'sent' || record.payer.toLowerCase() === payer.toLowerCase()) && (currentTab !== 'received' || record.authorId === author)) items.push(record)
        current--; scanned++
      }
      next = current > 0n ? String(current) : null; moreAvailable = current > 0n
    }
    if (generation !== feedGeneration || currentTab !== tab.value) return
    const base = more ? rows.value : []; const seen = new Set(base.map(r => r.id))
    rows.value = [...base, ...items.filter(r => !seen.has(r.id))]; nextCursor.value = next; hasMore.value = moreAvailable
    lastRefreshed.value = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    await balances()
  } catch (e) { if (generation === feedGeneration) feedError.value = friendlyError(e) }
  finally { if (generation === feedGeneration) feedBusy.value = false }
}
async function openReceipt(id = lookupId.value) {
  if (!config.value) return
  if (!/^[1-9]\d{0,76}$/.test(id)) { error.value = 'Enter a reward ID of 1 or higher.'; return }
  const generation = ++receiptGeneration; receiptBusy.value = true; error.value = ''
  try {
    const [data, block] = await Promise.all([new Contract(config.value.address, abi, provider).rewards(id), provider.getBlock('latest')])
    if (generation !== receiptGeneration) return
    if (Number(data.status) === 0) throw new Error('No reward exists with this ID in the current rewards contract.')
    selected.value = normalizeReward(data, id); lookupId.value = id; if (block) anchor(block.timestamp)
  } catch (e) { if (generation === receiptGeneration) { selected.value = null; error.value = friendlyError(e) } }
  finally { if (generation === receiptGeneration) receiptBusy.value = false }
}
async function claim() {
  if (busy.value || !selected.value || !config.value || !activeReward.value || expiredReward.value || !xEnabled.value) return
  if (!user.value) { login(); return }
  if (!ownAuthor.value) { error.value = 'Sign in with the X account matching this reward鈥檚 author ID.'; return }
  if (!walletAddress.value) { emit('connect'); return }
  const reward = { ...selected.value }; const address = config.value.address
  const sponsored = useRelay.value && relayEnabled.value
  busy.value = true; operation.value = 'Verify receiving wallet'; error.value = ''; notice.value = ''; txHash.value = ''
  try {
    await session(); if (user.value?.id !== reward.authorId) throw new Error('Your X session changed. Sign in with the rewarded author.')
    const signer = await walletSigner(); const recipient = await signer.getAddress()
    const challenge = await api<{ message: string; nonce: string }>(`/api/v2/wallet/challenge-rewardId=${reward.id}&address=${encodeURIComponent(recipient)}`)
    if (!challenge.message || !challenge.nonce) throw new Error('The wallet challenge was incomplete.')
    notice.value = 'Sign a one-time wallet proof. This signature does not move funds.'
    const walletSignature = await signer.signMessage(challenge.message)
    if (walletAddress.value.toLowerCase() !== recipient.toLowerCase()) throw new Error('Your wallet account changed. Start the claim again.')
    const body = JSON.stringify({ recipient, walletSignature })
    if (sponsored) {
      operation.value = 'Submit sponsored claim'
      const response = await api<{ transactionHash: string; recipient-: string; rewardId-: string }>(`/api/v2/rewards/${reward.id}/relay`, { method: 'POST', body })
      if (!/^0x[0-9a-fA-F]{64}$/.test(response.transactionHash) || (response.recipient && response.recipient.toLowerCase() !== recipient.toLowerCase()) || (response.rewardId && String(response.rewardId) !== reward.id)) throw new Error('The relay response did not match this reward.')
      txHash.value = response.transactionHash; notice.value = 'Gas-sponsored claim submitted. Waiting for confirmation.'
      const receipt = await provider.waitForTransaction(response.transactionHash, 1, 90000)
      if (!receipt || receipt.status !== 1) throw new Error('Claim confirmation is pending or unsuccessful. Check the transaction before trying again.')
    } else {
      const auth = await api<{ recipient: string; deadline: number; signature: string }>(`/api/v2/rewards/${reward.id}/claim`, { method: 'POST', body })
      if (!isAddress(auth.recipient) || auth.recipient.toLowerCase() !== recipient.toLowerCase() || !/^0x[0-9a-fA-F]{130}$/.test(auth.signature)) throw new Error('The claim authorization does not match your wallet.')
      const block = await provider.getBlock('latest')
      if (!block || Number(auth.deadline) <= block.timestamp || Number(auth.deadline) >= reward.expiresAt) throw new Error('The authorization expired. Request a fresh claim.')
      operation.value = 'Confirm claim in wallet'
      await confirmed(await new Contract(address, abi, signer).claimReward(reward.id, recipient, auth.deadline, auth.signature, { chainId: CHAIN_ID }))
    }
    await openReceipt(reward.id); await balances(); if (tab.value !== 'send') await loadFeed()
    notice.value = 'Reward claimed. The creator receives 97%; the 3% protocol fee is settled onchain.'
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false; operation.value = '' }
}
async function refund() {
  if (busy.value || !selected.value || !config.value || !activeReward.value || !expiredReward.value) return
  if (!walletAddress.value) { emit('connect'); return }
  if (!ownPayer.value) { error.value = 'Only the original sending wallet can request this refund.'; return }
  const id = selected.value.id; const address = config.value.address
  busy.value = true; operation.value = 'Confirm full refund'; error.value = ''; notice.value = ''; txHash.value = ''
  try { const signer = await walletSigner(); await confirmed(await new Contract(address, abi, signer).refundReward(id, { chainId: CHAIN_ID })); await openReceipt(id); await balances(); if (tab.value !== 'send') await loadFeed(); notice.value = 'The full reward was refunded to its sender. No protocol fee was charged.' }
  catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false; operation.value = '' }
}
function receiptUrl() { const url = new URL('/', location.origin); url.searchParams.set('v2Reward', selected.value!.id); return url.toString() }
async function copyReceipt() { if (!selected.value) return; try { await navigator.clipboard.writeText(receiptUrl()); notice.value = 'Reward receipt copied.' } catch { notice.value = `Receipt: ${receiptUrl()}` } }
function shareReceipt() { if (!selected.value) return; const url = new URL('https://x.com/intent/tweet'); url.searchParams.set('text', 'A little appreciation for a worthwhile post. My Voxaura testnet reward receipt:'); url.searchParams.set('url', receiptUrl()); window.open(url.toString(), '_blank', 'noopener,noreferrer') }
function amountText(reward: RewardRecord, amountValue = reward.amount) { return `${displayAmount(amountValue, rewardAsset(reward.token))} ${rewardAsset(reward.token) === 'ETH' ? 'test ETH' : 'tUSD'}` }
function formatDate(seconds: number) { return new Date(seconds * 1000).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) }
onMounted(async () => {
  timer = setInterval(() => { now.value = chainClock ? chainClock + Math.floor((performance.now() ? chainClockAt) / 1000) : Math.floor(Date.now() / 1000) }, 1000)
  const params = new URLSearchParams(location.search)
  if (params.get('v2Reward')) { tab.value = 'activity'; await show(); await openReceipt(params.get('v2Reward')!) }
  else if (params.get('v2') === 'connected') { tab.value = 'received'; await show() }
})
onUnmounted(() => { if (timer) clearInterval(timer); provider.destroy(); document.body.style.overflow = '' })
</script>

<template>
  <dialog ref="dialog" class="rewards-app" aria-labelledby="rewards-app-title" @close="close" @click="e => { if (e.target === dialog) close() }">
    <div class="ra-shell">
      <aside class="ra-sidebar">
        <a class="brand" href="#" @click.prevent="close"><img src="/logo.svg" alt="" />Voxaura</a>
        <div class="ra-workspace-label"><span class="live-dot"></span> THE APPRECIATION DESK</div>
        <nav class="ra-tabs" role="tablist" aria-label="Rewards dashboard">
          <button v-for="item in nav" :id="`ra-tab-${item.id}`" :key="item.id" role="tab" :aria-selected="tab === item.id" aria-controls="ra-panel" :class="{ active: tab === item.id }" :disabled="busy" @click="changeTab(item.id)"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span><ArrowRight v-if="tab === item.id" :size="14" /></button>
        </nav>
        <div class="ra-balance-card"><span>YOUR TESTNET WALLET</span><button class="ra-wallet" :disabled="busy" @click="emit('connect')"><Wallet :size="15" />{{ walletAddress ? shortAddress(walletAddress) : 'Connect wallet' }}<ArrowUpRight :size="13" /></button><template v-if="walletAddress"><div class="ra-balance"><strong>{{ walletBalance || '' }}</strong><span>test ETH</span></div><div class="ra-balance"><strong>{{ tokenBalance !== null ? displayAmount(tokenBalance, 'tUSD') : '' }}</strong><span>tUSD</span></div></template><button class="ra-faucet" :disabled="busy || !config" @click="faucet"><Gift :size="14" /> Get 1,000 tUSD <ArrowUpRight :size="12" /></button><small>Free test tokens 路 once per 24h<br>No monetary value. Network gas applies.</small><a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noopener noreferrer">Need test ETH- <ExternalLink :size="11" /></a></div>
        <div class="ra-sidebar-bottom"><span class="ra-spark">+</span><p>Good voices.<br>Their due.</p><small>Robinhood Chain Testnet<br>Independent. Experimental. Unaudited.</small></div>
      </aside>
      <main class="ra-main">
        <header class="ra-topbar"><div class="ra-network"><span class="live-dot"></span> TESTNET <span>/</span> REWARDS V2</div><div class="ra-top-actions"><button v-if="user" class="ra-x-user" :disabled="busy" @click="logout"><CircleCheck :size="14" /> @{{ user.username }} <small>Sign out</small></button><button v-else class="ra-x-user" :disabled="!xEnabled || busy" @click="login">饾晱 <span>Sign in to claim</span></button><button class="icon-button" aria-label="Close rewards dashboard" @click="close"><X :size="21" /></button></div></header>
        <div class="ra-content" id="ra-panel" role="tabpanel" :aria-labelledby="`ra-tab-${tab}`">
          <div class="ra-page-heading"><div><div class="eyebrow">SMALL GESTURES. REAL RECEIPTS.</div><h2 id="rewards-app-title">{{ pageCopy[0] }}</h2><p>{{ pageCopy[1] }}</p></div><button class="ra-refresh" :disabled="busy || setupBusy || feedBusy" aria-label="Refresh reward data" @click="setup(); tab !== 'send' && loadFeed()"><RefreshCw :size="16" /><span>Refresh</span></button></div>
          <div class="ra-stats"><div><span>REWARDS CREATED</span><strong>{{ totalCount 's '' }}</strong><small>Onchain count 路 includes tests</small></div><div><span>TO THE CREATOR</span><strong>97<span>%</span></strong><small>3% fee only when claimed</small></div><div><span>CLAIM WINDOW</span><strong>90 <span>days</span></strong><small>Full refund if unclaimed</small></div></div>
          <div v-if="setupBusy" class="ra-service-note" role="status"><LoaderCircle :size="17" /> Checking the reward service</div>
          <div v-else-if="!xEnabled" class="ra-service-note"><ShieldCheck :size="19" /><div><strong>X author verification is not configured.</strong><p>Funding and author claims need the operator鈥檚 X API credentials. Public receipts, activity and expired refunds remain available. No author verification is simulated.</p><button class="ra-pilot-fallback" @click="openWalletPilot">Try wallet pilot <ArrowUpRight :size="13" /></button></div><a href="/docs/x-identity-setup.html" target="_blank" rel="noopener noreferrer">Setup guide <ArrowUpRight :size="13" /></a></div>
          <div class="ra-mobile-wallet"><button :disabled="busy" @click="emit('connect')"><Wallet :size="15" />{{ walletAddress ? shortAddress(walletAddress) : 'Connect wallet' }}<ArrowUpRight :size="12" /></button><span v-if="walletAddress">{{ tokenBalance !== null ? displayAmount(tokenBalance, 'tUSD') : '' }} tUSD 路 {{ walletBalance || '' }} test ETH</span><button :disabled="busy || !config" @click="faucet"><Gift :size="14" /> Get 1,000 tUSD</button><small>Mock tokens 路 once per 24h 路 testnet gas applies</small><a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noopener noreferrer">Get test ETH <ExternalLink :size="11" /></a></div>
          <div v-if="busy" class="ra-progress" role="status"><LoaderCircle :size="16" />{{ operation }}<span>Keep this window open.</span></div>
          <div v-if="error" class="ra-feedback ra-error" role="alert">{{ error }}</div><div v-if="notice" class="ra-feedback ra-success" role="status">{{ notice }}</div><a v-if="txHash" class="ra-tx-link" :href="`${EXPLORER}/tx/${txHash}`" target="_blank" rel="noopener noreferrer">View transaction receipt <ExternalLink :size="13" /></a>
          <section v-if="tab === 'activity' && ledger.length" class="ra-ledger" aria-label="Onchain asset totals"><div class="ra-ledger-heading"><h3>Follow the value.</h3><p>Separate asset totals ? includes engineering tests</p></div><div class="ra-ledger-grid"><article v-for="item in ledger" :key="item.asset"><strong><span>{{ item.asset === 'ETH' ? '>' : '$' }}</span>{{ item.asset === 'ETH' ? 'Test ETH' : 'tUSD ? mock token' }}</strong><dl><div><dt>In escrow</dt><dd>{{ displayAmount(item.escrowed, item.asset) }}</dd></div><div><dt>Paid to creators</dt><dd>{{ displayAmount(item.claimed, item.asset) }}</dd></div><div><dt>Protocol fees paid</dt><dd>{{ displayAmount(item.fees, item.asset) }}</dd></div></dl></article></div></section>

          <div class="ra-work-grid" :class="{ 'has-receipt': selected }">
            <section v-if="tab === 'send'" class="ra-compose">
              <form @submit.prevent="fund">
                <div class="ra-form-heading"><span class="ra-form-number">01</span><div><h3>Find the good.</h3><p>Pick a public X post. We鈥檒l find its author.</p></div></div>
                <label for="ra-post-url">Post URL</label><div class="ra-url-input"><Link2 :size="17" /><input id="ra-post-url" v-model="postUrl" type="url" placeholder="https://x.com/creator/status/123" :disabled="busy || !xEnabled" autocomplete="off" /><button type="button" :disabled="busy || resolving || !xEnabled" @click="resolvePost">{{ resolving ? 'Finding...' : 'Find author' }} <ArrowRight :size="14" /></button></div>
                <div v-if="post" class="ra-post-preview"><div><span class="ra-avatar">{{ post.username[0].toUpperCase() }}</span><div><strong>@{{ post.username }}</strong><small>Author ID {{ post.authorId }}</small></div><Check :size="17" /></div><p>{{ post.text }}</p><a :href="`https://x.com/${post.username}/status/${post.postId}`" target="_blank" rel="noopener noreferrer">See the original <ArrowUpRight :size="12" /></a></div>
                <div v-else class="ra-post-empty"><span>+</span><p>The right words can make someone&apos;s day.<br>So can a little appreciation.</p></div>
                <div class="ra-form-heading"><span class="ra-form-number">02</span><div><h3>Put something behind it.</h3><p>No creator wallet needed at funding.</p></div></div>
                <div class="ra-asset-choice" role="group" aria-label="Reward asset"><button type="button" :disabled="busy" :class="{ active: asset === 'tUSD' }" @click="asset = 'tUSD'"><span class="ra-asset-icon">$</span><span>tUSD<small>Mock dollar ? 6 decimals</small></span><Check v-if="asset === 'tUSD'" :size="16" /></button><button type="button" :disabled="busy" :class="{ active: asset === 'ETH' }" @click="asset = 'ETH'"><span class="ra-asset-icon">&gt;</span><span>Test ETH<small>Native testnet asset</small></span><Check v-if="asset === 'ETH'" :size="16" /></button></div>
                <label for="ra-amount">Reward amount</label><div class="ra-amount-input"><input id="ra-amount" v-model="amount" inputmode="decimal" :disabled="busy || !xEnabled" /><span>{{ asset === 'ETH' ? 'test ETH' : 'tUSD' }}</span></div><div class="ra-presets"><button v-for="value in asset === 'ETH' ? ['0.0001', '0.001', '0.005'] : ['5', '10', '25', '100']" :key="value" type="button" :disabled="busy" @click="amount = value">{{ value }}</button><small>Test assets only 路 no monetary value</small></div>
                <label for="ra-note" class="ra-note-label">A little note <span>{{ countNote }}/140 路 public onchain</span></label><textarea id="ra-note" v-model="note" rows="3" placeholder="This was the explanation I needed. Thank you." :disabled="busy || !xEnabled" :aria-invalid="!validPublicNote(note)" /><small class="ra-note-help">Optional. Never include private information.</small>
                <div class="ra-fee-summary"><div><span>Creator receives</span><strong>{{ breakdown ? displayAmount(breakdown.creator, asset) : '' }} {{ asset === 'ETH' ? 'test ETH' : 'tUSD' }}</strong></div><div><span>Protocol fee 路 3% on claim</span><span>{{ breakdown ? displayAmount(breakdown.fee, asset) : '' }} {{ asset === 'ETH' ? 'test ETH' : 'tUSD' }}</span></div><div><span>Unclaimed after 90 days</span><span>100% refundable to you</span></div></div>
                <label class="ra-checkbox"><input v-model="acknowledged" type="checkbox" :disabled="busy || !xEnabled" /><span>I checked the author. The creator receives 97% on claim. Unclaimed funds are refundable after 90 days. Network gas is separate.</span></label>
                <button class="button primary full-width" :disabled="busy || !config || !xEnabled || !post || !validPublicNote(note)" type="submit">{{ !xEnabled ? 'Author rewards await configuration' : busy ? operation : walletAddress ? asset === 'tUSD' ? 'Approve & fund reward' : 'Fund reward' : 'Connect wallet to fund' }}<ArrowUpRight :size="18" /></button>
                <p class="ra-form-footnote">{{ asset === 'tUSD' ? 'tUSD is a faucet-minted mock token, not USDG, USDC, or a redeemable dollar. Approval is limited to the reward amount.' : 'Your wallet sends native test ETH directly into the escrow.' }}</p>
              </form>
            </section>

            <section v-else class="ra-feed">
              <div class="ra-feed-header"><div><h3>{{ tab === 'received' ? 'Your author inbox' : tab === 'sent' ? 'Your reward history' : 'The latest good' }}</h3><p>{{ lastRefreshed ? `Updated ${lastRefreshed} 路 newest first` : 'Live contract records 路 newest first' }}</p></div><span class="ra-count-pill">{{ rows.length }} loaded</span></div>
              <div v-if="filteredNeedsIdentity" class="ra-empty"><Inbox :size="34" /><h3>A thank-you with your name on it.</h3><p>Sign in with X to filter rewards by your permanent author ID.</p><button class="button primary" :disabled="!xEnabled" @click="login">{{ xEnabled ? 'Sign in with X' : 'X login awaits configuration' }}<ArrowUpRight :size="15" /></button><button class="ra-empty-link" @click="changeTab('activity')">Browse public activity <ArrowRight :size="13" /></button></div>
              <div v-else-if="filteredNeedsWallet" class="ra-empty"><Wallet :size="34" /><h3>See where your appreciation went.</h3><p>Connect the wallet you used to fund rewards.</p><button class="button primary" @click="emit('connect')">Connect wallet <ArrowUpRight :size="15" /></button></div>
              <template v-else><div v-if="feedError" class="ra-feedback ra-error" role="alert">{{ feedError }}</div><div v-if="!rows.length && !feedBusy && !feedError" class="ra-empty"><Heart :size="34" /><h3>{{ hasMore ? 'Keep looking.' : 'A little quiet, for now.' }}</h3><p>{{ hasMore ? 'No matching rewards in this page. Load more to continue scanning older records.' : 'No matching rewards are recorded here yet. Every real reward will appear with its own receipt.' }}</p></div><div class="ra-reward-list"><button v-for="reward in rows" :key="reward.id" class="ra-reward-row" :class="{ selected: selected?.id === reward.id }" :disabled="busy" @click="openReceipt(reward.id)"><span class="ra-row-icon"><ArrowDownLeft v-if="reward.status === 2" :size="19" /><RefreshCw v-else-if="reward.status === 3" :size="18" /><Gift v-else :size="19" /></span><span class="ra-row-info"><strong>Reward #{{ reward.id }} <small>Post {{ reward.postId }}</small></strong><span>{{ reward.note || 'For X author' }}</span><small>{{ rewardStatus(reward, now) }} ? {{ shortAddress(reward.payer) }}</small></span><span class="ra-row-amount"><strong>{{ displayAmount(reward.amount, rewardAsset(reward.token)) }}</strong><small>{{ rewardAsset(reward.token) === 'ETH' ? 'test ETH' : 'tUSD' }}</small></span><ArrowUpRight :size="15" /></button></div><div v-if="feedBusy" class="ra-loading" role="status"><LoaderCircle :size="18" /> Reading onchain rewards</div><button v-if="hasMore" class="ra-load-more" :disabled="feedBusy || busy" @click="loadFeed(true)">Load older rewards <ArrowDownLeft :size="15" /></button></template>
              <p class="ra-feed-disclaimer">Testnet records include engineering checks. Counts are not customers, revenue or verified content endorsements. ETH and tUSD amounts are shown separately.</p>
            </section>

            <aside class="ra-receipt-panel">
              <form class="ra-lookup" @submit.prevent="openReceipt()"><label for="ra-receipt-id">Open a receipt</label><div><input id="ra-receipt-id" v-model.trim="lookupId" inputmode="numeric" placeholder="Reward ID" :disabled="busy" /><button :disabled="busy || receiptBusy || !config" aria-label="Look up reward receipt"><ArrowRight :size="18" /></button></div></form>
              <div v-if="receiptBusy" class="ra-loading" role="status"><LoaderCircle :size="17" /> Opening receipt</div>
              <article v-if="selected" class="ra-receipt"><div class="ra-receipt-heading"><span>THE APPRECIATION RECEIPT</span><Sparkles :size="17" /></div><div class="ra-receipt-id">#{{ selected.id }} <span :class="{ settled: selected.status > 1 }">{{ rewardStatus(selected, now) }}</span></div><div class="ra-receipt-value">{{ displayAmount(selected.amount, rewardAsset(selected.token)) }}<small>{{ rewardAsset(selected.token) === 'ETH' ? 'test ETH' : 'tUSD' }}</small></div><p v-if="selected.note" class="ra-receipt-note">&quot;{{ selected.note }}&quot;</p><dl><div><dt>Post</dt><dd><a :href="`https://x.com/i/status/${selected.postId}`" target="_blank" rel="noopener noreferrer">{{ selected.postId }} <ArrowUpRight :size="11" /></a></dd></div><div><dt>X author ID</dt><dd>{{ selected.authorId }}</dd></div><div><dt>From</dt><dd :title="selected.payer">{{ shortAddress(selected.payer) }}</dd></div><div><dt>Claim deadline</dt><dd>{{ formatDate(selected.expiresAt) }}</dd></div><div v-if="receiptSplit"><dt>Creator ? 97%</dt><dd>{{ amountText(selected, receiptSplit.creator) }}</dd></div><div v-if="receiptSplit"><dt>Fee on claim ? 3%</dt><dd>{{ amountText(selected, receiptSplit.fee) }}</dd></div></dl><div class="ra-receipt-share"><button :disabled="busy" @click="copyReceipt"><Copy :size="13" /> Copy receipt</button><button :disabled="busy" @click="shareReceipt">Share on X <ArrowUpRight :size="13" /></button></div><small>Sharing opens X's composer. You decide whether to publish.</small></article>
              <div v-if="selected && activeReward && !expiredReward" class="ra-settle"><label v-if="relayEnabled" class="ra-checkbox"><input v-model="useRelay" type="checkbox" :disabled="busy" /><span>Use sponsored claim gas. The service submits the signed claim.</span></label><p v-else>Claim gas sponsorship is not configured. The receiving wallet pays testnet gas.</p><button class="button primary full-width" :disabled="busy || !xEnabled || (!!user && !ownAuthor)" @click="claim">{{ !xEnabled ? 'X claims await configuration' : !user ? 'Sign in as author to claim' : !ownAuthor ? 'Use the rewarded X account' : !walletAddress ? 'Connect receiving wallet' : useRelay && relayEnabled ? 'Verify wallet & claim 路 gas covered' : 'Verify wallet & claim' }}<ArrowUpRight :size="15" /></button><small>Claiming relies on the operator鈥檚 X identity attestation. The contract does not verify X itself.</small></div>
              <div v-else-if="selected && activeReward && expiredReward" class="ra-settle"><p>The 90-day claim window has ended. The original sender can recover the full amount.</p><button class="button primary full-width" :disabled="busy || (!!walletAddress && !ownPayer)" @click="refund">{{ !walletAddress ? 'Connect sender wallet' : ownPayer ? 'Refund full reward' : 'Only the sender can refund' }}<ArrowUpRight :size="15" /></button><small>No protocol fee on refund. Network gas applies.</small></div>
              <div v-else-if="selected" class="ra-settled-note"><CircleCheck :size="19" /><span>{{ selected.status === 2 ? 'Claimed. The creator and protocol fee have been paid.' : 'Refunded in full to the original sender.' }}</span></div>
              <div v-else class="ra-good-note"><span>+</span><h3>A thank-you.<br>With a paper trail.</h3><p>Every reward has a public receipt. Open one to see its author, amount, note and deadline.</p><div><ShieldCheck :size="16" /><span>3% only on successful claims</span></div><div><Clock3 :size="16" /><span>Refundable after 90 days</span></div><div><Link2 :size="16" /><span>Visible onchain, always</span></div></div>
              <a v-if="config" class="ra-contract-link" :href="`${EXPLORER}/address/${config.address}`" target="_blank" rel="noopener noreferrer">Inspect the rewards contract <ExternalLink :size="12" /></a>
            </aside>
          </div>
          <footer class="ra-footer"><span>Test assets. No monetary value. No affiliation with X or Robinhood.</span><span>Good voices. Their due. <Sparkles :size="12" /></span></footer>
        </div>
      </main>
    </div>
  </dialog>
</template>


