const robinhoodOfficialMainnetRpc =
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
  'https://rpc.mainnet.chain.robinhood.com';

const robinhoodAlchemyMainnetRpc =
  process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL;

// The chain's own RPC is the source of truth for ETA. Alchemy is only an
// optional secondary endpoint for wallet tooling that consumes this list.
const robinhoodMainnetRpcs = robinhoodAlchemyMainnetRpc
  ? [robinhoodOfficialMainnetRpc, robinhoodAlchemyMainnetRpc]
  : [robinhoodOfficialMainnetRpc];

export const ROBINHOOD_MAINNET = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  iconUrl: 'https://data.morpho.org/chain-icons/robinhood-chain.png',
  iconBackground: '#ccff00',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: robinhoodMainnetRpcs },
    public: { http: robinhoodMainnetRpcs },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Chain Explorer',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
  testnet: false,
} as const;

export const ROBINHOOD_TESTNET = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  network: 'robinhood-testnet',
  iconUrl: 'https://data.morpho.org/chain-icons/robinhood-chain.png',
  iconBackground: '#ccff00',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
    public: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Chain Testnet Explorer',
      url: 'https://explorer.testnet.chain.robinhood.com',
    },
  },
  testnet: true,
} as const;

const monadMainnetRpc =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL || 'https://rpc.monad.xyz';

export const MONAD_MAINNET = {
  id: 143,
  name: 'Monad',
  network: 'monad',
  iconUrl: 'https://www.monad.xyz/favicon.ico',
  iconBackground: '#836EF9',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: { http: [monadMainnetRpc] },
    public: { http: [monadMainnetRpc] },
  },
  blockExplorers: {
    default: {
      name: 'MonadVision',
      url: 'https://monadvision.com',
    },
  },
  testnet: false,
} as const;

const inkMainnetRpc =
  process.env.NEXT_PUBLIC_INK_RPC_URL || 'https://rpc-gel.inkonchain.com';

export const INK_MAINNET = {
  id: 57073,
  name: 'Ink',
  network: 'ink',
  iconUrl: '/images/ink-logo.svg',
  iconBackground: '#7132F5',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [inkMainnetRpc] },
    public: { http: [inkMainnetRpc] },
  },
  blockExplorers: {
    default: {
      name: 'Ink Explorer',
      url: 'https://explorer.inkonchain.com',
    },
  },
  testnet: false,
} as const;

const selectedChain = (process.env.NEXT_PUBLIC_CHAIN || 'robinhood').toLowerCase();
const useRobinhoodMainnet = process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK === 'mainnet';

export const ACTIVE_CHAIN =
  selectedChain === 'monad'
    ? MONAD_MAINNET
    : selectedChain === 'ink'
      ? INK_MAINNET
      : useRobinhoodMainnet
        ? ROBINHOOD_MAINNET
        : ROBINHOOD_TESTNET;

export const SWITCHABLE_CHAINS = [
  useRobinhoodMainnet ? ROBINHOOD_MAINNET : ROBINHOOD_TESTNET,
  MONAD_MAINNET,
] as const;
export const RPC_URL = ACTIVE_CHAIN.rpcUrls.default.http[0];
export const EXPLORER_URL = ACTIVE_CHAIN.blockExplorers.default.url;
export const NATIVE_TOKEN_SYMBOL = ACTIVE_CHAIN.nativeCurrency.symbol;
export const OPENSEA_CHAIN =
  process.env.OPENSEA_CHAIN || (selectedChain === 'monad' ? 'monad' : 'robinhood');

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
