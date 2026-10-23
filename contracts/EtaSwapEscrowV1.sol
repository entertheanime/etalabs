// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title EtaSwapEscrowV1
/// @notice Direct-deposit escrow. NOT compatible with the EtaSwapV9 app ABI.
/// @dev Owners call their NFT's safeTransferFrom with abi.encode(tradeId, side,
/// index), all uint256; side 0 = offered, 1 = requested. No operator deposits.
/// External collection policies can change and prevent release or refund.
contract EtaSwapEscrowV1 is ReentrancyGuard, Pausable, Ownable2Step, IERC721Receiver, IERC1155Receiver {
    enum Status { Pending, Accepted, Cancelled, Expired, Declined }
    enum Standard { ERC721, ERC1155 }
    struct Item { address token; uint256 id; uint256 amount; Standard standard; }
    struct Trade {
        address creator;
        address counterparty;
        uint256 offeredETH;
        uint256 requestedETH;
        uint256 offeredChog;
        uint256 requestedChog;
        uint256 fee;
        uint256 expiresAt;
        Status status;
    }

    uint256 public constant MAX_ITEMS = 8;
    uint256 public constant MAX_FEE = 0.01 ether;
    uint256 public constant MAX_DURATION = 7 days;
    uint256 public nextTradeId = 1;
    uint256 public tradeFee;
    address public immutable feeCollector;
    address public constant CHOG = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    address public chogNft;
    address public etaNft;
    mapping(uint256 => Trade) public trades;
    mapping(uint256 => mapping(uint256 => Item[])) private items;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => bool))) public deposited;
    mapping(address => mapping(uint256 => uint256)) public reserved721;
    mapping(address => mapping(uint256 => uint256)) public reserved1155;
    mapping(address => uint256) public ethCredit;
    mapping(address => uint256) public chogCredit;

    event Created(uint256 indexed tradeId, address indexed creator, address indexed counterparty);
    event Deposited(uint256 indexed tradeId, uint256 side, uint256 index);
    event Closed(uint256 indexed tradeId, Status status);
    event Refunded(uint256 indexed tradeId, uint256 side, uint256 index, address destination);
    event EthCredited(address indexed account, uint256 amount);
    event EthWithdrawn(address indexed account, address indexed destination, uint256 amount);
    event ChogCredited(address indexed account, uint256 amount);
    event ChogWithdrawn(address indexed account, address indexed destination, uint256 amount);
    event FeeChanged(uint256 fee);

    constructor(address collector) Ownable(msg.sender) {
        require(collector != address(0), "INVALID_COLLECTOR");
        feeCollector = collector;
    }

    function createTrade(address counterparty, Item[] calldata offered, Item[] calldata requested,
        uint256 offeredETH, uint256 requestedETH, uint256 offeredChog, uint256 requestedChog, uint256 duration)
        external payable nonReentrant whenNotPaused returns (uint256 id)
    {
        require(counterparty != address(0) && counterparty != msg.sender && counterparty != address(this), "INVALID_COUNTERPARTY");
        require(duration > 0 && duration <= MAX_DURATION, "INVALID_DURATION");
        require(offered.length + requested.length > 0 || offeredETH + requestedETH > 0 || offeredChog + requestedChog > 0, "EMPTY_TRADE");
        uint256 fee = feeFor(msg.sender);
        require(msg.value == offeredETH + fee, "INCORRECT_ETH_VALUE");
        _validate(offered);
        _validate(requested);
        for (uint256 i; i < offered.length; ++i) {
            for (uint256 j; j < requested.length; ++j) {
                require(offered[i].token != requested[j].token || offered[i].id != requested[j].id, "ASSET_ON_BOTH_SIDES");
            }
        }
        id = nextTradeId++;
        trades[id] = Trade(msg.sender, counterparty, offeredETH, requestedETH, offeredChog, requestedChog, fee, block.timestamp + duration, Status.Pending);
        for (uint256 i; i < offered.length; ++i) items[id][0].push(offered[i]);
        for (uint256 i; i < requested.length; ++i) items[id][1].push(requested[i]);
        _pullChog(msg.sender, offeredChog);
        _credit(feeCollector, fee);
        emit Created(id, msg.sender, counterparty);
    }

    function _validate(Item[] calldata list) private view {
        require(list.length <= MAX_ITEMS, "TOO_MANY_ITEMS");
        for (uint256 i; i < list.length; ++i) {
            Item calldata item = list[i];
            require(item.token.code.length > 0 && item.token != address(this) && item.amount > 0, "INVALID_ITEM");
            require(item.standard != Standard.ERC721 || item.amount == 1, "INVALID_ERC721_AMOUNT");
            for (uint256 j; j < i; ++j) {
                require(item.token != list[j].token || item.id != list[j].id, "DUPLICATE_ITEM");
            }
        }
    }

    function getItems(uint256 id, uint256 side) external view returns (Item[] memory) {
        require(side < 2, "INVALID_SIDE");
        return items[id][side];
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external nonReentrant whenNotPaused returns (bytes4)
    {
        (uint256 id, uint256 side, uint256 index) = _recordDeposit(operator, from, tokenId, 1, Standard.ERC721, data);
        require(reserved721[msg.sender][tokenId] == 0, "ALREADY_RESERVED");
        require(IERC721(msg.sender).ownerOf(tokenId) == address(this), "NOT_RECEIVED");
        reserved721[msg.sender][tokenId] = id;
        emit Deposited(id, side, index);
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address operator, address from, uint256 tokenId, uint256 amount, bytes calldata data)
        external nonReentrant whenNotPaused returns (bytes4)
    {
        (uint256 id, uint256 side, uint256 index) = _recordDeposit(operator, from, tokenId, amount, Standard.ERC1155, data);
        reserved1155[msg.sender][tokenId] += amount;
        require(IERC1155(msg.sender).balanceOf(address(this), tokenId) >= reserved1155[msg.sender][tokenId], "NOT_RECEIVED");
        emit Deposited(id, side, index);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function _recordDeposit(address operator, address from, uint256 tokenId, uint256 amount, Standard standard, bytes calldata data)
        private returns (uint256 id, uint256 side, uint256 index)
    {
        require(data.length == 96, "DEPOSIT_DATA_REQUIRED");
        (id, side, index) = abi.decode(data, (uint256, uint256, uint256));
        _pending(id);
        require(side < 2 && index < items[id][side].length, "INVALID_SLOT");
        Trade storage t = trades[id];
        require(block.timestamp <= t.expiresAt, "TRADE_EXPIRED");
        require(from == (side == 0 ? t.creator : t.counterparty) && operator == from, "OWNER_DIRECT_ONLY");
        require(!deposited[id][side][index], "ALREADY_DEPOSITED");
        Item storage item = items[id][side][index];
        require(msg.sender == item.token && tokenId == item.id && amount == item.amount && standard == item.standard, "WRONG_ASSET");
        deposited[id][side][index] = true;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external pure returns (bytes4)
    { revert("USE_SINGLE_DEPOSITS"); }

    /// @notice Counterparty explicitly confirms once all assets are deposited.
    /// All NFT transfers succeed together or the entire acceptance reverts.
    function acceptTrade(uint256 id) external payable nonReentrant whenNotPaused {
        _pending(id);
        Trade storage t = trades[id];
        require(msg.sender == t.counterparty, "COUNTERPARTY_ONLY");
        require(block.timestamp <= t.expiresAt, "TRADE_EXPIRED");
        uint256 fee = feeFor(msg.sender);
        require(msg.value == t.requestedETH + fee, "INCORRECT_ETH_VALUE");
        for (uint256 side; side < 2; ++side) {
            for (uint256 i; i < items[id][side].length; ++i) {
                require(deposited[id][side][i], "MISSING_DEPOSIT");
            }
        }
        t.status = Status.Accepted;
        _pullChog(msg.sender, t.requestedChog);
        _payOrCredit(t.creator, t.requestedETH);
        _payOrCredit(t.counterparty, t.offeredETH);
        _payChogOrCredit(t.creator, t.requestedChog);
        _payChogOrCredit(t.counterparty, t.offeredChog);
        _payOrCredit(feeCollector, fee);
        for (uint256 side; side < 2; ++side) {
            for (uint256 i; i < items[id][side].length; ++i) {
                _release(id, side, i, side == 0 ? t.counterparty : t.creator);
            }
        }
        emit Closed(id, Status.Accepted);
    }

    /// @notice Cancellation does not call NFT contracts, so one broken collection
    /// cannot block cancellation or refunds of the other deposited items.
    function cancelTrade(uint256 id) external nonReentrant {
        _pending(id);
        Trade storage t = trades[id];
        require(msg.sender == t.creator || msg.sender == t.counterparty, "PARTICIPANTS_ONLY");
        _close(id, msg.sender == t.creator ? Status.Cancelled : Status.Declined);
    }

    function expireTrade(uint256 id) external nonReentrant {
        _pending(id);
        require(block.timestamp > trades[id].expiresAt, "NOT_EXPIRED");
        _close(id, Status.Expired);
    }

    function _close(uint256 id, Status status) private {
        Trade storage t = trades[id];
        t.status = status;
        _payOrCredit(t.creator, t.offeredETH);
        _payChogOrCredit(t.creator, t.offeredChog);
        emit Closed(id, status);
    }

    /// @notice Depositors may choose a receiving wallet, useful if their original
    /// wallet rejects safe transfers. Only that side's depositor can claim.
    function refundNFT(uint256 id, uint256 side, uint256 index, address destination) external nonReentrant {
        Trade storage t = trades[id];
        require(t.creator != address(0) && side < 2, "INVALID_TRADE_OR_SIDE");
        if (t.status == Status.Pending && block.timestamp > t.expiresAt) _close(id, Status.Expired);
        require(t.status == Status.Cancelled || t.status == Status.Declined || t.status == Status.Expired, "NOT_REFUNDABLE");
        require(msg.sender == (side == 0 ? t.creator : t.counterparty), "DEPOSITOR_ONLY");
        require(destination != address(0) && destination != address(this), "INVALID_DESTINATION");
        require(index < items[id][side].length && deposited[id][side][index], "NOT_DEPOSITED");
        _release(id, side, index, destination);
        emit Refunded(id, side, index, destination);
    }

    /// @notice Refunds every NFT this caller deposited. Never touches the other side.
    function refundMySide(uint256 id, address destination) external nonReentrant {
        Trade storage t = trades[id];
        require(t.creator != address(0), "TRADE_NOT_FOUND");
        uint256 side = msg.sender == t.creator ? 0 : msg.sender == t.counterparty ? 1 : 2;
        require(side < 2, "DEPOSITOR_ONLY");
        if (t.status == Status.Pending && block.timestamp > t.expiresAt) _close(id, Status.Expired);
        require(t.status == Status.Cancelled || t.status == Status.Declined || t.status == Status.Expired, "NOT_REFUNDABLE");
        require(destination != address(0) && destination != address(this), "INVALID_DESTINATION");
        uint256 count = items[id][side].length;
        bool any;
        for (uint256 index; index < count; ++index) {
            if (!deposited[id][side][index]) continue;
            _release(id, side, index, destination);
            emit Refunded(id, side, index, destination);
            any = true;
        }
        require(any, "NOT_DEPOSITED");
    }

    function _release(uint256 id, uint256 side, uint256 index, address to) private {
        Item storage item = items[id][side][index];
        deposited[id][side][index] = false;
        if (item.standard == Standard.ERC721) {
            reserved721[item.token][item.id] = 0;
            IERC721(item.token).safeTransferFrom(address(this), to, item.id);
        } else {
            reserved1155[item.token][item.id] -= item.amount;
            IERC1155(item.token).safeTransferFrom(address(this), to, item.id, item.amount, "");
        }
    }

    function _pending(uint256 id) private view {
        require(trades[id].creator != address(0), "TRADE_NOT_FOUND");
        require(trades[id].status == Status.Pending, "NOT_PENDING");
    }

    function _credit(address account, uint256 amount) private {
        if (amount == 0) return;
        ethCredit[account] += amount;
        emit EthCredited(account, amount);
    }

    function _creditChog(address account, uint256 amount) private {
        if (amount == 0) return;
        chogCredit[account] += amount;
        emit ChogCredited(account, amount);
    }

    function _payOrCredit(address account, uint256 amount) private {
        if (amount == 0) return;
        (bool sent,) = payable(account).call{value: amount}("");
        if (!sent) _credit(account, amount);
    }

    function _payChogOrCredit(address account, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transfer.selector, account, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            _creditChog(account, amount);
        }
    }

    function _pullChog(address from, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "CHOG_PULL");
    }

    function withdrawChog(address destination) external nonReentrant {
        require(destination != address(0) && destination != address(this), "INVALID_DESTINATION");
        uint256 amount = chogCredit[msg.sender];
        require(amount > 0, "NO_CREDIT");
        chogCredit[msg.sender] = 0;
        (bool ok, bytes memory data) = CHOG.call(
            abi.encodeWithSelector(IERC20.transfer.selector, destination, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "CHOG_TRANSFER_FAILED");
        emit ChogWithdrawn(msg.sender, destination, amount);
    }

    function withdrawETH(address payable destination) external nonReentrant {
        require(destination != address(0) && destination != address(this), "INVALID_DESTINATION");
        uint256 amount = ethCredit[msg.sender];
        require(amount > 0, "NO_CREDIT");
        ethCredit[msg.sender] = 0;
        (bool ok,) = destination.call{value: amount}("");
        require(ok, "ETH_TRANSFER_FAILED");
        emit EthWithdrawn(msg.sender, destination, amount);
    }

    function setFeeExemptNfts(address chog, address eta) external onlyOwner {
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

    function setTradeFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_FEE, "FEE_TOO_HIGH");
        tradeFee = fee;
        emit FeeChanged(fee);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(IERC721Receiver).interfaceId || id == type(IERC1155Receiver).interfaceId;
    }
}
