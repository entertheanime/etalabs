import { VERIFIED_NFTS, isVerifiedNFT, isERC1155NFT } from '../app/config/verifiedNFTs';
import { verifyCollection, verifyNFT, BlockchainNFTVerification, CollectionVerification } from './blockchainVerification';
import { fetchUserCollections, fetchUserTokens } from './nft';

export interface EnhancedNFTVerification {
  contractAddress: string;
  tokenId: string;
  isVerified: boolean;
  isBlockchainVerified: boolean;
  isWhitelisted: boolean;
  standard: 'ERC721' | 'ERC1155' | 'UNKNOWN';
  owner: string;
  balance: string;
  name?: string;
  symbol?: string;
  tokenURI?: string;
  error?: string;
  verificationMethod: 'blockchain' | 'whitelist' | 'both' | 'none';
}

export interface EnhancedCollectionVerification {
  contractAddress: string;
  isVerified: boolean;
  isBlockchainVerified: boolean;
  isWhitelisted: boolean;
  isERC721: boolean;
  isERC1155: boolean;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  error?: string;
  verificationMethod: 'blockchain' | 'whitelist' | 'both' | 'none';
}

/**
 * Enhanced verification that checks both blockchain and whitelist
 */
export async function enhancedVerifyCollection(contractAddress: string): Promise<EnhancedCollectionVerification> {
  const result: EnhancedCollectionVerification = {
    contractAddress,
    isVerified: false,
    isBlockchainVerified: false,
    isWhitelisted: false,
    isERC721: false,
    isERC1155: false,
    verificationMethod: 'none'
  };

  // Check whitelist first (fast)
  const isWhitelisted = isVerifiedNFT(contractAddress);
  result.isWhitelisted = isWhitelisted;

  // Check blockchain verification
  try {
    const blockchainVerification = await verifyCollection(contractAddress);
    result.isBlockchainVerified = blockchainVerification.isERC721 || blockchainVerification.isERC1155;
    result.isERC721 = blockchainVerification.isERC721;
    result.isERC1155 = blockchainVerification.isERC1155;
    result.name = blockchainVerification.name;
    result.symbol = blockchainVerification.symbol;
    result.totalSupply = blockchainVerification.totalSupply;
    result.error = blockchainVerification.error;
  } catch (error) {
    result.error = `Blockchain verification failed: ${error.message}`;
  }

  // Determine overall verification status and method
  if (result.isWhitelisted && result.isBlockchainVerified) {
    result.isVerified = true;
    result.verificationMethod = 'both';
  } else if (result.isWhitelisted) {
    result.isVerified = true;
    result.verificationMethod = 'whitelist';
  } else if (result.isBlockchainVerified) {
    result.isVerified = true;
    result.verificationMethod = 'blockchain';
  } else {
    result.isVerified = false;
    result.verificationMethod = 'none';
  }

  return result;
}

/**
 * Enhanced verification for individual NFTs
 */
export async function enhancedVerifyNFT(
  contractAddress: string,
  tokenId: string,
  userAddress: string
): Promise<EnhancedNFTVerification> {
  const result: EnhancedNFTVerification = {
    contractAddress,
    tokenId,
    isVerified: false,
    isBlockchainVerified: false,
    isWhitelisted: false,
    standard: 'UNKNOWN',
    owner: '',
    balance: '0',
    verificationMethod: 'none'
  };

  // Check whitelist first (fast)
  const isWhitelisted = isVerifiedNFT(contractAddress);
  result.isWhitelisted = isWhitelisted;

  // Check blockchain verification
  try {
    const blockchainVerification = await verifyNFT(contractAddress, tokenId, userAddress);
    result.isBlockchainVerified = blockchainVerification.isVerified;
    result.standard = blockchainVerification.standard;
    result.owner = blockchainVerification.owner;
    result.balance = blockchainVerification.balance;
    result.name = blockchainVerification.name;
    result.symbol = blockchainVerification.symbol;
    result.tokenURI = blockchainVerification.tokenURI;
    result.error = blockchainVerification.error;
  } catch (error) {
    result.error = `Blockchain verification failed: ${error.message}`;
  }

  // Determine overall verification status and method
  if (result.isWhitelisted && result.isBlockchainVerified) {
    result.isVerified = true;
    result.verificationMethod = 'both';
  } else if (result.isWhitelisted) {
    result.isVerified = true;
    result.verificationMethod = 'whitelist';
  } else if (result.isBlockchainVerified) {
    result.isVerified = true;
    result.verificationMethod = 'blockchain';
  } else {
    result.isVerified = false;
    result.verificationMethod = 'none';
  }

  return result;
}

/**
 * Get all verified NFTs that a user actually owns (blockchain verified)
 */
export async function getBlockchainVerifiedNFTs(walletAddress: string): Promise<EnhancedNFTVerification[]> {
  if (!walletAddress) {
    console.log('❌ No wallet address provided');
    return [];
  }

  console.log(`🔍 Getting blockchain verified NFTs for wallet: ${walletAddress}`);
  const verifiedNFTs: EnhancedNFTVerification[] = [];

  try {
    // Get all user collections
    const allUserCollections = await fetchUserCollections(walletAddress);

    if (!allUserCollections || allUserCollections.length === 0) {
      console.log('📭 User has no NFT collections');
      return [];
    }

    console.log(`✅ Found ${allUserCollections.length} total collections`);

    // Process each collection
    for (const collection of allUserCollections) {
      try {
        const contractAddress = collection.collection?.primaryContract || collection.collection?.id;
        const collectionName = collection.collection?.name || 'Unknown Collection';

        console.log(`🔍 Verifying collection: ${collectionName} (${contractAddress})`);

        // Enhanced verification
        const enhancedVerification = await enhancedVerifyCollection(contractAddress);

        if (enhancedVerification.isVerified) {
          console.log(`✅ Collection verified: ${collectionName} (${enhancedVerification.verificationMethod})`);

          // Get tokens for this collection
          const tokensResponse = await fetchUserTokens(walletAddress, contractAddress);

          if (tokensResponse && tokensResponse.length > 0) {
            console.log(`✅ Found ${tokensResponse.length} tokens in ${collectionName}`);

            // Verify each token individually
            for (const token of tokensResponse) {
              try {
                const tokenVerification = await enhancedVerifyNFT(
                  contractAddress,
                  token.tokenId,
                  walletAddress
                );

                if (tokenVerification.isVerified) {
                  verifiedNFTs.push(tokenVerification);
                  console.log(`✅ Token verified: ${token.name || token.tokenId} (${tokenVerification.verificationMethod})`);
                } else {
                  console.log(`❌ Token not verified: ${token.name || token.tokenId} - ${tokenVerification.error}`);
                }
              } catch (tokenError) {
                console.error(`❌ Error verifying token ${token.tokenId}:`, tokenError);
              }
            }
          }
        } else {
          console.log(`❌ Collection not verified: ${collectionName} - ${enhancedVerification.error}`);
        }
      } catch (collectionError) {
        console.error(`❌ Error processing collection:`, collectionError);
      }
    }

  } catch (error) {
    console.error('❌ Error in blockchain verification process:', error);
  }

  console.log(`🎯 Final result: ${verifiedNFTs.length} blockchain verified NFTs found`);
  return verifiedNFTs;
}

/**
 * Get only whitelisted NFTs that are also blockchain verified
 */
export async function getWhitelistedAndVerifiedNFTs(walletAddress: string): Promise<EnhancedNFTVerification[]> {
  const allVerified = await getBlockchainVerifiedNFTs(walletAddress);
  
  // Filter to only include NFTs that are both whitelisted AND blockchain verified
  const whitelistedAndVerified = allVerified.filter(nft => 
    nft.verificationMethod === 'both' || nft.verificationMethod === 'whitelist'
  );

  console.log(`🎯 Whitelisted and verified NFTs: ${whitelistedAndVerified.length} out of ${allVerified.length} total`);
  return whitelistedAndVerified;
}

/**
 * Get NFTs that are blockchain verified but not in whitelist (new discoveries)
 */
export async function getNewlyVerifiedNFTs(walletAddress: string): Promise<EnhancedNFTVerification[]> {
  const allVerified = await getBlockchainVerifiedNFTs(walletAddress);
  
  // Filter to only include NFTs that are blockchain verified but NOT whitelisted
  const newlyVerified = allVerified.filter(nft => 
    nft.verificationMethod === 'blockchain'
  );

  console.log(`🎯 Newly verified NFTs (not in whitelist): ${newlyVerified.length}`);
  return newlyVerified;
}

/**
 * Quick check if user has any verified NFTs
 */
export async function userHasVerifiedNFTs(walletAddress: string): Promise<boolean> {
  const verifiedNFTs = await getBlockchainVerifiedNFTs(walletAddress);
  return verifiedNFTs.length > 0;
}

/**
 * Get verification statistics for a user
 */
export async function getVerificationStats(walletAddress: string): Promise<{
  totalCollections: number;
  whitelistedCollections: number;
  blockchainVerifiedCollections: number;
  totalNFTs: number;
  whitelistedNFTs: number;
  blockchainVerifiedNFTs: number;
  newlyVerifiedNFTs: number;
}> {
  const allVerified = await getBlockchainVerifiedNFTs(walletAddress);
  
  const stats = {
    totalCollections: 0,
    whitelistedCollections: 0,
    blockchainVerifiedCollections: 0,
    totalNFTs: allVerified.length,
    whitelistedNFTs: allVerified.filter(nft => nft.isWhitelisted).length,
    blockchainVerifiedNFTs: allVerified.filter(nft => nft.isBlockchainVerified).length,
    newlyVerifiedNFTs: allVerified.filter(nft => nft.verificationMethod === 'blockchain').length
  };

  // Get collection stats
  const uniqueCollections = new Set(allVerified.map(nft => nft.contractAddress));
  stats.totalCollections = uniqueCollections.size;

  for (const contractAddress of uniqueCollections) {
    const enhancedVerification = await enhancedVerifyCollection(contractAddress);
    if (enhancedVerification.isWhitelisted) stats.whitelistedCollections++;
    if (enhancedVerification.isBlockchainVerified) stats.blockchainVerifiedCollections++;
  }

  return stats;
}

/**
 * Verify a specific NFT with detailed logging
 */
export async function debugVerifyNFT(
  contractAddress: string,
  tokenId: string,
  userAddress: string
): Promise<EnhancedNFTVerification> {
  console.log(`🔍 DEBUG: Verifying NFT ${contractAddress}:${tokenId} for user ${userAddress}`);
  
  const result = await enhancedVerifyNFT(contractAddress, tokenId, userAddress);
  
  console.log(`📊 DEBUG RESULTS:`);
  console.log(`  - Contract: ${contractAddress}`);
  console.log(`  - Token ID: ${tokenId}`);
  console.log(`  - Is Whitelisted: ${result.isWhitelisted}`);
  console.log(`  - Is Blockchain Verified: ${result.isBlockchainVerified}`);
  console.log(`  - Overall Verified: ${result.isVerified}`);
  console.log(`  - Verification Method: ${result.verificationMethod}`);
  console.log(`  - Standard: ${result.standard}`);
  console.log(`  - Owner: ${result.owner}`);
  console.log(`  - Balance: ${result.balance}`);
  if (result.error) console.log(`  - Error: ${result.error}`);
  
  return result;
} 