// Auto-generated contract information
// Last updated: 2025-08-07T03:44:36.355Z

export const BULK_NFT_SENDER_ADDRESS = "0xDfFc5163576f324448813ea6aAB9A84971Af4A1c";

export const BULK_NFT_SENDER_NETWORK = "monadTestnet";

export const BULK_NFT_SENDER_ABI = [
  "function bulkTransferERC721ToOne(address[] calldata nftContracts, uint256[] calldata tokenIds, address recipient) external",
  "function bulkTransferERC721ToMany(address[] calldata nftContracts, uint256[] calldata tokenIds, address[] calldata recipients) external",
  "function bulkTransferERC1155ToOne(address[] calldata nftContracts, uint256[] calldata tokenIds, uint256[] calldata amounts, address recipient) external",
  "function bulkTransferERC1155ToMany(address[] calldata nftContracts, uint256[] calldata tokenIds, uint256[] calldata amounts, address[] calldata recipients) external",
  "function isERC721Approved(address nftContract, uint256 tokenId, address owner) external view returns (bool)",
  "function isERC1155Approved(address nftContract, address owner) external view returns (bool)",
  "event BulkTransferERC721(address indexed sender, uint256 totalTransfers, bool singleRecipient)",
  "event BulkTransferERC1155(address indexed sender, uint256 totalTransfers, bool singleRecipient)"
] as const;

export const BULK_NFT_SENDER_DEPLOYMENT_INFO = {
  "address": "0xDfFc5163576f324448813ea6aAB9A84971Af4A1c",
  "network": "monadTestnet",
  "deployedAt": "2025-08-07T03:44:36.355Z",
  "deployer": "0x20ce27B140A0EEECceF880e01D2082558400FDd6"
};
