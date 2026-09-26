import { formatUnits, getAddress, isAddress, parseUnits, ZeroAddress } from 'ethers'

export const REWARD_WINDOW_SECONDS = 90 * 24 * 60 * 60
export const REWARD_FEE_BPS = 300n
export type RewardAsset = 'ETH' | 'tUSD'
export type RewardRecord = {
  id: string; payer: string; token: string; amount: bigint; expiresAt: number;
  status: number; postId: string; authorId: string; note: string;
}

export function noteLength(value: string) { return Array.from(value).length }
export function validPublicNote(value: string) {
  return noteLength(value) <= 140 && new TextEncoder().encode(value).length <= 560 && !Array.from(value).some(character => { const code = character.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff })
}
export function rewardAmounts(amount: bigint) {
  const fee = amount * REWARD_FEE_BPS / 10000n
  return { gross: amount, fee, creator: amount - fee }
}
export function parseRewardAmount(value: string, asset: RewardAsset) {
  const trimmed = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) throw new Error('Enter a positive amount using numbers and a decimal point.')
  const amount = parseUnits(trimmed, asset === 'ETH' ? 18 : 6)
  if (amount <= 0n) throw new Error('The reward amount must be greater than zero.')
  if (amount > parseUnits(asset === 'ETH' ? '0.1' : '1000', asset === 'ETH' ? 18 : 6)) throw new Error(asset === 'ETH' ? 'The testnet interface limit is 0.1 test ETH per reward.' : 'The testnet interface limit is 1,000 tUSD per reward.')
  return amount
}
export function displayAmount(amount: bigint, asset: RewardAsset) {
  return formatUnits(amount, asset === 'ETH' ? 18 : 6)
}
export function rewardAsset(token: string): RewardAsset { return token.toLowerCase() === ZeroAddress ? 'ETH' : 'tUSD' }
export function rewardStatus(reward: RewardRecord, nowSeconds: number) {
  if (reward.status === 2) return 'Claimed'
  if (reward.status === 3) return 'Refunded'
  if (reward.status === 1) return nowSeconds >= reward.expiresAt ? 'Refund available' : 'Awaiting author'
  return 'Not found'
}
export function normalizeReward(data: any, fallbackId = ''): RewardRecord {
  const id = String(data.rewardId ?? data.id ?? fallbackId)
  const amount = BigInt(data.amount)
  const expiresAt = Number(data.expiresAt)
  const status = Number(data.status)
  if (!/^[1-9]\d{0,76}$/.test(id) || !isAddress(data.payer) || !isAddress(data.token) || amount < 0n || !Number.isSafeInteger(expiresAt) || ![0, 1, 2, 3].includes(status)) throw new Error('The network returned an invalid reward record.')
  const postId = String(data.postId)
  const authorId = String(data.authorId)
  if (status !== 0 && (!/^\d{1,30}$/.test(postId) || !/^\d{1,30}$/.test(authorId) || typeof data.note !== 'string')) throw new Error('The network returned invalid post information.')
  return { id, payer: getAddress(data.payer), token: getAddress(data.token), amount, expiresAt, status, postId, authorId, note: String(data.note ?? '') }
}
