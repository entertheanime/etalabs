import { MONAD_MAINNET, ROBINHOOD_MAINNET, ROBINHOOD_TESTNET } from './chain';

export const NETWORK_COOKIE = 'etaswap-network';
export type AppNetwork = 'robinhood' | 'monad';

export function isAppNetwork(value: string | null | undefined): value is AppNetwork {
  return value === 'robinhood' || value === 'monad';
}

export function envNetwork(): AppNetwork {
  return process.env.NEXT_PUBLIC_CHAIN === 'monad' ? 'monad' : 'robinhood';
}

export function resolveNetwork(cookie?: string | null): AppNetwork {
  return isAppNetwork(cookie) ? cookie : envNetwork();
}

export function readStoredNetwork(): AppNetwork | '' {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie.match(new RegExp(`(?:^|; )${NETWORK_COOKIE}=([^;]*)`));
  const fromCookie = cookie ? decodeURIComponent(cookie[1]) : '';
  if (isAppNetwork(fromCookie)) return fromCookie;
  try {
    const stored = window.localStorage.getItem(NETWORK_COOKIE);
    if (isAppNetwork(stored)) return stored;
  } catch {
    /* ignore */
  }
  return '';
}

export function requestNetwork(input: { searchParams?: URLSearchParams; cookie?: string | null }) {
  const query = input.searchParams?.get('chain');
  if (isAppNetwork(query)) return query;
  if (isAppNetwork(input.cookie)) return input.cookie;
  return undefined;
}

export function clientNetwork(): AppNetwork | '' {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(NETWORK_COOKIE);
    if (isAppNetwork(stored)) return stored;
  } catch {
    /* ignore */
  }
  return '';
}

export function withClientChain(url: string) {
  const chain = clientNetwork();
  if (!chain) return url;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}chain=${chain}`;
}

export function persistNetwork(network: AppNetwork) {
  if (typeof document === 'undefined') return;
  document.cookie = `${NETWORK_COOKIE}=${network}; path=/; max-age=31536000; samesite=lax`;
  try {
    window.localStorage.setItem(NETWORK_COOKIE, network);
  } catch {
    /* ignore */
  }
}

export function chainForNetwork(network: AppNetwork) {
  if (network === 'monad') return MONAD_MAINNET;
  return process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK === 'mainnet' ? ROBINHOOD_MAINNET : ROBINHOOD_TESTNET;
}

export function runtimeNetwork(): AppNetwork {
  if (typeof window !== 'undefined') {
    return readStoredNetwork() || envNetwork();
  }
  return envNetwork();
}

export function runtimeChain() {
  return chainForNetwork(runtimeNetwork());
}

export async function switchWalletToChain(chain: {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: readonly string[] } };
  blockExplorers: { default: { url: string } };
}) {
  const provider = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!provider?.request) return;
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    const code = Number((error as { code?: number })?.code);
    if (code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: [chain.blockExplorers.default.url],
        },
      ],
    });
  }
}

export async function switchWalletTo(network: AppNetwork) {
  await switchWalletToChain(chainForNetwork(network));
}
