import { useState, useEffect } from 'react';
import { Address } from 'viem';
import { VERIFIED_NFTS } from '../config/verifiedNFTs';
import { withClientChain } from '@/lib/networkPref';

export interface NFTCollection {
  contractAddress: string;
  name: string;
  symbol: string;
  collectionName?: string;
  isVerified: boolean;
  tokenCount?: number;
  image?: string;
  description?: string;
  floorPrice?: number;
  volumeAll?: number;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cache for API responses
const apiCache = new Map<string, any>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function useNFTCollections(address: Address | undefined) {
  const [collections, setCollections] = useState<NFTCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getVerifiedNFTsUserHoldsSmart = async (userAddress: string): Promise<NFTCollection[]> => {
    console.log('🚀 Starting Smart NFT Detection for:', userAddress);
    
    try {
      // Step 1: Get all user collections (1 API call)
      console.log('📊 Step 1: Getting all user collections...');
      
      const cacheKey = `collections_${userAddress}`;
      let userCollectionsData;
      
      if (apiCache.has(cacheKey)) {
        const cached = apiCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
          userCollectionsData = cached.data;
          console.log('✅ Using cached collections data');
        }
      }
      
      if (!userCollectionsData) {
        const collectionsResponse = await fetch(
          withClientChain(
            `/api/user-collections?wallet=${userAddress}&includeTopBid=false&includeLiquidCount=false&offset=0&limit=100`
          )
        );

        if (!collectionsResponse.ok) {
          // Log detailed error information
          console.error('API Error Details:', {
            status: collectionsResponse.status,
            statusText: collectionsResponse.statusText,
            url: collectionsResponse.url,
            headers: Object.fromEntries(collectionsResponse.headers.entries())
          });
          
          try {
            const errorBody = await collectionsResponse.text();
            console.error('Error Response Body:', errorBody);
          } catch (e) {
            console.error('Could not read error body:', e);
          }

          if (collectionsResponse.status === 429) {
            console.warn('⚠️ Rate limited, waiting longer...');
            await delay(3000);
            return [];
          }
          throw new Error(`HTTP ${collectionsResponse.status}: ${collectionsResponse.statusText}`);
        }

        const json = await collectionsResponse.json();
        if (!Array.isArray(json.collections)) {
          throw new Error(json.error || 'No collections returned');
        }
        userCollectionsData = json.collections.map((item: any) => ({
          contractAddress: item.collection.primaryContract.toLowerCase(),
          name: item.collection.name,
          symbol: item.collection.name,
          image: item.collection.image,
          description: item.collection.description,
          tokenCount: parseInt(item.ownership.tokenCount, 10),
          floorPrice: item.collection.floorAskPrice?.amount?.decimal || 0,
          volumeAll: item.collection.volume?.allTime || 0
        }));
        
        apiCache.set(cacheKey, {
          data: userCollectionsData,
          timestamp: Date.now()
        });
      }
      
      const collections = userCollectionsData;
      
      const verifiedAddresses = VERIFIED_NFTS.map(nft => nft.address.toLowerCase());
      const allowAllCollections = verifiedAddresses.length === 0;
      
      const userVerifiedCollections = collections.filter((item: any) => {
        if (allowAllCollections) return true;
        const contract = item.contractAddress.toLowerCase();
        return verifiedAddresses.includes(contract);
      });
      
      // Group by contract to get unique collections and token counts
      const collectionMap = new Map();
      userVerifiedCollections.forEach((item: any) => {
        const contract = item.contractAddress.toLowerCase();
        if (!collectionMap.has(contract)) {
          collectionMap.set(contract, {
            contractAddress: contract,
            name: item.name,
            symbol: item.symbol,
            image: item.image,
            description: item.description,
            tokenCount: item.tokenCount,
            floorPrice: item.floorPrice,
            volumeAll: item.volumeAll,
            isVerified: allowAllCollections || true,
          });
        } else {
          const existing = collectionMap.get(contract);
          existing.tokenCount += item.tokenCount;
        }
      });
      
      console.log(`✅ Found ${collectionMap.size} verified collections user owns`);
      
      if (collectionMap.size === 0) {
        console.log('ℹ️ User owns no verified NFTs');
        return [];
      }
      
      return Array.from(collectionMap.values());
      
    } catch (error) {
      console.error('❌ Smart NFT detection failed:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (!address) {
      setCollections([]);
      setIsLoading(false);
      return;
    }

    const fetchCollections = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const userAddress = address.toLowerCase();
        console.log('🔍 Fetching verified NFTs for:', userAddress);
        
        const verifiedCollections = await getVerifiedNFTsUserHoldsSmart(userAddress);
        
        console.log('✅ Final collections:', verifiedCollections);
        setCollections(verifiedCollections);
        
      } catch (err) {
        console.error('❌ Error fetching collections:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch collections');
        setCollections([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCollections();
  }, [address]);

  return { collections, isLoading, error };
} 