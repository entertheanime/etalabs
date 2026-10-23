import { Wallet } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, rabbyWallet } from '@rainbow-me/rainbowkit/wallets';
import { Chain } from 'wagmi';
import { InjectedConnector } from 'wagmi/connectors/injected';

type Injected = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  isBackpack?: boolean;
  isHaha?: boolean;
  isHaHa?: boolean;
  isHahaWallet?: boolean;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type AnnounceDetail = {
  info?: { rdns?: string; name?: string };
  provider?: Injected;
};

const eip6963 = new Map<string, Injected>();

function remember6963() {
  if (typeof window === 'undefined') return;
  if ((window as any).__eta6963) return;
  (window as any).__eta6963 = true;
  window.addEventListener('eip6963:announceProvider', ((event: Event) => {
    const detail = (event as CustomEvent<AnnounceDetail>).detail;
    const rdns = (detail?.info?.rdns || '').toLowerCase();
    const name = (detail?.info?.name || '').toLowerCase();
    const key = rdns || name;
    if (!key || !detail?.provider) return;
    eip6963.set(key, detail.provider);
  }) as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function request6963() {
  remember6963();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function warmInjectedWallets() {
  request6963();
}

// Ask wallets again on connect so Rabby does not hide Backpack/HaHa.

function injectedProviders(): Injected[] {
  if (typeof window === 'undefined') return [];
  request6963();
  const ethereum = (window as any).ethereum;
  const listed: Injected[] = Array.isArray(ethereum?.providers)
    ? ethereum.providers
    : ethereum
      ? [ethereum]
      : [];
  const extra = [
    (window as any).backpack?.ethereum,
    (window as any).backpack,
    (window as any).haha?.ethereum,
    (window as any).hahaWallet?.ethereum,
    ...eip6963.values(),
  ];
  return [...listed, ...extra].filter(Boolean);
}

function fromRdns(match: (rdns: string) => boolean) {
  request6963();
  for (const [rdns, provider] of eip6963) {
    if (match(rdns)) return provider;
  }
  return undefined;
}

export function getMetaMaskProvider() {
  return (
    fromRdns((rdns) => rdns === 'io.metamask' || rdns === 'io.metamask.mobile') ||
    injectedProviders().find(
      (provider) =>
        provider?.isMetaMask &&
        !provider?.isRabby &&
        !provider?.isPhantom &&
        !provider?.isBraveWallet &&
        !provider?.isBackpack &&
        !provider?.isHaha &&
        !provider?.isHaHa
    )
  );
}

export function getBackpackProvider() {
  return (
    fromRdns((rdns) => rdns.includes('backpack')) ||
    injectedProviders().find((provider) => provider?.isBackpack)
  );
}

export function getRabbyProvider() {
  // EIP-6963 only. window.ethereum is Rabby's multiplexer and opens
  // "Select a Wallet to Connect" instead of acting like Rabby itself.
  return (
    fromRdns((rdns) => rdns === 'io.rabby' || rdns === 'io.rabby.wallet') ||
    (typeof window !== 'undefined' ? (window as any).rabby : undefined)
  );
}

export function getHahaProvider() {
  return (
    fromRdns((rdns) => rdns.includes('haha')) ||
    injectedProviders().find(
      (provider) => provider?.isHaha || provider?.isHaHa || provider?.isHahaWallet
    )
  );
}

function isPresent(getProvider: () => Injected | undefined) {
  if (typeof window === 'undefined') return false;
  request6963();
  return Boolean(getProvider());
}

export function backpackWallet({ chains }: { chains: Chain[] }): Wallet {
  return {
    id: 'etaswap-backpack',
    name: 'Backpack',
    iconUrl: '/wallets/backpack.svg',
    iconBackground: '#E33E3F',
    installed: isPresent(getBackpackProvider),
    downloadUrls: {
      chrome: 'https://chromewebstore.google.com/detail/backpack/aflkmfhebedbjioipglgcbcmnbpglioj',
      browserExtension: 'https://backpack.app/downloads',
    },
    createConnector: () => ({
      connector: new InjectedConnector({
        chains,
        options: {
          name: 'Backpack',
          shimDisconnect: true,
          getProvider: getBackpackProvider as any,
        },
      }),
    }),
  };
}

export function hahaWallet({ chains }: { chains: Chain[] }): Wallet {
  return {
    id: 'etaswap-haha',
    name: 'HaHa Wallet',
    iconUrl: '/wallets/haha.png',
    iconBackground: '#6C5CE7',
    installed: isPresent(getHahaProvider),
    downloadUrls: {
      chrome: 'https://chromewebstore.google.com/detail/haha-wallet/andhndehpcjpmneneealacgnmealilal',
      browserExtension: 'https://www.haha.me/',
    },
    createConnector: () => ({
      connector: new InjectedConnector({
        chains,
        options: {
          name: 'HaHa Wallet',
          shimDisconnect: true,
          getProvider: getHahaProvider as any,
        },
      }),
    }),
  };
}

export function etaswapRabbyWallet({ chains }: { chains: Chain[] }): Wallet {
  const icon = rabbyWallet({ chains });
  return {
    id: 'etaswap-rabby',
    name: 'Rabby Wallet',
    iconUrl: icon.iconUrl,
    iconBackground: icon.iconBackground,
    installed: isPresent(getRabbyProvider),
    downloadUrls: icon.downloadUrls,
    createConnector: () => ({
      connector: new InjectedConnector({
        chains,
        options: {
          name: 'Rabby Wallet',
          shimDisconnect: true,
          getProvider: getRabbyProvider as any,
        },
      }),
    }),
  };
}

export function etaswapMetaMaskWallet({ chains, projectId }: { chains: Chain[]; projectId: string }): Wallet {
  const rainbowKitMetaMask = metaMaskWallet({ chains, projectId });

  return {
    ...rainbowKitMetaMask,
    id: 'etaswap-metamask',
    installed: isPresent(getMetaMaskProvider),
    createConnector: () => {
      request6963();
      if (!getMetaMaskProvider()) return rainbowKitMetaMask.createConnector();
      return {
        ...rainbowKitMetaMask.createConnector(),
        connector: new InjectedConnector({
          chains,
          options: {
            name: 'MetaMask',
            shimDisconnect: true,
            getProvider: getMetaMaskProvider as any,
          },
        }),
      };
    },
  };
}

export function clearWalletSession() {
  if (typeof window === 'undefined') return;
  const keys = Object.keys(window.localStorage);
  for (const key of keys) {
    if (
      key.startsWith('wagmi') ||
      key.startsWith('rk') ||
      key.toLowerCase().includes('rainbowkit') ||
      key.toLowerCase().includes('walletconnect')
    ) {
      window.localStorage.removeItem(key);
    }
  }
}

type InjectedProvider = {
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function injectedProvider() {
  return getMetaMaskProvider() as InjectedProvider | undefined;
}

/** Drops this site's MetaMask account permission so the next connect can pick another wallet. */
export async function revokeAccountPermission() {
  const provider = injectedProvider();
  if (!provider?.request) return false;
  try {
    await provider.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
    return true;
  } catch {
    return false;
  }
}

/** Revokes first, then opens MetaMask's account picker. Requesting existing permissions alone does not. */
export async function requestAccountSwitch(): Promise<boolean> {
  const provider = injectedProvider();
  if (!provider?.request) return false;
  await revokeAccountPermission();
  await provider.request({
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  });
  return true;
}
