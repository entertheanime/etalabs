// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract EtaSwapNFT is ERC721 {
    using Strings for uint256;

    uint256 public nextId = 1;

    constructor() ERC721("etaswap test", "ETANFT") {}

    function mint(uint256 count) external {
        require(count > 0 && count <= 10, "mint 1-10");
        for (uint256 i = 0; i < count; i++) {
            _safeMint(msg.sender, nextId);
            nextId++;
        }
    }

    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || getApproved(tokenId) == msg.sender || isApprovedForAll(owner, msg.sender), "not owner");
        _burn(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory id = tokenId.toString();
        string memory hue = Strings.toString((tokenId * 47) % 360);
        string memory svg = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
                '<rect width="400" height="400" rx="48" fill="hsl(',
                hue,
                ',72%,52%)"/>',
                '<text x="50%" y="48%" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">etaswap</text>',
                '<text x="50%" y="62%" text-anchor="middle" fill="white" font-size="28" font-family="sans-serif">#',
                id,
                '</text></svg>'
            )
        );

        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name":"etaswap #',
                        id,
                        '","description":"Test NFT for etaswap on Robinhood testnet.","image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(svg)),
                        '"}'
                    )
                )
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}
