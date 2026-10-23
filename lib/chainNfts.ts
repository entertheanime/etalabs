import type { OpenSeaNft } from './opensea';
import { fetchBlockscoutNfts, mergeChainAndOpenSeaNfts } from './blockscout';
import { ipfsToHttp } from './ipfs';
import { appCollectionName, overlayEtaArt } from './videoArt';

const accountNftCache = new Map<string, { nfts: OpenSeaNft[]; expiresAt: number }>();
const ACCOUNT_NFT_CACHE_TTL_MS = 2_000;

function alchemyNftBase() {
  const rpc = process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL || '';
  const match = rpc.match(/^(https:\/\/[^/]+)\/v2\/([^/?#]+)/i);
  if (!match) return '';
  return `${match[1]}/nft/v3/${match[2]}`;
}

function alchemyRpcUrl() {
  return process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL || process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || '';
}

function decodeAbiString(hexData: string) {
  const raw = String(hexData || '').replace(/^0x/i, '');
  if (raw.length < 128) return '';
  const bytes = Buffer.from(raw, 'hex');
  const offset = Number(bytes.readBigUInt64BE(24));
  if (!Number.isFinite(offset) || offset + 32 > bytes.length) return '';
  const length = Number(bytes.readBigUInt64BE(offset + 24));
  if (!Number.isFinite(length) || offset + 32 + length > bytes.length) return '';
  return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8');
}

async function rpcCall(to: string, data: string) {
  const rpc = alchemyRpcUrl();
  if (!rpc) return '';
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return '';
  const json = await response.json();
  return String(json.result || '');
}

async function readTokenUri(contract: string, tokenId: string) {
  const data = `0xc87b56dd${BigInt(tokenId).toString(16).padStart(64, '0')}`;
  return decodeAbiString(await rpcCall(contract, data));
}

const metadataCache = new Map<string, { name?: string; image?: string }>();

async function readTokenMetadata(tokenUri: string) {
  const uri = ipfsToHttp(tokenUri);
  if (!uri || uri.startsWith('data:')) return {};
  const cached = metadataCache.get(uri);
  if (cached) return cached;
  try {
    const response = await fetch(uri, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return {};
    const meta = await response.json();
    const value = {
      name: String(meta.name || ''),
      image: ipfsToHttp(meta.image || meta.image_url || ''),
    };
    metadataCache.set(uri, value);
    return value;
  } catch {
    return {};
  }
}

async function hydrateTokenMedia(nfts: OpenSeaNft[]) {
  const missing = nfts.filter((nft) => !nft.display_image_url && nft.contract && nft.identifier);
  if (!missing.length) return nfts;
  await Promise.all(
    missing.map(async (nft) => {
      try {
        const tokenUri = await readTokenUri(String(nft.contract), String(nft.identifier));
        if (!tokenUri) return;
        if (tokenUri.startsWith('data:image')) {
          nft.image_url = tokenUri;
          nft.display_image_url = tokenUri;
          return;
        }
        const meta = await readTokenMetadata(tokenUri);
        if (meta.image) {
          nft.image_url = meta.image;
          nft.display_image_url = meta.image;
        }
        if (meta.name) nft.name = meta.name;
      } catch {
        /* keep empty; tile can stay blank rather than show a collection logo */
      }
    })
  );
  return nfts;
}

function tokenIdDecimal(value: string) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return BigInt(raw).toString(10);
  } catch {
    return raw;
  }
}

export async function fetchTokenMedia(contract: string, tokenId: string) {
  const nfts: OpenSeaNft[] = [
    {
      contract: String(contract || '').toLowerCase(),
      identifier: tokenIdDecimal(tokenId),
    },
  ];
  await hydrateTokenMedia(nfts);
  const nft = nfts[0];
  return {
    name: nft.name || '',
    image: overlayEtaArt(
      { name: nft.name, tokenId: nft.identifier, image: nft.display_image_url || nft.image_url || '' },
      nft.collection
    ),
  };
}

export function invalidateChainNftCache(wallet?: string) {
  if (!wallet) {
    accountNftCache.clear();
    return;
  }
  accountNftCache.delete(wallet.toLowerCase());
}

async function fetchAlchemyNfts(wallet: string): Promise<OpenSeaNft[]> {
  const base = alchemyNftBase();
  if (!base) return [];
  const nfts: OpenSeaNft[] = [];
  let pageKey = '';
  for (let page = 0; page < 8; page++) {
    const params = new URLSearchParams({
      owner: wallet,
      withMetadata: 'true',
      pageSize: '100',
    });
    if (pageKey) params.set('pageKey', pageKey);
    const response = await fetch(`${base}/getNFTsForOwner?${params.toString()}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) break;
    const data = await response.json();
    for (const item of data.ownedNfts || []) {
      const contract = String(item.contract?.address || '').toLowerCase();
      const tokenId = tokenIdDecimal(item.tokenId || item.id?.tokenId);
      if (!contract || !tokenId) continue;
      const rawImage = ipfsToHttp(item.raw?.metadata?.image || '');
      const original = String(item.image?.originalUrl || '');
      const cached = String(item.image?.cachedUrl || item.image?.pngUrl || item.image?.thumbnailUrl || '');
      const looksLikeTokenArt = Boolean(rawImage) || original.includes(`/${tokenId}`) || original.startsWith('data:');
      const collection = appCollectionName(item.contract?.name || item.contract?.openSeaMetadata?.collectionName || 'Collection');
      const name = item.name || item.raw?.metadata?.name || `${item.contract?.name || 'NFT'} #${tokenId}`;
      const image = overlayEtaArt(
        { name, tokenId, image: looksLikeTokenArt ? rawImage || original || cached : '' },
        item.contract?.name || collection
      );
      nfts.push({
        identifier: tokenId,
        collection,
        contract,
        token_standard: String(item.tokenType || item.contract?.tokenType || 'erc721').toLowerCase(),
        name,
        description: item.description || item.raw?.metadata?.description || '',
        image_url: image,
        display_image_url: image,
      });
    }
    pageKey = data.pageKey || '';
    if (!pageKey) break;
  }
  return hydrateTokenMedia(nfts);
}

export async function fetchChainNfts(
  walletAddress: string,
  options: { forceRefresh?: boolean } = {}
): Promise<OpenSeaNft[]> {
  const wallet = walletAddress.toLowerCase();
  if (!wallet.startsWith('0x') || wallet.length !== 42) return [];
  if (options.forceRefresh) invalidateChainNftCache(wallet);
  const cached = accountNftCache.get(wallet);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.nfts;
  }

  let nfts: OpenSeaNft[] = [];
  let usedAlchemy = false;
  try {
    if (alchemyNftBase()) {
      nfts = await fetchAlchemyNfts(wallet);
      usedAlchemy = true;
    }
  } catch {
    usedAlchemy = false;
    nfts = [];
  }
  if (!usedAlchemy) {
    try {
      nfts = await fetchBlockscoutNfts(wallet, options);
    } catch {
      nfts = [];
    }
  }

  accountNftCache.set(wallet, { nfts, expiresAt: Date.now() + ACCOUNT_NFT_CACHE_TTL_MS });
  return nfts;
}

export { mergeChainAndOpenSeaNfts };
