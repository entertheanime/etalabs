// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Deliberately non-standard test collection: it reports ownership and
/// approvals correctly but refuses every transfer.
contract RevertingERC721 {
    mapping(uint256 => address) private owners;
    mapping(address => mapping(address => bool)) private operatorApprovals;

    function mint(address to, uint256 tokenId) external {
        require(owners[tokenId] == address(0), "ALREADY_MINTED");
        owners[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = owners[tokenId];
        require(owner != address(0), "NONEXISTENT");
        return owner;
    }

    function getApproved(uint256) external pure returns (address) { return address(0); }

    function setApprovalForAll(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return operatorApprovals[owner][operator];
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("TRANSFER_BLOCKED");
    }
}
