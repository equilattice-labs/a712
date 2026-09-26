<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ArrowUpRight, ArrowRight, Plus, Minus, Heart, MessageCircle, Repeat2, Bookmark, Check, Copy, X, Wallet, Menu, ShieldCheck, Clock3, Link2, CircleCheck, ExternalLink } from 'lucide-vue-next'
import RewardStudio from './components/RewardStudio.vue'
import XStudio from './components/XStudio.vue'
import RewardsApp from './components/RewardsApp.vue'
import { wallets, walletAddress, walletBalance, connectWallet, disconnectWallet, discoverWallets } from './wallet'
import { shortAddress, friendlyError } from './lib'

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
const selectedAmount = ref('0.001')
let observer: IntersectionObserver
const faq = [
  { q: 'What is Voxaura?', a: 'Voxaura connects appreciation for a public X post with an onchain reward. The author-rewards app supports test ETH, a tUSD demo token, a public note and a 90-day claim window. You can follow every reward in a public receipt. A separate wallet pilot is also available.' },
  { q: 'Is this real money?', a: 'No. This release runs on Robinhood Chain testnet. Test ETH and tUSD have no monetary value. tUSD is a mintable demo token, not USDG, not a stablecoin backed by dollars, and not redeemable. There is no investment offering or promise of returns.' },
  { q: 'How does the creator receive a reward?', a: 'In author mode, the creator signs in with X, proves control of a payout wallet and claims a wallet-bound authorization. This service remains disabled until the operator configures and verifies X API access. The separate wallet pilot works now with an explicit recipient address, which the sender must verify directly.' },
  { q: 'What if a reward is never claimed?', a: 'Author rewards expire after 90 days. An unclaimed reward then becomes fully refundable to the original sender, with no protocol fee. The sender requests the refund in their wallet. The older wallet pilot uses its own shorter, selected deadline; each receipt shows the exact expiry.' },
  { q: 'What are the fees?', a: 'Author rewards deduct 3% only when claimed, leaving 97% for the creator. There is no funding fee or refund fee. Network gas is separate. A configured, funded relayer may sponsor claim gas within its budget; otherwise the wallet pays it. The separate wallet pilot charges 0% protocol fees. All current assets are valueless test tokens.' },
  { q: 'Is Voxaura affiliated with X or Robinhood Chain?', a: 'No. Voxaura is an independent project built on the public Robinhood Chain testnet. X and Robinhood Chain do not endorse this project. The pilot contract is experimental and has not received an independent security audit.' },
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
onMounted(() => {
  discoverWallets()
  observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target) } }), { threshold: 0.1 })
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el))
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="announcement"><span class="live-dot"></span> A little appreciation. A whole new possibility. <button @click="openStudio">Testnet is open <ArrowUpRight :size="13" /></button></div>
  <header class="site-header">
    <a href="#" class="brand" aria-label="Voxaura home"><img src="/logo.svg" alt="" />voxaura</a>
    <nav class="desktop-nav" aria-label="Main navigation"><a href="#why">The idea</a><a href="#how">How it works</a><a href="#roadmap">What’s next</a><a href="/docs/business-plan.html" target="_blank" rel="noopener noreferrer">Our vision <ArrowUpRight :size="13" /></a></nav>
    <div class="header-actions"><button class="wallet-nav" @click="openWallet"><Wallet :size="16" />{{ walletAddress ? shortAddress(walletAddress) : 'Connect wallet' }}</button><button class="button dark small" @click="openStudio">Open app <ArrowUpRight :size="16" /></button><button class="icon-button mobile-menu-button" aria-label="Toggle navigation" :aria-expanded="mobileMenu" @click="mobileMenu = !mobileMenu"><X v-if="mobileMenu" :size="23" /><Menu v-else :size="23" /></button></div>
    <nav v-if="mobileMenu" class="mobile-nav" aria-label="Mobile navigation"><a href="#why" @click="mobileMenu = false">The idea</a><a href="#how" @click="mobileMenu = false">How it works</a><a href="#roadmap" @click="mobileMenu = false">What’s next</a><button @click="openWallet(); mobileMenu = false">Connect wallet</button></nav>
  </header>

  <main id="main">
    <section class="terminal-overview section-wrap" aria-labelledby="terminal-title">
      <div class="terminal-overview-head">
        <div>
          <div class="eyebrow terminal-status"><span class="live-dot"></span> ROBINHOOD CHAIN TESTNET <span class="terminal-status-separator">/</span> REWARD TERMINAL</div>
          <h1 id="terminal-title">Reward terminal</h1>
          <p>Fund a creator reward, review its receipt, and keep every settlement visible onchain.</p>
        </div>
        <div class="terminal-actions">
          <button class="button primary" @click="openStudio"><Plus :size="17" /> New reward</button>
          <button class="button terminal-secondary" @click="openWallet"><Wallet :size="16" /> {{ walletAddress ? shortAddress(walletAddress) : 'Connect wallet' }}</button>
        </div>
      </div>
      <div class="terminal-grid">
        <article class="terminal-balance-panel">
          <div class="terminal-panel-label">AVAILABLE BALANCE <span class="terminal-live">LIVE</span></div>
          <div class="terminal-balance-value">{{ walletBalance || '0.000000' }} <small>test ETH</small></div>
          <div class="terminal-balance-meta"><span>{{ walletAddress ? shortAddress(walletAddress) : 'Wallet not connected' }}</span><button @click="openWallet">Manage <ArrowUpRight :size="13" /></button></div>
          <div class="terminal-balance-line"><span style="width: 34%"></span></div>
          <div class="terminal-balance-foot"><span>Gas budget</span><strong>Testnet only</strong></div>
        </article>
        <article class="terminal-metric-panel">
          <div class="terminal-panel-label">REWARD ACTIVITY <span>LAST 30 DAYS</span></div>
          <div class="terminal-metric-row"><strong>0</strong><span>Sent</span><b>--</b></div>
          <div class="terminal-metric-row"><strong>0</strong><span>Claimed</span><b>--</b></div>
          <div class="terminal-metric-row"><strong>0</strong><span>Pending</span><b>--</b></div>
        </article>
        <article class="terminal-quick-panel">
          <div class="terminal-panel-label">QUICK START</div>
          <button @click="openStudio"><span class="terminal-quick-icon"><Link2 :size="16" /></span><span><strong>Send from a post</strong><small>Paste an X post URL</small></span><ArrowUpRight :size="15" /></button>
          <button @click="openWalletPilot"><span class="terminal-quick-icon"><Wallet :size="16" /></span><span><strong>Open wallet pilot</strong><small>Use a direct recipient</small></span><ArrowUpRight :size="15" /></button>
        </article>
      </div>
      <div class="terminal-ticker" role="status"><span class="live-dot"></span><span>NETWORK HEALTHY</span><span>Block time 2.1s</span><span>Protocol fee 3% on author claims</span><span class="terminal-ticker-end">Test assets have no monetary value</span></div>
    </section>

    <section class="hero section-wrap">
      <div class="hero-copy">
        <div class="eyebrow"><span class="mini-spark">*</span> GOOD CONTENT. REAL APPRECIATION.</div>
        <h1>Good posts<br>deserve more<br>than <span class="serif-word">likes.<svg viewBox="0 0 250 22" aria-hidden="true"><path d="M3 15Q110 -5 244 12M22 21Q143 9 216 17" /></svg></span></h1>
        <p class="hero-description">That thread that changed your mind.<br>That idea that made your day.<br>Give the voice behind it a little more.</p>
        <div class="hero-ctas"><button class="button primary" @click="openStudio">Make someone’s post <ArrowUpRight :size="20" /></button><a class="text-link" href="#how">See how it works <ArrowRight :size="17" /></a></div>
        <div class="hero-caption"><span class="live-dot"></span> Built on Robinhood Chain <span class="caption-divider">/</span> Testnet pilot</div>
      </div>
      <div class="hero-art" aria-label="Illustration of rewarding a thoughtful post. Example only.">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div>
        <div class="art-coordinate coord-top">A BETTER KIND OF ENGAGEMENT *</div>
        <div class="floating-token token-one"><img src="/logo.svg" alt="" /></div><div class="floating-token token-two">*</div>
        <div class="float-tag tag-thanks"><Heart :size="16" fill="currentColor" /> More than a like.</div>
        <div class="post-card">
          <div class="post-card-top"><div class="avatar avatar-lena">l<span>*</span></div><div><strong>Lena Rivers <span class="verified"><Check :size="10" /></span></strong><span>@lena_creates · example</span></div><span class="x-mark">𝕏</span></div>
          <p>The best thing about the internet?<br><br>Someone, somewhere, is sharing the exact thing you needed to hear.</p>
          <div class="post-footer"><span><MessageCircle :size="16" /> 12</span><span><Repeat2 :size="17" /> 28</span><span><Heart :size="16" /> 164</span><Bookmark :size="16" /></div>
          <div class="post-reward"><span class="reward-spark">*</span><span>A little love, onchain<small>Good voices deserve their due.</small></span><ArrowUpRight :size="20" /></div>
        </div>
        <div class="reward-float"><div class="reward-float-label"><span class="live-dot"></span> A THANK YOU THAT GOES FURTHER <ArrowUpRight :size="15" /></div><div class="float-amount">{{ selectedAmount }} <small>test ETH</small><span>*</span></div><div class="float-amount-options"><button v-for="a in ['0.0001', '0.001', '0.005']" :key="a" :class="{ active: selectedAmount === a }" @click="selectedAmount = a">{{ a }}</button><button aria-label="Open reward studio" @click="openStudio"><Plus :size="17" /></button></div></div>
        <div class="float-tag tag-receipt"><CircleCheck :size="16" /> Appreciation, with a receipt.</div>
        <span class="art-caption">ILLUSTRATIVE POST · TEST TOKENS ONLY</span>
        <span class="hand-spark">*</span>
      </div>
    </section>

    <section class="principle-strip"><div><span>Less noise.</span><strong>More signal.</strong><span class="strip-star">*</span><span>Less scrolling.</span><strong>More meaning.</strong><span class="strip-star">*</span><span>Good voices.</span><strong>Their due.</strong><span class="strip-star">*</span></div></section>

    <section id="why" class="why-section section-wrap reveal">
      <div class="section-intro"><div class="eyebrow"><span class="section-number">01 /</span> THE IDEA IS SIMPLE</div><h2>The internet has likes.<br>Let’s give it <span class="serif-word">thank-yous.</span></h2><p>A thoughtful explanation. An independent investigation. A tiny moment of joy. Value shows up everywhere. Now appreciation can, too.</p></div>
      <div class="value-cards"><article class="value-card value-green"><span class="card-index">FOR THE CURIOUS</span><div class="value-illustration conversation-art"><div>“This finally clicked...”</div><div>“You made my day.” <Heart :size="17" /></div><span>*</span></div><h3>Back the post<br>that stayed with you.</h3><p>No subscription. No long-term commitment. Just a small reward for something worth your attention.</p><a href="#how">A better way to say thanks <ArrowUpRight :size="17" /></a></article>
      <article class="value-card value-cream"><span class="card-index">FOR THE ORIGINALS</span><div class="value-illustration signal-art"><div class="signal-line"></div><span class="signal-circle">*</span><span class="signal-label">YOUR VOICE HAS VALUE</span></div><h3>Your voice matters.<br>Let it be valued.</h3><p>A direct connection between your work and the people it helps. Rewards go to your wallet, on your terms.</p><button @click="openStudio">Explore the creator flow <ArrowUpRight :size="17" /></button></article>
      <article class="value-card value-dark"><span class="card-index">FOR A BETTER INTERNET</span><div class="value-illustration receipt-art"><div><Check :size="20" /><span>GOOD POST<br><b>GOOD ENERGY.</b></span><i>*</i></div></div><h3>Less guesswork.<br>More transparency.</h3><p>See the amount, recipient and deadline. Every claim and refund leaves an onchain record.</p><a href="#trust">Follow the appreciation <ArrowUpRight :size="17" /></a></article></div>
    </section>

    <section id="how" class="how-section section-wrap reveal">
      <div class="how-heading"><div class="eyebrow"><span class="section-number">02 /</span> SMALL GESTURE. SIMPLE FLOW.</div><h2>From “great post”<br>to <span class="serif-word">“you deserve this”</span></h2><button class="button primary" @click="openStudio">Try your first reward <ArrowUpRight :size="18" /></button></div>
      <div class="steps"><article><span class="step-number">01</span><div><h3>Find your something good.</h3><p>Copy the link to a public X post. It could be a big idea or a small moment that made a difference.</p><div class="step-preview"><Link2 :size="15" /><span>x.com/your-favorite-voice/status/...</span><Copy :size="13" /></div></div></article><article><span class="step-number">02</span><div><h3>Put a little appreciation behind it.</h3><p>Check the author, choose test ETH or tUSD, and add a public note. Review the 90-day deadline before funding.</p><div class="step-pills"><span>YOUR AMOUNT</span><span>90 DAYS</span><span>THEIR VOICE</span></div></div></article><article><span class="step-number">03</span><div><h3>Give good voices their due.</h3><p>Share the receipt. With X verification enabled, its author signs in and claims to their wallet. Unclaimed rewards become refundable after expiry.</p><div class="step-success"><CircleCheck :size="16" /> A little thank you. Recorded onchain.</div></div></article></div>
    </section>

    <section class="manifesto-section"><div class="manifesto-inner section-wrap reveal"><div class="manifesto-star">*</div><div class="eyebrow">A SMALL BET ON A BETTER INTERNET</div><h2>Attention is everywhere.<br><span>Appreciation</span> makes<br>the difference.</h2><p>We’re building for the researchers, the explainers, the artists,<br>the builders. And everyone who ever thought, “more people<br>should see this.”</p><button class="button lime" @click="openStudio">Put your appreciation into action <ArrowUpRight :size="20" /></button><div class="manifesto-note">ONE POST. ONE PERSON. A LITTLE MORE POSSIBILITY.</div></div><div class="manifesto-orbit"></div></section>

    <section id="trust" class="trust-section section-wrap reveal"><div class="section-intro"><div class="eyebrow"><span class="section-number">03 /</span> BUILT TO BE UNDERSTOOD</div><h2>Clear rules.<br><span class="serif-word">Good energy.</span></h2><p>Your thank-you deserves a transparent journey. Here’s what you can expect from the pilot.</p></div><div class="trust-grid"><article><div class="trust-icon"><Wallet :size="23" /></div><h3>Your wallet, your say.</h3><p>Connect an Ethereum-compatible browser wallet. Every transaction requires your approval.</p></article><article><div class="trust-icon"><Link2 :size="23" /></div><h3>A receipt for every reward.</h3><p>Inspect the escrow and transaction on the Robinhood Chain testnet explorer.</p></article><article><div class="trust-icon"><Clock3 :size="23" /></div><h3>A deadline, not a dead end.</h3><p>Unclaimed rewards become refundable to their sender after the chosen expiry.</p></article><article><div class="trust-icon"><ShieldCheck :size="23" /></div><h3>Built in the open.</h3><p>A 3% fee only on author claims. Full unclaimed refunds. Experimental contracts; no independent audit yet.</p></article></div></section>

    <section id="roadmap" class="roadmap-section section-wrap reveal"><div class="roadmap-heading"><div><div class="eyebrow"><span class="section-number">04 /</span> START SMALL. MEAN MORE.</div><h2>A little today.<br><span class="serif-word">A lot to build toward.</span></h2></div><p>A focused first step, with a bigger idea behind it.<br>Here’s what’s live and what comes next.</p></div><div class="roadmap-grid"><article class="roadmap-active"><span class="pill"><span class="live-dot"></span> LIVE · TESTNET</span><span class="roadmap-num">01</span><h3>Make appreciation tangible.</h3><p>Testnet escrows, public receipts and a working wallet pilot. No real money. Every settlement is visible onchain.</p><button @click="openStudio">Try the pilot <ArrowUpRight :size="17" /></button></article><article><span class="pill">BUILT / X SETUP</span><span class="roadmap-num">02</span><h3>Make claiming feel familiar.</h3><p>X login, author matching, test ETH and tUSD rewards, public notes and optional sponsored claims. Real X access still needs operator credentials.</p><button @click="openStudio">Explore author rewards <ArrowUpRight :size="17" /></button></article><article><span class="pill">LATER · EXPLORING</span><span class="roadmap-num">03</span><h3>Make good voices go further.</h3><p>Curated creator campaigns, approved real assets and community discovery, after pilot evidence and launch reviews.</p><a href="/docs/business-plan.html" target="_blank" rel="noopener noreferrer">Read the vision <ArrowUpRight :size="17" /></a></article></div></section>

    <section id="faq" class="faq-section section-wrap reveal"><div><div class="eyebrow"><span class="section-number">05 /</span> THE GOOD QUESTIONS</div><h2>A little more<br><span class="serif-word">clarity.</span></h2><p>Thoughtful questions.<br>Straightforward answers.</p></div><div class="faq-list"><article v-for="(item, i) in faq" :key="item.q" :class="{ expanded: activeFaq === i }"><button :aria-expanded="activeFaq === i" :aria-controls="`faq-${i}`" @click="activeFaq = activeFaq === i ? null : i">{{ item.q }}<Minus v-if="activeFaq === i" :size="19" /><Plus v-else :size="19" /></button><div v-show="activeFaq === i" :id="`faq-${i}`"><p>{{ item.a }}</p></div></article></div></section>

    <section class="final-cta section-wrap reveal"><span class="cta-spark">*</span><div><div class="eyebrow">YOU KNOW THE POST.</div><h2>Make their <span class="serif-word">day.</span></h2></div><button class="button dark" @click="openStudio">Send a little appreciation <ArrowUpRight :size="20" /></button></section>
  </main>

  <footer class="site-footer section-wrap"><div class="footer-top"><a href="#" class="brand"><img src="/logo.svg" alt="" />voxaura</a><p>Give good voices their due.</p><a href="/docs/business-plan.html" target="_blank" rel="noopener noreferrer">Read our vision <ArrowUpRight :size="15" /></a><a href="/docs/technical-overview.html" target="_blank" rel="noopener noreferrer">How it’s built <ArrowUpRight :size="15" /></a><button @click="openWalletPilot">Wallet pilot <ArrowUpRight :size="15" /></button><button @click="openInfo('social')">Find our voice <ArrowUpRight :size="15" /></button></div><div class="footer-bottom"><span>© {{ new Date().getFullYear() }} Voxaura. A little more human.</span><div><button @click="openInfo('privacy')">Privacy</button><button @click="openInfo('terms')">Testnet terms</button><span class="footer-network"><span class="live-dot"></span> Robinhood Chain testnet</span></div></div><p class="footer-disclaimer">Independent project. Not affiliated with X or Robinhood Chain. Test tokens have no monetary value. Author verification requires configured X API access. The separate wallet pilot does not verify X ownership.</p></footer>

  <RewardStudio ref="studio" @connect="openWallet" @xRewards="openXStudio" />
  <XStudio ref="xStudio" @connect="openWallet" @walletPilot="openWalletPilot" />
  <RewardsApp ref="rewardsApp" @connect="openWallet" @walletPilot="openWalletPilot" />
  <dialog ref="walletDialog" class="small-dialog" @click="e => { if (e.target === walletDialog) walletDialog?.close() }"><div class="small-dialog-top"><span class="eyebrow">YOUR ONCHAIN CONNECTION</span><button class="icon-button" aria-label="Close wallet dialog" @click="walletDialog?.close()"><X :size="22" /></button></div><div class="wallet-large-icon"><Wallet :size="28" /></div><h2>{{ walletAddress ? 'You’re connected.' : 'Bring your wallet.' }}</h2><p>Use an Ethereum-compatible browser wallet to explore Robinhood Chain testnet.</p><template v-if="walletAddress"><div class="connected-address">{{ walletAddress }}</div><p v-if="walletBalance">{{ walletBalance }} test ETH</p><button class="button primary full-width" @click="disconnectWallet(); walletDialog?.close()">Disconnect from Voxaura</button><small>Disconnecting clears this app’s session. Manage site permissions in your wallet.</small></template><template v-else><button v-for="wallet in wallets" :key="wallet.id" class="wallet-option" :disabled="connecting" @click="selectWallet(wallet.id)"><Wallet :size="21" /><span>{{ wallet.name }}</span><ArrowUpRight :size="18" /></button><div v-if="!wallets.length" class="no-wallet"><p>No browser wallet detected.</p><a class="button primary full-width" href="https://metamask.io/download" target="_blank" rel="noopener noreferrer">Get an Ethereum wallet <ExternalLink :size="17" /></a><small>Install a wallet, then reload this page. Never share your recovery phrase or private key.</small></div></template><p v-if="walletError" role="alert" class="feedback error">{{ walletError }}</p><div class="wallet-dialog-note"><ShieldCheck :size="15" /> Connecting does not move funds.</div></dialog>
  <dialog ref="infoDialog" class="small-dialog info-dialog" @click="e => { if (e.target === infoDialog) infoDialog?.close() }"><div class="small-dialog-top"><span class="eyebrow">A LITTLE CLARITY</span><button class="icon-button" aria-label="Close information" @click="infoDialog?.close()"><X :size="22" /></button></div><template v-if="infoType === 'privacy'"><h2>Privacy, plainly.</h2><p>The wallet pilot has no account database, analytics trackers or email collection. Wallet access requires your approval. The optional X service uses an HTTP-only session cookie and stores your public X identity temporarily in server memory.</p><p>Transactions, wallet addresses, amounts and post IDs are public onchain. The RPC provider and your wallet receive requests needed to operate the app. External links use their own privacy policies.</p><p>Public notes, post IDs and transfers are recorded onchain. Do not include private information. If enabled, X login requests only account and post read access; OAuth access tokens are discarded after identity lookup.</p></template><template v-else-if="infoType === 'terms'"><h2>A playground<br>with clear rules.</h2><p>Voxaura is experimental software on Robinhood Chain testnet. Test ETH has no monetary value. Use only test funds.</p><p>Rewards are locked until the recipient claims or the expiry allows the sender to request a refund. The wallet pilot does not verify X ownership. Author mode relies on a trusted verification service; its signing key can authorize payouts. Its 3% claim fee and 90-day expiry are shown before funding.</p><p>Contracts are unaudited. Network availability and successful transactions are not guaranteed. No financial returns, affiliation, or production readiness are claimed.</p></template><template v-else><h2>Good voices.<br>Coming together.</h2><p>Our selected public identity is <strong>@voxaura</strong>, paired with <strong>voxaura.xyz</strong>.</p><p>The domain was found without an RDAP object and no public X profile was found at check time. X signup eligibility remains unverified. Neither identity has been registered or secured.</p><a href="https://x.com/voxaura" target="_blank" rel="noopener noreferrer" class="button primary full-width">Check @voxaura on X <ArrowUpRight :size="17" /></a></template></dialog>
</template>
