import { MONAD_NFT_TRADING_ABI } from './abi';
import V9Artifact from '@/lib/abis/EtaSwapV9.json';
import { ACTIVE_CHAIN, RPC_URL, EXPLORER_URL } from './chain';
import { runtimeChain, runtimeNetwork, type AppNetwork } from './networkPref';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const TRADE_CONTRACT_STORAGE_KEY = 'etaswap-trade-contract';

export function tradeStorageKey(chainId: number = runtimeChain().id) {
  return `${TRADE_CONTRACT_STORAGE_KEY}:${chainId}`;
}
export const TEST_NFT_STORAGE_KEY = 'etaswap-test-nft';
export const TEST_NFT_LATEST_KEY = 'etaswap-test-nft-latest';
export const PETS_NFT_STORAGE_KEY = 'etaswap-pets-nft';
export const VIDEO_NFT_STORAGE_KEY = 'etaswap-video-nft';
export const LEGACY_ESCROW_TRADE_ADDRESS = '0xbaedc00a80cfe5d0faa3fb3de4f6ff6bbfcb7d08';
export const PREVIOUS_STAY_IN_WALLET_TRADE_ADDRESS = '0xbeaf52fc055944a2455279ca35621ba8de199353';
export const STAY_IN_WALLET_TRADE_ADDRESS = '0x68d59cc0aaa4d61699223a48b792c735fcb2700a';
export const LEGACY_MONAD_STAY_IN_WALLET_ADDRESS = '0xdD72E0eC0B7B5b6393202BFb56fc7d92AD8a41a5';
export const PRE_CHOG_MONAD_STAY_IN_WALLET_ADDRESS = '0x9dbe4ccec8a7b71bb8477507daa76b6238679dae';
export const MONAD_STAY_IN_WALLET_ADDRESS = '0x0000000000000000000000000000000000000001';
export const TEST_NFT_ADDRESS =
  process.env.NEXT_PUBLIC_TEST_NFT_ADDRESS || '0xac8be86e6d0c62b084de090a88aafa25cd3740e2';

export function petsNftStorageKey(chainId: number = runtimeChain().id) {
  return `${PETS_NFT_STORAGE_KEY}:${chainId}`;
}

export function videoNftStorageKey(chainId: number = runtimeChain().id) {
  return `${VIDEO_NFT_STORAGE_KEY}:${chainId}`;
}

export function getPetsNftAddress(): string {
  if (typeof window === 'undefined') return '';
  const keyed = window.localStorage.getItem(petsNftStorageKey());
  if (keyed) return keyed;
  if (runtimeNetwork() === 'robinhood') {
    return window.localStorage.getItem(PETS_NFT_STORAGE_KEY) || '';
  }
  return '';
}

export function getVideoNftAddress(): string {
  if (typeof window === 'undefined') return '';
  const keyed = window.localStorage.getItem(videoNftStorageKey());
  if (keyed) return keyed;
  if (runtimeNetwork() === 'robinhood') {
    return window.localStorage.getItem(VIDEO_NFT_STORAGE_KEY) || '';
  }
  return '';
}

export function rememberVideoNft(address: string, chainId: number = runtimeChain().id) {
  if (typeof window === 'undefined' || !address) return;
  window.localStorage.setItem(videoNftStorageKey(chainId), address);
  rememberLatestTestMint(address, [1, 2, 3]);
}

export function getTestNftAddress(): string {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(TEST_NFT_STORAGE_KEY);
    if (saved) return saved;
  }
  return TEST_NFT_ADDRESS;
}

export function getLatestTestMint(): { contract: string; ids: string[] } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TEST_NFT_LATEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { contract?: string; ids?: string[]; chainId?: number };
    if (!parsed.contract || !parsed.ids?.length) return null;
    if (parsed.chainId !== runtimeChain().id) return null;
    return { contract: parsed.contract, ids: parsed.ids.map(String) };
  } catch {
    return null;
  }
}

export function rememberLatestTestMint(contract: string, ids: Array<string | number>) {
  if (typeof window === 'undefined') return;
  const nextIds = ids.map(String);
  const previous = getLatestTestMint();
  const merged =
    previous?.contract.toLowerCase() === contract.toLowerCase()
      ? [...new Set([...previous.ids, ...nextIds])]
      : nextIds;
  window.localStorage.setItem(TEST_NFT_STORAGE_KEY, contract);
  window.localStorage.setItem(
    TEST_NFT_LATEST_KEY,
    JSON.stringify({ contract, ids: merged, at: Date.now(), chainId: runtimeChain().id })
  );
}

function publishedTradeContract(network: AppNetwork = runtimeNetwork()): string {
  if (network === 'monad') {
    const env = process.env.NEXT_PUBLIC_MONAD_TRADE_CONTRACT_ADDRESS;
    return env && env !== ZERO_ADDRESS ? env : MONAD_STAY_IN_WALLET_ADDRESS;
  }
  if (ACTIVE_CHAIN.network === 'ink' && network !== 'robinhood') {
    const env = process.env.NEXT_PUBLIC_INK_TRADE_CONTRACT_ADDRESS;
    return env && env !== ZERO_ADDRESS ? env : '';
  }
  if (network !== 'robinhood') return '';
  const env = process.env.NEXT_PUBLIC_TRADE_CONTRACT_ADDRESS;
  if (
    env &&
    env !== ZERO_ADDRESS &&
    env.toLowerCase() !== LEGACY_ESCROW_TRADE_ADDRESS &&
    env.toLowerCase() !== PREVIOUS_STAY_IN_WALLET_TRADE_ADDRESS
  ) {
    return env;
  }
  return '';
}

function storedTradeContract(): string {
  if (typeof window === 'undefined') return '';
  const keyed = window.localStorage.getItem(tradeStorageKey());
  if (
    keyed &&
    keyed !== ZERO_ADDRESS &&
    keyed.toLowerCase() !== LEGACY_MONAD_STAY_IN_WALLET_ADDRESS.toLowerCase() &&
    keyed.toLowerCase() !== PRE_CHOG_MONAD_STAY_IN_WALLET_ADDRESS.toLowerCase() &&
    keyed.toLowerCase() !== '0xb83feae93222df783f5bd5616b0f8602ae47bb2e'
  ) {
    return keyed;
  }
  if (runtimeNetwork() === 'monad') {
    const legacy = window.localStorage.getItem(TRADE_CONTRACT_STORAGE_KEY);
    if (legacy && legacy !== ZERO_ADDRESS && legacy.toLowerCase() !== publishedTradeContract().toLowerCase()) {
      const robinhood = process.env.NEXT_PUBLIC_TRADE_CONTRACT_ADDRESS || '';
      if (!robinhood || legacy.toLowerCase() !== robinhood.toLowerCase()) return legacy;
    }
  }
  return '';
}

export function allowedTradeContracts(): string[] {
  const addrs = new Set<string>();
  for (const published of [publishedTradeContract('monad'), publishedTradeContract('robinhood')]) {
    if (published) addrs.add(published.toLowerCase());
  }
  const stored = storedTradeContract();
  if (stored) addrs.add(stored.toLowerCase());
  return [...addrs];
}

export function isAllowedTradeContract(address?: string) {
  if (!address) return false;
  return allowedTradeContracts().includes(address.toLowerCase());
}

export function rememberTradeContract(address: string, chainId: number = runtimeChain().id) {
  if (!address || address === ZERO_ADDRESS) return;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(tradeStorageKey(chainId), address);
}

export function getTradeContractAddress(): string {
  const stored = storedTradeContract();
  if (stored) return stored;
  return publishedTradeContract();
}

export function getKnownTradeContractAddresses(): string[] {
  return allowedTradeContracts();
}

export const MONAD_NFT_TRADING_V5_ADDRESS = ZERO_ADDRESS;

export const MONAD_NFT_TRADING_V6_ADDRESS = getTradeContractAddress();

export const MONAD_NFT_TRADING_ADDRESS = MONAD_NFT_TRADING_V6_ADDRESS;

export const CONTRACT_V5_CONFIG = {
  address: MONAD_NFT_TRADING_V5_ADDRESS,
  abi: MONAD_NFT_TRADING_ABI,
} as const;

export const CONTRACT_V6_CONFIG = {
  get address() {
    return getTradeContractAddress();
  },
  abi: V9Artifact.abi as any,
};

export const CONTRACT_CONFIG = CONTRACT_V6_CONFIG;

export const TRADE_FEE = "0";
export const FEE_RECIPIENT = "0x20ce27B140A0EEECceF880e01D2082558400FDd6";

export const MONAD_TESTNET = {
  chainId: ACTIVE_CHAIN.id,
  name: ACTIVE_CHAIN.name,
  rpcUrl: RPC_URL,
  hyperRpcUrl: RPC_URL,
  blockExplorer: EXPLORER_URL,
} as const;

export const getOptimalProvider = () => {
  return {
    hyperRpc: RPC_URL,
    standardRpc: RPC_URL,
  };
};

export const HYPER_RPC_SUPPORTED_METHODS = [
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBlockReceipts',
  'eth_getTransactionByHash',
  'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'trace_block',
] as const;
