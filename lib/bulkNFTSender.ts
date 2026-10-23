// BulkNFTSender Contract Integration
// Auto-generated from deployment: 2025-08-07T03:44:36.355Z

import { Contract, ethers } from 'ethers';

// Contract deployment information
export const BULK_NFT_SENDER_ADDRESS = "0xDfFc5163576f324448813ea6aAB9A84971Af4A1c";
export const BULK_NFT_SENDER_NETWORK = "monadTestnet";
export const DEPLOYER_ADDRESS = "0x20ce27B140A0EEECceF880e01D2082558400FDd6";

// Human-readable ABI for ethers.js
export const BULK_NFT_SENDER_ABI = [
  // Constructor
  "constructor()",
  
  // Main bulk transfer functions
  "function bulkTransferERC721ToOne(address[] calldata nftContracts, uint256[] calldata tokenIds, address recipient) external",
  "function bulkTransferERC721ToMany(address[] calldata nftContracts, uint256[] calldata tokenIds, address[] calldata recipients) external",
  "function bulkTransferERC1155ToOne(address[] calldata nftContracts, uint256[] calldata tokenIds, uint256[] calldata amounts, address recipient) external",
  "function bulkTransferERC1155ToMany(address[] calldata nftContracts, uint256[] calldata tokenIds, uint256[] calldata amounts, address[] calldata recipients) external",
  
  // Approval checking functions
  "function isERC721Approved(address nftContract, uint256 tokenId, address owner) external view returns (bool)",
  "function isERC1155Approved(address nftContract, address owner) external view returns (bool)",
  
  // Owner functions
  "function owner() external view returns (address)",
  "function transferOwnership(address newOwner) external",
  "function renounceOwnership() external",
  
  // Emergency functions
  "function withdrawETH() external",
  "function emergencyWithdrawERC721(address nftContract, uint256 tokenId, address to) external",
  "function emergencyWithdrawERC1155(address nftContract, uint256 tokenId, uint256 amount, address to) external",
  
  // Events
  "event BulkTransferERC721(address indexed sender, uint256 totalTransfers, bool singleRecipient)",
  "event BulkTransferERC1155(address indexed sender, uint256 totalTransfers, bool singleRecipient)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)"
] as const;

// TypeScript interfaces for function parameters
export interface BulkTransferERC721Params {
  nftContracts: string[];
  tokenIds: string[];
  recipient?: string;
  recipients?: string[];
}

export interface BulkTransferERC1155Params {
  nftContracts: string[];
  tokenIds: string[];
  amounts: string[];
  recipient?: string;
  recipients?: string[];
}

export interface NFTApprovalCheck {
  nftContract: string;
  tokenId?: string;
  owner: string;
}

// Helper function to create contract instance
export function createBulkNFTSenderContract(
  signerOrProvider: ethers.Signer | ethers.Provider
): Contract {
  return new ethers.Contract(BULK_NFT_SENDER_ADDRESS, BULK_NFT_SENDER_ABI, signerOrProvider);
}

// Helper functions for common operations
export class BulkNFTSenderHelper {
  private contract: Contract;

  constructor(signerOrProvider: ethers.Signer | ethers.Provider) {
    this.contract = createBulkNFTSenderContract(signerOrProvider);
  }

  // Send multiple ERC721 NFTs to one recipient
  async bulkSendERC721ToOne(params: BulkTransferERC721Params) {
    if (!params.recipient) throw new Error("Recipient required for single recipient transfer");
    
    return await this.contract.bulkTransferERC721ToOne(
      params.nftContracts,
      params.tokenIds,
      params.recipient
    );
  }

  // Send multiple ERC721 NFTs to multiple recipients
  async bulkSendERC721ToMany(params: BulkTransferERC721Params) {
    if (!params.recipients) throw new Error("Recipients array required for multiple recipient transfer");
    
    return await this.contract.bulkTransferERC721ToMany(
      params.nftContracts,
      params.tokenIds,
      params.recipients
    );
  }

  // Send multiple ERC1155 NFTs to one recipient
  async bulkSendERC1155ToOne(params: BulkTransferERC1155Params) {
    if (!params.recipient) throw new Error("Recipient required for single recipient transfer");
    
    return await this.contract.bulkTransferERC1155ToOne(
      params.nftContracts,
      params.tokenIds,
      params.amounts,
      params.recipient
    );
  }

  // Send multiple ERC1155 NFTs to multiple recipients
  async bulkSendERC1155ToMany(params: BulkTransferERC1155Params) {
    if (!params.recipients) throw new Error("Recipients array required for multiple recipient transfer");
    
    return await this.contract.bulkTransferERC1155ToMany(
      params.nftContracts,
      params.tokenIds,
      params.amounts,
      params.recipients
    );
  }

  // Check if ERC721 NFT is approved for transfer
  async isERC721Approved(nftContract: string, tokenId: string, owner: string): Promise<boolean> {
    try {
      // Validate inputs
      if (!ethers.isAddress(nftContract)) {
        throw new Error(`Invalid NFT contract address: ${nftContract}`);
      }
      if (!ethers.isAddress(owner)) {
        throw new Error(`Invalid owner address: ${owner}`);
      }
      
      const result = await this.contract.isERC721Approved(nftContract, tokenId, owner);
      return result;
    } catch (error: any) {
      console.error(`ERC721 approval check failed for ${nftContract}#${tokenId}:`, error);
      
      // If the contract doesn't exist or doesn't implement the interface, return false
      if (error.code === 'BAD_DATA' || error.message?.includes('could not decode result data')) {
        return false;
      }
      
      throw error;
    }
  }

  // Check if ERC1155 NFT is approved for transfer
  async isERC1155Approved(nftContract: string, owner: string): Promise<boolean> {
    try {
      // Validate inputs
      if (!ethers.isAddress(nftContract)) {
        throw new Error(`Invalid NFT contract address: ${nftContract}`);
      }
      if (!ethers.isAddress(owner)) {
        throw new Error(`Invalid owner address: ${owner}`);
      }
      
      const result = await this.contract.isERC1155Approved(nftContract, owner);
      return result;
    } catch (error: any) {
      console.error(`ERC1155 approval check failed for ${nftContract}:`, error);
      
      // If the contract doesn't exist or doesn't implement the interface, return false
      if (error.code === 'BAD_DATA' || error.message?.includes('could not decode result data')) {
        return false;
      }
      
      throw error;
    }
  }

  // Get contract owner
  async getOwner(): Promise<string> {
    return await this.contract.owner();
  }

  // Listen to bulk transfer events
  onBulkTransferERC721(callback: (sender: string, totalTransfers: number, singleRecipient: boolean) => void) {
    this.contract.on("BulkTransferERC721", callback);
  }

  onBulkTransferERC1155(callback: (sender: string, totalTransfers: number, singleRecipient: boolean) => void) {
    this.contract.on("BulkTransferERC1155", callback);
  }

  // Remove event listeners
  removeAllListeners() {
    this.contract.removeAllListeners();
  }
}

// Export the contract instance creator for direct use
export { createBulkNFTSenderContract as getBulkNFTSenderContract };

// Deployment info
export const DEPLOYMENT_INFO = {
  address: BULK_NFT_SENDER_ADDRESS,
  network: BULK_NFT_SENDER_NETWORK,
  deployer: DEPLOYER_ADDRESS,
  deployedAt: "2025-08-07T03:44:36.355Z"
} as const;