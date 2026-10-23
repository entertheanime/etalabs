import { ethers } from 'ethers';
import { optimalProvider } from './blockchain';

// ERC165 interface IDs
const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';
const ERC165_INTERFACE_ID = '0x01ffc9a7';

// Standard ERC721 and ERC1155 function signatures
const ERC721_FUNCTIONS = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)'
];

const ERC1155_FUNCTIONS = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function uri(uint256 id) view returns (string)'
];

export interface BlockchainNFTVerification {
  contractAddress: string;
  tokenId: string;
  isVerified: boolean;
  standard: 'ERC721' | 'ERC1155' | 'UNKNOWN';
  owner: string;
  balance: string;
  name?: string;
  symbol?: string;
  tokenURI?: string;
  error?: string;
}

export interface CollectionVerification {
  contractAddress: string;
  isERC721: boolean;
  isERC1155: boolean;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  error?: string;
}

/**
 * Check if a contract supports ERC165 interface detection
 */
async function supportsERC165(contractAddress: string): Promise<boolean> {
  try {
    const provider = optimalProvider.getProvider();
    const contract = new ethers.Contract(
      contractAddress,
      ['function supportsInterface(bytes4 interfaceId) view returns (bool)'],
      provider
    );
    
    const supportsERC165Interface = await contract.supportsInterface(ERC165_INTERFACE_ID);
    return supportsERC165Interface;
  } catch (error) {
    console.warn(`Contract ${contractAddress} doesn't support ERC165:`, error.message);
    return false;
  }
}

/**
 * Check if a contract supports a specific interface
 */
async function supportsInterface(contractAddress: string, interfaceId: string): Promise<boolean> {
  try {
    const provider = optimalProvider.getProvider();
    const contract = new ethers.Contract(
      contractAddress,
      ['function supportsInterface(bytes4 interfaceId) view returns (bool)'],
      provider
    );
    
    return await contract.supportsInterface(interfaceId);
  } catch (error) {
    console.warn(`Failed to check interface ${interfaceId} for ${contractAddress}:`, error.message);
    return false;
  }
}

/**
 * Verify if a contract is a valid NFT collection
 */
export async function verifyCollection(contractAddress: string): Promise<CollectionVerification> {
  const result: CollectionVerification = {
    contractAddress,
    isERC721: false,
    isERC1155: false
  };

  try {
    // First check if contract exists
    const provider = optimalProvider.getProvider();
    const code = await provider.getCode(contractAddress);
    
    if (code === '0x') {
      result.error = 'Contract does not exist';
      return result;
    }

    // Check if contract supports ERC165
    const supportsERC165Interface = await supportsERC165(contractAddress);
    
    if (supportsERC165Interface) {
      // Use ERC165 to check interfaces
      const [isERC721, isERC1155] = await Promise.all([
        supportsInterface(contractAddress, ERC721_INTERFACE_ID),
        supportsInterface(contractAddress, ERC1155_INTERFACE_ID)
      ]);
      
      result.isERC721 = isERC721;
      result.isERC1155 = isERC1155;
    } else {
      // Fallback: try to call standard functions
      console.log(`Contract ${contractAddress} doesn't support ERC165, trying fallback verification...`);
      
      const [erc721Contract, erc1155Contract] = [
        new ethers.Contract(contractAddress, ERC721_FUNCTIONS, provider),
        new ethers.Contract(contractAddress, ERC1155_FUNCTIONS, provider)
      ];

      try {
        // Try ERC721 functions
        await erc721Contract.name();
        result.isERC721 = true;
      } catch (error) {
        // Not ERC721
      }

      try {
        // Try ERC1155 functions
        await erc1155Contract.balanceOf(ethers.ZeroAddress, 0);
        result.isERC1155 = true;
      } catch (error) {
        // Not ERC1155
      }
    }

    // Get collection metadata if it's a valid NFT contract
    if (result.isERC721 || result.isERC1155) {
      try {
        const contract = new ethers.Contract(
          contractAddress,
          [...ERC721_FUNCTIONS, ...ERC1155_FUNCTIONS],
          provider
        );

        try {
          result.name = await contract.name();
        } catch (error) {
          // Name might not be available
        }

        try {
          result.symbol = await contract.symbol();
        } catch (error) {
          // Symbol might not be available
        }
      } catch (error) {
        console.warn(`Failed to get metadata for ${contractAddress}:`, error.message);
      }
    }

  } catch (error) {
    result.error = `Verification failed: ${error.message}`;
  }

  return result;
}

/**
 * Verify if a specific NFT exists and is owned by the user
 */
export async function verifyNFT(
  contractAddress: string,
  tokenId: string,
  userAddress: string
): Promise<BlockchainNFTVerification> {
  const result: BlockchainNFTVerification = {
    contractAddress,
    tokenId,
    isVerified: false,
    standard: 'UNKNOWN',
    owner: '',
    balance: '0'
  };

  try {
    // First verify the collection
    const collectionVerification = await verifyCollection(contractAddress);
    
    if (collectionVerification.error) {
      result.error = collectionVerification.error;
      return result;
    }

    if (!collectionVerification.isERC721 && !collectionVerification.isERC1155) {
      result.error = 'Contract is not a valid NFT collection';
      return result;
    }

    const provider = optimalProvider.getProvider();

    if (collectionVerification.isERC721) {
      result.standard = 'ERC721';
      
      const contract = new ethers.Contract(contractAddress, ERC721_FUNCTIONS, provider);
      
      try {
        // Check ownership
        const owner = await contract.ownerOf(tokenId);
        result.owner = owner;
        result.balance = owner.toLowerCase() === userAddress.toLowerCase() ? '1' : '0';
        result.isVerified = result.balance === '1';
        
        // Get metadata
        try {
          result.name = await contract.name();
        } catch (error) {
          // Name might not be available
        }
        
        try {
          result.symbol = await contract.symbol();
        } catch (error) {
          // Symbol might not be available
        }
        
        try {
          result.tokenURI = await contract.tokenURI(tokenId);
        } catch (error) {
          // TokenURI might not be available
        }
        
      } catch (error) {
        result.error = `ERC721 verification failed: ${error.message}`;
      }
      
    } else if (collectionVerification.isERC1155) {
      result.standard = 'ERC1155';
      
      const contract = new ethers.Contract(contractAddress, ERC1155_FUNCTIONS, provider);
      
      try {
        // Check balance
        const balance = await contract.balanceOf(userAddress, tokenId);
        result.balance = balance.toString();
        result.owner = userAddress; // ERC1155 doesn't have single owner concept
        result.isVerified = balance.gt(0);
        
        // Get metadata
        try {
          result.tokenURI = await contract.uri(tokenId);
        } catch (error) {
          // URI might not be available
        }
        
      } catch (error) {
        result.error = `ERC1155 verification failed: ${error.message}`;
      }
    }

  } catch (error) {
    result.error = `Verification failed: ${error.message}`;
  }

  return result;
}

/**
 * Batch verify multiple NFTs
 */
export async function verifyNFTs(
  nfts: Array<{ contractAddress: string; tokenId: string }>,
  userAddress: string
): Promise<BlockchainNFTVerification[]> {
  const results: BlockchainNFTVerification[] = [];
  
  // Process in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < nfts.length; i += batchSize) {
    const batch = nfts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(nft => verifyNFT(nft.contractAddress, nft.tokenId, userAddress))
    );
    results.push(...batchResults);
    
    // Small delay between batches
    if (i + batchSize < nfts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

/**
 * Get all NFTs owned by a user in a specific collection
 */
export async function getUserNFTsInCollection(
  contractAddress: string,
  userAddress: string
): Promise<BlockchainNFTVerification[]> {
  try {
    const collectionVerification = await verifyCollection(contractAddress);
    
    if (collectionVerification.error || (!collectionVerification.isERC721 && !collectionVerification.isERC1155)) {
      return [];
    }

    const provider = optimalProvider.getProvider();
    const results: BlockchainNFTVerification[] = [];

    if (collectionVerification.isERC721) {
      // For ERC721, we need to scan for owned tokens
      // This is a simplified approach - in production you might want to use an indexer
      const contract = new ethers.Contract(contractAddress, ERC721_FUNCTIONS, provider);
      
      // Try to get total supply if available
      try {
        const totalSupply = await contract.totalSupply();
        const maxTokens = Math.min(Number(totalSupply), 1000); // Limit to prevent infinite loops
        
        for (let i = 0; i < maxTokens; i++) {
          try {
            const owner = await contract.ownerOf(i);
            if (owner.toLowerCase() === userAddress.toLowerCase()) {
              results.push({
                contractAddress,
                tokenId: i.toString(),
                isVerified: true,
                standard: 'ERC721',
                owner: owner,
                balance: '1'
              });
            }
          } catch (error) {
            // Token might not exist
            continue;
          }
        }
      } catch (error) {
        // Total supply not available, can't scan
        console.warn(`Cannot scan ERC721 collection ${contractAddress}: totalSupply not available`);
      }
      
    } else if (collectionVerification.isERC1155) {
      // For ERC1155, we need to know which token IDs to check
      // This is a simplified approach - in production you might want to use an indexer
      const contract = new ethers.Contract(contractAddress, ERC1155_FUNCTIONS, provider);
      
      // Check common token IDs (0-100)
      for (let i = 0; i < 100; i++) {
        try {
          const balance = await contract.balanceOf(userAddress, i);
          if (balance.gt(0)) {
            results.push({
              contractAddress,
              tokenId: i.toString(),
              isVerified: true,
              standard: 'ERC1155',
              owner: userAddress,
              balance: balance.toString()
            });
          }
        } catch (error) {
          // Token might not exist
          continue;
        }
      }
    }

    return results;
    
  } catch (error) {
    console.error(`Failed to get user NFTs in collection ${contractAddress}:`, error);
    return [];
  }
}

/**
 * Check if a user owns any NFTs in a collection (quick check)
 */
export async function userOwnsNFTsInCollection(
  contractAddress: string,
  userAddress: string
): Promise<boolean> {
  try {
    const collectionVerification = await verifyCollection(contractAddress);
    
    if (collectionVerification.error || (!collectionVerification.isERC721 && !collectionVerification.isERC1155)) {
      return false;
    }

    const provider = optimalProvider.getProvider();

    if (collectionVerification.isERC721) {
      const contract = new ethers.Contract(contractAddress, ERC721_FUNCTIONS, provider);
      
      // Check if user owns any token (try first 10 tokens)
      for (let i = 0; i < 10; i++) {
        try {
          const owner = await contract.ownerOf(i);
          if (owner.toLowerCase() === userAddress.toLowerCase()) {
            return true;
          }
        } catch (error) {
          continue;
        }
      }
      
    } else if (collectionVerification.isERC1155) {
      const contract = new ethers.Contract(contractAddress, ERC1155_FUNCTIONS, provider);
      
      // Check if user has any balance (try first 10 token IDs)
      for (let i = 0; i < 10; i++) {
        try {
          const balance = await contract.balanceOf(userAddress, i);
          if (balance.gt(0)) {
            return true;
          }
        } catch (error) {
          continue;
        }
      }
    }

    return false;
    
  } catch (error) {
    console.error(`Failed to check user ownership in collection ${contractAddress}:`, error);
    return false;
  }
} 