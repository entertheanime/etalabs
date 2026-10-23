// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract EtaSwapPets is ERC721 {
    using Strings for uint256;

    uint256 public nextId = 1;
    mapping(uint256 => string) public tokenNames;
    mapping(uint256 => uint256) public tokenHues;

    constructor() ERC721("etaswap pets", "ETAPET") {}

    function mintTigerAndCat() external {
        _mintNamed("tiger 1", 32);
        _mintNamed("cat 1", 210);
    }

    function mintOne(string calldata name) external {
        _mintNamed(name, 140);
    }

    function _mintNamed(string memory name, uint256 hue) internal {
        uint256 tokenId = nextId;
        nextId += 1;
        tokenNames[tokenId] = name;
        tokenHues[tokenId] = hue;
        _safeMint(msg.sender, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory name = tokenNames[tokenId];
        string memory hue = tokenHues[tokenId].toString();
        string memory svg = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
                '<rect width="400" height="400" rx="48" fill="hsl(',
                hue,
                ',72%,48%)"/>',
                '<text x="50%" y="54%" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">',
                name,
                '</text></svg>'
            )
        );
        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name":"',
                        name,
                        '","description":"Normal mainnet test NFT for etaswap stay-in-wallet.","image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(svg)),
                        '"}'
                    )
                )
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}
