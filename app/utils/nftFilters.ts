import { NFT } from '../../types/nft';
import { isVerifiedNFT } from '../config/verifiedNFTs';

export const filterVerifiedNFTs = (nfts: NFT[]): NFT[] => {
  if (!nfts) return [];
  
  // Debug: Log what we're checking
  console.log('🔍 Filtering NFTs:', nfts.map(nft => ({
    tokenId: nft.tokenId,
    collectionId: nft.collectionId,
    contractAddress: nft.contractAddress,
    isVerified: isVerifiedNFT(nft.collectionId) || isVerifiedNFT(nft.contractAddress)
  })));
  
  return nfts.filter(nft => {
    if (!nft) return false;
    // Check both collectionId and contractAddress
    const verified = isVerifiedNFT(nft.collectionId) || isVerifiedNFT(nft.contractAddress);
    return verified;
  });
};

// Enhanced filter that requires blockchain verification
export const filterBlockchainVerifiedNFTs = async (nfts: NFT[], userAddress: string): Promise<NFT[]> => {
  if (!nfts || !userAddress) return [];
  
  console.log('🔍 Filtering NFTs with blockchain verification...');
  
  // Import the enhanced verification service
  const { enhancedVerifyNFT } = await import('../../services/enhancedVerification');
  
  const verifiedNFTs: NFT[] = [];
  
  for (const nft of nfts) {
    if (!nft) continue;
    
    try {
      const contractAddress = nft.contractAddress || nft.collectionId;
      if (!contractAddress) continue;
      
      const verification = await enhancedVerifyNFT(contractAddress, nft.tokenId, userAddress);
      
      if (verification.isVerified) {
        verifiedNFTs.push(nft);
        console.log(`✅ NFT verified: ${nft.name || nft.tokenId} (${verification.verificationMethod})`);
      } else {
        console.log(`❌ NFT not verified: ${nft.name || nft.tokenId} - ${verification.error}`);
      }
    } catch (error) {
      console.error(`❌ Error verifying NFT ${nft.tokenId}:`, error);
    }
  }
  
  console.log(`🎯 Blockchain verified NFTs: ${verifiedNFTs.length} out of ${nfts.length}`);
  return verifiedNFTs;
}; 