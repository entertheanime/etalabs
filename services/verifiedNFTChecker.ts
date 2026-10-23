import { VERIFIED_NFTS } from '../app/config/verifiedNFTs';
import { appCollectionName, overlayEtaArt } from '@/lib/videoArt';
import { chainForNetwork, clientNetwork, envNetwork, withClientChain } from '@/lib/networkPref';

const DEBUG_LOGS = process.env.NEXT_PUBLIC_DEBUG_LOGS === '1';
const debug = (...args: any[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

const HOLDINGS_CACHE_TTL_MS = 8_000;
export const INVENTORY_CHANGED_EVENT = 'etaswap-inventory';
const HIDDEN_TOKENS_KEY = 'etaswap-hide-until-gone';
const RECEIVED_TOKENS_KEY = 'etaswap-show-until-seen';
const HIDDEN_TOKENS_TTL_MS = 10 * 60_000;

type HiddenToken = { wallet: string; contract: string; tokenId: string; until: number; chain?: string };
type ReceivedToken = HiddenToken & { name?: string; image?: string; collectionName?: string };

function inventoryChain(explicit?: string) {
  if (explicit === 'robinhood' || explicit === 'monad' || explicit === 'ink' || explicit === 'ethereum') {
    return explicit;
  }
  return clientNetwork() || envNetwork();
}

function cacheKey(wallet: string, chain = inventoryChain()) {
  return `${wallet}:${chain}`;
}

function onThisChain(item: { chain?: string }) {
  const current = inventoryChain();
  if (!item.chain) return false;
  return item.chain === current;
}

const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function notifyInventoryChanged(wallet?: string) {
  if (typeof window === 'undefined') return;
  const key = (wallet || '').toLowerCase();
  if (notifyTimers.has(key)) clearTimeout(notifyTimers.get(key));
  notifyTimers.set(
    key,
    setTimeout(() => {
      notifyTimers.delete(key);
      window.dispatchEvent(new CustomEvent(INVENTORY_CHANGED_EVENT, { detail: { wallet: key } }));
    }, 120)
  );
}

function inventoryStore() {
  if (typeof window === 'undefined') return null;
  return window.localStorage || window.sessionStorage;
}

function readStoredList(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const store = inventoryStore();
    const raw = store?.getItem(key) || window.sessionStorage.getItem(key) || '[]';
    const parsed = JSON.parse(raw);
    const now = Date.now();
    return (Array.isArray(parsed) ? parsed : []).filter(
      (item) => item?.wallet && item?.contract && item?.tokenId && Number(item.until) > now
    );
  } catch {
    return [];
  }
}

function readHiddenTokens(): HiddenToken[] {
  return readStoredList(HIDDEN_TOKENS_KEY);
}

function writeHiddenTokens(rows: HiddenToken[]) {
  inventoryStore()?.setItem(HIDDEN_TOKENS_KEY, JSON.stringify(rows));
}

function tokenRef(item: { contract?: string; contractAddress?: string; token?: string; tokenId?: string; id?: string } | undefined | null) {
  const contract = String(item?.contract || item?.contractAddress || item?.token || '').toLowerCase();
  const tokenId = String(item?.tokenId ?? item?.id ?? '');
  return { contract, tokenId };
}

export function rememberSentTokens(
  walletAddress: string,
  items: Array<{ contract?: string; contractAddress?: string; token?: string; tokenId?: string; id?: string } | undefined | null>,
  chain?: string
) {
  const wallet = (walletAddress || '').toLowerCase();
  if (!wallet) return;
  const network = inventoryChain(chain);
  const next = readHiddenTokens().filter((item) => !(item.wallet === wallet && inventoryChain(item.chain) === network));
  const until = Date.now() + HIDDEN_TOKENS_TTL_MS;
  for (const item of items) {
    const { contract, tokenId } = tokenRef(item);
    if (!contract || !tokenId) continue;
    next.push({ wallet, contract, tokenId, until, chain: network });
  }
  writeHiddenTokens(next);
  holdingsCache.delete(cacheKey(wallet, network));
  notifyInventoryChanged(wallet);
}

function readReceivedTokens(): ReceivedToken[] {
  return readStoredList(RECEIVED_TOKENS_KEY);
}

function writeReceivedTokens(rows: ReceivedToken[]) {
  inventoryStore()?.setItem(RECEIVED_TOKENS_KEY, JSON.stringify(rows));
}

export function rememberReceivedTokens(
  walletAddress: string,
  items: Array<{ contract?: string; contractAddress?: string; token?: string; tokenId?: string; id?: string; name?: string; image?: string; collectionName?: string } | undefined | null>,
  chain?: string
) {
  const wallet = (walletAddress || '').toLowerCase();
  if (!wallet) return;
  const network = inventoryChain(chain);
  const next = readReceivedTokens().filter((item) => !(item.wallet === wallet && inventoryChain(item.chain) === network));
  const until = Date.now() + HIDDEN_TOKENS_TTL_MS;
  for (const item of items) {
    const { contract, tokenId } = tokenRef(item);
    if (!contract || !tokenId) continue;
    next.push({
      wallet,
      contract,
      tokenId,
      until,
      chain: network,
      name: item?.name || '',
      image: item?.image || '',
      collectionName: item?.collectionName || item?.name || '',
    });
  }
  writeReceivedTokens(next);
  holdingsCache.delete(cacheKey(wallet, network));
  notifyInventoryChanged(wallet);
}

export function walletNeedsFastRefresh(walletAddress: string) {
  const wallet = (walletAddress || '').toLowerCase();
  return (
    readHiddenTokens().some((item) => item.wallet === wallet) ||
    readReceivedTokens().some((item) => item.wallet === wallet)
  );
}

function pushReceivedHolding(holdings: VerifiedNFTHolding[], item: ReceivedToken) {
  const existing = holdings.find((holding) => holding.collectionId.toLowerCase() === item.contract);
  const token = {
    tokenId: item.tokenId,
    name: item.name || item.collectionName || item.tokenId,
    image: item.image || '',
    floorPrice: 0,
    tokenCount: '1',
  };
  if (existing) {
    if (!existing.tokens.some((row) => String(row.tokenId) === String(item.tokenId))) {
      existing.tokens.push(token);
    }
    return;
  }
  holdings.push({
    collectionId: item.contract,
    collectionName: item.collectionName || item.name || 'Received',
    collectionImage: item.image || '',
    tokens: [token],
  });
}

async function walletOwnsToken(rpc: string, wallet: string, contract: string, tokenId: string) {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpc);
  try {
    const nft = new ethers.Contract(contract, ['function ownerOf(uint256) view returns (address)'], provider);
    const owner = String(await nft.ownerOf(tokenId)).toLowerCase();
    return owner === wallet;
  } catch {
    try {
      const nft = new ethers.Contract(
        contract,
        ['function balanceOf(address,uint256) view returns (uint256)'],
        provider
      );
      return BigInt(await nft.balanceOf(wallet, tokenId)) > 0n;
    } catch {
      return false;
    }
  }
}

async function attachOwnedReceived(wallet: string, holdings: VerifiedNFTHolding[]) {
  const current = inventoryChain();
  if (current !== 'monad' && current !== 'robinhood') return holdings;
  const received = readReceivedTokens().filter((item) => item.wallet === wallet);
  if (!received.length) return holdings;
  const have = new Set(
    holdings.flatMap((holding) =>
      holding.tokens.map((token) => `${holding.collectionId.toLowerCase()}:${String(token.tokenId)}`)
    )
  );
  const pending = received.filter((item) => !have.has(`${item.contract}:${item.tokenId}`));
  if (!pending.length) return holdings;
  const rpc = chainForNetwork(current).rpcUrls.default.http[0];
  const owned = (
    await Promise.all(
      pending.map(async (item) => {
        const yes = await withTimeout(walletOwnsToken(rpc, wallet, item.contract, item.tokenId), 4000, false);
        return yes ? item : null;
      })
    )
  ).filter(Boolean) as ReceivedToken[];
  if (!owned.length) return holdings;
  const next = cloneHoldings(holdings);
  for (const item of owned) pushReceivedHolding(next, item);
  writeReceivedTokens(
    readReceivedTokens().map((item) =>
      owned.some((row) => row.wallet === item.wallet && row.contract === item.contract && row.tokenId === item.tokenId)
        ? { ...item, chain: current }
        : item
    )
  );
  return next;
}

function applyReceivedTokens(wallet: string, holdings: VerifiedNFTHolding[], persist = true) {
  const received = readReceivedTokens();
  const mine = received.filter((item) => item.wallet === wallet && onThisChain(item));
  if (!mine.length) return holdings;
  const have = new Set(
    holdings.flatMap((holding) =>
      holding.tokens.map((token) => `${holding.collectionId.toLowerCase()}:${String(token.tokenId)}`)
    )
  );
  if (persist) {
    writeReceivedTokens(
      received.filter((item) => {
        if (item.wallet !== wallet || !onThisChain(item)) return true;
        return !have.has(`${item.contract}:${item.tokenId}`);
      })
    );
  }
  const extra = mine.filter((item) => !have.has(`${item.contract}:${item.tokenId}`));
  if (!extra.length) return holdings;
  const next = [...holdings];
  for (const item of extra) pushReceivedHolding(next, item);
  return next;
}

function applyHiddenTokens(wallet: string, holdings: VerifiedNFTHolding[], persist = true) {
  const hidden = readHiddenTokens();
  const mine = hidden.filter((item) => item.wallet === wallet && onThisChain(item));
  if (!mine.length) return holdings;
  const hide = new Set(mine.map((item) => `${item.contract}:${item.tokenId}`));
  const onApi = new Set(
    holdings.flatMap((holding) =>
      holding.tokens.map((token) => `${holding.collectionId.toLowerCase()}:${String(token.tokenId)}`)
    )
  );
  if (persist) {
    writeHiddenTokens(
      hidden.filter((item) => {
        if (item.wallet !== wallet || !onThisChain(item)) return true;
        return onApi.has(`${item.contract}:${item.tokenId}`);
      })
    );
  }
  return holdings
    .map((holding) => ({
      ...holding,
      tokens: holding.tokens.filter(
        (token) => !hide.has(`${holding.collectionId.toLowerCase()}:${String(token.tokenId)}`)
      ),
    }))
    .filter((holding) => holding.tokens.length > 0);
}
const holdingsCache = new Map<string, { value: WalletInventory; expiresAt: number }>();
const inflight = new Map<string, Promise<WalletInventory>>();

export type WalletInventory = {
  wallet: string;
  holdings: VerifiedNFTHolding[];
};

function cloneHoldings(holdings: VerifiedNFTHolding[]): VerifiedNFTHolding[] {
  return holdings.map((holding) => ({
    ...holding,
    tokens: holding.tokens.map((token) => ({ ...token })),
  }));
}

async function fetchUserCollections(walletAddress: string, forceRefresh = false) {
  const params = new URLSearchParams({ wallet: walletAddress });
  if (forceRefresh) params.set('fresh', '1');
  const network = clientNetwork();
  if (network) params.set('chain', network);
  const response = await fetch(`/api/user-collections?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.json();
}

async function fetchMintedTestNfts(walletAddress: string): Promise<VerifiedNFTHolding[]> {
  const { getLatestTestMint, getPetsNftAddress, getTestNftAddress, getVideoNftAddress } = await import('@/lib/contracts');
  const { ACTIVE_CHAIN } = await import('@/lib/chain');
  const latest = getLatestTestMint();
  const pets = getPetsNftAddress();
  const video = getVideoNftAddress();
  const contracts = [...new Set(
    [latest?.contract, pets, video, ACTIVE_CHAIN.testnet ? getTestNftAddress() : '']
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
  )];
  if (!contracts.length) return [];

  try {
    const params = new URLSearchParams({ wallet: walletAddress });
    for (const contract of contracts) params.append('contract', contract);
    if (latest?.ids.length) params.set('ids', latest.ids.join(','));
    const response = await fetch(`/api/test-nfts?${params.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    const holdings = Array.isArray(data.holdings) && data.holdings.length
      ? data.holdings
      : data.holding
        ? [data.holding]
        : [];
    return holdings.map((holding: VerifiedNFTHolding) => ({
      ...holding,
      collectionName: holding.collectionName || 'eta',
    }));
  } catch (error) {
    console.warn('Could not load minted test NFTs', error);
    return [];
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export interface VerifiedNFTHolding {
  collectionId: string;
  collectionName: string;
  collectionImage?: string;
  collectionFloorPrice?: number;
  collectionFloorSymbol?: string;
  openseaVerified?: boolean;
  collectionSlug?: string;
  tokens: Array<{
    tokenId: string;
    name: string;
    image: string;
    floorPrice: number;
    tokenCount: string;
  }>;
}

function tokenKey(contract: string, tokenId: string) {
  return `${contract.toLowerCase()}:${String(tokenId)}`;
}

function dedupeTokens(
  tokens: VerifiedNFTHolding['tokens']
): VerifiedNFTHolding['tokens'] {
  const seen = new Set<string>();
  const unique: VerifiedNFTHolding['tokens'] = [];
  for (const token of tokens) {
    const id = String(token.tokenId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...token, tokenId: id });
  }
  return unique;
}

function polishHolding(holding: VerifiedNFTHolding): VerifiedNFTHolding {
  const collectionName = appCollectionName(holding.collectionName);
  const tokens = holding.tokens.map((token) => ({
    ...token,
    image: overlayEtaArt(token, holding.collectionName || collectionName),
  }));
  return {
    ...holding,
    collectionName,
    collectionImage: overlayEtaArt(tokens[0] || {}, holding.collectionName || collectionName) || holding.collectionImage,
    tokens,
  };
}

function normalizeHoldings(holdings: VerifiedNFTHolding[]): VerifiedNFTHolding[] {
  const byContract = new Map<string, VerifiedNFTHolding>();
  const globallySeen = new Set<string>();
  for (const holding of holdings) {
    const collectionId = (holding.collectionId || '').toLowerCase();
    if (!collectionId) continue;
    const incoming = dedupeTokens(holding.tokens || []).filter((token) => {
      const key = tokenKey(collectionId, token.tokenId);
      if (globallySeen.has(key)) return false;
      globallySeen.add(key);
      return true;
    });
    const existing = byContract.get(collectionId);
    if (!existing) {
      byContract.set(collectionId, {
        ...holding,
        collectionId,
        tokens: incoming,
      });
      continue;
    }
    existing.tokens.push(...incoming);
    if (!existing.collectionImage && holding.collectionImage) {
      existing.collectionImage = holding.collectionImage;
    }
    if (!existing.openseaVerified && holding.openseaVerified) {
      existing.openseaVerified = true;
    }
    if (!existing.collectionSlug && holding.collectionSlug) {
      existing.collectionSlug = holding.collectionSlug;
    }
  }
  return [...byContract.values()].filter((holding) => holding.tokens.length > 0).map(polishHolding);
}

function holdingsFromCollections(allUserCollections: any, mintedById: Map<string, VerifiedNFTHolding>) {
  const userHoldings: VerifiedNFTHolding[] = [];
  const collections = allUserCollections?.collections;
  if (!Array.isArray(collections) || collections.length === 0) {
    return userHoldings;
  }

  const allowAll = VERIFIED_NFTS.length === 0;
  const verifiedCollectionsOwned = collections.filter((collection: any) => {
    const contractAddress = collection.collection?.primaryContract || collection.collection?.id;
    if (contractAddress && mintedById.has(contractAddress.toLowerCase())) {
      return true;
    }
    return allowAll || VERIFIED_NFTS.some((nft) =>
      nft.address.toLowerCase() === contractAddress?.toLowerCase()
    );
  });

  for (const collection of verifiedCollectionsOwned) {
    const contractAddress = collection.collection?.primaryContract || collection.collection?.id;
    const collectionName = collection.collection?.name || 'Unknown Collection';
    const embedded = Array.isArray(collection.tokens) ? collection.tokens : [];
    if (!contractAddress || embedded.length === 0) continue;

    const overrideEntry = VERIFIED_NFTS.find((v) => v.address.toLowerCase() === contractAddress.toLowerCase());
    const mediaOverride = overrideEntry?.mediaOverride || '';
    const logoOverride = overrideEntry?.logoOverride || '';
    const tokenMediaOverride = overrideEntry?.tokenMediaOverride || mediaOverride || '';
    const holding: VerifiedNFTHolding = {
      collectionId: contractAddress,
      collectionName,
      collectionImage: logoOverride || collection.collection?.image || mediaOverride || '',
      collectionFloorPrice: collection.collection?.floorAskPrice?.amount?.native || 0,
      openseaVerified: collection.collection?.openseaVerified === true,
      collectionSlug: collection.collection?.slug || '',
      tokens: embedded.map((token: any) => ({
        tokenId: token.tokenId || 'unknown',
        name: token.name || collectionName,
        image: token.image || tokenMediaOverride || collection.collection?.image || '',
        floorPrice: collection.collection?.floorAskPrice?.amount?.native || 0,
        tokenCount: token.tokenCount || token.ownership?.tokenCount || '1',
      })),
    };

    const already = mintedById.get(contractAddress.toLowerCase());
    if (already) {
      const seen = new Set(already.tokens.map((token) => String(token.tokenId)));
      const extra = holding.tokens.filter((token) => !seen.has(String(token.tokenId)));
      if (extra.length) {
        mintedById.set(contractAddress.toLowerCase(), {
          ...already,
          tokens: [...already.tokens, ...extra.map((token) => ({ ...token, tokenId: String(token.tokenId) }))],
        });
      }
      continue;
    }

    userHoldings.push({ ...holding, collectionId: contractAddress.toLowerCase() });
  }

  return userHoldings;
}

export function peekOptimisticInventory(walletAddress: string): VerifiedNFTHolding[] {
  const wallet = (walletAddress || '').toLowerCase();
  if (!wallet) return [];
  const cached = holdingsCache.get(cacheKey(wallet))?.value.holdings || [];
  return applyHiddenTokens(wallet, applyReceivedTokens(wallet, cloneHoldings(cached), false), false);
}

export function invalidateWalletInventory(walletAddress?: string) {
  if (!walletAddress) {
    holdingsCache.clear();
    return;
  }
  holdingsCache.delete(cacheKey(walletAddress.toLowerCase()));
}

export function prefetchFreshInventory(wallets: Array<string | undefined | null>) {
  for (const wallet of wallets) {
    const value = String(wallet || '').toLowerCase();
    if (!value.startsWith('0x') || value.length !== 42) continue;
    invalidateWalletInventory(value);
    fetch(withClientChain(`/api/user-collections?wallet=${value}&fresh=1`), { cache: 'no-store' }).catch(() => {});
  }
}

export async function loadWalletInventory(
  walletAddress: string,
  options: { forceRefresh?: boolean } = {}
): Promise<WalletInventory> {
  const wallet = (walletAddress || '').toLowerCase();
  if (!wallet) return { wallet, holdings: [] };
  const key = cacheKey(wallet);
  if (options.forceRefresh) holdingsCache.delete(key);

  const cached = holdingsCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return { wallet, holdings: cloneHoldings(cached.value.holdings) };
  }
  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    return { wallet: result.wallet, holdings: cloneHoldings(result.holdings) };
  }

  const work = (async (): Promise<WalletInventory> => {
    const mintedPromise = fetchMintedTestNfts(wallet);
    let collections: any = { collections: [] };
    try {
      collections = await fetchUserCollections(wallet, options.forceRefresh);
    } catch (error) {
      console.error('Error loading OpenSea inventory:', error);
    }

    const minted = cloneHoldings(await withTimeout(mintedPromise, 4000, []));
    const mintedById = new Map(minted.map((holding) => [holding.collectionId.toLowerCase(), holding]));
    const fromOpenSea = holdingsFromCollections(collections, mintedById);
    const hydrated = await attachOwnedReceived(
      wallet,
      applyReceivedTokens(wallet, normalizeHoldings([...mintedById.values(), ...fromOpenSea]))
    );
    const holdings = applyHiddenTokens(wallet, hydrated);
    const snapshot = { wallet, holdings };
    holdingsCache.set(key, { value: { wallet, holdings: cloneHoldings(holdings) }, expiresAt: Date.now() + HOLDINGS_CACHE_TTL_MS });
    return snapshot;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, work);
  return work;
}

export async function enrichHoldingsMeta(holdings: VerifiedNFTHolding[]): Promise<VerifiedNFTHolding[]> {
  const slugs = [...new Set(holdings.map((holding) => holding.collectionSlug || '').filter(Boolean))];
  if (!slugs.length) return holdings;
  try {
    const response = await fetch(`/api/collection-meta?slugs=${encodeURIComponent(slugs.join(','))}`, {
      cache: 'no-store',
    });
    if (!response.ok) return holdings;
    const data = await response.json();
    const meta = data.collections || {};
    return holdings.map((holding) => {
      const extra = meta[holding.collectionSlug || ''];
      if (!extra) return holding;
      return {
        ...holding,
        collectionName: appCollectionName(extra.name || holding.collectionName),
        collectionImage: extra.imageUrl || holding.collectionImage,
        collectionFloorPrice: Number(extra.floorEth || 0) || holding.collectionFloorPrice || 0,
        collectionFloorSymbol: extra.floorSymbol || holding.collectionFloorSymbol || 'USDG',
        openseaVerified: extra.verified === true || holding.openseaVerified,
      };
    });
  } catch {
    return holdings;
  }
}

export async function getVerifiedNFTsUserHolds(walletAddress: string): Promise<VerifiedNFTHolding[]> {
  const inventory = await loadWalletInventory(walletAddress);
  return inventory.holdings;
}

export async function userHoldsAnyVerifiedNFTs(walletAddress: string): Promise<boolean> {
  const holdings = await getVerifiedNFTsUserHolds(walletAddress);
  return holdings.length > 0;
}

export async function getVerifiedNFTsUserHoldsOptimized(walletAddress: string): Promise<VerifiedNFTHolding[]> {
  return getVerifiedNFTsUserHolds(walletAddress);
}

export async function getVerifiedNFTsUserHoldsUltraConservative(walletAddress: string): Promise<VerifiedNFTHolding[]> {
  return getVerifiedNFTsUserHolds(walletAddress);
}

export async function getVerifiedNFTsUserHoldsSmart(walletAddress: string): Promise<VerifiedNFTHolding[]> {
  return getVerifiedNFTsUserHolds(walletAddress);
}

export async function getTokenURI(contractAddress: string, tokenId: string): Promise<string> {
  try {
    const { ethers } = await import('ethers');
    const { getOptimalProvider } = await import('@/lib/contracts');
    const provider = new ethers.JsonRpcProvider(getOptimalProvider().standardRpc);
    const contract = new ethers.Contract(
      contractAddress,
      ['function tokenURI(uint256 tokenId) view returns (string)'],
      provider
    );
    return await contract.tokenURI(tokenId);
  } catch (error) {
    console.error(`Failed to get tokenURI for ${contractAddress}:${tokenId}`, error);
    return '';
  }
}
