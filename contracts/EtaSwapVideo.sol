// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/// Video mint with IPFS art and forced royalties.
contract EtaSwapVideo is ERC721, ERC2981 {
    error OperatorNotAllowed(address operator);

    uint256 public nextId = 1;
    mapping(uint256 => string) public tokenNames;
    mapping(uint256 => string) private _uris;

    constructor() ERC721("etaswap video", "ETAVID") {
        _setDefaultRoyalty(msg.sender, 500);
        _mintUri("Flame", "ipfs://QmVfcvwF64eEZ6fSnyTut6NmfUdA5wwYbhq45JDZkWtchk");
        _mintUri("Heart", "ipfs://Qma5nTBDRv5tpHBT46eiEUsWfXNTJUtKhhSTqpRw4DjW3v");
        _mintUri("Teddy", "ipfs://QmZXhwZnajeFFmSo8E14qNX9EqwYNejyUyH6DkZiGfXYPB");
    }

    function isOperatorAllowed(address) public pure returns (bool) {
        return false;
    }

    function royaltyBps() external pure returns (uint96) {
        return 500;
    }

    function _mintUri(string memory name, string memory uri) internal {
        uint256 tokenId = nextId;
        nextId += 1;
        tokenNames[tokenId] = name;
        _uris[tokenId] = uri;
        _safeMint(msg.sender, tokenId);
    }

    function _requireAllowedOperator(address from) internal view {
        if (from != msg.sender) revert OperatorNotAllowed(msg.sender);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        if (approved && !isOperatorAllowed(operator)) revert OperatorNotAllowed(operator);
        super.setApprovalForAll(operator, approved);
    }

    function approve(address operator, uint256 tokenId) public override {
        if (operator != address(0) && !isOperatorAllowed(operator)) revert OperatorNotAllowed(operator);
        super.approve(operator, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        _requireAllowedOperator(from);
        super.transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override {
        _requireAllowedOperator(from);
        super.safeTransferFrom(from, to, tokenId, data);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uris[tokenId];
    }
}
