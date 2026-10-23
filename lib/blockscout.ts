import { EXPLORER_URL } from './chain';
import type { OpenSeaNft } from './opensea';
import { ipfsToHttp } from './ipfs';

const accountNftCache = new Map<string, { nfts: OpenSeaNft[]; expiresAt: number }>();
const ACCOUNT_NFT_CACHE_TTL_MS = 2_000;

export function invalidateBlockscoutNftCache(wallet?: string) {
  if (!wallet) {
    accountNftCache.clear();
    return;
  }
  accountNftCache.delete(wallet.toLowerCase());
}

export async function fetchBlockscoutNfts(
  walletAddress: string,
  options: { forceRefresh?: boolean } = {}
): Promise<OpenSeaNft[]> {
  const wallet = walletAddress.toLowerCase();
  if (!wallet.startsWith('0x') || wallet.length !== 42) return [];
  if (options.forceRefresh) invalidateBlockscoutNftCache(wallet);

  const cached = accountNftCache.get(wallet);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.nfts;
  }

  const nfts: OpenSeaNft[] = [];
  let params = new URLSearchParams({ type: 'ERC-721,ERC-1155' });

  for (let page = 0; page < 8; page++) {
    const response = await fetch(`${EXPLORER_URL}/api/v2/addresses/${wallet}/nft?${params.toString()}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) break;

    const data = await response.json();
    for (const item of data.items || []) {
      const contract = String(item.token?.address_hash || item.token?.address || '').toLowerCase();
      const tokenId = String(item.id ?? '');
      if (!contract || !tokenId) continue;
      const image = ipfsToHttp(item.image_url || item.media_url || item.metadata?.image || '');
      nfts.push({
        identifier: tokenId,
        collection: item.token?.name || item.metadata?.name || 'Collection',
        contract,
        token_standard: String(item.token_type || item.token?.type || 'erc721').toLowerCase(),
        name: item.metadata?.name || `${item.token?.name || 'NFT'} #${tokenId}`,
        description: item.metadata?.description || '',
        image_url: image,
        display_image_url: image,
      });
    }

    const next = data.next_page_params;
    if (!next || typeof next !== 'object') break;
    params = new URLSearchParams({ type: 'ERC-721,ERC-1155' });
    for (const [key, value] of Object.entries(next)) {
      if (value == null) continue;
      params.set(key, String(value));
    }
  }

  accountNftCache.set(wallet, { nfts, expiresAt: Date.now() + ACCOUNT_NFT_CACHE_TTL_MS });
  return nfts;
}

export function mergeChainAndOpenSeaNfts(chainNfts: OpenSeaNft[], openSeaNfts: OpenSeaNft[]) {
  if (!chainNfts.length) return openSeaNfts;
  const extra = new Map(
    openSeaNfts.map((nft) => [`${String(nft.contract || '').toLowerCase()}:${nft.identifier}`, nft])
  );
  return chainNfts.map((nft) => {
    const overlay = extra.get(`${String(nft.contract || '').toLowerCase()}:${nft.identifier}`);
    if (!overlay) return nft;
    return {
      ...nft,
      collection: overlay.collection || nft.collection,
      name: overlay.name || nft.name,
      description: overlay.description || nft.description,
      image_url: overlay.display_image_url || overlay.image_url || nft.image_url,
      display_image_url: overlay.display_image_url || overlay.image_url || nft.display_image_url,
      opensea_url: overlay.opensea_url,
    };
  });
}
