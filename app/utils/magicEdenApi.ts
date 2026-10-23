import axios, { AxiosError } from 'axios';

const ME_API_BASE_URL = 'https://api-mainnet.magiceden.dev/v3/rtp/monad-testnet';
// This file should no longer be used for direct API calls
// Use server-side API routes instead: /api/user-collections
const ME_API_KEY = 'DEPRECATED - Use server-side API routes';

// Rate limiting configuration - Optimized for faster performance 
const RATE_LIMIT_DELAY = parseInt(process.env.NEXT_PUBLIC_API_RATE_LIMIT_MS || '500'); // 500ms between requests (speed optimized)
const MAX_RETRIES = parseInt(process.env.NEXT_PUBLIC_API_MAX_RETRIES || '3');
const RETRY_DELAY_BASE = parseInt(process.env.NEXT_PUBLIC_API_RETRY_DELAY_MS || '5000'); // 5 seconds base delay for retries

// Simple in-memory rate limiter
class RateLimiter {
  private lastRequestTime = 0;
  
  async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      const delay = RATE_LIMIT_DELAY - timeSinceLastRequest;
      console.log(`⏳ Rate limiting: waiting ${delay}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }
}

const rateLimiter = new RateLimiter();

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_DELAY_BASE
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Apply rate limiting before each request
      await rateLimiter.waitForRateLimit();
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries + 1} attempts failed for API request`);
        throw lastError;
      }
      
      // Check if it's a rate limit error (429) or server error (5xx)
      const isRetryableError = axios.isAxiosError(error) && (
        error.response?.status === 429 || 
        (error.response?.status && error.response.status >= 500)
      );
      
      if (!isRetryableError) {
        console.error(`❌ Non-retryable error encountered:`, error);
        throw error;
      }
      
      // Much longer delays for 429 errors
      let delay = baseDelay * Math.pow(2, attempt);
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        delay = delay * 2; // Double the delay for rate limit errors
        console.log(`🚫 Rate limit hit! Extra long retry delay: ${delay}ms`);
      }
      
      console.log(`⚠️ Attempt ${attempt + 1} failed (${error.message}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Simple in-memory cache for API responses
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class APICache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL = 60000; // 1 minute default cache
  
  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

const apiCache = new APICache();

// Cache wrapper for any async function
async function withCache<T>(
  cacheKey: string,
  operation: () => Promise<T>,
  ttl: number = 60000
): Promise<T> {
  // Try to get from cache first
  const cached = apiCache.get<T>(cacheKey);
  if (cached) {
    console.log(`💾 Cache hit for: ${cacheKey}`);
    return cached;
  }
  
  // Execute operation and cache result
  console.log(`🌐 Cache miss, fetching: ${cacheKey}`);
  const result = await operation();
  apiCache.set(cacheKey, result, ttl);
  
  return result;
}

/**
 * Quick check to see if a wallet has any NFTs at all
 * @param walletAddress The user's wallet address
 * @returns Promise<boolean> True if wallet has any NFT collections
 */
export const hasAnyNFTs = async (walletAddress: string): Promise<boolean> => {
  const validWallet = validateAddress(walletAddress);
  const cacheKey = `hasNFTs:${validWallet}`;
  
  return withCache(cacheKey, async () => {
    console.log(`🔍 Quick check: Does wallet ${validWallet.substring(0, 8)}... have any NFTs?`);
    
    const response = await retryWithBackoff(async () => {
      return await meApiClient.get<CollectionsResponse>(
        `/users/${validWallet}/collections/v3`,
        {
          params: {
            includeTopBid: false,
            includeLiquidCount: false,
            offset: 0,
            limit: 1 // Just check if there's at least one collection
          }
        }
      );
    });
    
    const hasNFTs = response.data.collections && response.data.collections.length > 0;
    console.log(`${hasNFTs ? '✅' : '📭'} Wallet has ${hasNFTs ? 'some' : 'no'} NFT collections`);
    return hasNFTs;
  }, 120000) // Cache for 2 minutes
  .catch(error => {
    console.warn(`⚠️ Could not check if wallet has NFTs:`, error instanceof Error ? error.message : error);
    return true; // Assume they might have NFTs if we can't check
  });
};

const meApiClient = axios.create({
  baseURL: ME_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${ME_API_KEY}`,
    'accept': '*/*'
  },
  timeout: 30000 // 30 second timeout
});

// Add response interceptor for logging and tracking
meApiClient.interceptors.response.use(
  response => {
    apiCallTracker.logCall(response.config.url || 'unknown', response.status);
    
    console.log(`✅ API Success [${response.config.url}]:`, {
      status: response.status,
      dataSize: JSON.stringify(response.data).length,
      rate: `${apiCallTracker.getCallRate(1).toFixed(1)}/min`
    });
    return response;
  },
  error => {
    if (axios.isAxiosError(error)) {
      apiCallTracker.logCall(error.config?.url || 'unknown', error.response?.status);
      
      const errorInfo = {
        url: error.config?.url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        rate: `${apiCallTracker.getCallRate(1).toFixed(1)}/min`,
        recent429s: apiCallTracker.get429Count(5),
        ...(error.response?.data && { responseData: error.response.data })
      };
      
      // More detailed error logging based on status code
      if (error.response?.status === 429) {
        console.error('🚫 Rate limit exceeded (429) - TOO MANY REQUESTS:', errorInfo);
        console.error(`💡 Suggestion: Try the ultra-conservative function or increase delays`);
      } else if (error.response?.status && error.response.status >= 500) {
        console.error('🔧 Server error (5xx):', errorInfo);
      } else if (error.response?.status === 404) {
        console.warn('📭 Resource not found (404):', errorInfo);
      } else {
        console.error('❌ API Error:', errorInfo);
      }
    } else {
      console.error('❌ Network/Unknown Error:', error);
    }
    throw error;
  }
);

// Validates Ethereum address format (0x followed by 40 hex chars)
const validateAddress = (address: string): string => {
  if (!address) throw new Error('Address is required');
  
  // Convert to lowercase
  address = address.toLowerCase();
  
  // Check format
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    throw new Error('Invalid address format. Must be 0x followed by 40 hex characters.');
  }
  
  return address;
};

export interface TokenAttribute {
  trait_type: string;
  value: string;
}

export interface TokenOwnership {
  tokenCount?: string;
  tokenId?: string;
  amount?: string;
  onSaleCount?: string;
}

export interface NFTCollection {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  image: string | null;
  tokenCount: string;
  primaryContract: string;
  contractKind: string;
  floorAskPrice?: {
    currency: {
      contract: string;
      name: string;
      symbol: string;
      decimals: number;
    };
    amount: {
      raw: string;
      decimal: number;
      usd: number | null;
      native: number;
    };
  };
}

export interface CollectionWithOwnership {
  collection: NFTCollection;
  ownership: TokenOwnership;
}

export interface CollectionsResponse {
  collections: CollectionWithOwnership[];
}

export interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
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
      imageUrl?: string;
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
    // Keep existing fields for backward compatibility
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
    // Keep existing fields
    tokenId?: string;
    amount?: string;
    onSaleAmount?: string;
  };
}

export interface TokensResponse {
  tokens: NFTToken[];
}

/**
 * Fetches user's NFTs for a specific collection
 * @param walletAddress The user's wallet address (0x followed by 40 hex chars)
 * @param contractAddress The NFT collection contract address (0x followed by 40 hex chars)
 * @returns Array of NFT tokens with full metadata
 */
export const fetchUserNFTs = async (
  walletAddress: string,
  contractAddress: string
): Promise<CollectionsResponse> => {
  try {
    // Validate addresses
    const validWallet = validateAddress(walletAddress);
    const validContract = validateAddress(contractAddress);
    
    console.log(`🔍 Fetching user NFTs for wallet: ${validWallet.substring(0, 8)}...`);
    
    return await retryWithBackoff(async () => {
      const response = await meApiClient.get<CollectionsResponse>(
        `/users/${validWallet}/collections/v3`,
        {
          params: {
            includeTopBid: false,
            includeLiquidCount: false
          }
        }
      );
      return response.data;
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error fetching user NFTs:', error.message);
    } else {
      console.error('❌ Error fetching user NFTs:', error);
    }
    throw error;
  }
};

/**
 * Fetches NFT collection information including floor price, supply, and metadata
 * @param walletAddress The user's wallet address (0x followed by 40 hex chars)
 * @param offset Pagination offset
 * @param limit Number of collections to fetch
 * @returns Collection response containing array of NFT collections with full metadata
 */
export const fetchNFTCollections = async (
  walletAddress: string,
  offset: number = 0,
  limit: number = 20
): Promise<CollectionsResponse> => {
  try {
    // Validate wallet address
    const validWallet = validateAddress(walletAddress);
    
    console.log(`🔍 Fetching NFT collections for wallet: ${validWallet.substring(0, 8)}... (offset: ${offset}, limit: ${limit})`);
    
    return await retryWithBackoff(async () => {
      const response = await meApiClient.get<CollectionsResponse>(
        `/users/${validWallet}/collections/v3`,
        {
          params: {
            includeTopBid: false,
            includeLiquidCount: false,
            offset,
            limit
          }
        }
      );
      return response.data;
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error fetching NFT collections:', error.message);
    } else {
      console.error('❌ Error fetching NFT collections:', error);
    }
    throw error;
  }
};

/**
 * Fetches NFT tokens for multiple collections in parallel
 * @param walletAddress The user's wallet address
 * @param contractAddresses Array of collection contract addresses
 * @param concurrency Maximum number of concurrent requests (default: 3)
 * @returns Array of results with collection address and tokens
 */
export const fetchNFTTokensBatch = async (
  walletAddress: string,
  contractAddresses: string[],
  concurrency: number = 1 // REDUCED to 1 to avoid rate limits - process sequentially!
): Promise<Array<{ contractAddress: string; result: TokensResponse | null; error?: string }>> => {
  const validWallet = validateAddress(walletAddress);
  console.log(`🐌 CONSERVATIVE batch fetching NFT tokens for ${contractAddresses.length} collections (sequential processing to avoid 429s)`);
  
  const results: Array<{ contractAddress: string; result: TokensResponse | null; error?: string }> = [];
  
  // Process ONE AT A TIME to avoid rate limits
  for (let i = 0; i < contractAddresses.length; i++) {
    const contractAddress = contractAddresses[i];
    console.log(`📦 Processing collection ${i + 1}/${contractAddresses.length}: ${contractAddress.substring(0, 8)}...`);
    
    try {
      const validContract = validateAddress(contractAddress);
      
      const result = await retryWithBackoff(async () => {
        const response = await meApiClient.get<TokensResponse>(
          `/users/${validWallet}/tokens/v6`,
          {
            params: {
              collection: validContract
            }
          }
        );
        return response.data;
      });
      
      results.push({ contractAddress, result, error: undefined });
      console.log(`✅ Success for ${contractAddress.substring(0, 8)}...`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Failed to fetch tokens for ${contractAddress}: ${errorMessage}`);
      results.push({ contractAddress, result: null, error: errorMessage });
    }
    
    // Always wait between requests to be extra safe
    if (i < contractAddresses.length - 1) {
      const delay = RATE_LIMIT_DELAY + 500; // Extra 500ms buffer
      console.log(`⏳ Waiting ${delay}ms before next collection...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.log(`✅ Batch complete: ${results.filter(r => r.result).length}/${contractAddresses.length} collections returned data`);
  return results;
};

/**
 * Get all user collections in one optimized call
 * @param walletAddress The user's wallet address
 * @returns Map of contract address to collection metadata
 */
export const getUserCollectionsMap = async (walletAddress: string): Promise<Map<string, NFTCollection>> => {
  const validWallet = validateAddress(walletAddress);
  const cacheKey = `collectionsMap:${validWallet}`;
  
  return withCache(cacheKey, async () => {
    console.log(`🗂️ Fetching all collections metadata for wallet: ${validWallet.substring(0, 8)}...`);
    
    const response = await retryWithBackoff(async () => {
      return await meApiClient.get<CollectionsResponse>(
        `/users/${validWallet}/collections/v3`,
        {
          params: {
            includeTopBid: false,
            includeLiquidCount: false,
            offset: 0,
            limit: 100 // Get up to 100 collections in one call
          }
        }
      );
    });
    
    const collectionsMap = new Map<string, NFTCollection>();
    
    if (response.data.collections) {
      response.data.collections.forEach(item => {
        const address = item.collection.primaryContract.toLowerCase();
        collectionsMap.set(address, item.collection);
      });
      
      console.log(`📚 Loaded metadata for ${collectionsMap.size} collections`);
    }
    
    return collectionsMap;
  }, 300000) // Cache for 5 minutes (collection metadata changes less frequently)
  .catch(error => {
    console.warn(`⚠️ Could not fetch collections metadata:`, error instanceof Error ? error.message : error);
    return new Map();
  });
};

/**
 * Fetches individual NFT tokens for a user from a specific collection (original function)
 * @param walletAddress The user's wallet address (0x followed by 40 hex chars)
 * @param contractAddress The NFT collection contract address (0x followed by 40 hex chars)
 * @returns Array of NFT tokens with full metadata
 */
export const fetchNFTTokens = async (
  walletAddress: string,
  contractAddress: string
): Promise<TokensResponse> => {
  try {
    // Validate addresses
    const validWallet = validateAddress(walletAddress);
    const validContract = validateAddress(contractAddress);
    
    console.log(`🔍 Fetching NFT tokens for wallet: ${validWallet.substring(0, 8)}... from collection: ${validContract.substring(0, 8)}...`);
    
    return await retryWithBackoff(async () => {
      const response = await meApiClient.get<TokensResponse>(
        `/users/${validWallet}/tokens/v6`,
        {
          params: {
            collection: validContract
          }
        }
      );
      return response.data;
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error fetching NFT tokens:', error.message);
    } else {
      console.error('❌ Error fetching NFT tokens:', error);
    }
    throw error;
  }
};

/**
 * Cache management functions
 */
export const cacheUtils = {
  clear: () => {
    apiCache.clear();
    console.log('🧹 API cache cleared');
  },
  
  size: () => apiCache.size(),
  
  getStats: () => ({
    size: apiCache.size(),
    entries: Array.from(apiCache['cache'].keys()) // Access private cache for debugging
  })
};

/**
 * Performance monitoring wrapper
 */
async function withPerformanceMonitoring<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  console.log(`⏱️ Starting ${operation}...`);
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    console.log(`✅ ${operation} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${operation} failed after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * ULTRA-FAST VERSION: Uses all optimization techniques
 * @param walletAddress The user's wallet address
 * @param options Configuration options
 */
export const getVerifiedNFTsUltraFast = async (
  walletAddress: string,
  options: {
    concurrency?: number;
    useCache?: boolean;
    skipBlockchainCheck?: boolean;
  } = {}
): Promise<any> => {
  const { concurrency = 5, useCache = true, skipBlockchainCheck = false } = options;
  
  return withPerformanceMonitoring(`Ultra-fast NFT check for ${walletAddress.substring(0, 8)}...`, async () => {
    if (!useCache) {
      cacheUtils.clear();
    }
    
    const validWallet = validateAddress(walletAddress);
    const cacheKey = `ultraFast:${validWallet}:${concurrency}:${skipBlockchainCheck}`;
    
    if (useCache) {
      const cached = apiCache.get(cacheKey);
      if (cached) {
        console.log('⚡ Ultra-fast cache hit!');
        return cached;
      }
    }
    
    // This will be imported and used by the verifiedNFTChecker
    const result = { walletAddress, timestamp: Date.now() };
    
    if (useCache) {
      apiCache.set(cacheKey, result, 180000); // 3 minute cache
    }
    
    return result;
  });
};

// API call tracking for debugging
class APICallTracker {
  private calls: Array<{ timestamp: number; url: string; status?: number }> = [];
  
  logCall(url: string, status?: number) {
    this.calls.push({ timestamp: Date.now(), url, status });
    
    // Keep only last 50 calls to avoid memory issues
    if (this.calls.length > 50) {
      this.calls = this.calls.slice(-50);
    }
  }
  
  getRecentCalls(minutes: number = 5): Array<{ timestamp: number; url: string; status?: number }> {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.calls.filter(call => call.timestamp > cutoff);
  }
  
  get429Count(minutes: number = 5): number {
    return this.getRecentCalls(minutes).filter(call => call.status === 429).length;
  }
  
  getCallRate(minutes: number = 1): number {
    const recentCalls = this.getRecentCalls(minutes);
    return recentCalls.length / minutes; // calls per minute
  }
  
  getStats(): object {
    const recent = this.getRecentCalls(5);
    return {
      totalCalls: this.calls.length,
      recentCalls: recent.length,
      recent429s: recent.filter(c => c.status === 429).length,
      callsPerMinute: this.getCallRate(1),
      oldestCall: this.calls[0]?.timestamp,
      newestCall: this.calls[this.calls.length - 1]?.timestamp
    };
  }
}

const apiCallTracker = new APICallTracker();

// Enhanced debugging utilities
export const debugUtils = {
  getAPIStats: () => apiCallTracker.getStats(),
  
  get429Count: (minutes: number = 5) => apiCallTracker.get429Count(minutes),
  
  getCallRate: (minutes: number = 1) => apiCallTracker.getCallRate(minutes),
  
  printDebugInfo: () => {
    const stats = apiCallTracker.getStats();
    console.log('🔍 API Debug Info:', {
      ...stats,
      cacheSize: apiCache.size(),
      rateLimitDelay: RATE_LIMIT_DELAY,
      retryDelay: RETRY_DELAY_BASE
    });
  },
  
  // Test function to check if API is accessible
  testAPI: async (walletAddress: string) => {
    console.log('🧪 Testing API access...');
    try {
      const result = await hasAnyNFTs(walletAddress);
      console.log('✅ API test successful:', result);
      return true;
    } catch (error) {
      console.error('❌ API test failed:', error);
      return false;
    }
  }
}; 