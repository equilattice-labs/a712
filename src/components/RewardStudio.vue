<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Contract, JsonRpcProvider, parseEther, formatEther, isAddress, ZeroAddress, Interface } from 'ethers'
import { ArrowUpRight, X, ArrowRight, Link2, ShieldCheck, Copy, RefreshCw, CircleCheck, Wallet, Clock3, ExternalLink } from 'lucide-vue-next'
import { parsePostUrl, shortAddress, friendlyError, RPC, EXPLORER } from '../lib'
import { walletAddress, walletBalance, walletChain, walletSigner, refreshWallet } from '../wallet'

const emit = defineEmits<{ connect: []; xRewards: [] }>()
const dialog = ref<HTMLDialogElement>()
const tab = ref('send')
const postUrl = ref('')
const recipient = ref('')
const amount = ref('0.001')
const duration = ref('604800')
const acknowledged = ref(false)
const busy = ref(false)
const notice = ref('')
const error = ref('')
const txHash = ref('')
const rewardId = ref('')
const loadedRewardId = ref('')
const loaded = ref<any>(null)
const deployment = ref<{ address: string; chainId: number } | null>(null)
const now = ref(Date.now())
let chainClock = Date.now()
let clockTick = performance.now()
let lookupSequence = 0
let ticker: ReturnType<typeof setInterval>
const abi = [
  'function createReward(string postId,address recipient,uint64 expiresAt) payable returns(uint256)',
  'function claimReward(uint256 rewardId)', 'function refundReward(uint256 rewardId)',
  'function rewards(uint256) view returns(address payer,address recipient,uint256 amount,uint64 expiresAt,uint8 status,string postId)',
  'function rewardCount() view returns(uint256)',
  'event RewardCreated(uint256 indexed rewardId,address indexed payer,address indexed recipient,string postId,uint256 amount,uint64 expiresAt)',
]
const postId = computed(() => parsePostUrl(postUrl.value))
const expired = computed(() => loaded.value && Number(loaded.value.expiresAt) * 1000 <= now.value)
const isRecipient = computed(() => loaded.value?.recipient.toLowerCase() === walletAddress.value.toLowerCase())
const isPayer = computed(() => loaded.value?.payer.toLowerCase() === walletAddress.value.toLowerCase())
const active = computed(() => loaded.value && Number(loaded.value.status) === 1)
const status = computed(() => !loaded.value ? '' : ['Not found', expired.value ? 'Ready for refund' : 'Awaiting claim', 'Claimed', 'Refunded'][Number(loaded.value.status)])

function show(preset?: string) {
  if (preset) postUrl.value = preset
  if (!dialog.value?.open) dialog.value?.showModal()
  document.body.style.overflow = 'hidden'
}
function close() { dialog.value?.close(); document.body.style.overflow = '' }
defineExpose({ show })
async function loadDeployment() {
  try {
    const response = await fetch('/deployment.json')
    if (!response.ok) throw new Error('Deployment configuration is not available.')
    const data = await response.json()
    const address = data.address || data.contractAddress
    if (!isAddress(address) || Number(data.chainId ?? data.network?.chainId) !== 46630) throw new Error('Invalid testnet deployment configuration.')
    deployment.value = { address, chainId: 46630 }
  } catch { error.value = 'The testnet deployment is not configured. Please try again later.' }
}
async function sendReward() {
  if (busy.value) return
  error.value = ''; notice.value = ''; txHash.value = ''
  if (!postId.value) { error.value = 'Paste a complete public X post URL, such as https://x.com/creator/status/123456789.'; return }
  if (!isAddress(recipient.value) || recipient.value === ZeroAddress) { error.value = 'Enter a valid, non-zero creator wallet address.'; return }
  let value: bigint
  try { value = parseEther(amount.value); if (value <= 0n || value > parseEther('0.1')) throw new Error() }
  catch { error.value = 'Choose an amount greater than 0 and no more than 0.1 test ETH.'; return }
  if (!acknowledged.value) { error.value = 'Confirm the recipient wallet belongs to the intended creator.'; return }
  if (!walletAddress.value) { emit('connect'); return }
  if (!deployment.value) { error.value = 'Contract configuration is unavailable.'; return }
  busy.value = true
  try {
    const signer = await walletSigner()
    const contract = new Contract(deployment.value.address, abi, signer)
    const latest = await signer.provider.getBlock('latest')
    const expiry = (latest?.timestamp ?? Math.floor(Date.now() / 1000)) + Number(duration.value)
    notice.value = 'Review the reward in your wallet.'
    const tx = await contract.createReward(postId.value, recipient.value, expiry, { value, chainId: 46630 })
    txHash.value = tx.hash; notice.value = 'Transaction submitted. Waiting for onchain confirmation…'
    const receipt = await tx.wait()
    const iface = new Interface(abi)
    let createdId = ''
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== deployment.value.address.toLowerCase()) continue
      try { const parsed = iface.parseLog(log); if (parsed?.name === 'RewardCreated') createdId = String(parsed.args[0]) } catch { /* other events */ }
    }
    if (!createdId) throw new Error('Transaction confirmed, but the receipt could not be decoded. Check the transaction link before trying again.')
    rewardId.value = createdId
    notice.value = `Reward #${rewardId.value} is funded. Share its receipt with the creator.`
    tab.value = 'manage'; await loadReward(); await refreshWallet()
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false }
}
async function loadReward() {
  const requestSequence = ++lookupSequence
  const requestedId = rewardId.value
  error.value = ''; loaded.value = null
  loadedRewardId.value = ''
  if (!/^\d+$/.test(rewardId.value) || BigInt(rewardId.value) < 1n) { error.value = 'Enter a reward ID of 1 or higher.'; return }
  if (!deployment.value) { error.value = 'Contract configuration is unavailable.'; return }
  try {
    const provider = new JsonRpcProvider(RPC, 46630, { staticNetwork: true })
    const [data, latestBlock] = await Promise.all([
      new Contract(deployment.value.address, abi, provider).rewards(requestedId), provider.getBlock('latest'),
    ])
    if (requestSequence !== lookupSequence) return
    if (Number(data.status) === 0) throw new Error('No reward exists with this ID.')
    if (latestBlock) { chainClock = latestBlock.timestamp * 1000; clockTick = performance.now(); now.value = chainClock }
    loadedRewardId.value = requestedId
    loaded.value = data
  } catch (e) { if (requestSequence === lookupSequence) error.value = friendlyError(e) }
}
async function act(action: 'claimReward' | 'refundReward') {
  if (busy.value || !loadedRewardId.value) return
  if (!walletAddress.value) { emit('connect'); return }
  if (!deployment.value) return
  busy.value = true; error.value = ''; notice.value = ''; txHash.value = ''
  try {
    const signer = await walletSigner()
    const actionId = loadedRewardId.value
    const tx = await new Contract(deployment.value.address, abi, signer)[action](actionId, { chainId: 46630 })
    txHash.value = tx.hash; notice.value = 'Transaction submitted. Waiting for confirmation…'
    await tx.wait(); rewardId.value = actionId; await loadReward(); await refreshWallet()
    notice.value = action === 'claimReward' ? 'Reward claimed. The test ETH is in your wallet.' : 'Reward refunded to the original sender.'
  } catch (e) { error.value = friendlyError(e); notice.value = '' }
  finally { busy.value = false }
}
async function copyReceipt() {
  const url = new URL(window.location.origin); url.searchParams.set('reward', loadedRewardId.value)
  try { await navigator.clipboard.writeText(url.toString()); notice.value = 'Receipt link copied.' }
  catch { notice.value = `Your receipt: ${url.toString()}` }
}
onMounted(async () => {
  ticker = setInterval(() => { now.value = chainClock + performance.now() - clockTick }, 1000)
  await loadDeployment()
  const id = new URLSearchParams(location.search).get('reward')
  if (id) { rewardId.value = id; tab.value = 'manage'; show(); await loadReward() }
})
onUnmounted(() => { clearInterval(ticker); document.body.style.overflow = '' })
</script>

<template>
  <dialog ref="dialog" class="studio-dialog" @close="close" @click="e => { if (e.target === dialog) close() }">
    <div class="studio-shell">
      <aside class="studio-sidebar">
        <a class="brand" href="#" @click.prevent="close"><img src="/logo.svg" alt="" />voxdue</a>
        <span class="eyebrow"><span class="live-dot"></span> THE TESTNET STUDIO</span>
        <h2>A good post.<br>A real thank you.</h2>
        <p>Send a little appreciation. Follow every step onchain.</p>
        <div class="studio-orb"><span>✳</span></div>
        <div class="sidebar-facts"><span><ShieldCheck :size="16" /> Non-custodial escrow</span><span><Clock3 :size="16" /> Refund after expiry</span><span><Link2 :size="16" /> Robinhood Chain testnet</span></div>
        <small>Test ETH has no monetary value. No X ownership verification in this wallet pilot.</small>
      </aside>
      <div class="studio-content">
        <div class="studio-top"><span class="pill">WALLET PILOT</span><button class="studio-mode-switch" @click="close(); emit('xRewards')">X author rewards <ArrowUpRight :size="13" /></button><button class="icon-button" aria-label="Close reward studio" @click="close"><X :size="21" /></button></div>
        <div class="studio-tabs" role="tablist" aria-label="Reward actions"><button role="tab" :disabled="busy" :aria-selected="tab === 'send'" :class="{ active: tab === 'send' }" @click="tab = 'send'; error = ''; notice = ''">Send a reward <ArrowUpRight :size="16" /></button><button role="tab" :disabled="busy" :aria-selected="tab === 'manage'" :class="{ active: tab === 'manage' }" @click="tab = 'manage'; error = ''; notice = ''">Claim / refund <ArrowRight :size="16" /></button></div>
        <div class="studio-wallet"><span><span class="live-dot" :class="{ offline: !walletAddress }"></span>{{ walletAddress ? shortAddress(walletAddress) : 'No wallet connected' }}<small v-if="walletBalance"> · {{ walletBalance }} test ETH</small><small v-else-if="walletAddress && walletChain !== 46630"> · switch required</small></span><button @click="emit('connect')">{{ walletAddress ? 'Manage' : 'Connect' }} <Wallet :size="14" /></button></div>
        <form v-if="tab === 'send'" class="reward-form" @submit.prevent="sendReward">
          <div><h3>Make someone’s post.</h3><p>Pick the post. Choose the amount. Send the appreciation.</p></div>
          <label>X post URL <div class="input-with-icon"><Link2 :size="17" /><input v-model="postUrl" type="url" placeholder="https://x.com/creator/status/…" autocomplete="off" required :disabled="busy" /></div></label>
          <label>Creator’s wallet address <input v-model.trim="recipient" placeholder="0x…" required autocomplete="off" :disabled="busy" /><small>Ask the creator for their wallet. X post ownership is not verified.</small></label>
          <div class="field-row"><label>Amount <div class="amount-input"><input v-model="amount" inputmode="decimal" aria-label="Reward amount" :disabled="busy" /><span>test ETH</span></div></label><label>Claim window <select v-model="duration" :disabled="busy"><option value="3600">1 hour</option><option value="86400">1 day</option><option value="604800">7 days</option><option value="2592000">30 days</option></select></label></div>
          <div class="amount-options"><button v-for="value in ['0.0001', '0.001', '0.005']" :key="value" type="button" :class="{ selected: amount === value }" @click="amount = value" :disabled="busy">{{ value }}</button><span>0% protocol fee + network gas</span></div>
          <label class="checkbox-label"><input v-model="acknowledged" type="checkbox" :disabled="busy" /> <span>I checked the recipient wallet. Only this wallet can claim; unclaimed funds are refundable after expiry.</span></label>
          <button class="button primary full-width" type="submit" :disabled="busy || !deployment">{{ busy ? 'Transaction in progress…' : walletAddress ? 'Send reward' : 'Connect wallet to send' }}<ArrowUpRight v-if="!busy" :size="19" /></button>
          <a class="faucet-link" href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noopener noreferrer">Need test ETH? Open the official faucet <ExternalLink :size="12" /></a>
        </form>
        <div v-else class="manage-reward">
          <h3>Follow the good.</h3><p>Open a receipt to claim a reward or refund an expired one.</p>
          <form class="lookup-form" @submit.prevent="loadReward"><label class="sr-only" for="reward-id">Reward ID</label><input id="reward-id" v-model.trim="rewardId" :disabled="busy" inputmode="numeric" placeholder="Reward ID, e.g. 1" /><button class="button primary" :disabled="busy">Look up <ArrowRight :size="17" /></button></form>
          <div v-if="loaded" class="receipt-card"><div class="receipt-title"><span>REWARD #{{ loadedRewardId }}</span><span class="pill">{{ status }}</span></div><div class="receipt-amount">{{ formatEther(loaded.amount) }} <small>test ETH</small></div><dl><div><dt>Post</dt><dd><a :href="`https://x.com/i/status/${loaded.postId}`" target="_blank" rel="noopener noreferrer">{{ loaded.postId }} <ArrowUpRight :size="12" /></a></dd></div><div><dt>Sender</dt><dd :title="loaded.payer">{{ shortAddress(loaded.payer) }}</dd></div><div><dt>Recipient</dt><dd :title="loaded.recipient">{{ shortAddress(loaded.recipient) }}</dd></div><div><dt>Expires</dt><dd>{{ new Date(Number(loaded.expiresAt) * 1000).toLocaleString() }}</dd></div></dl><div class="receipt-tools"><button @click="copyReceipt"><Copy :size="14" /> Copy receipt</button><button @click="loadReward" :disabled="busy" aria-label="Refresh receipt"><RefreshCw :size="14" /></button></div></div>
          <button v-if="active && !expired" class="button primary full-width" :disabled="busy || (!!walletAddress && !isRecipient)" @click="act('claimReward')">{{ !walletAddress ? 'Connect wallet to claim' : isRecipient ? 'Claim reward' : 'Only the recipient wallet can claim' }}<ArrowUpRight :size="17" /></button>
          <button v-if="active && expired" class="button primary full-width" :disabled="busy || (!!walletAddress && !isPayer)" @click="act('refundReward')">{{ !walletAddress ? 'Connect wallet for refund' : isPayer ? 'Refund to sender' : 'Only the sender can request a refund' }}<ArrowUpRight :size="17" /></button>
          <div v-if="loaded && !active" class="completed-note"><CircleCheck :size="19" /> This reward is complete. Its history stays onchain.</div>
          <small v-if="loaded" class="receipt-disclaimer">A receipt proves the wallet transfer, not ownership of the X post.</small>
        </div>
        <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
        <div v-if="notice" class="feedback success" role="status">{{ notice }}</div>
        <a v-if="txHash" class="transaction-link" :href="`${EXPLORER}/tx/${txHash}`" target="_blank" rel="noopener noreferrer">View transaction <ExternalLink :size="13" /></a>
        <div class="studio-footer"><span>Independent. Open source. Testnet.</span><a v-if="deployment" :href="`${EXPLORER}/address/${deployment.address}`" target="_blank" rel="noopener noreferrer">View contract <ArrowUpRight :size="12" /></a></div>
      </div>
    </div>
  </dialog>
</template>
