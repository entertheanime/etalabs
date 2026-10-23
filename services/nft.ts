import { NFT } from '@/types/nft';
import { isERC1155NFT } from '@/app/config/verifiedNFTs';
import { VERIFIED_NFTS } from '@/app/config/verifiedNFTs';
import { withClientChain } from '@/lib/networkPref';

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const tokensCache = new Map<string, { data: NFT[]; timestamp: number }>();
const collectionsCache = new Map<string, { data: any[]; timestamp: number }>();

// Removed slow ERC1155 blockchain balance checking for speed optimization
// Now relying on Magic Eden API balance data only

export async function getNFTsForCollection(
  walletAddress: string,
  collectionId: string
): Promise<{ tokens: NFT[], error?: string }> {
  if (!walletAddress || !collectionId) {
    return { tokens: [], error: 'Wallet address and collection ID are required' };
  }

  const cacheKey = `${walletAddress}-${collectionId}`;
  
  // Check cache first
  const cached = tokensCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('🎯 Using cached tokens for:', cacheKey);
    return { tokens: cached.data };
  }

  try {
    console.log('🌐 Fetching fresh tokens for collection:', collectionId);
    
    // Step 1: Use manual ERC1155 configuration instead of blockchain call
    const isERC1155 = isERC1155NFT(collectionId);
    console.log(`📋 Contract ${collectionId} is ERC1155: ${isERC1155} (from config)`);
    
    // Step 2: Fetch from our server-side API
    const response = await fetch(withClientChain(`/api/user-collections?wallet=${walletAddress}`));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const collectionsData = await response.json();
    
    // Find the specific collection
    const collectionData = collectionsData.collections.find(
      (item: any) => item.collection.primaryContract.toLowerCase() === collectionId.toLowerCase()
    );
    
    if (!collectionData) {
      return { tokens: [] };
    }
    
    // Convert to expected format
    const mediaOverride = VERIFIED_NFTS.find(v => v.address.toLowerCase() === collectionId.toLowerCase())?.mediaOverride || '';
    const mockResponse = {
      tokens: [{
        token: {
          tokenId: "collection",
          name: collectionData.collection.name,
          description: collectionData.collection.description,
          image: collectionData.collection.image,
          contract: collectionId,
          collection: {
            floorAskPrice: collectionData.collection.floorAskPrice?.amount?.native || 0
          }
        },
        ownership: {
          tokenCount: collectionData.ownership.tokenCount
        }
      }]
    };
    
    // Step 3: Process tokens with fast API-only approach (no blockchain calls)
    const tokens = mockResponse.tokens.map((item) => {
      const floorPrice = (item.token.collection?.floorAskPrice || 0) / 1000;
      const tokenCount = item.ownership?.tokenCount || "1";
      
      console.log('✅ Token processed (fast mode):', {
        tokenId: item.token.tokenId,
        name: item.token.name,
        balance: tokenCount,
        floorPrice,
        isERC1155
      });
      
      const nft: NFT = {
        tokenId: item.token.tokenId,
        name: item.token.name || 'Unnamed NFT',
        description: item.token.description || '',
        image: item.token.image || mediaOverride || '',
        collectionId: collectionId,
        contractAddress: item.token.contract || collectionId,
        ownership: {
          tokenCount: tokenCount
        },
        floorPrice,
        selectedCount: 0,
        standard: isERC1155 ? 'ERC1155' : 'ERC721',
        balance: tokenCount
      };

      return nft;
    });

    // Filter out tokens with zero balance
    const validTokens = tokens.filter(token => 
      parseInt(token.ownership?.tokenCount || '0') > 0
    );

    // Cache the result
    tokensCache.set(cacheKey, { 
      data: validTokens, 
      timestamp: Date.now() 
    });
    
    console.log(`✅ Successfully fetched ${validTokens.length} tokens for collection ${collectionId}`);
    console.log(`📊 Speed optimized: No blockchain calls, API-only processing`);
    
    return { tokens: validTokens };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch NFTs';
    console.error('Error fetching NFTs:', errorMessage);
    return { tokens: [], error: errorMessage };
  }
}

export async function getNFTCollections(
  walletAddress: string,
  offset: number = 0,
  limit: number = 20
): Promise<{ collections: any[], error?: string }> {
  if (!walletAddress) {
    return { collections: [], error: 'Wallet address is required' };
  }

  const cacheKey = `${walletAddress}-${offset}-${limit}`;
  
  // Check cache first
  const cached = collectionsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('🎯 Using cached collections for:', cacheKey);
    return { collections: cached.data };
  }

  try {
    console.log('🌐 Fetching fresh collections for wallet:', walletAddress);
    
    // Use our server-side API instead of direct Magic Eden calls
    const response = await fetch(withClientChain(`/api/user-collections?wallet=${walletAddress}&offset=${offset}&limit=${limit}`));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    
    // Return the raw response but filter out invalid collections
    const filteredCollections = data.collections.filter((item: any) => 
      item.collection && item.collection.primaryContract && item.collection.name
    );
    
    console.log(`✅ Successfully fetched ${filteredCollections.length} valid collections out of ${data.collections.length} total`);
    
    // Cache the result
    collectionsCache.set(cacheKey, { 
      data: filteredCollections, 
      timestamp: Date.now() 
    });
    
    return { collections: filteredCollections };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch collections';
    console.error('Error fetching collections:', errorMessage);
    return { collections: [], error: errorMessage };
  }
}

// Clear cache function for debugging
export function clearNFTCache() {
  tokensCache.clear();
  collectionsCache.clear();
  console.log('🧹 NFT cache cleared');
}

// Export types for convenience (these are now just placeholder types)
export type NFTToken = any;
export type TokenAttribute = any;
export type TokenMetadata = any;

export async function fetchUserCollections(walletAddress: string): Promise<any[]> {
  const { collections, error } = await getNFTCollections(walletAddress);
  if (error) {
    console.error('Error fetching user collections:', error);
    return [];
  }
  return collections;
}

export async function fetchUserTokens(walletAddress: string, collectionId: string): Promise<NFT[]> {
  const { tokens, error } = await getNFTsForCollection(walletAddress, collectionId);
  if (error) {
    console.error('Error fetching user tokens:', error);
    return [];
  }
  return tokens;
}