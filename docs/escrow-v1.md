# EtaSwap direct-deposit escrow V1 — development candidate

Source: `contracts/EtaSwapEscrowV1.sol`. This is a separate contract and ABI.
The running application still uses V9; no existing offer or contract is migrated.
Do not send deposits to the existing V9 address. No mainnet deployment is included.

## Workflow

1. Creator calls `createTrade` with immutable NFT lists, ETH amounts, counterparty,
   and expiry duration (at most seven days). Value is offered ETH plus the current
   creation fee. Each side has at most eight entries. Fee is snapshotted for acceptance.
2. Each depositor calls their **NFT contract directly**, using
   `safeTransferFrom(owner, escrow, tokenId, data)` for ERC721, or
   `safeTransferFrom(owner, escrow, tokenId, amount, data)` for ERC1155.
   `data = abi.encode(uint256(tradeId), uint256(side), uint256(index))`;
   side 0 is creator/offered; side 1 is counterparty/requested.
   No operator approvals or escrow `transferFrom` deposit calls are used.
3. After every NFT is deposited, the counterparty calls `acceptTrade`, attaching
   requested ETH plus the offer's snapshotted fee. All NFT releases occur in one
   transaction. A failed release rolls back **all** releases and ETH credits.
4. ETH proceeds become `ethCredit`; recipients call `withdrawETH(destination)`.
   This explicit withdrawal requires another transaction/gas and must be visible in the UI.
5. Either participant can cancel a pending offer. Anyone can expire it after its
   deadline. Each depositor calls `refundNFT` for their deposited slots separately.
   Expired offers can be closed automatically during a refund. Offered ETH is
   credited back to the creator exactly once. Creation fees are not refunded;
   there is no platform cancellation/refund fee, but network gas still applies.

## Controls and limitations

- Exact collection, token ID, standard, quantity, original depositor, and slot matching.
- ERC721 reservations and aggregated ERC1155 custody accounting.
- No batch receiver callbacks, untagged safe sends, third-party deposits, or mint
  callbacks. Some ERC1155 contracts route one-item batches to the single hook;
  those are accepted only when the exact single slot matches.
- Pause stops creation, deposits, and settlement, but leaves cancellation,
  expiration, NFT refunds, and ETH withdrawals available.
- Two-step admin ownership; capped fees; immutable collector. Admin has no NFT
  seizure function, no credit withdrawal authority over users, and no upgrade hook.
- A receiver that rejects NFTs can block settlement but cannot prevent cancellation.
  Depositors can refund their own assets to an alternate receiving wallet.
- Any collection can later change its transfer policy, pause, upgrade, or behave
  maliciously. Escrow cannot override it; an affected NFT may remain stuck until
  the collection permits release. Other items and ETH can still be refunded.
- Arbitrary malicious tokens can lie about custody or transfers. Matching an asset
  address does not certify that a collection is legitimate. Keep collection links
  and compatibility checks visible; never present this as universal NFT support.
- Raw ERC721 `transferFrom` bypasses receiver callbacks and is unsupported. Such
  transfers are not assigned to offers and cannot be recovered by this contract.
  The UI must exclusively construct tagged safe transfers.
- Cancellation and acceptance race by normal transaction ordering: whichever
  executes first closes the offer; the other reverts. Deposits never auto-accept.
- Live transfer-policy simulations alone are not enough. Verify deposit, release,
  cancellation, and refund on a local fork for supported collections.

## Verification

Local suite (no real assets):

```sh
npx hardhat test test/EtaSwapEscrowV1.test.js --network hardhat
```

Optional actual-collection fork tests (public RPC reads, **all writes local**):

```sh
RUN_ESCROW_FORK=1 npx hardhat test test/EtaSwapEscrowV1.fork.test.js --network hardhat
```

The fork tests cover melo #1237 and Hood Andy #78 against their deployed NFT and
validator code. They impersonate owners only inside Hardhat's in-memory fork.
Results depend on current chain state and the RPC supporting historical reads.

Observed on 2026-09-19: both actual-collection fork scenarios passed, including
NFT-for-NFT settlement and cancellation/refund. This is a development test result,
not an independent security audit or a guarantee of future collection policies.

Before real deposits: independent contract review, testnet exercise, a new escrow
UI with per-item deposit/refund progress and ETH claims, wallet chain/address
checks, and compatibility simulations for each collection. Do not swap the V9
ABI/address in place: existing offers continue to use their original contract.
