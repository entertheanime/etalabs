import { ACTIVE_CHAIN } from '@/lib/chain';
import { runtimeChain, runtimeNetwork, type AppNetwork } from '@/lib/networkPref';

const ZERO = '0x0000000000000000000000000000000000000000';
export const LEGACY_MONAD_ESCROW_V1_ADDRESS = '0x3Cd2B208782ABae1f58a0E522f9444b7b46D6c8a';
export const PRE_CHOG_MONAD_ESCROW_V1_ADDRESS = '0x7df3fa2aa559c7d5b8871750162ab1e04b48a4a1';
export const MONAD_ESCROW_V1_ADDRESS = '0x0000000000000000000000000000000000000002';
let cachedEscrow = '';

export const ESCROW_DURATION_SECONDS = 24 * 60 * 60;

export function escrowStorageKey(chainId: number = runtimeChain().id) {
  return `etaswap-escrow-v1:${chainId}`;
}

function publishedEscrowAddress(network: AppNetwork = runtimeNetwork()): string {
  if (network === 'monad') {
    const env = process.env.NEXT_PUBLIC_MONAD_ESCROW_CONTRACT_ADDRESS;
    return env && env !== ZERO ? env : MONAD_ESCROW_V1_ADDRESS;
  }
  if (ACTIVE_CHAIN.network === 'ink' && network !== 'robinhood') {
    const env = process.env.NEXT_PUBLIC_INK_ESCROW_CONTRACT_ADDRESS;
    return env && env !== ZERO ? env : '';
  }
  if (network !== 'robinhood') return '';
  const env = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS;
  return env && env !== ZERO ? env : '';
}

export function isAllowedEscrowContract(address?: string) {
  if (!address) return false;
  const known = [
    publishedEscrowAddress('monad'),
    publishedEscrowAddress('robinhood'),
    cachedEscrow,
  ];
  if (typeof window !== 'undefined') {
    known.push(window.localStorage.getItem(escrowStorageKey()) || '');
  }
  return known.some((item) => item && item.toLowerCase() === address.toLowerCase());
}

export function getEscrowAddress(): string {
  const published = publishedEscrowAddress();
  if (published) {
    cachedEscrow = published;
    return published;
  }
  if (cachedEscrow) return cachedEscrow;
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(escrowStorageKey());
    if (saved && saved !== ZERO) return saved;
  }
  return '';
}

export async function loadEscrowAddress(): Promise<string> {
  const published = publishedEscrowAddress();
  if (published) {
    cachedEscrow = published;
    return published;
  }
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(escrowStorageKey());
    if (saved && saved !== ZERO) {
      cachedEscrow = saved;
      return saved;
    }
  }
  try {
    const { getSharedEscrowContract } = await import('@/lib/sharedTradeContract');
    const shared = await getSharedEscrowContract(runtimeChain().id);
    if (shared) {
      cachedEscrow = shared;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(escrowStorageKey(), shared);
      }
      return shared;
    }
  } catch {
    /* ignore */
  }
  return publishedEscrowAddress() || cachedEscrow;
}

export function rememberEscrowAddress(address: string, chainId: number = runtimeChain().id) {
  if (!address || address === ZERO) return;
  cachedEscrow = address;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(escrowStorageKey(chainId), address);
  }
}

export function isEscrowTrade(trade?: {
  tradeType?: string;
  tradeContract?: string;
} | null) {
  if (!trade) return false;
  if (trade.tradeType === 'escrow-program') return true;
  const escrow = getEscrowAddress();
  return Boolean(
    escrow && trade.tradeContract && trade.tradeContract.toLowerCase() === escrow.toLowerCase()
  );
}
