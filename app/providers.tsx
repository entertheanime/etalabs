'use client';

import { ReactNode } from 'react';
import { fetchNFTTokens } from './utils/magicEdenApi';
import { VERIFIED_NFTS } from './config/verifiedNFTs';
import RainbowKitProviders from './components/RainbowKitProviders';
import { NetworkPrefProvider } from './context/NetworkPrefContext';
import { envNetwork, type AppNetwork } from '@/lib/networkPref';

export function Providers({
  children,
  initialNetwork = envNetwork(),
}: {
  children: ReactNode;
  initialNetwork?: AppNetwork;
}) {
  return (
    <NetworkPrefProvider initialNetwork={initialNetwork}>
      <RainbowKitProviders>{children}</RainbowKitProviders>
    </NetworkPrefProvider>
  );
}

export interface TokenAttribute {
  trait_type?: string;
  value?: string | number;
  display_type?: string;
}

export interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: TokenAttribute[];
}

export interface NFTToken {
  token: {
    contract: string;
    tokenId: string;
    kind?: string;
    name?: string;
    description?: string;
    image?: string;
    media?: string;
    collection: {
      id: string;
      name: string;
      floorAskPrice: number;
    };
    lastBuy?: {
      value: number;
      timestamp: number;
    };
    lastSell?: {
      value: number;
      timestamp: number;
    };
    rarityScore?: number;
    rarityRank?: number;
    lastAppraisalValue?: number;
    chainId?: string;
    contractAddress?: string;
    isFlagged?: boolean;
    lastFlagUpdate?: string;
    lastMetaUpdate?: string;
    supply?: string;
    createdAt?: string;
    updatedAt?: string;
    attributes?: TokenAttribute[];
    metadata?: TokenMetadata;
  };
  ownership?: {
    tokenCount: string;
    onSaleCount?: string;
    floorAsk?: {
      id?: string | null;
      price?: number | null;
      maker?: string | null;
      validFrom?: string | null;
      validUntil?: string | null;
      dynamicPricing?: any;
      source?: string | null;
    };
    acquiredAt?: string;
    tokenId?: string;
    amount?: string;
    onSaleAmount?: string;
  };
}

export interface NFT {
  tokenId: string;
  name: string;
  description: string;
  image: string;
  collectionId: string;
  contractAddress: string;
  ownership: {
    tokenCount: string;
  };
  floorPrice?: number;
  selectedCount: number;
}

const tokensCache = new Map<string, { data: NFT[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function getNFTsForCollection(
  walletAddress: string,
  collectionId: string
): Promise<{ tokens: NFT[]; error?: string }> {
  if (!walletAddress || !collectionId) {
    return { tokens: [], error: 'Wallet address and collection ID are required' };
  }

  const cacheKey = `${walletAddress}-${collectionId}`;
  const cached = tokensCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { tokens: cached.data };
  }

  try {
    const response = await fetchNFTTokens(walletAddress, collectionId);
    const mediaOverride =
      VERIFIED_NFTS.find((v) => v.address.toLowerCase() === collectionId.toLowerCase())
        ?.mediaOverride || '';

    const tokens = response.tokens.map((item) => {
      const floorPrice = (item.token.collection?.floorAskPrice || 0) / 1000;
      const tokenCount = item.ownership?.tokenCount || '1';
      const nft: NFT = {
        tokenId: item.token.tokenId,
        name: item.token.name || 'Unnamed NFT',
        description: item.token.description || '',
        image: item.token.image || item.token.media || mediaOverride || '',
        collectionId: collectionId,
        contractAddress: item.token.contract || collectionId,
        ownership: {
          tokenCount: tokenCount,
        },
        floorPrice,
        selectedCount: 0,
      };
      return nft;
    });

    tokensCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
    return { tokens };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch NFTs';
    return { tokens: [], error: errorMessage };
  }
}
