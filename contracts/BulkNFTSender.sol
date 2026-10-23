// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BulkNFTSender
 * @dev Contract for efficiently sending multiple NFTs in a single transaction
 */
contract BulkNFTSender is ReentrancyGuard, Ownable {
    
    event BulkTransferERC721(
        address indexed sender,
        uint256 totalTransfers,
        bool singleRecipient
    );
    
    event BulkTransferERC1155(
        address indexed sender,
        uint256 totalTransfers,
        bool singleRecipient
    );

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Bulk transfer ERC721 NFTs to a single recipient
     * @param nftContracts Array of NFT contract addresses
     * @param tokenIds Array of token IDs to transfer
     * @param recipient Single recipient address
     */
    function bulkTransferERC721ToOne(
        address[] calldata nftContracts,
        uint256[] calldata tokenIds,
        address recipient
    ) external nonReentrant {
        require(nftContracts.length == tokenIds.length, "Array length mismatch");
        require(nftContracts.length > 0, "Empty arrays");
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot send to yourself");

        for (uint256 i = 0; i < nftContracts.length; i++) {
            IERC721(nftContracts[i]).transferFrom(
                msg.sender,
                recipient,
                tokenIds[i]
            );
        }

        emit BulkTransferERC721(msg.sender, nftContracts.length, true);
    }

    /**
     * @dev Bulk transfer ERC721 NFTs to multiple recipients (one NFT per recipient)
     * @param nftContracts Array of NFT contract addresses
     * @param tokenIds Array of token IDs to transfer
     * @param recipients Array of recipient addresses
     */
    function bulkTransferERC721ToMany(
        address[] calldata nftContracts,
        uint256[] calldata tokenIds,
        address[] calldata recipients
    ) external nonReentrant {
        require(nftContracts.length == tokenIds.length, "Contract/token array length mismatch");
        require(nftContracts.length == recipients.length, "Contract/recipient array length mismatch");
        require(nftContracts.length > 0, "Empty arrays");

        for (uint256 i = 0; i < nftContracts.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(recipients[i] != msg.sender, "Cannot send to yourself");
            
            IERC721(nftContracts[i]).transferFrom(
                msg.sender,
                recipients[i],
                tokenIds[i]
            );
        }

        emit BulkTransferERC721(msg.sender, nftContracts.length, false);
    }

    /**
     * @dev Bulk transfer ERC1155 NFTs to a single recipient
     * @param nftContracts Array of NFT contract addresses
     * @param tokenIds Array of token IDs to transfer
     * @param amounts Array of amounts to transfer
     * @param recipient Single recipient address
     */
    function bulkTransferERC1155ToOne(
        address[] calldata nftContracts,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        address recipient
    ) external nonReentrant {
        require(nftContracts.length == tokenIds.length, "Contract/token array length mismatch");
        require(nftContracts.length == amounts.length, "Contract/amount array length mismatch");
        require(nftContracts.length > 0, "Empty arrays");
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot send to yourself");

        for (uint256 i = 0; i < nftContracts.length; i++) {
            require(amounts[i] > 0, "Invalid amount");
            
            IERC1155(nftContracts[i]).safeTransferFrom(
                msg.sender,
                recipient,
                tokenIds[i],
                amounts[i],
                ""
            );
        }

        emit BulkTransferERC1155(msg.sender, nftContracts.length, true);
    }

    /**
     * @dev Bulk transfer ERC1155 NFTs to multiple recipients
     * @param nftContracts Array of NFT contract addresses
     * @param tokenIds Array of token IDs to transfer
     * @param amounts Array of amounts to transfer
     * @param recipients Array of recipient addresses
     */
    function bulkTransferERC1155ToMany(
        address[] calldata nftContracts,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        address[] calldata recipients
    ) external nonReentrant {
        require(nftContracts.length == tokenIds.length, "Contract/token array length mismatch");
        require(nftContracts.length == amounts.length, "Contract/amount array length mismatch");
        require(nftContracts.length == recipients.length, "Contract/recipient array length mismatch");
        require(nftContracts.length > 0, "Empty arrays");

        for (uint256 i = 0; i < nftContracts.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(recipients[i] != msg.sender, "Cannot send to yourself");
            require(amounts[i] > 0, "Invalid amount");
            
            IERC1155(nftContracts[i]).safeTransferFrom(
                msg.sender,
                recipients[i],
                tokenIds[i],
                amounts[i],
                ""
            );
        }

        emit BulkTransferERC1155(msg.sender, nftContracts.length, false);
    }

    /**
     * @dev Check if NFT is approved for transfer
     * @param nftContract NFT contract address
     * @param tokenId Token ID to check
     * @param owner Owner address
     */
    function isERC721Approved(
        address nftContract,
        uint256 tokenId,
        address owner
    ) external view returns (bool) {
        // Check if contract address has code
        if (nftContract.code.length == 0) {
            return false;
        }
        
        // Check getApproved
        (bool success1, bytes memory data1) = nftContract.staticcall(
            abi.encodeWithSignature("getApproved(uint256)", tokenId)
        );
        
        // Check isApprovedForAll
        (bool success2, bytes memory data2) = nftContract.staticcall(
            abi.encodeWithSignature("isApprovedForAll(address,address)", owner, address(this))
        );
        
        if (success1 && data1.length >= 32) {
            address approved = abi.decode(data1, (address));
            if (approved == address(this)) {
                return true;
            }
        }
        
        if (success2 && data2.length >= 32) {
            bool approvedForAll = abi.decode(data2, (bool));
            if (approvedForAll) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @dev Check if ERC1155 is approved for transfer
     * @param nftContract NFT contract address
     * @param owner Owner address
     */
    function isERC1155Approved(
        address nftContract,
        address owner
    ) external view returns (bool) {
        // Check if contract address has code
        if (nftContract.code.length == 0) {
            return false;
        }
        
        // Check isApprovedForAll
        (bool success, bytes memory data) = nftContract.staticcall(
            abi.encodeWithSignature("isApprovedForAll(address,address)", owner, address(this))
        );
        
        if (success && data.length >= 32) {
            bool approvedForAll = abi.decode(data, (bool));
            return approvedForAll;
        }
        
        return false;
    }

    /**
     * @dev Emergency function to withdraw any accidentally sent ETH
     */
    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /**
     * @dev Emergency function to transfer any accidentally sent ERC721 tokens
     */
    function emergencyWithdrawERC721(
        address nftContract,
        uint256 tokenId,
        address to
    ) external onlyOwner {
        IERC721(nftContract).transferFrom(address(this), to, tokenId);
    }

    /**
     * @dev Emergency function to transfer any accidentally sent ERC1155 tokens
     */
    function emergencyWithdrawERC1155(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        address to
    ) external onlyOwner {
        IERC1155(nftContract).safeTransferFrom(address(this), to, tokenId, amount, "");
    }
}