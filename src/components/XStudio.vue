<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Contract, Interface, JsonRpcProvider, ZeroAddress, formatEther, isAddress, parseEther } from 'ethers'
import { ArrowRight, ArrowUpRight, Check, CircleCheck, Clock3, Copy, ExternalLink, Link2, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-vue-next'
import { CHAIN_ID, EXPLORER, RPC, friendlyError, parsePostUrl, shortAddress } from '../lib'
import { refreshWallet, walletAddress, walletSigner } from '../wallet'

type XUser = { id: string; username: string; name: string }
type XPost = { postId: string; authorId: string; username: string; text: string }
type XReward = { payer: string; amount: bigint; expiresAt: bigint; status: number; postId: string; authorId: string }
type Deployment = { address: string; chainId: number }
const emit = defineEmits<{ connect: []; walletPilot: [] }>()
const dialog = ref<HTMLDialogElement>()
const tab = ref<'send' | 'manage'>('send')
const loadingSetup = ref(true)
const xEnabled = ref(false)
const user = ref<XUser | null>(null)
const csrfToken = ref('')
const deployment = ref<Deployment | null>(null)
const busy = ref(false)
const lookingUp = ref(false)
const error = ref('')
const notice = ref('')
const txHash = ref('')
const postUrl = ref('')
const post = ref<XPost | null>(null)
const amount = ref('0.001')
const duration = ref('604800')
const acknowledged = ref(false)
const lookupId = ref('')
const loadedId = ref('')
const reward = ref<XReward | null>(null)
const now = ref(0)
let clockAnchor = 0
let clockTick = 0
let lookupSequence = 0
let postSequence = 0
let ticker: ReturnType<typeof setInterval> | undefined
const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true })
const abi = [
  'function createReward(string postId,string authorId,uint64 expiresAt) payable returns(uint256)',
  'function rewards(uint256) view returns(address payer,uint256 amount,uint64 expiresAt,uint8 status,string postId,string authorId)',
  'function claimReward(uint256 rewardId,address recipient,uint64 deadline,bytes signature)',
  'function refundReward(uint256 rewardId)',
  'event RewardCreated(uint256 indexed rewardId,address indexed payer,string postId,string authorId,uint256 amount,uint64 expiresAt)',
]
const iface = new Interface(abi)
const active = computed(() => reward.value?.status === 1)
const expired = computed(() => !!reward.value && Number(reward.value.expiresAt) * 1000 <= now.value)
const isPayer = computed(() => !!reward.value && !!walletAddress.value && reward.value.payer.toLowerCase() === walletAddress.value.toLowerCase())
const isAuthor = computed(() => !!user.value && !!reward.value && user.value.id === reward.value.authorId)
const status = computed(() => !reward.value ? '' : ['Not found', expired.value ? 'Ready for refund' : 'Awaiting author', 'Claimed', 'Refunded'][reward.value.status] ?? 'Unknown')
const canFund = computed(() => xEnabled.value && !!deployment.value && !!post.value && !busy.value)

watch(postUrl, () => { postSequence++; post.value = null; acknowledged.value = false })

function show() {
  if (!dialog.value?.open) dialog.value?.showModal()
  document.body.style.overflow = 'hidden'
}
function close() { dialog.value?.close(); document.body.style.overflow = '' }
function openWalletPilot() { close(); emit('walletPilot') }
defineExpose({ show })

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken.value ? { 'X-CSRF-Token': csrfToken.value } : {}), ...options.headers },
    signal: AbortSignal.timeout(15000),
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) throw new Error('The X identity service is not available. You can still use the wallet pilot.')
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401) { user.value = null; csrfToken.value = '' }
    throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : 'The X identity request could not be completed. Please try again.')
  }
  return data as T
}

async function refreshSession() {
  const session = await api<{ user: XUser | null; csrfToken: string }>('/api/session')
  user.value = session.user
  csrfToken.value = session.csrfToken || ''
}

async function setup() {
  loadingSetup.value = true
  const [healthResult, deploymentResult] = await Promise.allSettled([
    api<{ xEnabled: boolean; chainId: number }>('/api/health'),
    fetch('/x-deployment.json', { signal: AbortSignal.timeout(15000) }).then(async response => {
      if (!response.ok) throw new Error('X escrow is not configured.')
      const data = await response.json()
      const address = data.address || data.contractAddress
      const chainId = Number(data.chainId ?? data.network?.chainId)
      if (!isAddress(address) || address === ZeroAddress || chainId !== CHAIN_ID) throw new Error('Invalid X escrow deployment.')
      return { address, chainId }
    }),
  ])
  deployment.value = deploymentResult.status === 'fulfilled' ? deploymentResult.value : null
  xEnabled.value = healthResult.status === 'fulfilled' && healthResult.value.xEnabled === true && Number(healthResult.value.chainId) === CHAIN_ID && !!deployment.value
  if (xEnabled.value) {
    try { await refreshSession() }
    catch { user.value = null; csrfToken.value = '' }
  } else { user.value = null; csrfToken.value = '' }
  loadingSetup.value = false
}

async function resolvePost() {
  if (busy.value || lookingUp.value || !xEnabled.value) return
  error.value = ''; notice.value = ''; post.value = null; acknowledged.value = false
  const requestedUrl = postUrl.value.trim()
  const id = parsePostUrl(requestedUrl)
  if (!id) { error.value = 'Paste a complete public X post URL.'; return }
  const sequence = ++postSequence
  lookingUp.value = true
  try {
    const result = await api<XPost>(`/api/x/post?url=${encodeURIComponent(requestedUrl)}`)
    if (sequence !== postSequence) return
    if (result.postId !== id || !/^\d{1,30}$/.test(result.authorId) || !/^[A-Za-z0-9_]{1,15}$/.test(result.username) || typeof result.text !== 'string') throw new Error('The author lookup returned an invalid result. Please try again.')
    post.value = result
  } catch (e) { if (sequence === postSequence) error.value = friendlyError(e) }
  finally { lookingUp.value = false }
}

function anchorClock(timestamp: number) { clockAnchor = timestamp * 1000; clockTick = performance.now(); now.value = clockAnchor }

async function loadReward(id = lookupId.value) {
  if (busy.value && id !== loadedId.value) return
  const sequence = ++lookupSequence
  error.value = ''; reward.value = null; loadedId.value = ''
  if (!/^[1-9]\d{0,76}$/.test(id)) { error.value = 'Enter an X reward ID of 1 or higher.'; return }
  if (!deployment.value) { error.value = 'The X escrow deployment is not available.'; return }
  lookingUp.value = true
  try {
    const [data, block] = await Promise.all([
      new Contract(deployment.value.address, abi, provider).rewards(id), provider.getBlock('latest'),
    ])
    if (sequence !== lookupSequence) return
    if (!block) throw new Error('The network did not return its latest block. Please retry.')
    if (Number(data.status) === 0) throw new Error('No X reward exists with this ID. Wallet pilot receipts use a separate contract.')
    anchorClock(block.timestamp)
    reward.value = { payer: data.payer, amount: data.amount, expiresAt: data.expiresAt, status: Number(data.status), postId: data.postId, authorId: data.authorId }
    loadedId.value = id; lookupId.value = id
  } catch (e) { if (sequence === lookupSequence) error.value = friendlyError(e) }
  finally { if (sequence === lookupSequence) lookingUp.value = false }
}

async function confirmed(tx: any) {
  txHash.value = tx.hash
  notice.value = 'Transaction submitted. Waiting for onchain confirmation…'
  try {
    const receipt = await tx.wait()
    if (!receipt || receipt.status !== 1) throw new Error('The transaction was not confirmed successfully.')
    return receipt
  } catch (e: any) {
    if (e.code === 'TRANSACTION_REPLACED' && !e.cancelled && e.receipt?.status === 1) { txHash.value = e.replacement.hash; return e.receipt }
    throw e
  }
}

async function fundReward() {
  if (!canFund.value || busy.value) return
  error.value = ''; notice.value = ''; txHash.value = ''
  if (!acknowledged.value) { error.value = 'Confirm that the displayed author is the person you want to reward.'; return }
  let value: bigint
  try { value = parseEther(amount.value); if (value <= 0n || value > parseEther('0.1')) throw new Error() }
  catch { error.value = 'Enter an amount greater than 0 and no more than 0.1 test ETH.'; return }
  if (!walletAddress.value) { emit('connect'); return }
  const selectedPost = { ...post.value! }
  const contractAddress = deployment.value!.address
  const selectedDuration = Number(duration.value)
  if (![3600, 86400, 604800, 2592000].includes(selectedDuration)) { error.value = 'Choose one of the available claim windows.'; return }
  busy.value = true
  try {
    const signer = await walletSigner()
    const block = await signer.provider.getBlock('latest')
    if (!block) throw new Error('The latest testnet block is unavailable. Please retry.')
    notice.value = 'Review the author reward in your wallet.'
    const tx = await new Contract(contractAddress, abi, signer).createReward(selectedPost.postId, selectedPost.authorId, block.timestamp + selectedDuration, { value, chainId: CHAIN_ID })
    const receipt = await confirmed(tx)
    let createdId = ''
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue
      try {
        const event = iface.parseLog(log)
        if (event?.name === 'RewardCreated' && event.args.postId === selectedPost.postId && event.args.authorId === selectedPost.authorId) createdId = String(event.args.rewardId)
      } catch { /* Ignore unrelated logs. */ }
    }
    if (!createdId) throw new Error('The transaction confirmed, but its reward receipt could not be decoded. Check the transaction link before trying again.')
    loadedId.value = createdId
    tab.value = 'manage'
    await loadReward(createdId)
    await refreshWallet()
    notice.value = `X reward #${createdId} is funded. Share the receipt so its author can sign in and claim.`
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false }
}

function login() {
  if (!xEnabled.value || busy.value) return
  const returnTo = loadedId.value ? `/?xReward=${encodeURIComponent(loadedId.value)}` : '/?x=connected'
  window.location.assign(`/api/auth/x/start?returnTo=${encodeURIComponent(returnTo)}`)
}

async function logout() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await api('/api/auth/logout', { method: 'POST' }); user.value = null; csrfToken.value = ''; await refreshSession() }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function claim() {
  if (busy.value || !active.value || expired.value || !loadedId.value || !deployment.value || !xEnabled.value) return
  if (!user.value) { login(); return }
  if (!isAuthor.value) { error.value = 'Sign in with the X account whose numeric author ID matches this reward.'; return }
  if (!walletAddress.value) { emit('connect'); return }
  const actionId = loadedId.value
  const expectedAuthor = reward.value!.authorId
  const rewardExpiry = reward.value!.expiresAt
  const contractAddress = deployment.value.address
  busy.value = true; error.value = ''; notice.value = ''; txHash.value = ''
  try {
    await refreshSession()
    if (user.value?.id !== expectedAuthor) throw new Error('Your X session changed. Sign in with the rewarded author account.')
    const signer = await walletSigner()
    const address = await signer.getAddress()
    const challenge = await api<{ message: string; nonce: string; expiresAt: string }>(`/api/wallet/challenge?rewardId=${encodeURIComponent(actionId)}&address=${encodeURIComponent(address)}`)
    if (!challenge.message || !challenge.nonce) throw new Error('The wallet verification request was incomplete. Please retry.')
    notice.value = 'Sign the wallet ownership message. This signature does not move funds.'
    const walletSignature = await signer.signMessage(challenge.message)
    if (walletAddress.value.toLowerCase() !== address.toLowerCase()) throw new Error('Your wallet account changed. Start the claim again.')
    const authorization = await api<{ recipient: string; deadline: number | string; signature: string }>(`/api/rewards/${actionId}/claim`, { method: 'POST', body: JSON.stringify({ recipient: address, walletSignature }) })
    if (!isAddress(authorization.recipient) || authorization.recipient.toLowerCase() !== address.toLowerCase() || !/^0x[0-9a-fA-F]{130}$/.test(authorization.signature)) throw new Error('The claim authorization did not match your wallet. Please retry.')
    const deadline = BigInt(authorization.deadline)
    const block = await signer.provider.getBlock('latest')
    if (!block || deadline <= BigInt(block.timestamp) || deadline > rewardExpiry) throw new Error('The claim authorization has expired. Please request a fresh claim.')
    notice.value = 'Author and wallet verified. Approve the claim transaction in your wallet.'
    const tx = await new Contract(contractAddress, abi, signer).claimReward(actionId, address, deadline, authorization.signature, { chainId: CHAIN_ID })
    await confirmed(tx)
    await loadReward(actionId); await refreshWallet()
    notice.value = 'Reward claimed. The test ETH was sent to your verified wallet.'
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false }
}

async function refund() {
  if (busy.value || !active.value || !expired.value || !loadedId.value || !deployment.value) return
  if (!walletAddress.value) { emit('connect'); return }
  if (!isPayer.value) { error.value = 'Only the original sender wallet can request this refund.'; return }
  const actionId = loadedId.value
  const address = deployment.value.address
  busy.value = true; error.value = ''; notice.value = ''; txHash.value = ''
  try {
    const signer = await walletSigner()
    const tx = await new Contract(address, abi, signer).refundReward(actionId, { chainId: CHAIN_ID })
    await confirmed(tx)
    await loadReward(actionId); await refreshWallet()
    notice.value = 'The unclaimed reward was refunded to its original sender.'
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false }
}

async function copyReceipt() {
  if (!loadedId.value) return
  const url = new URL('/', window.location.origin)
  url.searchParams.set('xReward', loadedId.value)
  try { await navigator.clipboard.writeText(url.toString()); notice.value = 'X reward receipt copied.' }
  catch { notice.value = `Your X reward receipt: ${url.toString()}` }
}

onMounted(async () => {
  ticker = setInterval(() => { if (clockAnchor) now.value = clockAnchor + performance.now() - clockTick }, 1000)
  await setup()
  const query = new URLSearchParams(window.location.search)
  const id = query.get('xReward')
  if (id) { tab.value = 'manage'; lookupId.value = id; show(); await loadReward(id) }
  else if (query.get('x') === 'connected') { tab.value = 'manage'; show() }
})
onUnmounted(() => { if (ticker) clearInterval(ticker); provider.destroy(); document.body.style.overflow = '' })
</script>

<template>
  <dialog ref="dialog" class="studio-dialog x-studio-dialog" @close="close" @click="e => { if (e.target === dialog) close() }">
    <div class="studio-shell">
      <aside class="studio-sidebar">
        <a class="brand" href="#" @click.prevent="close"><img src="/logo.svg" alt="" />voxdue</a>
        <span class="eyebrow"><span class="live-dot" :class="{ offline: !xEnabled }"></span> THE AUTHOR REWARD STUDIO</span>
        <h2>The post is theirs.<br>The thank-you, too.</h2>
        <p>Reward a public post. Its author signs in with X and chooses a wallet to claim.</p>
        <div class="studio-orb"><span>✳</span></div>
        <div class="sidebar-facts"><span><ShieldCheck :size="16" /> X account verification</span><span><Wallet :size="16" /> A wallet you control</span><span><Clock3 :size="16" /> Refund after expiry</span></div>
        <small>Solana Chain testnet. Test ETH has no monetary value. X identity claims depend on the configured verification service.</small>
      </aside>
      <div class="studio-content">
        <div class="studio-top"><span class="pill">X AUTHOR REWARDS</span><button class="icon-button" aria-label="Close X reward studio" @click="close"><X :size="21" /></button></div>
        <div v-if="loadingSetup" class="x-setup-loading" role="status"><RefreshCw :size="18" /> Checking the author reward service…</div>
        <div v-else-if="!xEnabled" class="x-setup-notice">
          <div class="x-notice-icon"><ShieldCheck :size="23" /></div>
          <h3>X claims are not configured yet.</h3>
          <p>The author-login flow needs the operator’s X API credentials and claim verification service. No X login or author claim is available in this deployment yet.</p>
          <div class="x-setup-actions"><button class="button primary" @click="openWalletPilot">Use the wallet pilot <ArrowUpRight :size="16" /></button><button class="text-link" :disabled="loadingSetup" @click="setup"><RefreshCw :size="14" /> Check again</button></div>
          <a class="x-setup-guide" href="/docs/x-identity-setup.html" target="_blank" rel="noopener noreferrer">Operator setup guide <ExternalLink :size="13" /></a>
          <small>Existing X reward receipts can still be read below. Expired refunds do not require X login.</small>
        </div>
        <div class="studio-tabs" role="tablist" aria-label="X reward actions"><button role="tab" :disabled="busy" :aria-selected="tab === 'send'" :class="{ active: tab === 'send' }" @click="tab = 'send'; error = ''; notice = ''">Reward a post <ArrowUpRight :size="16" /></button><button role="tab" :disabled="busy" :aria-selected="tab === 'manage'" :class="{ active: tab === 'manage' }" @click="tab = 'manage'; error = ''; notice = ''">Claim / refund <ArrowRight :size="16" /></button></div>
        <div class="studio-wallet"><span><span class="live-dot" :class="{ offline: !walletAddress }"></span>{{ walletAddress ? shortAddress(walletAddress) : 'No wallet connected' }}</span><button :disabled="busy" @click="emit('connect')">{{ walletAddress ? 'Manage' : 'Connect' }} <Wallet :size="14" /></button></div>
        <div v-if="xEnabled" class="x-session"><span v-if="user"><CircleCheck :size="15" /> Signed in as <strong>@{{ user.username }}</strong></span><span v-else>X login is needed only to claim as an author.</span><button v-if="user" :disabled="busy" @click="logout">Sign out</button><button v-else :disabled="busy" @click="login">Sign in with X <ArrowUpRight :size="13" /></button></div>

        <form v-if="tab === 'send'" class="reward-form" @submit.prevent="fundReward">
          <div><h3>Good post. Well deserved.</h3><p>Find its author through X, then put a little appreciation behind it.</p></div>
          <label>X post URL<div class="x-url-row"><div class="input-with-icon"><Link2 :size="17" /><input v-model="postUrl" type="url" placeholder="https://x.com/creator/status/…" autocomplete="off" :disabled="busy || !xEnabled" required /></div><button type="button" class="button dark" :disabled="busy || lookingUp || !xEnabled" @click="resolvePost">{{ lookingUp ? 'Checking…' : 'Find author' }}</button></div></label>
          <div v-if="post" class="x-post-preview"><div><span class="x-author-check"><Check :size="14" /></span><strong>@{{ post.username }}</strong><span>Author ID {{ post.authorId }}</span></div><p>{{ post.text }}</p><a :href="`https://x.com/${post.username}/status/${post.postId}`" target="_blank" rel="noopener noreferrer">View original post <ArrowUpRight :size="13" /></a></div>
          <div class="field-row"><label>Reward amount<div class="amount-input"><input v-model="amount" inputmode="decimal" aria-label="X reward amount" :disabled="busy || !xEnabled" /><span>test ETH</span></div></label><label>Claim window<select v-model="duration" :disabled="busy || !xEnabled"><option value="3600">1 hour</option><option value="86400">1 day</option><option value="604800">7 days</option><option value="2592000">30 days</option></select></label></div>
          <label class="checkbox-label"><input v-model="acknowledged" type="checkbox" :disabled="busy || !post || !xEnabled" /><span>I checked the post and author. The named X account can claim through the verification service; unclaimed rewards are refundable after expiry.</span></label>
          <button class="button primary full-width" :disabled="!canFund" type="submit">{{ busy ? 'Transaction in progress…' : !xEnabled ? 'X rewards await configuration' : !post ? 'Find the author first' : walletAddress ? 'Fund author reward' : 'Connect wallet to fund' }}<ArrowUpRight v-if="!busy" :size="18" /></button>
          <small class="x-form-note">No protocol fee in this testnet pilot. Network gas applies. No creator wallet is needed at funding.</small>
        </form>

        <div v-else class="manage-reward">
          <h3>A thank-you with your name on it.</h3><p>Use an X reward receipt. Wallet pilot rewards have their own studio.</p>
          <form class="lookup-form" @submit.prevent="loadReward()"><label class="sr-only" for="x-reward-id">X reward ID</label><input id="x-reward-id" v-model.trim="lookupId" :disabled="busy" inputmode="numeric" placeholder="X reward ID, e.g. 1" /><button class="button primary" :disabled="busy || lookingUp || !deployment">{{ lookingUp ? 'Loading…' : 'Look up' }} <ArrowRight :size="16" /></button></form>
          <div v-if="reward" class="receipt-card"><div class="receipt-title"><span>X REWARD #{{ loadedId }}</span><span class="pill">{{ status }}</span></div><div class="receipt-amount">{{ formatEther(reward.amount) }} <small>test ETH</small></div><dl><div><dt>Post</dt><dd><a :href="`https://x.com/i/status/${reward.postId}`" target="_blank" rel="noopener noreferrer">{{ reward.postId }} <ArrowUpRight :size="12" /></a></dd></div><div><dt>X author ID</dt><dd>{{ reward.authorId }}</dd></div><div><dt>Sender</dt><dd :title="reward.payer">{{ shortAddress(reward.payer) }}</dd></div><div><dt>Expires</dt><dd>{{ new Date(Number(reward.expiresAt) * 1000).toLocaleString() }}</dd></div></dl><div class="receipt-tools"><button :disabled="busy" @click="copyReceipt"><Copy :size="14" /> Copy X receipt</button><button :disabled="busy || lookingUp" @click="loadReward(loadedId)" aria-label="Refresh X reward"><RefreshCw :size="14" /></button></div></div>
          <div v-if="reward && active && !expired" class="x-claim-path">
            <div class="x-claim-step" :class="{ done: isAuthor }"><span>{{ isAuthor ? '✓' : '1' }}</span><div><strong>Verify the author</strong><p v-if="isAuthor">Your signed-in X account matches this reward.</p><p v-else-if="user">@{{ user.username }} is not the rewarded author. Sign out and use the matching account.</p><p v-else>Sign in with the X account whose author ID appears above.</p></div></div>
            <div class="x-claim-step" :class="{ done: !!walletAddress }"><span>{{ walletAddress ? '✓' : '2' }}</span><div><strong>Choose your wallet</strong><p>Sign a one-time ownership message, then approve the onchain claim.</p></div></div>
            <button class="button primary full-width" :disabled="busy || !xEnabled || (!!user && !isAuthor)" @click="claim">{{ busy ? 'Claim in progress…' : !xEnabled ? 'X claims await configuration' : !user ? 'Sign in with X to claim' : !isAuthor ? 'Use the rewarded X account' : !walletAddress ? 'Connect your receiving wallet' : 'Verify wallet & claim' }}<ArrowUpRight :size="18" /></button>
          </div>
          <button v-if="reward && active && expired" class="button primary full-width" :disabled="busy || (!!walletAddress && !isPayer)" @click="refund">{{ busy ? 'Transaction in progress…' : !walletAddress ? 'Connect sender wallet for refund' : isPayer ? 'Refund to sender' : 'Only the sender can request a refund' }}<ArrowUpRight :size="17" /></button>
          <div v-if="reward && !active" class="completed-note"><CircleCheck :size="19" /> This X reward is complete. Its receipt stays onchain.</div>
          <small v-if="reward" class="receipt-disclaimer">X login verifies the account through the operator’s attestation service. It does not prove that the post’s content is true, original, or endorsed.</small>
        </div>
        <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
        <div v-if="notice" class="feedback success" role="status">{{ notice }}</div>
        <a v-if="txHash" class="transaction-link" :href="`${EXPLORER}/tx/${txHash}`" target="_blank" rel="noopener noreferrer">View transaction <ExternalLink :size="13" /></a>
        <div class="studio-footer"><span>Independent. Testnet. No real money.</span><a v-if="deployment" :href="`${EXPLORER}/address/${deployment.address}`" target="_blank" rel="noopener noreferrer">X escrow contract <ArrowUpRight :size="12" /></a></div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.x-setup-loading{display:flex;align-items:center;gap:10px;padding:20px 0;color:#71847b;font-size:14px}.x-setup-notice{padding:25px;margin:12px 0 22px;border:1px solid #d8ddd0;background:#f4f3eb;border-radius:18px}.x-notice-icon{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;background:#dcf7b5;margin-bottom:16px}.x-setup-notice h3{font-size:24px;line-height:1.2;margin:0 0 12px;letter-spacing:-.8px}.x-setup-notice p{font-size:14px;line-height:1.7;color:#5c7165;margin:0 0 18px}.x-setup-notice small{display:block;color:#71847b;font-size:12px;line-height:1.6;margin-top:17px}.x-setup-actions{display:flex;align-items:center;gap:15px;flex-wrap:wrap}.x-setup-actions .button{font-size:13px;padding:13px 16px}.x-setup-actions .text-link{font-size:12px;display:inline-flex;align-items:center;gap:6px}.x-setup-guide{display:inline-flex;align-items:center;gap:7px;font-size:12px;margin-top:18px;text-decoration:underline;text-underline-offset:4px}.x-session{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0 18px;color:#71847b;font-size:12px}.x-session>span{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.x-session strong{color:#102f27}.x-session button{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:12px;color:#102f27;text-decoration:underline;text-underline-offset:4px}.x-url-row{display:flex;align-items:stretch;gap:9px}.x-url-row .input-with-icon{flex:1;min-width:0}.x-url-row .button{font-size:12px;padding:12px 15px;white-space:nowrap;border-radius:12px}.x-post-preview{border:1px solid #d8ddd0;border-radius:16px;padding:20px;background:#fff}.x-post-preview>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}.x-post-preview>div>span:last-child{font-size:11px;color:#71847b;margin-left:auto}.x-author-check{width:24px;height:24px;display:grid;place-items:center;background:#dcf7b5;border-radius:50%}.x-post-preview p{font-size:14px;line-height:1.7;margin:15px 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto}.x-post-preview a{display:inline-flex;align-items:center;gap:5px;font-size:12px;text-decoration:underline;text-underline-offset:4px}.x-form-note{font-size:11px;color:#71847b;line-height:1.6}.x-claim-path{padding-top:18px}.x-claim-step{display:flex;gap:13px;margin-bottom:19px}.x-claim-step>span{display:grid;place-items:center;flex:0 0 28px;height:28px;border:1px solid #d8ddd0;border-radius:50%;font-size:12px}.x-claim-step.done>span{background:#dcf7b5;border-color:#dcf7b5}.x-claim-step strong{font-size:14px;font-weight:600}.x-claim-step p{font-size:12px!important;line-height:1.6!important;color:#71847b;margin:4px 0 0!important}.x-studio-dialog .receipt-card dd{overflow-wrap:anywhere}.x-studio-dialog :disabled{cursor:not-allowed}.x-studio-dialog .studio-footer{flex-wrap:wrap;gap:12px}@media(max-width:600px){.x-setup-notice{padding:19px}.x-setup-notice h3{font-size:22px}.x-session{align-items:flex-start;flex-wrap:wrap}.x-url-row{flex-direction:column}.x-url-row .button{justify-content:center}.x-post-preview>div>span:last-child{margin-left:32px;width:100%}.x-setup-actions{align-items:flex-start}.x-setup-actions .button{width:100%;justify-content:center}}
</style>
