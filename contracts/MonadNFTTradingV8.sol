// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title MonadNFTTradingV8
 * @notice Same trade ABI as V6, but NFTs stay in wallets until accept.
 * Offered ETH is still escrowed (native ETH cannot be pulled later).
 */
contract MonadNFTTradingV8 is ReentrancyGuard, Pausable, IERC721Receiver, IERC1155Receiver {
    enum TradeStatus { Pending, Accepted, Cancelled, Expired, Declined }
    enum TokenStandard { ERC721, ERC1155 }

    struct NFTItem {
        address contractAddress;
        uint256 tokenId;
        uint256 amount;
        TokenStandard standard;
    }

    struct Trade {
        uint256 id;
        address creator;
        address counterparty;
        uint256 offeredMONAD;
        uint256 requestedMONAD;
        uint256 expiryTime;
        TradeStatus status;
        string message;
        uint256 createdAt;
    }

    uint256 private nextTradeId = 1;
    uint256 public tradeFee = 0;
    uint256 public constant MAX_TRADE_FEE = 1 ether;
    address public constant FEE_COLLECTOR = 0x20ce27B140A0EEECceF880e01D2082558400FDd6;

    mapping(address => bool) public isAdmin;
    address[] public adminList;
    uint256 public constant MAX_ADMINS = 3;

    mapping(uint256 => Trade) public trades;
    mapping(uint256 => NFTItem[]) public tradeOfferedNFTs;
    mapping(uint256 => NFTItem[]) public tradeRequestedNFTs;
    mapping(uint256 => uint256) public tradeOfferedNFTCount;
    mapping(uint256 => uint256) public tradeRequestedNFTCount;
    mapping(address => uint256[]) public userCreatedTrades;
    mapping(address => uint256[]) public userReceivedTrades;

    event TradeCreated(uint256 indexed tradeId, address indexed creator, address indexed counterparty);
    event TradeAccepted(uint256 indexed tradeId, address indexed creator, address indexed acceptor);
    event TradeCancelled(uint256 indexed tradeId, address indexed canceller);
    event TradeExpired(uint256 indexed tradeId);
    event TradeDeclined(uint256 indexed tradeId, address indexed decliner);
    event TradeFeeUpdated(uint256 oldFee, uint256 newFee, address updatedBy);
    event AdminAdded(address indexed newAdmin, address indexed addedBy);
    event AdminRemoved(address indexed removedAdmin, address indexed removedBy);
    event TradeAdminCancelled(uint256 indexed tradeId, address indexed admin);

    modifier tradeExists(uint256 tradeId) {
        require(trades[tradeId].creator != address(0), "Trade does not exist");
        _;
    }

    modifier tradePending(uint256 tradeId) {
        require(trades[tradeId].status == TradeStatus.Pending, "Trade not pending");
        _;
    }

    modifier tradeAcceptable(uint256 tradeId) {
        Trade storage trade = trades[tradeId];
        require(
            trade.status == TradeStatus.Pending ||
            (trade.status == TradeStatus.Expired && block.timestamp <= trade.expiryTime),
            "Trade not acceptable"
        );
        _;
    }

    modifier tradeNotExpired(uint256 tradeId) {
        require(block.timestamp <= trades[tradeId].expiryTime, "Trade has expired");
        _;
    }

    modifier onlyTradeCreator(uint256 tradeId) {
        require(msg.sender == trades[tradeId].creator, "Only trade creator can perform this action");
        _;
    }

    modifier onlyCounterparty(uint256 tradeId) {
        require(msg.sender == trades[tradeId].counterparty, "Not trade counterparty");
        _;
    }

    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "Only admin can perform this action");
        _;
    }

    constructor() {
        isAdmin[msg.sender] = true;
        adminList.push(msg.sender);
    }

    function _held(address owner, NFTItem memory nft) internal view returns (bool) {
        if (nft.standard == TokenStandard.ERC721) {
            return IERC721(nft.contractAddress).ownerOf(nft.tokenId) == owner;
        }
        return IERC1155(nft.contractAddress).balanceOf(owner, nft.tokenId) >= nft.amount;
    }

    function _approved(address owner, NFTItem memory nft) internal view returns (bool) {
        if (nft.standard == TokenStandard.ERC721) {
            IERC721 token = IERC721(nft.contractAddress);
            return token.isApprovedForAll(owner, address(this)) || token.getApproved(nft.tokenId) == address(this);
        }
        return IERC1155(nft.contractAddress).isApprovedForAll(owner, address(this));
    }

    function _pullNft(address from, address to, NFTItem memory nft) internal {
        require(_held(from, nft), "NFT_NOT_IN_WALLET");
        require(_approved(from, nft), "NFT_NOT_APPROVED");
        if (nft.standard == TokenStandard.ERC721) {
            IERC721(nft.contractAddress).safeTransferFrom(from, to, nft.tokenId);
        } else {
            IERC1155(nft.contractAddress).safeTransferFrom(from, to, nft.tokenId, nft.amount, "");
        }
    }

    function createTrade(
        address counterparty,
        NFTItem[] calldata offeredNFTs,
        NFTItem[] calldata requestedNFTs,
        uint256 offeredMONAD,
        uint256 requestedMONAD,
        string calldata message
    ) external payable nonReentrant whenNotPaused {
        require(counterparty != address(0), "Invalid counterparty address");
        require(counterparty != msg.sender, "Cannot trade with yourself");
        require(msg.value >= offeredMONAD + tradeFee, "NOT_ENOUGH_ETH");
        require(
            offeredNFTs.length > 0 || requestedNFTs.length > 0 || offeredMONAD > 0 || requestedMONAD > 0,
            "Trade must include at least one asset"
        );

        uint256 tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            id: tradeId,
            creator: msg.sender,
            counterparty: counterparty,
            offeredMONAD: offeredMONAD,
            requestedMONAD: requestedMONAD,
            expiryTime: block.timestamp + 1 days,
            status: TradeStatus.Pending,
            message: message,
            createdAt: block.timestamp
        });

        for (uint256 i = 0; i < offeredNFTs.length; i++) {
            require(_held(msg.sender, offeredNFTs[i]), "NFT_NOT_IN_WALLET");
            require(_approved(msg.sender, offeredNFTs[i]), "NFT_NOT_APPROVED");
            tradeOfferedNFTs[tradeId].push(offeredNFTs[i]);
        }
        for (uint256 i = 0; i < requestedNFTs.length; i++) {
            tradeRequestedNFTs[tradeId].push(requestedNFTs[i]);
        }

        tradeOfferedNFTCount[tradeId] = offeredNFTs.length;
        tradeRequestedNFTCount[tradeId] = requestedNFTs.length;
        userCreatedTrades[msg.sender].push(tradeId);
        userReceivedTrades[counterparty].push(tradeId);

        if (tradeFee > 0) {
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        if (msg.value > offeredMONAD + tradeFee) {
            payable(msg.sender).transfer(msg.value - offeredMONAD - tradeFee);
        }

        emit TradeCreated(tradeId, msg.sender, counterparty);
    }

    function acceptTrade(uint256 tradeId)
        external
        payable
        nonReentrant
        whenNotPaused
        tradeExists(tradeId)
        tradeAcceptable(tradeId)
        tradeNotExpired(tradeId)
        onlyCounterparty(tradeId)
    {
        Trade storage trade = trades[tradeId];
        require(msg.value >= trade.requestedMONAD + tradeFee, "NOT_ENOUGH_ETH");

        for (uint256 i = 0; i < tradeOfferedNFTCount[tradeId]; i++) {
            _pullNft(trade.creator, msg.sender, tradeOfferedNFTs[tradeId][i]);
        }
        for (uint256 i = 0; i < tradeRequestedNFTCount[tradeId]; i++) {
            _pullNft(msg.sender, trade.creator, tradeRequestedNFTs[tradeId][i]);
        }

        trade.status = TradeStatus.Accepted;

        if (tradeFee > 0) {
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        if (trade.offeredMONAD > 0) {
            payable(msg.sender).transfer(trade.offeredMONAD);
        }
        if (trade.requestedMONAD > 0) {
            payable(trade.creator).transfer(trade.requestedMONAD);
        }
        uint256 expectedPayment = trade.requestedMONAD + tradeFee;
        if (msg.value > expectedPayment) {
            payable(msg.sender).transfer(msg.value - expectedPayment);
        }

        emit TradeAccepted(tradeId, trade.creator, msg.sender);
    }

    function cancelTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyTradeCreator(tradeId)
    {
        trades[tradeId].status = TradeStatus.Cancelled;
        _returnEthToCreator(tradeId);
        emit TradeCancelled(tradeId, msg.sender);
    }

    function declineTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyCounterparty(tradeId)
    {
        trades[tradeId].status = TradeStatus.Declined;
        _returnEthToCreator(tradeId);
        emit TradeDeclined(tradeId, msg.sender);
    }

    function expireTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
    {
        require(block.timestamp > trades[tradeId].expiryTime, "Trade not yet expired");
        trades[tradeId].status = TradeStatus.Expired;
        _returnEthToCreator(tradeId);
        emit TradeExpired(tradeId);
    }

    function adminCancelTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyAdmin
    {
        trades[tradeId].status = TradeStatus.Cancelled;
        _returnEthToCreator(tradeId);
        emit TradeAdminCancelled(tradeId, msg.sender);
    }

    function setTradeFee(uint256 newFee) external onlyAdmin {
        require(newFee <= MAX_TRADE_FEE, "Fee exceeds maximum limit");
        uint256 oldFee = tradeFee;
        tradeFee = newFee;
        emit TradeFeeUpdated(oldFee, newFee, msg.sender);
    }

    function addAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        require(!isAdmin[newAdmin], "Address is already an admin");
        require(adminList.length < MAX_ADMINS, "Maximum admin limit reached");
        isAdmin[newAdmin] = true;
        adminList.push(newAdmin);
        emit AdminAdded(newAdmin, msg.sender);
    }

    function removeAdmin(address adminToRemove) external onlyAdmin {
        require(isAdmin[adminToRemove], "Address is not an admin");
        require(adminList.length > 1, "Cannot remove the last admin");
        require(adminToRemove != msg.sender, "Cannot remove yourself");
        isAdmin[adminToRemove] = false;
        for (uint256 i = 0; i < adminList.length; i++) {
            if (adminList[i] == adminToRemove) {
                adminList[i] = adminList[adminList.length - 1];
                adminList.pop();
                break;
            }
        }
        emit AdminRemoved(adminToRemove, msg.sender);
    }

    function getAdmins() external view returns (address[] memory) {
        return adminList;
    }

    function getAdminCount() external view returns (uint256) {
        return adminList.length;
    }

    function getTradeFee() external view returns (uint256) {
        return tradeFee;
    }

    function _returnEthToCreator(uint256 tradeId) internal {
        Trade storage trade = trades[tradeId];
        if (trade.offeredMONAD > 0) {
            payable(trade.creator).transfer(trade.offeredMONAD);
        }
    }

    function detectTokenStandard(address contractAddress) external view returns (TokenStandard) {
        if (IERC165(contractAddress).supportsInterface(0xd9b67a26)) {
            return TokenStandard.ERC1155;
        } else if (IERC165(contractAddress).supportsInterface(0x80ac58cd)) {
            return TokenStandard.ERC721;
        }
        revert("Unsupported token standard");
    }

    function getTrade(uint256 tradeId) external view returns (
        uint256 id,
        address creator,
        address counterparty,
        uint256 offeredMONAD,
        uint256 requestedMONAD,
        uint256 expiryTime,
        TradeStatus status,
        string memory message,
        uint256 createdAt
    ) {
        Trade storage trade = trades[tradeId];
        return (
            trade.id,
            trade.creator,
            trade.counterparty,
            trade.offeredMONAD,
            trade.requestedMONAD,
            trade.expiryTime,
            trade.status,
            trade.message,
            trade.createdAt
        );
    }

    function getOfferedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) {
        uint256 count = tradeOfferedNFTCount[tradeId];
        NFTItem[] memory nfts = new NFTItem[](count);
        for (uint256 i = 0; i < count; i++) {
            nfts[i] = tradeOfferedNFTs[tradeId][i];
        }
        return nfts;
    }

    function getRequestedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) {
        uint256 count = tradeRequestedNFTCount[tradeId];
        NFTItem[] memory nfts = new NFTItem[](count);
        for (uint256 i = 0; i < count; i++) {
            nfts[i] = tradeRequestedNFTs[tradeId][i];
        }
        return nfts;
    }

    function getUserCreatedTrades(address user) external view returns (uint256[] memory) {
        return userCreatedTrades[user];
    }

    function getUserReceivedTrades(address user) external view returns (uint256[] memory) {
        return userReceivedTrades[user];
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
