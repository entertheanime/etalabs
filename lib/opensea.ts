import { NATIVE_TOKEN_SYMBOL, OPENSEA_CHAIN } from './chain';

const OPENSEA_BASE = 'https://api.opensea.io/api/v2';

export function getOpenSeaChain(): string {
  return process.env.OPENSEA_CHAIN || OPENSEA_CHAIN;
}

export interface OpenSeaNft {
  identifier?: string;
  collection?: string;
  contract?: string;
  token_standard?: string;
  name?: string;
  description?: string;
  image_url?: string;
  display_image_url?: string;
  metadata_url?: string;
  opensea_url?: string;
}

export interface OpenSeaCollection {
  collection?: string;
  name?: string;
  description?: string;
  image_url?: string | null;
  contracts?: Array<{ address?: string; chain?: string }>;
}

export interface OpenSeaCollectionDetails {
  name: string;
  description: string;
  imageUrl: string;
  safelistStatus: string;
  verified: boolean;
  floorEth: number;
  floorSymbol: string;
}

function defaultFloorSymbol() {
  return getOpenSeaChain() === 'robinhood' ? 'USDG' : NATIVE_TOKEN_SYMBOL;
}

function readFloor(data: {
  floor_price?: number;
  floor_price_symbol?: string;
  total?: { floor_price?: number; floor_price_symbol?: string };
}) {
  const amount = Number(data?.floor_price ?? data?.total?.floor_price ?? 0);
  const symbol = String(data?.floor_price_symbol || data?.total?.floor_price_symbol || '')
    .trim()
    .toUpperCase();
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    symbol: symbol === 'WETH' ? 'ETH' : symbol,
  };
}

export function looksLikeGeneratedCollectionSlug(slug: string) {
  const value = String(slug || '').toLowerCase();
  return /-\d{6,}$/.test(value) || /^\d+$/.test(value);
}

export function isOpenSeaVerifiedStatus(status?: string): boolean {
  return String(status || '').toLowerCase() === 'verified';
}

const collectionDetailsCache = new Map<string, { value: OpenSeaCollectionDetails; expiresAt: number }>();
const accountNftCache = new Map<string, { nfts: OpenSeaNft[]; expiresAt: number }>();
const liveAdds = new Map<string, Map<string, { nft: OpenSeaNft; until: number }>>();
const liveRemoves = new Map<string, Map<string, number>>();
const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_NFT_CACHE_TTL_MS = 8_000;
const LIVE_NFT_TTL_MS = 10 * 60_000;
const keyCooldownUntil = new Map<string, number>();
const watchedWallets = new Map<string, number>();
const WATCH_TTL_MS = 15 * 60_000;

export function watchInventoryWallet(wallet: string) {
  const value = (wallet || '').toLowerCase();
  if (!value.startsWith('0x') || value.length !== 42) return;
  if (value === '0x0000000000000000000000000000000000000000') return;
  watchedWallets.set(value, Date.now() + WATCH_TTL_MS);
}

export function isWatchedInventoryWallet(wallet: string) {
  const value = (wallet || '').toLowerCase();
  const expiresAt = watchedWallets.get(value) || 0;
  if (expiresAt <= Date.now()) {
    watchedWallets.delete(value);
    return false;
  }
  return true;
}

export function getOpenSeaKeys(): string[] {
  return [
    process.env.OPENSEA_API_KEY,
    process.env.OPENSEA_API_KEY_2,
    process.env.OPENSEA_API_KEY_3,
  ]
    .map((key) => (key || '').trim())
    .filter(Boolean);
}

function tokenKey(nft: { contract?: string; identifier?: string }) {
  return `${String(nft.contract || '').toLowerCase()}:${String(nft.identifier || '')}`;
}

export function applyLiveNftMove(input: { from?: string; to?: string; nft?: OpenSeaNft | null }) {
  const nft = input.nft;
  if (!nft?.contract || !nft.identifier) return;
  const key = tokenKey(nft);
  const until = Date.now() + LIVE_NFT_TTL_MS;
  const to = (input.to || '').toLowerCase();
  const from = (input.from || '').toLowerCase();
  if (to.startsWith('0x') && to.length === 42) {
    const add = liveAdds.get(to) || new Map();
    add.set(key, { nft, until });
    liveAdds.set(to, add);
    liveRemoves.get(to)?.delete(key);
    invalidateAccountNftCache(to);
  }
  if (from.startsWith('0x') && from.length === 42) {
    const remove = liveRemoves.get(from) || new Map();
    remove.set(key, until);
    liveRemoves.set(from, remove);
    liveAdds.get(from)?.delete(key);
    invalidateAccountNftCache(from);
  }
}

function applyLiveInventory(wallet: string, nfts: OpenSeaNft[]) {
  const now = Date.now();
  const add = liveAdds.get(wallet);
  const remove = liveRemoves.get(wallet);
  const have = new Set(nfts.map((nft) => tokenKey(nft)));
  let next = nfts.filter((nft) => {
    const until = remove?.get(tokenKey(nft));
    return !until || until <= now;
  });
  if (remove) {
    for (const [key, until] of [...remove.entries()]) {
      if (until <= now || !have.has(key)) remove.delete(key);
    }
  }
  if (add) {
    for (const [key, row] of [...add.entries()]) {
      if (row.until <= now || have.has(key)) {
        add.delete(key);
        continue;
      }
      next = [row.nft, ...next];
    }
  }
  return next;
}

export function invalidateAccountNftCache(wallet?: string) {
  if (!wallet) {
    accountNftCache.clear();
    return;
  }
  const needle = `:${wallet.toLowerCase()}:`;
  for (const key of [...accountNftCache.keys()]) {
    if (key.includes(needle)) accountNftCache.delete(key);
  }
}

function cooldownKey(key: string, response: Response) {
  const retryAfter = Number(response.headers.get('retry-after'));
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  let waitMs = 5_000;
  if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = retryAfter * 1000;
  else if (Number.isFinite(reset) && reset > 0) waitMs = Math.max(1_000, reset * 1000 - Date.now());
  keyCooldownUntil.set(key, Date.now() + Math.min(waitMs, 60_000));
}

function orderedKeys() {
  const now = Date.now();
  const keys = getOpenSeaKeys();
  const ready = keys.filter((key) => (keyCooldownUntil.get(key) || 0) <= now);
  const cooling = keys.filter((key) => (keyCooldownUntil.get(key) || 0) > now);
  return ready.length ? [...ready, ...cooling] : keys;
}

async function openseaFetch(path: string): Promise<Response> {
  const keys = orderedKeys();
  if (!keys.length) {
    return fetch(`${OPENSEA_BASE}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
  }

  let lastResponse: Response | null = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const response = await fetch(`${OPENSEA_BASE}${path}`, {
        headers: {
          accept: 'application/json',
          'x-api-key': key,
        },
        signal: AbortSignal.timeout(12_000),
      });
      lastResponse = response;
      if (response.status === 429 || response.status === 401 || response.status >= 500) {
        if (response.status === 429) cooldownKey(key, response);
        if (i < keys.length - 1) continue;
      }
      return response;
    } catch {
      if (i < keys.length - 1) continue;
    }
  }

  return lastResponse || new Response(JSON.stringify({ error: 'OpenSea unavailable' }), { status: 503 });
}

export async function fetchOpenSeaNft(contract: string, tokenId: string): Promise<OpenSeaNft | null> {
  const chain = getOpenSeaChain();
  const address = String(contract || '').toLowerCase();
  const id = String(tokenId || '').trim();
  if (!address.startsWith('0x') || !id) return null;
  const response = await openseaFetch(`/chain/${chain}/contract/${address}/nfts/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const data = await response.json();
  const nft = data.nft || data;
  if (!nft) return null;
  return {
    identifier: String(nft.identifier || id),
    collection: nft.collection || '',
    contract: String(nft.contract || address).toLowerCase(),
    token_standard: nft.token_standard || 'erc721',
    name: nft.name || '',
    description: nft.description || '',
    image_url: nft.image_url || '',
    display_image_url: nft.display_image_url || nft.image_url || '',
    metadata_url: nft.metadata_url || '',
    opensea_url: nft.opensea_url || '',
  };
}

export async function fetchAccountNfts(
  walletAddress: string,
  options: {
    limit?: number;
    maxPages?: number;
    collectionSlug?: string;
    forceRefresh?: boolean;
    chain?: string;
  } = {}
): Promise<{ nfts: OpenSeaNft[]; error?: string; status?: number }> {
  if (typeof window === 'undefined') {
    import('./openseaStream').then((module) => module.startOpenSeaStream()).catch(() => {});
  }
  watchInventoryWallet(walletAddress);
  const chain = options.chain || getOpenSeaChain();
  const pageLimit = Math.min(options.limit ?? 200, 200);
  const maxPages = options.maxPages ?? 4;
  const cacheKey = `${chain}:${walletAddress.toLowerCase()}:${options.collectionSlug || ''}:${maxPages}`;
  if (options.forceRefresh) invalidateAccountNftCache(walletAddress);
  const cached = accountNftCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return { nfts: applyLiveInventory(walletAddress.toLowerCase(), cached.nfts) };
  }
  const nfts: OpenSeaNft[] = [];
  let next: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      limit: String(pageLimit),
      include_auto_hidden: 'false',
    });
    if (options.collectionSlug) {
      params.set('collection', options.collectionSlug);
    }
    if (next) {
      params.set('next', next);
    }

    const response = await openseaFetch(
      `/chain/${chain}/account/${walletAddress}/nfts?${params.toString()}`
    );

    if (!response.ok) {
      const body = await response.text();
      return {
        nfts,
        status: response.status,
        error: `OpenSea error ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    const data = await response.json();
    const pageNfts: OpenSeaNft[] = Array.isArray(data.nfts) ? data.nfts : [];
    nfts.push(...pageNfts);
    next = data.next;
    if (!next || pageNfts.length === 0) {
      break;
    }
  }

  const fromEvents = await fetchRecentAccountNfts(walletAddress, chain);
  const have = new Set(nfts.map((nft) => tokenKey(nft)));
  for (const nft of fromEvents) {
    const key = tokenKey(nft);
    if (!key.endsWith(':') && !have.has(key)) {
      nfts.unshift(nft);
      have.add(key);
    }
  }

  const merged = applyLiveInventory(walletAddress.toLowerCase(), nfts);
  accountNftCache.set(cacheKey, { nfts: merged, expiresAt: Date.now() + ACCOUNT_NFT_CACHE_TTL_MS });
  return { nfts: merged };
}

async function fetchRecentAccountNfts(walletAddress: string, chain = getOpenSeaChain()): Promise<OpenSeaNft[]> {
  const wallet = walletAddress.toLowerCase();
  const found: OpenSeaNft[] = [];
  for (const eventType of ['transfer', 'sale']) {
    const params = new URLSearchParams({
      chain,
      limit: '20',
    });
    params.append('event_type', eventType);
    const response = await openseaFetch(`/events/accounts/${walletAddress}?${params.toString()}`);
    if (!response.ok) continue;
    const data = await response.json();
    const events = data.asset_events || data.events || [];
    for (const event of events) {
      const created = Date.parse(String(event.event_timestamp || event.closing_date || event.created_date || ''));
      if (!Number.isFinite(created) || Date.now() - created > 8 * 60_000) continue;
      const nft = event.nft || event.asset || null;
      const contract = String(nft?.contract?.address || nft?.contract || '').toLowerCase();
      const identifier = String(nft?.identifier || nft?.token_id || '');
      if (!contract.startsWith('0x') || !identifier) continue;
      const to = String(
        event.to_address ||
          event.to_account?.address ||
          event.winner_account?.address ||
          event.taker?.address ||
          ''
      ).toLowerCase();
      if (to !== wallet) continue;
      found.push({
        identifier,
        collection: nft.collection || event.collection || '',
        contract,
        token_standard: nft.token_standard || 'erc721',
        name: nft.name || '',
        image_url: nft.image_url || '',
        display_image_url: nft.display_image_url || nft.image_url || '',
        opensea_url: nft.opensea_url,
      });
    }
  }
  return found;
}

export async function fetchOpenSeaCollections(
  limit: number = 20,
  chain = getOpenSeaChain()
): Promise<{
  collections: OpenSeaCollection[];
  error?: string;
  status?: number;
}> {
  const response = await openseaFetch(`/collections?chain=${chain}&limit=${limit}`);

  if (!response.ok) {
    const body = await response.text();
    return {
      collections: [],
      status: response.status,
      error: `OpenSea error ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  const data = await response.json();
  return { collections: Array.isArray(data.collections) ? data.collections : [] };
}

export async function fetchOpenSeaCollection(slug: string): Promise<OpenSeaCollectionDetails | null> {
  if (!slug) return null;
  const cached = collectionDetailsCache.get(slug);
  if (cached && cached.expiresAt > Date.now() && cached.value.floorSymbol) return cached.value;

  const response = await openseaFetch(`/collections/${encodeURIComponent(slug)}`);
  if (!response.ok) return null;

  const data = await response.json();
  const safelistStatus = String(data.safelist_status || '');
  const fromCollection = readFloor(data);
  let floorEth = fromCollection.amount;
  let floorSymbol = fromCollection.symbol;
  if ((!floorEth || !floorSymbol) && !looksLikeGeneratedCollectionSlug(slug)) {
    try {
      const stats = await openseaFetch(`/collections/${encodeURIComponent(slug)}/stats`);
      if (stats.ok) {
        const fromStats = readFloor(await stats.json());
        if (!floorEth) floorEth = fromStats.amount;
        if (!floorSymbol) floorSymbol = fromStats.symbol;
      }
    } catch {
      floorEth = floorEth || 0;
    }
  }
  const value = {
    name: data.name || slug,
    description: data.description || '',
    imageUrl: data.image_url || '',
    safelistStatus,
    verified: isOpenSeaVerifiedStatus(safelistStatus),
    floorEth,
    floorSymbol: floorSymbol || defaultFloorSymbol(),
  };
  collectionDetailsCache.set(slug, { value, expiresAt: Date.now() + COLLECTION_CACHE_TTL_MS });
  return value;
}

export function peekOpenSeaCollectionMap(slugs: string[]) {
  const unique = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  return new Map(
    unique
      .map((slug) => {
        const cached = collectionDetailsCache.get(slug);
        return cached && cached.expiresAt > Date.now() ? ([slug, cached.value] as const) : null;
      })
      .filter((entry): entry is readonly [string, OpenSeaCollectionDetails] => Boolean(entry))
  );
}

export async function fetchOpenSeaCollectionMap(slugs: string[]) {
  const unique = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  const entries = await Promise.all(unique.map(async (slug) => [slug, await fetchOpenSeaCollection(slug)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, OpenSeaCollectionDetails] => Boolean(entry[1])));
}

export function groupNftsByCollection(nfts: OpenSeaNft[]) {
  const map = new Map<
    string,
    {
      contract: string;
      name: string;
      image: string;
      description: string;
      slug: string;
      tokenCount: number;
      tokens: Array<{
        tokenId: string;
        name: string;
        image: string;
        tokenCount: string;
        standard: string;
      }>;
    }
  >();

  for (const nft of nfts) {
    const contract = (nft.contract || '').toLowerCase();
    if (!contract) continue;
    const token = {
      tokenId: nft.identifier || '',
      name: nft.name || nft.collection || 'Unnamed NFT',
      image: nft.display_image_url || nft.image_url || '',
      tokenCount: '1',
      standard: nft.token_standard || 'erc721',
    };

    const existing = map.get(contract);
    if (existing) {
      existing.tokenCount += 1;
      if (token.tokenId && !existing.tokens.some((item) => item.tokenId === token.tokenId)) {
        existing.tokens.push(token);
      }
      continue;
    }

    map.set(contract, {
      contract,
      name: nft.collection || nft.name || 'Unnamed collection',
      image: nft.display_image_url || nft.image_url || '',
      description: nft.description || '',
      slug: nft.collection || '',
      tokenCount: 1,
      tokens: token.tokenId ? [token] : [],
    });
  }

  return Array.from(map.values());
}
