// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Models the observed policy: owner-initiated transfers only.
contract OwnerDirectNFT is ERC721 {
    bool public blocked;
    constructor() ERC721("Owner direct", "OD") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
    function setBlocked(bool value) external { blocked = value; }
    function transferFrom(address from, address to, uint256 id) public override {
        require(!blocked, "COLLECTION_BLOCKED");
        require(msg.sender == from, "OPERATOR_BLOCKED");
        super.transferFrom(from, to, id);
    }
}

contract EscrowTestWallet is IERC721Receiver {
    bool public rejectNFT;
    bool public rejectETH;
    address public reenterTarget;
    bytes public reenterData;
    bool public reentrySucceeded;
    function configure(bool nft, bool eth, address target, bytes calldata data) external {
        rejectNFT = nft; rejectETH = eth; reenterTarget = target; reenterData = data;
    }
    function execute(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        require(!rejectNFT, "REJECT_NFT");
        if (reenterTarget != address(0)) (reentrySucceeded,) = reenterTarget.call(reenterData);
        return IERC721Receiver.onERC721Received.selector;
    }
    receive() external payable { require(!rejectETH, "REJECT_ETH"); }
}
