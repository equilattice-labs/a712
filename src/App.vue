<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ArrowUpRight, Plus, Minus, X, Wallet, Menu, ShieldCheck, Clock3, Link2, CircleCheck, ExternalLink, Activity, Layers3, ReceiptText } from 'lucide-vue-next'
import RewardStudio from './components/RewardStudio.vue'
import XStudio from './components/XStudio.vue'
import RewardsApp from './components/RewardsApp.vue'
import { wallets, walletAddress, walletBalance, walletChain, connectWallet, disconnectWallet, discoverWallets } from './wallet'
import { shortAddress, friendlyError, CHAIN_ID, EXPLORER } from './lib'

const studio = ref<InstanceType<typeof RewardStudio>>()
const xStudio = ref<InstanceType<typeof XStudio>>()
const rewardsApp = ref<InstanceType<typeof RewardsApp>>()
const walletDialog = ref<HTMLDialogElement>()
const infoDialog = ref<HTMLDialogElement>()
const infoType = ref('privacy')
const mobileMenu = ref(false)
const walletError = ref('')
const connecting = ref(false)
const activeFaq = ref<number | null>(0)
const onTestnet = computed(() => !!walletAddress.value && walletChain.value === CHAIN_ID)
const walletStatus = computed(() => !walletAddress.value ? 'Not connected' : onTestnet.value ? 'Robinhood testnet' : 'Switch network required')
const faq = [
  { q: 'What is Meritiva?', a: 'Meritiva connects appreciation for a public X post with an onchain reward. The author-rewards app supports test ETH, a tUSD demo token, a public note and a 90-day claim window. You can follow every reward in a public receipt. A separate wallet pilot is also available.' },
  { q: 'Is this real money?', a: 'No. This release runs on Robinhood Chain testnet. Test ETH and tUSD have no monetary value. tUSD is a mintable demo token, not USDG, not a stablecoin backed by dollars, and not redeemable. There is no investment offering or promise of returns.' },
  { q: 'How does the creator receive a reward?', a: 'In author mode, the creator signs in with X, proves control of a payout wallet and claims a wallet-bound authorization. This service remains disabled until the operator configures and verifies X API access. The separate wallet pilot works now with an explicit recipient address, which the sender must verify directly.' },
  { q: 'What if a reward is never claimed?', a: 'Author rewards expire after 90 days. An unclaimed reward then becomes fully refundable to the original sender, with no protocol fee. The sender requests the refund in their wallet. The older wallet pilot uses its own shorter, selected deadline; each receipt shows the exact expiry.' },
  { q: 'What are the fees?', a: 'Author rewards deduct 3% only when claimed, leaving 97% for the creator. There is no funding fee or refund fee. Network gas is separate. A configured, funded relayer may sponsor claim gas within its budget; otherwise the wallet pays it. The separate wallet pilot charges 0% protocol fees. All current assets are valueless test tokens.' },
  { q: 'Is Meritiva affiliated with X or Robinhood Chain?', a: 'No. Meritiva is an independent project built on the public Robinhood Chain testnet. X and Robinhood Chain do not endorse this project. The pilot contract is experimental and has not received an independent security audit.' },
]

function openStudio() { mobileMenu.value = false; rewardsApp.value?.show() }
function openWalletPilot() { mobileMenu.value = false; studio.value?.show() }
function openXStudio() { mobileMenu.value = false; xStudio.value?.show() }
function openWallet() { walletError.value = ''; walletDialog.value?.showModal() }
async function selectWallet(id: string) {
  const option = wallets.value.find(w => w.id === id)
  if (!option) return
  connecting.value = true; walletError.value = ''
  try { await connectWallet(option); walletDialog.value?.close() }
  catch (e) { walletError.value = friendlyError(e) }
  finally { connecting.value = false }
}
function openInfo(type: string) { infoType.value = type; infoDialog.value?.showModal() }
onMounted(discoverWallets)
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a href="#" class="brand" aria-label="Meritiva home"><img src="/logo.svg" alt="" />meritiva<span class="brand-badge">TESTNET</span></a>
    <nav class="desktop-nav" aria-label="Main navigation"><a class="active" href="#main"><Layers3 :size="15" /> Overview</a><a href="#why">Rewards</a><a href="#how">How it works</a><a href="/docs/technical-overview.html" target="_blank" rel="noopener noreferrer">Docs <ArrowUpRight :size="12" /></a></nav>
    <div class="header-actions"><button class="wallet-nav" @click="openWallet"><Wallet :size="16" />{{ walletAddress ? shortAddress(walletAddress) : 'Connect wallet' }}</button><button class="button primary small" @click="openStudio">Open app <ArrowUpRight :size="16" /></button><button class="icon-button mobile-menu-button" aria-label="Toggle navigation" :aria-expanded="mobileMenu" @click="mobileMenu = !mobileMenu"><X v-if="mobileMenu" :size="22" /><Menu v-else :size="22" /></button></div>
    <nav v-if="mobileMenu" class="mobile-nav" aria-label="Mobile navigation"><a href="#why" @click="mobileMenu = false">Rewards</a><a href="#how" @click="mobileMenu = false">How it works</a><a href="#roadmap" @click="mobileMenu = false">Build status</a><button @click="openWallet(); mobileMenu = false">{{ walletAddress ? 'Manage wallet' : 'Choose wallet' }}</button></nav>
  </header>

  <main id="main" class="workspace section-wrap">
    <section class="terminal-overview" aria-labelledby="terminal-title">
      <div class="terminal-overview-head">
        <div><div class="eyebrow">THE ONCHAIN REWARD DESK</div><h1 id="terminal-title">Back the signal.</h1><p>Turn a useful X post into a reward on Robinhood Chain.</p></div>
        <div class="chain-badge"><img src="/brand-mark.svg" alt="" /><span>Robinhood Chain<small>Testnet &middot; Chain ID {{ CHAIN_ID }}</small></span></div>
      </div>
      <div class="terminal-grid">
        <article class="terminal-balance-panel">
          <div class="terminal-panel-label">WALLET BALANCE <span class="connection-badge" :class="{ connected: onTestnet }"><span class="live-dot" :class="{ offline: !onTestnet }"></span>{{ walletStatus }}</span></div>
          <div class="terminal-balance-value">{{ onTestnet && walletBalance ? walletBalance : '\u2014' }} <small>test ETH</small></div>
          <div class="terminal-balance-meta"><span>{{ walletAddress ? shortAddress(walletAddress) : 'Connect a wallet to view your balance' }}</span><button @click="openWallet">{{ walletAddress ? 'Manage wallet' : 'Choose wallet' }} <ArrowUpRight :size="14" /></button></div>
          <p v-if="walletAddress && !onTestnet" class="terminal-balance-help">Your wallet will request a network switch before sending a reward.</p>
          <p v-else-if="walletAddress && !walletBalance" class="terminal-balance-help">Balance is unavailable. Reconnect your wallet to retry.</p>
          <p v-else class="terminal-balance-help">Test ETH is used for rewards and network gas. It has no monetary value.</p>
        </article>
        <article class="terminal-activity-panel">
          <div class="terminal-panel-label"><Activity :size="15" /> YOUR REWARDS</div>
          <h2>Every reward.<br>One clear receipt.</h2>
          <p>Review sent, received and public activity in the rewards app.</p>
          <button class="text-link" @click="openStudio">View rewards <ArrowUpRight :size="15" /></button>
        </article>
        <article class="terminal-rules-panel">
          <div class="terminal-panel-label">AUTHOR REWARD RULES</div>
          <dl><div><dt>Creator receives</dt><dd>97<span>%</span></dd></div><div><dt>Claim window</dt><dd>90 <span>days</span></dd></div><div><dt>Unclaimed refund</dt><dd>100<span>%</span></dd></div></dl>
          <span class="terminal-rule-note">3% fee only when claimed &middot; Gas separate</span>
        </article>
      </div>
    </section>

    <section id="why" class="reward-workspace" aria-labelledby="reward-workspace-title">
      <div class="section-heading"><div><span class="eyebrow">CHOOSE YOUR ROUTE</span><h2 id="reward-workspace-title">Send a reward</h2></div><span class="subtle-label">TEST ASSETS ONLY</span></div>
      <div class="reward-routes">
        <article class="route-card route-author"><div class="route-top"><span class="route-icon"><Link2 :size="23" /></span><span class="pill">X AUTHOR REWARDS</span></div><h3>A post worth backing.</h3><p>Choose a public X post, add test ETH or tUSD, and leave a public note. The verified author claims to their wallet.</p><div class="route-assets"><span><b>&#x039E;</b> Test ETH</span><span><b>$</b> tUSD demo</span></div><button class="button primary full-width" @click="openStudio">New reward <Plus :size="18" /></button><small>X author lookup and claims require the identity service.</small></article>
        <article class="route-card"><div class="route-top"><span class="route-icon"><Wallet :size="23" /></span><span class="pill">DIRECT WALLET PILOT</span></div><h3>Know their wallet?</h3><p>Send test ETH to an explicit recipient. Choose the claim deadline, then share the receipt to claim or refund.</p><div class="route-features"><span><CircleCheck :size="15" /> 0% protocol fee</span><span><Clock3 :size="15" /> 1 hour to 30 days</span></div><button class="button secondary full-width" @click="openWalletPilot">Open wallet pilot <ArrowUpRight :size="18" /></button><small>Confirm the address directly. This route does not verify X ownership.</small></article>
        <aside id="trust" class="receipt-guide"><div class="receipt-guide-icon"><ReceiptText :size="26" /></div><h3>Follow the funds.</h3><p>Each reward gets a public receipt with its amount, recipient and expiry.</p><ol><li><span>01</span> Fund in your wallet</li><li><span>02</span> Share the receipt</li><li><span>03</span> Claim or refund onchain</li></ol><a :href="EXPLORER" target="_blank" rel="noopener noreferrer">Open testnet explorer <ExternalLink :size="14" /></a></aside>
      </div>
    </section>

    <section id="how" class="workflow-panel" aria-labelledby="workflow-title"><div class="section-heading"><h2 id="workflow-title">From post to payout</h2><span class="subtle-label">AUTHOR REWARDS</span></div><div class="workflow-steps"><article><span>1</span><div><h3>Find the post</h3><p>Paste a public X URL and check its author.</p></div></article><article><span>2</span><div><h3>Fund the reward</h3><p>Choose an asset, review the fee and approve in your wallet.</p></div></article><article><span>3</span><div><h3>Creator claims</h3><p>The author verifies X and their payout wallet. Unclaimed rewards are refundable after 90 days.</p></div></article></div></section>

    <div class="workspace-bottom"><section id="roadmap" class="build-panel"><div class="section-heading"><h2>Build status</h2><span class="pill">TESTNET</span></div><div class="build-row"><CircleCheck :size="17" /><div><strong>Wallet rewards & receipts</strong><p>Direct rewards, claims and expiry refunds.</p></div></div><div class="build-row"><ShieldCheck :size="17" /><div><strong>Author verification</strong><p>Built. Availability depends on configured X access.</p></div></div><a class="text-link" href="/docs/business-plan.html" target="_blank" rel="noopener noreferrer">Read the project plan <ArrowUpRight :size="14" /></a></section>
    <section id="faq" class="faq-section"><div class="section-heading"><h2>Know before you send</h2></div><div class="faq-list"><article v-for="(item, i) in faq" :key="item.q"><button :aria-expanded="activeFaq === i" :aria-controls="`faq-${i}`" @click="activeFaq = activeFaq === i ? null : i">{{ item.q }}<Minus v-if="activeFaq === i" :size="16" /><Plus v-else :size="16" /></button><div v-show="activeFaq === i" :id="`faq-${i}`"><p>{{ item.a }}</p></div></article></div></section></div>
  </main>

  <footer class="site-footer section-wrap"><div class="footer-top"><a href="#" class="brand"><img src="/logo.svg" alt="" />meritiva</a><p>Reward the signal.</p><button @click="openWalletPilot">Wallet pilot <ArrowUpRight :size="14" /></button><button @click="openInfo('social')">@meritiva <ArrowUpRight :size="14" /></button><a href="/docs/technical-overview.html" target="_blank" rel="noopener noreferrer">Docs <ArrowUpRight :size="14" /></a></div><div class="footer-bottom"><span>&copy; {{ new Date().getFullYear() }} Meritiva</span><div><button @click="openInfo('privacy')">Privacy</button><button @click="openInfo('terms')">Testnet terms</button><span>Robinhood Chain testnet</span></div></div><p class="footer-disclaimer">Independent project. Not affiliated with X or Robinhood Chain. Test tokens have no monetary value. Contracts are experimental and unaudited.</p></footer>

  <RewardStudio ref="studio" @connect="openWallet" @xRewards="openXStudio" />
  <XStudio ref="xStudio" @connect="openWallet" @walletPilot="openWalletPilot" />
  <RewardsApp ref="rewardsApp" @connect="openWallet" @walletPilot="openWalletPilot" />
  <dialog ref="walletDialog" class="small-dialog" @click="e => { if (e.target === walletDialog) walletDialog?.close() }"><div class="small-dialog-top"><span class="eyebrow">YOUR ONCHAIN CONNECTION</span><button class="icon-button" aria-label="Close wallet dialog" @click="walletDialog?.close()"><X :size="22" /></button></div><div class="wallet-large-icon"><Wallet :size="28" /></div><h2>{{ walletAddress ? 'You’re connected.' : 'Bring your wallet.' }}</h2><p>Use an Ethereum-compatible browser wallet to explore Robinhood Chain testnet.</p><template v-if="walletAddress"><div class="connected-address">{{ walletAddress }}</div><p v-if="walletBalance">{{ walletBalance }} test ETH</p><button class="button primary full-width" @click="disconnectWallet(); walletDialog?.close()">Disconnect from Meritiva</button><small>Disconnecting clears this app’s session. Manage site permissions in your wallet.</small></template><template v-else><button v-for="wallet in wallets" :key="wallet.id" class="wallet-option" :disabled="connecting" @click="selectWallet(wallet.id)"><Wallet :size="21" /><span>{{ wallet.name }}</span><ArrowUpRight :size="18" /></button><div v-if="!wallets.length" class="no-wallet"><p>No browser wallet detected.</p><a class="button primary full-width" href="https://metamask.io/download" target="_blank" rel="noopener noreferrer">Get an Ethereum wallet <ExternalLink :size="17" /></a><small>Install a wallet, then reload this page. Never share your recovery phrase or private key.</small></div></template><p v-if="walletError" role="alert" class="feedback error">{{ walletError }}</p><div class="wallet-dialog-note"><ShieldCheck :size="15" /> Connecting does not move funds.</div></dialog>
  <dialog ref="infoDialog" class="small-dialog info-dialog" @click="e => { if (e.target === infoDialog) infoDialog?.close() }"><div class="small-dialog-top"><span class="eyebrow">A LITTLE CLARITY</span><button class="icon-button" aria-label="Close information" @click="infoDialog?.close()"><X :size="22" /></button></div><template v-if="infoType === 'privacy'"><h2>Privacy, plainly.</h2><p>The wallet pilot has no account database, analytics trackers or email collection. Wallet access requires your approval. The optional X service uses an HTTP-only session cookie and stores your public X identity temporarily in server memory.</p><p>Transactions, wallet addresses, amounts and post IDs are public onchain. The RPC provider and your wallet receive requests needed to operate the app. External links use their own privacy policies.</p><p>Public notes, post IDs and transfers are recorded onchain. Do not include private information. If enabled, X login requests only account and post read access; OAuth access tokens are discarded after identity lookup.</p></template><template v-else-if="infoType === 'terms'"><h2>A playground<br>with clear rules.</h2><p>Meritiva is experimental software on Robinhood Chain testnet. Test ETH has no monetary value. Use only test funds.</p><p>Rewards are locked until the recipient claims or the expiry allows the sender to request a refund. The wallet pilot does not verify X ownership. Author mode relies on a trusted verification service; its signing key can authorize payouts. Its 3% claim fee and 90-day expiry are shown before funding.</p><p>Contracts are unaudited. Network availability and successful transactions are not guaranteed. No financial returns, affiliation, or production readiness are claimed.</p></template><template v-else><h2>Good voices.<br>Coming together.</h2><p>Our selected public identity is <strong>@meritiva</strong>, paired with <strong>meritiva.xyz</strong>.</p><p>The domain was found without an RDAP object and no public X profile was found at check time. X signup eligibility remains unverified. Neither identity has been registered or secured.</p><a href="https://x.com/meritiva" target="_blank" rel="noopener noreferrer" class="button primary full-width">Check @meritiva on X <ArrowUpRight :size="17" /></a></template></dialog>
</template>
