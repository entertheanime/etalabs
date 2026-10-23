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
 * @title MonadNFTTradingV6
 * @dev NFT Trading Contract with Enhanced Admin Features
 * @author 0xDTrade Team
 * @notice This contract allows users to create, accept, cancel, and decline NFT trades
 * 
 * NEW IN V6: Enhanced Admin Management System
 * - Dynamic fee management (0-1 MONAD cap)
 * - Multi-admin system (up to 3 admins)
 * - Admin override capabilities for stuck trades
 * - Maintains all V5 functionality
 */
contract MonadNFTTradingV6 is ReentrancyGuard, Pausable, IERC721Receiver, IERC1155Receiver {
    
    enum TradeStatus { Pending, Accepted, Cancelled, Expired, Declined }
    enum TokenStandard { ERC721, ERC1155 }
    
    struct NFTItem {
        address contractAddress;
        uint256 tokenId;
        uint256 amount; // For ERC1155, 1 for ERC721
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
    
    // State variables
    uint256 private nextTradeId = 1;
    
    // 🆕 V6: Dynamic fee management
    uint256 public tradeFee = 0; // Free during beta
    uint256 public constant MAX_TRADE_FEE = 1 ether;
    address public constant FEE_COLLECTOR = 0x20ce27B140A0EEECceF880e01D2082558400FDd6;
    
    // 🆕 V6: Multi-admin system
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
    
    // Events
    event TradeCreated(uint256 indexed tradeId, address indexed creator, address indexed counterparty);
    event TradeAccepted(uint256 indexed tradeId, address indexed creator, address indexed acceptor);
    event TradeCancelled(uint256 indexed tradeId, address indexed canceller);
    event TradeExpired(uint256 indexed tradeId);
    event TradeDeclined(uint256 indexed tradeId, address indexed decliner);
    
    // 🆕 V6: New admin events
    event TradeFeeUpdated(uint256 oldFee, uint256 newFee, address updatedBy);
    event AdminAdded(address indexed newAdmin, address indexed addedBy);
    event AdminRemoved(address indexed removedAdmin, address indexed removedBy);
    event TradeAdminCancelled(uint256 indexed tradeId, address indexed admin);
    
    // Modifiers
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
    
    modifier onlyCreatorOrCounterparty(uint256 tradeId) {
        require(
            msg.sender == trades[tradeId].creator || msg.sender == trades[tradeId].counterparty,
            "Only trade creator or counterparty can perform this action"
        );
        _;
    }
    
    // 🆕 V6: Admin modifier
    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "Only admin can perform this action");
        _;
    }
    
    /**
     * @dev Constructor - Initialize with primary admin
     */
    constructor() {
        isAdmin[msg.sender] = true;
        adminList.push(msg.sender);
    }
    
    /**
     * @dev Create a new trade (unchanged from V5)
     */
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
        require(msg.value >= offeredMONAD + tradeFee, "Insufficient MONAD sent"); // 🔄 Uses dynamic tradeFee
        require(
            offeredNFTs.length > 0 || requestedNFTs.length > 0 || offeredMONAD > 0 || requestedMONAD > 0,
            "Trade must include at least one asset"
        );
        
        uint256 tradeId = nextTradeId++;
        
        // Create trade
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
        
        // Store NFTs
        for (uint256 i = 0; i < offeredNFTs.length; i++) {
            tradeOfferedNFTs[tradeId].push(offeredNFTs[i]);
            
            // Transfer NFT to contract
            if (offeredNFTs[i].standard == TokenStandard.ERC721) {
                IERC721(offeredNFTs[i].contractAddress).safeTransferFrom(
                    msg.sender,
                    address(this),
                    offeredNFTs[i].tokenId
                );
            } else if (offeredNFTs[i].standard == TokenStandard.ERC1155) {
                IERC1155(offeredNFTs[i].contractAddress).safeTransferFrom(
                    msg.sender,
                    address(this),
                    offeredNFTs[i].tokenId,
                    offeredNFTs[i].amount,
                    ""
                );
            }
        }
        
        for (uint256 i = 0; i < requestedNFTs.length; i++) {
            tradeRequestedNFTs[tradeId].push(requestedNFTs[i]);
        }
        
        tradeOfferedNFTCount[tradeId] = offeredNFTs.length;
        tradeRequestedNFTCount[tradeId] = requestedNFTs.length;
        
        // Track trades for users
        userCreatedTrades[msg.sender].push(tradeId);
        userReceivedTrades[counterparty].push(tradeId);
        
        // Send fee to collector
        if (tradeFee > 0) { // 🔄 Uses dynamic tradeFee
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        
        // Refund excess payment
        if (msg.value > offeredMONAD + tradeFee) { // 🔄 Uses dynamic tradeFee
            payable(msg.sender).transfer(msg.value - offeredMONAD - tradeFee);
        }
        
        emit TradeCreated(tradeId, msg.sender, counterparty);
    }
    
    /**
     * @dev Accept a trade (unchanged from V5)
     */
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
        require(msg.value >= trade.requestedMONAD + tradeFee, "Insufficient MONAD sent"); // 🔄 Uses dynamic tradeFee
        
        trade.status = TradeStatus.Accepted;
        
        // Transfer offered NFTs to counterparty (acceptor)
        for (uint256 i = 0; i < tradeOfferedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeOfferedNFTs[tradeId][i];
            
            if (nft.standard == TokenStandard.ERC721) {
                IERC721(nft.contractAddress).safeTransferFrom(
                    address(this),
                    msg.sender,
                    nft.tokenId
                );
            } else if (nft.standard == TokenStandard.ERC1155) {
                IERC1155(nft.contractAddress).safeTransferFrom(
                    address(this),
                    msg.sender,
                    nft.tokenId,
                    nft.amount,
                    ""
                );
            }
        }
        
        // Transfer requested NFTs from counterparty to creator
        for (uint256 i = 0; i < tradeRequestedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeRequestedNFTs[tradeId][i];
            
            if (nft.standard == TokenStandard.ERC721) {
                IERC721(nft.contractAddress).safeTransferFrom(
                    msg.sender,
                    trade.creator,
                    nft.tokenId
                );
            } else if (nft.standard == TokenStandard.ERC1155) {
                IERC1155(nft.contractAddress).safeTransferFrom(
                    msg.sender,
                    trade.creator,
                    nft.tokenId,
                    nft.amount,
                    ""
                );
            }
        }
        
        // Send trade fee to collector first
        if (tradeFee > 0) { // 🔄 Uses dynamic tradeFee
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        
        // Transfer MONAD amounts
        if (trade.offeredMONAD > 0) {
            // Creator's offered MONAD goes to counterparty (acceptor)
            payable(msg.sender).transfer(trade.offeredMONAD);
        }
        
        if (trade.requestedMONAD > 0) {
            // Counterparty's requested MONAD (from msg.value) goes to creator
            payable(trade.creator).transfer(trade.requestedMONAD);
        }
        
        // Refund any excess payment to counterparty
        uint256 expectedPayment = trade.requestedMONAD + tradeFee; // 🔄 Uses dynamic tradeFee
        if (msg.value > expectedPayment) {
            payable(msg.sender).transfer(msg.value - expectedPayment);
        }
        
        emit TradeAccepted(tradeId, trade.creator, msg.sender);
    }
    
    /**
     * @dev Cancel a trade (only creator) - unchanged from V5
     */
    function cancelTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyTradeCreator(tradeId)
    {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Cancelled;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeCancelled(tradeId, msg.sender);
    }
    
    /**
     * @dev Decline a trade (only counterparty) - unchanged from V5
     */
    function declineTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyCounterparty(tradeId)
    {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Declined;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeDeclined(tradeId, msg.sender);
    }
    
    /**
     * @dev Mark expired trades (can be called by anyone) - unchanged from V5
     */
    function expireTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
    {
        Trade storage trade = trades[tradeId];
        require(block.timestamp > trade.expiryTime, "Trade not yet expired");
        
        trade.status = TradeStatus.Expired;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeExpired(tradeId);
    }
    
    // 🆕 V6: NEW ADMIN FUNCTIONS
    
    /**
     * @dev Admin force cancel trade (for stuck trades)
     */
    function adminCancelTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
        onlyAdmin
    {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Cancelled;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeAdminCancelled(tradeId, msg.sender);
    }
    
    /**
     * @dev Set trade fee (0-1 MONAD cap)
     */
    function setTradeFee(uint256 newFee) external onlyAdmin {
        require(newFee <= MAX_TRADE_FEE, "Fee exceeds maximum limit");
        
        uint256 oldFee = tradeFee;
        tradeFee = newFee;
        
        emit TradeFeeUpdated(oldFee, newFee, msg.sender);
    }
    
    /**
     * @dev Add new admin (max 3 total)
     */
    function addAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        require(!isAdmin[newAdmin], "Address is already an admin");
        require(adminList.length < MAX_ADMINS, "Maximum admin limit reached");
        
        isAdmin[newAdmin] = true;
        adminList.push(newAdmin);
        
        emit AdminAdded(newAdmin, msg.sender);
    }
    
    /**
     * @dev Remove admin (cannot remove last admin)
     */
    function removeAdmin(address adminToRemove) external onlyAdmin {
        require(isAdmin[adminToRemove], "Address is not an admin");
        require(adminList.length > 1, "Cannot remove the last admin");
        require(adminToRemove != msg.sender, "Cannot remove yourself");
        
        isAdmin[adminToRemove] = false;
        
        // Remove from adminList array
        for (uint256 i = 0; i < adminList.length; i++) {
            if (adminList[i] == adminToRemove) {
                adminList[i] = adminList[adminList.length - 1];
                adminList.pop();
                break;
            }
        }
        
        emit AdminRemoved(adminToRemove, msg.sender);
    }
    
    /**
     * @dev Get all admins
     */
    function getAdmins() external view returns (address[] memory) {
        return adminList;
    }
    
    /**
     * @dev Get admin count
     */
    function getAdminCount() external view returns (uint256) {
        return adminList.length;
    }
    
    /**
     * @dev Get current trade fee
     */
    function getTradeFee() external view returns (uint256) {
        return tradeFee;
    }
    
    // END V6 NEW FUNCTIONS
    
    /**
     * @dev Internal function to return assets to creator (unchanged from V5)
     */
    function _returnAssetsToCreator(uint256 tradeId) internal {
        Trade storage trade = trades[tradeId];
        
        // Return offered NFTs to creator
        for (uint256 i = 0; i < tradeOfferedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeOfferedNFTs[tradeId][i];
            
            if (nft.standard == TokenStandard.ERC721) {
                IERC721(nft.contractAddress).safeTransferFrom(
                    address(this),
                    trade.creator,
                    nft.tokenId
                );
            } else if (nft.standard == TokenStandard.ERC1155) {
                IERC1155(nft.contractAddress).safeTransferFrom(
                    address(this),
                    trade.creator,
                    nft.tokenId,
                    nft.amount,
                    ""
                );
            }
        }
        
        // Return offered MONAD to creator
        if (trade.offeredMONAD > 0) {
            payable(trade.creator).transfer(trade.offeredMONAD);
        }
    }
    
    /**
     * @dev Auto-detect token standard (unchanged from V5)
     */
    function detectTokenStandard(address contractAddress) external view returns (TokenStandard) {
        if (IERC165(contractAddress).supportsInterface(0xd9b67a26)) {
            return TokenStandard.ERC1155; // ERC1155 interface
        } else if (IERC165(contractAddress).supportsInterface(0x80ac58cd)) {
            return TokenStandard.ERC721; // ERC721 interface
        } else {
            revert("Unsupported token standard");
        }
    }
    
    /**
     * @dev Get trade details (unchanged from V5)
     */
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
    
    /**
     * @dev Get offered NFTs for a trade (unchanged from V5)
     */
    function getOfferedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) {
        uint256 count = tradeOfferedNFTCount[tradeId];
        NFTItem[] memory nfts = new NFTItem[](count);
        
        for (uint256 i = 0; i < count; i++) {
            nfts[i] = tradeOfferedNFTs[tradeId][i];
        }
        
        return nfts;
    }
    
    /**
     * @dev Get requested NFTs for a trade (unchanged from V5)
     */
    function getRequestedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) {
        uint256 count = tradeRequestedNFTCount[tradeId];
        NFTItem[] memory nfts = new NFTItem[](count);
        
        for (uint256 i = 0; i < count; i++) {
            nfts[i] = tradeRequestedNFTs[tradeId][i];
        }
        
        return nfts;
    }
    
    /**
     * @dev Get trades created by a user (unchanged from V5)
     */
    function getUserCreatedTrades(address user) external view returns (uint256[] memory) {
        return userCreatedTrades[user];
    }
    
    /**
     * @dev Get trades received by a user (unchanged from V5)
     */
    function getUserReceivedTrades(address user) external view returns (uint256[] memory) {
        return userReceivedTrades[user];
    }
    
    /**
     * @dev Emergency function to pause contract (admin only)
     */
    function pause() external onlyAdmin {
        _pause();
    }
    
    /**
     * @dev Emergency function to unpause contract (admin only)
     */
    function unpause() external onlyAdmin {
        _unpause();
    }
    
    // Required for receiving NFTs (unchanged from V5)
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