// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title EtaSwapV9
 * @notice Direct wallet-to-wallet NFT trading. NFTs are never escrowed by this contract.
 * @dev Native ETH attached to an offer is held until the trade is accepted, cancelled, declined, or expires.
 */
contract EtaSwapV9 is ReentrancyGuard, Pausable, IERC721Receiver, IERC1155Receiver {
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
        uint256 offeredETH;
        uint256 requestedETH;
        uint256 offeredChog;
        uint256 requestedChog;
        uint256 expiryTime;
        TradeStatus status;
        string message;
        uint256 createdAt;
    }

    uint256 public constant MAX_NFTS_PER_SIDE = 8;
    uint256 public constant MAX_MESSAGE_LENGTH = 280;
    uint256 public constant MAX_TRADE_FEE = 0.01 ether;
    uint256 public constant MAX_ADMINS = 3;
    uint256 public constant MIN_TRADE_DURATION = 5 minutes;
    uint256 public constant MAX_TRADE_DURATION = 1 days;

    uint256 private nextTradeId = 1;
    uint256 public tradeFee;
    address public immutable feeCollector;
    address public constant CHOG = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    address public chogNft;
    address public etaNft;

    mapping(address => bool) public isAdmin;
    address[] private adminList;
    mapping(address => uint256) public deferredEth;
    mapping(address => uint256) public deferredChog;

    mapping(uint256 => Trade) public trades;
    mapping(uint256 => NFTItem[]) private tradeOfferedNFTs;
    mapping(uint256 => NFTItem[]) private tradeRequestedNFTs;
    mapping(address => uint256[]) private userCreatedTrades;
    mapping(address => uint256[]) private userReceivedTrades;

    event TradeCreated(uint256 indexed tradeId, address indexed creator, address indexed counterparty);
    event TradeAccepted(uint256 indexed tradeId, address indexed creator, address indexed acceptor);
    event TradeCancelled(uint256 indexed tradeId, address indexed canceller);
    event TradeExpired(uint256 indexed tradeId);
    event TradeDeclined(uint256 indexed tradeId, address indexed decliner);
    event TradeFeeUpdated(uint256 oldFee, uint256 newFee, address indexed updatedBy);
    event AdminAdded(address indexed newAdmin, address indexed addedBy);
    event AdminRemoved(address indexed removedAdmin, address indexed removedBy);
    event DeferredEthCredited(address indexed recipient, uint256 amount);
    event DeferredEthWithdrawn(address indexed recipient, uint256 amount);
    event DeferredChogCredited(address indexed recipient, uint256 amount);
    event DeferredChogWithdrawn(address indexed recipient, uint256 amount);

    modifier tradeExists(uint256 tradeId) {
        require(trades[tradeId].creator != address(0), "TRADE_NOT_FOUND");
        _;
    }

    modifier onlyAdmin() {
        require(isAdmin[msg.sender], "ADMIN_ONLY");
        _;
    }

    constructor() {
        isAdmin[msg.sender] = true;
        adminList.push(msg.sender);
        feeCollector = msg.sender;
    }

    function createTrade(
        address counterparty,
        NFTItem[] calldata offeredNFTs,
        NFTItem[] calldata requestedNFTs,
        uint256 offeredETH,
        uint256 requestedETH,
        uint256 offeredChog,
        uint256 requestedChog,
        string calldata message,
        uint256 duration
    ) external payable nonReentrant whenNotPaused {
        require(counterparty != address(0) && counterparty != msg.sender, "INVALID_COUNTERPARTY");
        require(bytes(message).length <= MAX_MESSAGE_LENGTH, "MESSAGE_TOO_LONG");
        require(
            offeredNFTs.length > 0 || requestedNFTs.length > 0 || offeredETH > 0 || requestedETH > 0 || offeredChog > 0 || requestedChog > 0,
            "EMPTY_TRADE"
        );
        uint256 fee = feeFor(msg.sender);
        require(msg.value == offeredETH + fee, "INCORRECT_ETH_VALUE");
        require(duration >= MIN_TRADE_DURATION && duration <= MAX_TRADE_DURATION, "INVALID_DURATION");

        _validateNftList(offeredNFTs);
        _validateNftList(requestedNFTs);
        for (uint256 i; i < offeredNFTs.length; ++i) {
            require(_heldBy(msg.sender, offeredNFTs[i]), "NFT_NOT_IN_WALLET");
            require(_approvedFor(msg.sender, offeredNFTs[i]), "NFT_NOT_APPROVED");
        }

        uint256 tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            id: tradeId,
            creator: msg.sender,
            counterparty: counterparty,
            offeredETH: offeredETH,
            requestedETH: requestedETH,
            offeredChog: offeredChog,
            requestedChog: requestedChog,
            expiryTime: block.timestamp + duration,
            status: TradeStatus.Pending,
            message: message,
            createdAt: block.timestamp
        });

        for (uint256 i; i < offeredNFTs.length; ++i) tradeOfferedNFTs[tradeId].push(offeredNFTs[i]);
        for (uint256 i; i < requestedNFTs.length; ++i) tradeRequestedNFTs[tradeId].push(requestedNFTs[i]);
        userCreatedTrades[msg.sender].push(tradeId);
        userReceivedTrades[counterparty].push(tradeId);

        _pullChog(msg.sender, offeredChog);
        _payOrCredit(feeCollector, fee);
        emit TradeCreated(tradeId, msg.sender, counterparty);
    }

    function acceptTrade(uint256 tradeId) external payable nonReentrant whenNotPaused tradeExists(tradeId) {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Pending, "TRADE_NOT_PENDING");
        require(block.timestamp <= trade.expiryTime, "TRADE_EXPIRED");
        require(msg.sender == trade.counterparty, "COUNTERPARTY_ONLY");
        uint256 fee = feeFor(msg.sender);
        require(msg.value == trade.requestedETH + fee, "INCORRECT_ETH_VALUE");

        NFTItem[] storage offeredNFTs = tradeOfferedNFTs[tradeId];
        NFTItem[] storage requestedNFTs = tradeRequestedNFTs[tradeId];
        for (uint256 i; i < offeredNFTs.length; ++i) _transferNft(trade.creator, msg.sender, offeredNFTs[i]);
        for (uint256 i; i < requestedNFTs.length; ++i) _transferNft(msg.sender, trade.creator, requestedNFTs[i]);

        trade.status = TradeStatus.Accepted;
        _pullChog(msg.sender, trade.requestedChog);
        _payOrCredit(feeCollector, fee);
        _payOrCredit(msg.sender, trade.offeredETH);
        _payOrCredit(trade.creator, trade.requestedETH);
        _payChog(msg.sender, trade.offeredChog);
        _payChog(trade.creator, trade.requestedChog);
        emit TradeAccepted(tradeId, trade.creator, msg.sender);
    }

    function cancelTrade(uint256 tradeId) external nonReentrant tradeExists(tradeId) {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Pending, "TRADE_NOT_PENDING");
        require(msg.sender == trade.creator, "CREATOR_ONLY");
        trade.status = TradeStatus.Cancelled;
        _payOrCredit(trade.creator, trade.offeredETH);
        _payChog(trade.creator, trade.offeredChog);
        emit TradeCancelled(tradeId, msg.sender);
    }

    function declineTrade(uint256 tradeId) external nonReentrant tradeExists(tradeId) {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Pending, "TRADE_NOT_PENDING");
        require(msg.sender == trade.counterparty, "COUNTERPARTY_ONLY");
        trade.status = TradeStatus.Declined;
        _payOrCredit(trade.creator, trade.offeredETH);
        _payChog(trade.creator, trade.offeredChog);
        emit TradeDeclined(tradeId, msg.sender);
    }

    function expireTrade(uint256 tradeId) external nonReentrant tradeExists(tradeId) {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Pending, "TRADE_NOT_PENDING");
        require(block.timestamp > trade.expiryTime, "TRADE_NOT_EXPIRED");
        trade.status = TradeStatus.Expired;
        _payOrCredit(trade.creator, trade.offeredETH);
        _payChog(trade.creator, trade.offeredChog);
        emit TradeExpired(tradeId);
    }

    function withdrawDeferredEth() external nonReentrant {
        uint256 amount = deferredEth[msg.sender];
        require(amount > 0, "NOTHING_TO_WITHDRAW");
        deferredEth[msg.sender] = 0;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "WITHDRAWAL_FAILED");
        emit DeferredEthWithdrawn(msg.sender, amount);
    }

    function setFeeExemptNfts(address chog, address eta) external onlyAdmin {
        chogNft = chog;
        etaNft = eta;
    }

    function feeFor(address account) public view returns (uint256) {
        return _holdsExempt(account) ? 0 : tradeFee;
    }

    function _holdsExempt(address account) internal view returns (bool) {
        return _owns721(chogNft, account) || _owns721(etaNft, account);
    }

    function _owns721(address token, address account) internal view returns (bool) {
        if (token == address(0) || account == address(0)) return false;
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC721.balanceOf.selector, account));
        return ok && data.length >= 32 && abi.decode(data, (uint256)) > 0;
    }

    function setTradeFee(uint256 newFee) external onlyAdmin {
        require(newFee <= MAX_TRADE_FEE, "FEE_TOO_HIGH");
        uint256 oldFee = tradeFee;
        tradeFee = newFee;
        emit TradeFeeUpdated(oldFee, newFee, msg.sender);
    }

    function addAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "INVALID_ADMIN");
        require(!isAdmin[newAdmin], "ALREADY_ADMIN");
        require(adminList.length < MAX_ADMINS, "MAX_ADMINS_REACHED");
        isAdmin[newAdmin] = true;
        adminList.push(newAdmin);
        emit AdminAdded(newAdmin, msg.sender);
    }

    function removeAdmin(address adminToRemove) external onlyAdmin {
        require(adminToRemove != msg.sender, "CANNOT_REMOVE_SELF");
        require(isAdmin[adminToRemove], "NOT_ADMIN");
        require(adminList.length > 1, "LAST_ADMIN");
        isAdmin[adminToRemove] = false;
        for (uint256 i; i < adminList.length; ++i) {
            if (adminList[i] == adminToRemove) {
                adminList[i] = adminList[adminList.length - 1];
                adminList.pop();
                break;
            }
        }
        emit AdminRemoved(adminToRemove, msg.sender);
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    function getAdmins() external view returns (address[] memory) { return adminList; }
    function getOfferedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) { return tradeOfferedNFTs[tradeId]; }
    function getRequestedNFTs(uint256 tradeId) external view returns (NFTItem[] memory) { return tradeRequestedNFTs[tradeId]; }
    function getUserCreatedTrades(address user) external view returns (uint256[] memory) { return userCreatedTrades[user]; }
    function getUserReceivedTrades(address user) external view returns (uint256[] memory) { return userReceivedTrades[user]; }

    function _validateNftList(NFTItem[] calldata nfts) internal pure {
        require(nfts.length <= MAX_NFTS_PER_SIDE, "TOO_MANY_NFTS");
        for (uint256 i; i < nfts.length; ++i) {
            NFTItem calldata nft = nfts[i];
            require(nft.contractAddress != address(0) && nft.amount > 0, "INVALID_NFT");
            require(nft.standard != TokenStandard.ERC721 || nft.amount == 1, "ERC721_AMOUNT_MUST_BE_ONE");
            for (uint256 j; j < i; ++j) {
                NFTItem calldata previous = nfts[j];
                require(
                    nft.contractAddress != previous.contractAddress ||
                    nft.tokenId != previous.tokenId ||
                    nft.standard != previous.standard,
                    "DUPLICATE_NFT"
                );
            }
        }
    }

    function _heldBy(address owner, NFTItem memory nft) internal view returns (bool) {
        if (nft.standard == TokenStandard.ERC721) {
            try IERC721(nft.contractAddress).ownerOf(nft.tokenId) returns (address tokenOwner) {
                return tokenOwner == owner;
            } catch { return false; }
        }
        try IERC1155(nft.contractAddress).balanceOf(owner, nft.tokenId) returns (uint256 balance) {
            return balance >= nft.amount;
        } catch { return false; }
    }

    function _approvedFor(address owner, NFTItem memory nft) internal view returns (bool) {
        if (nft.standard == TokenStandard.ERC721) {
            try IERC721(nft.contractAddress).isApprovedForAll(owner, address(this)) returns (bool approvedForAll) {
                if (approvedForAll) return true;
            } catch { return false; }
            try IERC721(nft.contractAddress).getApproved(nft.tokenId) returns (address approved) {
                return approved == address(this);
            } catch { return false; }
        }
        try IERC1155(nft.contractAddress).isApprovedForAll(owner, address(this)) returns (bool approved) {
            return approved;
        } catch { return false; }
    }

    function _transferNft(address from, address to, NFTItem memory nft) internal {
        require(_heldBy(from, nft), "NFT_NOT_IN_WALLET");
        require(_approvedFor(from, nft), "NFT_NOT_APPROVED");
        if (nft.standard == TokenStandard.ERC721) {
            IERC721(nft.contractAddress).safeTransferFrom(from, to, nft.tokenId);
        } else {
            IERC1155(nft.contractAddress).safeTransferFrom(from, to, nft.tokenId, nft.amount, "");
        }
    }

    function _payOrCredit(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool sent,) = payable(recipient).call{value: amount}("");
        if (!sent) {
            deferredEth[recipient] += amount;
            emit DeferredEthCredited(recipient, amount);
        }
    }

    function _pullChog(address from, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "CHOG_PULL");
    }

    function _payChog(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transfer.selector, recipient, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            deferredChog[recipient] += amount;
            emit DeferredChogCredited(recipient, amount);
        }
    }

    function withdrawDeferredChog() external nonReentrant {
        uint256 amount = deferredChog[msg.sender];
        require(amount > 0, "NOTHING_TO_WITHDRAW");
        deferredChog[msg.sender] = 0;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "CHOG_WITHDRAW");
        emit DeferredChogWithdrawn(msg.sender, amount);
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
