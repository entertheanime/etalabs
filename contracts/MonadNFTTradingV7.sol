// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title MonadNFTTradingV7
 * @dev Enhanced NFT trading contract with automatic expiration checking
 * 
 * Key improvements in V7:
 * - Automatic expiration checking in all trade operations
 * - Expired trades are automatically handled without external calls
 * - Better gas optimization for expiration checks
 * - Cleaner trade lifecycle management
 */
contract MonadNFTTradingV7 is ERC721Holder, ERC1155Holder, ReentrancyGuard, Pausable {
    
    // Constants
    uint256 public constant MAX_TRADE_FEE = 1 ether; // 1 MONAD max fee
    uint256 public constant MAX_ADMINS = 3;
    address public constant FEE_COLLECTOR = 0x20ce27B140A0EEECceF880e01D2082558400FDd6;
    
    // State variables
    uint256 public tradeCount;
    uint256 public tradeFee = 0.3 ether; // Default 0.3 MONAD
    
    // Admin management
    mapping(address => bool) public isAdmin;
    address[] public adminList;
    
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
    
    // Storage mappings
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
    event TradeFeeUpdated(uint256 oldFee, uint256 newFee, address updatedBy);
    event AdminAdded(address indexed newAdmin, address indexed addedBy);
    event AdminRemoved(address indexed removedAdmin, address indexed removedBy);
    event TradeAdminCancelled(uint256 indexed tradeId, address indexed admin);
    event TradeAutoExpired(uint256 indexed tradeId); // New event for auto-expiration
    
    // Modifiers
    modifier tradeExists(uint256 tradeId) {
        require(trades[tradeId].creator != address(0), "Trade does not exist");
        _;
    }
    
    modifier tradePending(uint256 tradeId) {
        require(trades[tradeId].status == TradeStatus.Pending, "Trade not pending");
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
    
    // 🆕 V7: New modifier that automatically handles expiration
    modifier autoExpireCheck(uint256 tradeId) {
        if (_isTradeExpired(tradeId)) {
            _autoExpireTrade(tradeId);
        }
        _;
    }
    
    constructor() {
        // Set deployer as first admin
        isAdmin[msg.sender] = true;
        adminList.push(msg.sender);
    }
    
    /**
     * @dev Create a new trade with automatic expiration (24 hours)
     */
    function createTrade(
        address counterparty,
        NFTItem[] calldata offeredNFTs,
        NFTItem[] calldata requestedNFTs,
        uint256 requestedMONAD,
        string calldata message
    ) external payable nonReentrant whenNotPaused {
        require(counterparty != address(0), "Invalid counterparty address");
        require(counterparty != msg.sender, "Cannot trade with yourself");
        require(msg.value >= tradeFee, "Insufficient fee payment");
        require(
            offeredNFTs.length > 0 || requestedNFTs.length > 0 || msg.value > tradeFee || requestedMONAD > 0,
            "Trade must include at least one asset"
        );
        
        uint256 offeredMONAD = msg.value - tradeFee;
        tradeCount++;
        uint256 tradeId = tradeCount;
        
        // Create trade with 24-hour expiration
        trades[tradeId] = Trade({
            id: tradeId,
            creator: msg.sender,
            counterparty: counterparty,
            offeredMONAD: offeredMONAD,
            requestedMONAD: requestedMONAD,
            expiryTime: block.timestamp + 24 hours, // 24-hour expiration
            status: TradeStatus.Pending,
            message: message,
            createdAt: block.timestamp
        });
        
        // Store NFTs
        for (uint256 i = 0; i < offeredNFTs.length; i++) {
            _transferNFTToContract(offeredNFTs[i], msg.sender);
            tradeOfferedNFTs[tradeId].push(offeredNFTs[i]);
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
        if (tradeFee > 0) {
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        
        emit TradeCreated(tradeId, msg.sender, counterparty);
    }
    
    /**
     * @dev Accept a trade with automatic expiration checking
     */
    function acceptTrade(uint256 tradeId) 
        external 
        payable 
        nonReentrant 
        whenNotPaused
        tradeExists(tradeId)
        autoExpireCheck(tradeId) // 🆕 V7: Auto-check expiration first
        tradePending(tradeId)
        onlyCounterparty(tradeId)
    {
        Trade storage trade = trades[tradeId];
        require(msg.value >= trade.requestedMONAD + tradeFee, "Insufficient MONAD sent");
        
        trade.status = TradeStatus.Accepted;
        
        // Transfer offered NFTs to counterparty (acceptor)
        for (uint256 i = 0; i < tradeOfferedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeOfferedNFTs[tradeId][i];
            _transferNFTFromContract(nft, msg.sender);
        }
        
        // Transfer requested NFTs from counterparty to creator
        for (uint256 i = 0; i < tradeRequestedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeRequestedNFTs[tradeId][i];
            _transferNFTToContract(nft, msg.sender);
            _transferNFTFromContract(nft, trade.creator);
        }
        
        // Handle MONAD transfers
        if (tradeFee > 0) {
            payable(FEE_COLLECTOR).transfer(tradeFee);
        }
        
        if (trade.offeredMONAD > 0) {
            payable(msg.sender).transfer(trade.offeredMONAD);
        }
        
        if (trade.requestedMONAD > 0) {
            payable(trade.creator).transfer(trade.requestedMONAD);
        }
        
        // Refund excess payment
        uint256 expectedPayment = trade.requestedMONAD + tradeFee;
        if (msg.value > expectedPayment) {
            payable(msg.sender).transfer(msg.value - expectedPayment);
        }
        
        emit TradeAccepted(tradeId, trade.creator, msg.sender);
    }
    
    /**
     * @dev Cancel a trade with automatic expiration checking
     */
    function cancelTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        autoExpireCheck(tradeId) // 🆕 V7: Auto-check expiration first
        tradePending(tradeId)
        onlyTradeCreator(tradeId)
    {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Cancelled;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeCancelled(tradeId, msg.sender);
    }
    
    /**
     * @dev Decline a trade with automatic expiration checking
     */
    function declineTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        autoExpireCheck(tradeId) // 🆕 V7: Auto-check expiration first
        tradePending(tradeId)
        onlyCounterparty(tradeId)
    {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Declined;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeDeclined(tradeId, msg.sender);
    }
    
    /**
     * @dev Manual expiration (for external services or users)
     */
    function expireTrade(uint256 tradeId)
        external
        nonReentrant
        tradeExists(tradeId)
        tradePending(tradeId)
    {
        require(_isTradeExpired(tradeId), "Trade not yet expired");
        
        _autoExpireTrade(tradeId);
    }
    
    /**
     * @dev Admin force cancel trade
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
    
    // 🆕 V7: Internal automatic expiration functions
    
    /**
     * @dev Check if a trade is expired
     */
    function _isTradeExpired(uint256 tradeId) internal view returns (bool) {
        return block.timestamp > trades[tradeId].expiryTime && trades[tradeId].status == TradeStatus.Pending;
    }
    
    /**
     * @dev Automatically expire a trade
     */
    function _autoExpireTrade(uint256 tradeId) internal {
        Trade storage trade = trades[tradeId];
        trade.status = TradeStatus.Expired;
        
        _returnAssetsToCreator(tradeId);
        
        emit TradeAutoExpired(tradeId);
    }
    
    /**
     * @dev Return assets to trade creator
     */
    function _returnAssetsToCreator(uint256 tradeId) internal {
        Trade storage trade = trades[tradeId];
        
        // Return offered NFTs to creator
        for (uint256 i = 0; i < tradeOfferedNFTCount[tradeId]; i++) {
            NFTItem storage nft = tradeOfferedNFTs[tradeId][i];
            _transferNFTFromContract(nft, trade.creator);
        }
        
        // Return offered MONAD to creator
        if (trade.offeredMONAD > 0) {
            payable(trade.creator).transfer(trade.offeredMONAD);
        }
    }
    
    /**
     * @dev Transfer NFT to contract
     */
    function _transferNFTToContract(NFTItem memory nft, address from) internal {
        if (nft.standard == TokenStandard.ERC721) {
            IERC721(nft.contractAddress).safeTransferFrom(from, address(this), nft.tokenId);
        } else if (nft.standard == TokenStandard.ERC1155) {
            IERC1155(nft.contractAddress).safeTransferFrom(from, address(this), nft.tokenId, nft.amount, "");
        }
    }
    
    /**
     * @dev Transfer NFT from contract
     */
    function _transferNFTFromContract(NFTItem memory nft, address to) internal {
        if (nft.standard == TokenStandard.ERC721) {
            IERC721(nft.contractAddress).safeTransferFrom(address(this), to, nft.tokenId);
        } else if (nft.standard == TokenStandard.ERC1155) {
            IERC1155(nft.contractAddress).safeTransferFrom(address(this), to, nft.tokenId, nft.amount, "");
        }
    }
    
    // Admin functions (same as V6)
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
    
    // View functions
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
        return tradeOfferedNFTs[tradeId];
    }
    
    function getRequestedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) {
        return tradeRequestedNFTs[tradeId];
    }
    
    function getUserCreatedTrades(address user) external view returns (uint256[] memory) {
        return userCreatedTrades[user];
    }
    
    function getUserReceivedTrades(address user) external view returns (uint256[] memory) {
        return userReceivedTrades[user];
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
    
    // 🆕 V7: New view function to check if trade is expired
    function isTradeExpired(uint256 tradeId) external view returns (bool) {
        return _isTradeExpired(tradeId);
    }
    
    // Emergency functions
    function pause() external onlyAdmin {
        _pause();
    }
    
    function unpause() external onlyAdmin {
        _unpause();
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
} 