import { ethers } from 'ethers';
import EscrowArtifact from '@/lib/abis/EtaSwapEscrowV1.json';
import { ESCROW_DURATION_SECONDS, getEscrowAddress, isAllowedEscrowContract, loadEscrowAddress } from '@/lib/escrow';
import { runtimeChain } from '@/lib/networkPref';

function escrowReadProvider() {
  const chain = runtimeChain();
  return new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], chain.id, { staticNetwork: true });
}
import { friendlyTradeError, isWalletRejected } from '@/lib/tradeErrors';
import { contractFeeFor, walletClientToSigner } from '@/services/blockchain';

export type EscrowNft = {
  contractAddress: string;
  tokenId: string;
  amount?: string;
  standard: number;
};

const ERC721_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
];
const ERC1155_ABI = [
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
];

function requireEscrowAddress(override?: string) {
  const address = override || getEscrowAddress();
  if (!isAllowedEscrowContract(address)) {
    throw new Error(
      getEscrowAddress()
        ? 'This offer is not on the live escrow contract.'
        : 'Escrow is not published yet on this chain.'
    );
  }
  return address;
}

function escrowContract(signer: ethers.Signer, address?: string) {
  return new ethers.Contract(requireEscrowAddress(address), EscrowArtifact.abi, signer);
}

function toItems(nfts: EscrowNft[]) {
  return nfts.map((nft) => ({
    token: nft.contractAddress,
    id: nft.tokenId,
    amount: nft.amount || '1',
    standard: nft.standard === 1 ? 1 : 0,
  }));
}

function encodeDeposit(tradeId: string | number, side: 0 | 1, index: number) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'uint256'],
    [tradeId, side, index]
  );
}

const erc721Iface = new ethers.Interface(ERC721_ABI);
const erc1155Iface = new ethers.Interface(ERC1155_ABI);

function depositCall(
  from: string,
  escrowAddr: string,
  item: { token: string; id: any; amount?: any; standard: any },
  data: string
) {
  if (Number(item.standard) === 1) {
    return {
      to: item.token,
      data: erc1155Iface.encodeFunctionData('safeTransferFrom', [
        from,
        escrowAddr,
        item.id,
        item.amount || 1,
        data,
      ]),
    };
  }
  return {
    to: item.token,
    data: erc721Iface.encodeFunctionData('safeTransferFrom', [from, escrowAddr, item.id, data]),
  };
}

function chainIdHex(value: number) {
  return `0x${value.toString(16)}`;
}

async function walletCanBatch(walletClient: any, from: string) {
  if (!walletClient?.request) return false;
  try {
    const chainId = Number(walletClient.chain?.id ?? (await walletClient.getChainId?.()) ?? 0);
    let caps: any;
    try {
      caps = await walletClient.request({
        method: 'wallet_getCapabilities',
        params: [from, [chainIdHex(chainId)]],
      });
    } catch {
      caps = await walletClient.request({
        method: 'wallet_getCapabilities',
        params: [from],
      });
    }
    const forChain =
      caps?.[chainIdHex(chainId)] ||
      caps?.[chainId] ||
      caps?.[String(chainId)] ||
      caps;
    const atomic = forChain?.atomic?.status || forChain?.atomic;
    return atomic === 'supported' || atomic === 'ready';
  } catch {
    return false;
  }
}

async function sendAtomicCalls(
  walletClient: any,
  from: string,
  calls: Array<{ to: string; data: string; value?: bigint }>
) {
  const chainId = Number(walletClient.chain?.id ?? (await walletClient.getChainId?.()) ?? 0);
  const formatted = calls.map((call) => ({
    to: call.to,
    data: call.data,
    value: call.value != null ? ethers.toBeHex(call.value) : '0x0',
  }));
  const result = await walletClient.request({
    method: 'wallet_sendCalls',
    params: [
      {
        version: '2.0.0',
        from,
        chainId: chainIdHex(chainId),
        atomicRequired: true,
        calls: formatted,
      },
    ],
  });
  const id = typeof result === 'string' ? result : result?.id || result?.batchId;
  if (!id) return;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const status = await walletClient.request({
        method: 'wallet_getCallsStatus',
        params: [id],
      });
      const code = Number(status?.status ?? status);
      if (code === 200 || status?.status === 'CONFIRMED' || status?.status === 'confirmed') return;
      if (code === 400 || code === 500 || status?.status === 'FAILED' || status?.status === 'failed') return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

async function undepositedIndexes(
  contract: ethers.Contract,
  tradeId: string,
  side: 0 | 1,
  items: Array<{ token: string; id: bigint; amount: bigint; standard: number }>
) {
  const pending: number[] = [];
  for (let index = 0; index < items.length; index++) {
    if (!(await contract.deposited(tradeId, side, index))) pending.push(index);
  }
  return pending;
}

async function sendOneDeposit(
  signer: ethers.Signer,
  from: string,
  escrowAddr: string,
  item: { token: string; id: bigint; amount: bigint; standard: number },
  tradeId: string,
  side: 0 | 1,
  index: number
) {
  const data = encodeDeposit(tradeId, side, index);
  if (Number(item.standard) === 0) {
    const nft = new ethers.Contract(item.token, ERC721_ABI, signer);
    const tx = await nft.getFunction('safeTransferFrom(address,address,uint256,bytes)')(
      from,
      escrowAddr,
      item.id,
      data
    );
    await tx.wait();
    return;
  }
  const nft = new ethers.Contract(item.token, ERC1155_ABI, signer);
  const tx = await nft.getFunction('safeTransferFrom(address,address,uint256,uint256,bytes)')(
    from,
    escrowAddr,
    item.id,
    item.amount,
    data
  );
  await tx.wait();
}

export async function depositEscrowSide(
  tradeId: string,
  side: 0 | 1,
  walletClient: any,
  progress?: (message: string) => void,
  tradeContract?: string
) {
  const signer = await walletClientToSigner(walletClient);
  const from = await signer.getAddress();
  const contract = escrowContract(signer, tradeContract);
  const items: Array<{ token: string; id: bigint; amount: bigint; standard: number }> =
    await contract.getItems(tradeId, side);
  const escrowAddr = await contract.getAddress();
  let pending = await undepositedIndexes(contract, tradeId, side, items);
  if (!pending.length) return;

  if (pending.length > 1 && (await walletCanBatch(walletClient, from))) {
    progress?.(`Confirm once to send your ${pending.length} NFTs into escrow…`);
    try {
      await sendAtomicCalls(
        walletClient,
        from,
        pending.map((index) =>
          depositCall(from, escrowAddr, items[index], encodeDeposit(tradeId, side, index))
        )
      );
    } catch {
      /* wallet rejected or cannot batch — fall through */
    }
    const waitUntil = Date.now() + 12_000;
    while (Date.now() < waitUntil) {
      pending = await undepositedIndexes(contract, tradeId, side, items);
      if (!pending.length) return;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    pending = await undepositedIndexes(contract, tradeId, side, items);
    if (!pending.length) return;
  }

  for (const index of pending) {
    progress?.(
      items.length === 1
        ? 'Confirm to send your NFT into escrow…'
        : `Confirm NFT ${index + 1} of ${items.length} into escrow…`
    );
    await sendOneDeposit(signer, from, escrowAddr, items[index], tradeId, side, index);
  }
}

export async function preflightOwnerDeposits(from: string, nfts: EscrowNft[]) {
  const { assertTokensCanMove } = await import('@/lib/transferPolicy');
  await assertTokensCanMove(
    nfts.map((nft) => ({
      contractAddress: nft.contractAddress,
      tokenId: String(nft.tokenId),
      owner: from,
      standard: nft.standard,
    }))
  );
}

export async function createEscrowTrade(
  params: {
    counterpartyAddress: string;
    userNFTs: EscrowNft[];
    counterpartyNFTs: EscrowNft[];
    userMonadAmount: string;
    counterpartyMonadAmount: string;
    userChogAmount?: string;
    counterpartyChogAmount?: string;
    durationSeconds?: number;
  },
  walletClient: any,
  progress?: (message: string) => void
): Promise<string> {
  const signer = await walletClientToSigner(walletClient);
  const from = await signer.getAddress();
  if (params.userNFTs.length) {
    progress?.('Checking whether these NFTs can move into escrow…');
    await preflightOwnerDeposits(from, params.userNFTs);
  }
  const contract = escrowContract(signer);
  const offeredETH = ethers.parseEther(params.userMonadAmount || '0');
  const requestedETH = ethers.parseEther(params.counterpartyMonadAmount || '0');
  const { parseChog } = await import('@/lib/chog');
  const { ensureChogApproved } = await import('@/services/blockchain');
  const offeredChog = parseChog(params.userChogAmount);
  const requestedChog = parseChog(params.counterpartyChogAmount);
  if (offeredChog > 0n) {
    progress?.('Approve CHOG for this escrow offer…');
    await ensureChogApproved(offeredChog, getEscrowAddress(), walletClient);
  }
  const fee = await contractFeeFor(contract, from);
  const { clampOfferDuration } = await import('@/lib/offerExpiry');
  const duration = clampOfferDuration(params.durationSeconds || ESCROW_DURATION_SECONDS);
  progress?.('Create the escrow offer in your wallet…');
  const tx = await contract.createTrade(
    params.counterpartyAddress,
    toItems(params.userNFTs),
    toItems(params.counterpartyNFTs),
    offeredETH,
    requestedETH,
    offeredChog,
    requestedChog,
    duration,
    { value: offeredETH + fee }
  );
  progress?.('Please wait. Your offer is confirming on-chain…');
  const receipt = await tx.wait();
  progress?.('Please wait. Creating your trade link…');
  const created = receipt.logs
    .map((log: any) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === 'Created');
  const tradeId = created?.args?.[0]?.toString();
  if (!tradeId) throw new Error('Escrow offer was created, but no trade id was returned.');
  rememberEscrowTradeId(await signer.getAddress(), tradeId);
  try {
    await depositEscrowSide(tradeId, 0, walletClient, progress);
  } catch (error: any) {
    error.escrowTradeId = tradeId;
    error.message = `Offer did not go through. Claim any NFT that already went into escrow. ${friendlyTradeError(error)}`;
    throw error;
  }
  const stillMissing = await pendingDepositCount(contract, tradeId, 0);
  if (stillMissing > 0) {
    const error: any = new Error('Offer did not go through. Not every NFT reached escrow.');
    error.escrowTradeId = tradeId;
    throw error;
  }
  return tradeId;
}

function escrowStatusFromNum(statusNum: number, expiresAtMs = 0) {
  if (statusNum === 1) return 'accepted' as const;
  if (statusNum === 2) return 'cancelled' as const;
  if (statusNum === 4) return 'declined' as const;
  if (statusNum === 3 || (statusNum === 0 && expiresAtMs && Date.now() > expiresAtMs)) {
    return 'expired' as const;
  }
  return 'pending' as const;
}

function acceptBlockedByStatus(status: ReturnType<typeof escrowStatusFromNum>) {
  if (status === 'cancelled') {
    return 'They cancelled this offer. It is closed, so you cannot accept.';
  }
  if (status === 'declined') {
    return 'This offer was declined. It is closed, so you cannot accept.';
  }
  if (status === 'expired') {
    return 'This offer expired. It is closed, so you cannot accept.';
  }
  if (status === 'accepted') {
    return 'This offer already settled.';
  }
  return null;
}

export async function acceptEscrowTrade(
  tradeId: string,
  walletClient: any,
  progress?: (message: string) => void,
  tradeContract?: string
) {
  const signer = await walletClientToSigner(walletClient);
  const contract = escrowContract(signer, tradeContract);
  const live = await contract.trades(tradeId);
  const expiresAtMs = Number(live.expiresAt ?? live[5] ?? 0) * 1000;
  const blocked = acceptBlockedByStatus(escrowStatusFromNum(Number(live.status ?? live[6]), expiresAtMs));
  if (blocked) throw new Error(blocked);
  const theirMissing = await pendingDepositCount(contract, tradeId, 0);
  if (theirMissing > 0) {
    const closedNow = acceptBlockedByStatus(
      escrowStatusFromNum(Number((await contract.trades(tradeId)).status ?? 0), expiresAtMs)
    );
    if (closedNow) throw new Error(closedNow);
    const yourMissing = await pendingDepositCount(contract, tradeId, 1);
    const yourTotal = (await contract.getItems(tradeId, 1)).length;
    if (yourTotal - yourMissing > 0) {
      throw new Error(
        'Your NFT is in escrow, but they have not finished their side. Wait, or Decline to get yours back.'
      );
    }
    throw new Error(
      'Their NFTs are not in escrow for this offer. If they cancelled, this link is closed.'
    );
  }
  const afterMissing = acceptBlockedByStatus(
    escrowStatusFromNum(Number((await contract.trades(tradeId)).status ?? 0), expiresAtMs)
  );
  if (afterMissing) throw new Error(afterMissing);
  await depositEscrowSide(tradeId, 1, walletClient, progress, tradeContract);
  const closedAfterDeposit = acceptBlockedByStatus(
    escrowStatusFromNum(Number((await contract.trades(tradeId)).status ?? 0), expiresAtMs)
  );
  if (closedAfterDeposit) throw new Error(closedAfterDeposit);
  const stillMissingYours = await pendingDepositCount(contract, tradeId, 1);
  if (stillMissingYours > 0) {
    throw new Error(
      'Confirm the rest in your wallet, then tap Accept again.'
    );
  }
  const liveNow = await contract.trades(tradeId);
  const closedBeforeSettle = acceptBlockedByStatus(
    escrowStatusFromNum(Number(liveNow.status ?? liveNow[6]), expiresAtMs)
  );
  if (closedBeforeSettle) throw new Error(closedBeforeSettle);
  const requestedETH = BigInt(liveNow.requestedETH ?? liveNow[3]);
  const requestedChog = BigInt(liveNow.requestedChog ?? 0);
  const you = await signer.getAddress();
  const fee = await contractFeeFor(contract, you);
  if (requestedChog > 0n) {
    const { ensureChogApproved } = await import('@/services/blockchain');
    progress?.('Approve CHOG for this accept…');
    await ensureChogApproved(requestedChog, requireEscrowAddress(tradeContract), walletClient);
  }
  progress?.('Confirm accept. Escrow will send both sides.');
  const tx = await contract.acceptTrade(tradeId, { value: requestedETH + fee });
  const receipt = await tx.wait();
  return receipt.hash as string;
}

function escrowSideFor(you: string, trade: any): 0 | 1 | null {
  const creator = String(trade.creator ?? trade[0]).toLowerCase();
  const counterparty = String(trade.counterparty ?? trade[1]).toLowerCase();
  if (you === creator) return 0;
  if (you === counterparty) return 1;
  return null;
}

async function myHeldDepositIndexes(
  contract: ethers.Contract,
  tradeId: string,
  side: 0 | 1
) {
  const escrowAddr = (await contract.getAddress()).toLowerCase();
  const items = await contract.getItems(tradeId, side);
  const flags = await Promise.all(
    items.map((_, index) => contract.deposited(tradeId, side, index))
  );
  const checks = await Promise.all(
    items.map(async (item, index) => {
      if (!flags[index]) return -1;
      const token = String(item.token ?? item[0] ?? '');
      const tokenId = item.id ?? item[1];
      const standard = Number(item.standard ?? item[3] ?? 0);
      if (standard === 0 && token) {
        try {
          const nft = new ethers.Contract(
            token,
            ['function ownerOf(uint256) view returns (address)'],
            contract.runner
          );
          const owner = String(await nft.ownerOf(tokenId)).toLowerCase();
          if (owner !== escrowAddr) return -1;
        } catch {
          // deposited=true is enough if ownerOf is flaky
        }
      }
      return index;
    })
  );
  return checks.filter((index) => index >= 0);
}

async function pendingDepositCount(
  contract: ethers.Contract,
  tradeId: string,
  side: 0 | 1
) {
  const items = await contract.getItems(tradeId, side);
  let pending = 0;
  for (let index = 0; index < items.length; index++) {
    if (!(await contract.deposited(tradeId, side, index))) pending += 1;
  }
  return pending;
}

async function refundMyDeposits(
  contract: ethers.Contract,
  tradeId: string,
  side: 0 | 1,
  you: string,
  progress?: (message: string) => void
) {
  const mine = await myHeldDepositIndexes(contract, tradeId, side);
  if (!mine.length) return '';
  let lastHash = '';
  let claimed = 0;
  for (const [i, index] of mine.entries()) {
    progress?.(
      mine.length === 1
        ? 'Confirm once to get your NFT back…'
        : `Confirm ${i + 1} of ${mine.length} for your NFTs only…`
    );
    try {
      const tx = await contract.refundNFT(tradeId, side, index, you);
      const receipt = await tx.wait();
      lastHash = receipt.hash;
      claimed += 1;
    } catch (error: any) {
      error.claimedNfts = claimed;
      error.remainingNfts = mine.length - claimed;
      throw error;
    }
  }
  return lastHash;
}

export type EscrowClaimHint = {
  blockchainTradeId: string;
  tradeContract: string;
  count: number;
  nfts?: Array<{ token: string; tokenId: string }>;
};

function claimCacheKey(wallet: string) {
  return `etaswap-escrow-claim-rows:${wallet.toLowerCase()}`;
}

function hintIdsKey(wallet: string) {
  return `etaswap-escrow-trade-ids:${(getEscrowAddress() || '').toLowerCase()}:${wallet.toLowerCase()}`;
}

function readHintIds(wallet: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(hintIdsKey(wallet)) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeHintIds(wallet: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(hintIdsKey(wallet), JSON.stringify([...new Set(ids)].slice(-100)));
}

export function rememberEscrowTradeId(wallet: string, tradeId: string) {
  if (!wallet || !tradeId) return;
  writeHintIds(wallet, [...readHintIds(wallet), String(tradeId)]);
}

export function readCachedEscrowClaims(wallet: string): EscrowClaimHint[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(claimCacheKey(wallet)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row?.blockchainTradeId && Number(row.count) > 0);
  } catch {
    return [];
  }
}

function writeCachedEscrowClaims(wallet: string, rows: EscrowClaimHint[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(claimCacheKey(wallet), JSON.stringify(rows));
}

function ethCacheKey(wallet: string) {
  return `etaswap-escrow-eth:${wallet.toLowerCase()}`;
}

function readCachedEscrowEth(wallet: string): bigint | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ethCacheKey(wallet));
    if (raw == null || raw === '') return null;
    return BigInt(raw);
  } catch {
    return null;
  }
}

function writeCachedEscrowEth(wallet: string, amount: bigint) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ethCacheKey(wallet), amount.toString());
}

export function knownEscrowHintIds(wallet: string): string[] {
  return readHintIds(wallet);
}

async function claimsOnContract(
  escrowAddr: string,
  walletAddress: string,
  extraIds: string[] = [],
  contract = new ethers.Contract(escrowAddr, EscrowArtifact.abi, escrowReadProvider())
): Promise<EscrowClaimHint[]> {
  const you = walletAddress.toLowerCase();
  const next = Number(await contract.nextTradeId());
  const ids = new Set([...readHintIds(you), ...extraIds.map(String)]);
  for (let id = Math.max(1, next - 40); id < next; id += 1) ids.add(String(id));
  const partyIds: string[] = [];
  const idList = [...ids];
  const rows: Array<EscrowClaimHint | null> = [];
  for (let i = 0; i < idList.length; i += 16) {
    const chunk = idList.slice(i, i + 16);
    rows.push(
      ...(await Promise.all(
        chunk.map(async (tradeId) => {
          try {
            const trade = await contract.trades(tradeId);
            const side = escrowSideFor(you, trade);
            if (side === null) return null;
            partyIds.push(tradeId);
            const items = await contract.getItems(tradeId, side);
            const flags = await Promise.all(
              items.map((_, index) => contract.deposited(tradeId, side, index))
            );
            const nfts = items
              .map((item, index) =>
                flags[index]
                  ? {
                      token: String(item.token ?? item[0] ?? ''),
                      tokenId: String(item.id ?? item[1] ?? ''),
                    }
                  : null
              )
              .filter(Boolean) as Array<{ token: string; tokenId: string }>;
            return { blockchainTradeId: tradeId, tradeContract: escrowAddr, count: nfts.length, nfts };
          } catch {
            return { blockchainTradeId: tradeId, tradeContract: escrowAddr, count: -1 };
          }
        })
      ))
    );
  }
  writeHintIds(you, [...readHintIds(you), ...partyIds]);
  return rows.filter(Boolean) as EscrowClaimHint[];
}

export async function readEscrowClaimSnapshot(
  walletAddress: string,
  extraIds: string[] = []
): Promise<{
  claims: EscrowClaimHint[];
  ethCredit: bigint;
  chogCredit: bigint;
  complete: boolean;
  ethVerified: boolean;
  seenIds: string[];
}> {
  await loadEscrowAddress();
  const you = walletAddress.toLowerCase();
  const escrowAddr = getEscrowAddress();
  if (!escrowAddr || !you) {
    return { claims: [], ethCredit: 0n, chogCredit: 0n, complete: true, ethVerified: true, seenIds: [] };
  }

  const byKey = new Map<string, EscrowClaimHint>();
  const unread = new Set<string>();
  const seen = new Set<string>();
  let ethCredit = 0n;
  let chogCredit = 0n;
  let ethVerified = false;
  let scanned = false;
  const provider = escrowReadProvider();
  const contract = new ethers.Contract(escrowAddr, EscrowArtifact.abi, provider);
  try {
    ethCredit = BigInt(await contract.ethCredit(walletAddress));
    ethVerified = true;
  } catch {
    ethVerified = false;
  }
  try {
    chogCredit = BigInt(await contract.chogCredit(walletAddress));
  } catch {
    chogCredit = 0n;
  }
  try {
    const rows = await claimsOnContract(escrowAddr, you, extraIds, contract);
    scanned = true;
    for (const row of rows) {
      const key = `${row.tradeContract.toLowerCase()}:${row.blockchainTradeId}`;
      if (row.count < 0) {
        unread.add(key);
        continue;
      }
      seen.add(key);
      if (row.count > 0) byKey.set(key, row);
    }
  } catch {
    scanned = false;
  }

  for (const row of readCachedEscrowClaims(you)) {
    const key = `${row.tradeContract.toLowerCase()}:${row.blockchainTradeId}`;
    if (unread.has(key) || !seen.has(key)) {
      if (row.count > 0) byKey.set(key, row);
    }
  }

  const claims = [...byKey.values()];
  const complete = scanned && unread.size === 0;
  if (complete) writeCachedEscrowClaims(you, claims);
  return { claims, ethCredit, chogCredit, complete, ethVerified, seenIds: [...seen] };
}

export async function loadEscrowClaimSnapshot(walletAddress: string): Promise<{
  claims: EscrowClaimHint[];
  ethCredit: bigint;
  chogCredit: bigint;
  live: boolean;
  reached: boolean;
}> {
  const you = walletAddress.toLowerCase();
  const cached = () => ({
    claims: readCachedEscrowClaims(you),
    ethCredit: readCachedEscrowEth(you) ?? 0n,
    chogCredit: 0n,
    live: false,
    reached: false,
  });
  if (typeof window !== 'undefined') {
    const hints = knownEscrowHintIds(you);
    const qs = new URLSearchParams({ wallet: you });
    if (hints.length) qs.set('ids', hints.join(','));
    let res: Response;
    try {
      res = await fetch(`/api/escrow-claims?${qs}`, {
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      return cached();
    }
    if (!res.ok) return cached();
    const data = (await res.json()) as {
      claims?: EscrowClaimHint[];
      ethCredit?: string;
      chogCredit?: string;
      complete?: boolean;
      ethVerified?: boolean;
      seenIds?: string[];
    };
    const incoming = (data.claims || []).filter((row) => row?.count > 0);
    const seen = new Set((data.seenIds || []).map((id) => id.toLowerCase()));
    const claims = [
      ...incoming,
      ...readCachedEscrowClaims(you).filter((row) => {
        const key = `${row.tradeContract.toLowerCase()}:${row.blockchainTradeId}`;
        if (incoming.some((item) => `${item.tradeContract.toLowerCase()}:${item.blockchainTradeId}` === key)) {
          return false;
        }
        return !seen.has(key);
      }),
    ];
    writeCachedEscrowClaims(you, claims);
    let ethCredit = BigInt(data.ethCredit || '0');
    if (data.ethVerified === false) {
      ethCredit = readCachedEscrowEth(you) ?? ethCredit;
    } else {
      writeCachedEscrowEth(you, ethCredit);
    }
    return {
      claims,
      ethCredit,
      chogCredit: BigInt(data.chogCredit || '0'),
      live: data.complete === true && data.ethVerified === true,
      reached: true,
    };
  }
  const snapshot = await readEscrowClaimSnapshot(walletAddress);
  return {
    claims: snapshot.claims,
    ethCredit: snapshot.ethCredit,
    chogCredit: snapshot.chogCredit,
    live: snapshot.complete && snapshot.ethVerified,
    reached: true,
  };
}

export async function listHeldEscrowClaims(walletAddress: string): Promise<EscrowClaimHint[]> {
  return (await loadEscrowClaimSnapshot(walletAddress)).claims;
}

export async function getEscrowEthCredit(walletAddress: string): Promise<bigint> {
  try {
    return (await loadEscrowClaimSnapshot(walletAddress)).ethCredit;
  } catch {
    return 0n;
  }
}

export async function cancelEscrowTrade(
  tradeId: string,
  walletClient: any,
  progress?: (message: string) => void,
  tradeContract?: string
) {
  const signer = await walletClientToSigner(walletClient);
  const you = (await signer.getAddress()).toLowerCase();
  const contract = escrowContract(signer, tradeContract);
  const trade = await contract.trades(tradeId);
  const status = Number(trade.status ?? trade[6]);
  const expiresAt = Number(trade.expiresAt ?? trade[5] ?? 0) * 1000;
  const expiredPending = status === 0 && expiresAt && Date.now() > expiresAt;
  if (status === 0 && expiredPending) {
    progress?.('Offer expired. Confirm to close it and free any ETH…');
    const tx = await contract.expireTrade(tradeId);
    await tx.wait();
  } else if (status === 0 && !expiredPending) {
    progress?.('Offer is still open. Confirm cancel, then each NFT comes back…');
    const tx = await contract.cancelTrade(tradeId);
    await tx.wait();
  }
  const side = escrowSideFor(you, trade);
  if (side === null) return '';
  return refundMyDeposits(contract, tradeId, side, you, progress);
}

export async function getEscrowClaimState(
  tradeId: string,
  walletAddress: string,
  tradeContract?: string
) {
  const provider = escrowReadProvider();
  const address = requireEscrowAddress(tradeContract);
  const contract = new ethers.Contract(address, EscrowArtifact.abi, provider);
  const you = walletAddress.toLowerCase();
  const trade = await contract.trades(tradeId);
  const side = escrowSideFor(you, trade);
  const eth = BigInt(await contract.ethCredit(you));
  let chog = 0n;
  try {
    chog = BigInt(await contract.chogCredit(you));
  } catch {
    chog = 0n;
  }
  const status = Number(trade.status ?? trade[6]);
  const expiresAt = Number(trade.expiresAt ?? trade[5] ?? 0) * 1000;
  const expiredPending = status === 0 && expiresAt && Date.now() > expiresAt;
  const refundable = expiredPending || status === 2 || status === 3 || status === 4;
  const onChainStatus = escrowStatusFromNum(status, expiresAt);
  const creatorMissing =
    status === 0 && !expiredPending ? await pendingDepositCount(contract, tradeId, 0) : 0;
  if (side === null) {
    return {
      nftCount: 0,
      pendingDeposits: 0,
      heldKeys: [] as string[],
      eth,
      canClaim: false,
      canFinishDeposit: false,
      canWithdrawEth: eth > 0n,
      canWithdrawChog: chog > 0n,
      chog,
      creatorMissing,
      onChainStatus,
    };
  }
  const mine = await myHeldDepositIndexes(contract, tradeId, side);
  const pendingDeposits = status === 0 && !expiredPending ? await pendingDepositCount(contract, tradeId, side) : 0;
  const items = await contract.getItems(tradeId, side);
  const heldKeys = mine.map((index) => {
    const item = items[index];
    const token = String(item.token ?? item[0] ?? '').toLowerCase();
    const tokenId = String(item.id ?? item[1] ?? '');
    return `${token}-${tokenId}`;
  });
  return {
    nftCount: mine.length,
    pendingDeposits,
    heldKeys,
    eth,
    canClaim: (refundable || status === 0) && mine.length > 0,
    canFinishDeposit:
      pendingDeposits > 0 &&
      status === 0 &&
      !expiredPending &&
      (side === 0 || creatorMissing === 0),
    canWithdrawEth: eth > 0n,
    canWithdrawChog: chog > 0n,
    chog,
    creatorMissing,
    onChainStatus,
  };
}

export async function expireAndRefundEscrow(
  tradeId: string,
  walletClient: any,
  progress?: (message: string) => void,
  tradeContract?: string
) {
  return cancelEscrowTrade(tradeId, walletClient, progress, tradeContract);
}

export async function claimEscrowRefunds(
  tradeId: string,
  walletClient: any,
  progress?: (message: string) => void,
  tradeContract?: string
) {
  return cancelEscrowTrade(tradeId, walletClient, progress, tradeContract);
}

export async function withdrawEscrowEth(walletClient: any, tradeContract?: string) {
  const signer = await walletClientToSigner(walletClient);
  const you = await signer.getAddress();
  const contract = escrowContract(signer, tradeContract);
  const credit = await contract.ethCredit(you);
  if (credit === BigInt(0)) return '';
  const tx = await contract.withdrawETH(you);
  const receipt = await tx.wait();
  return receipt.hash as string;
}

export async function withdrawEscrowChog(walletClient: any, tradeContract?: string) {
  const signer = await walletClientToSigner(walletClient);
  const you = await signer.getAddress();
  const contract = escrowContract(signer, tradeContract);
  let credit = 0n;
  try {
    credit = BigInt(await contract.chogCredit(you));
  } catch {
    return '';
  }
  if (credit === 0n) return '';
  const tx = await contract.withdrawChog(you);
  const receipt = await tx.wait();
  return receipt.hash as string;
}

export async function getEscrowOnChainTrade(tradeId: string, tradeContract?: string) {
  const provider = escrowReadProvider();
  const address = requireEscrowAddress(tradeContract);
  const contract = new ethers.Contract(address, EscrowArtifact.abi, provider);
  const trade = await contract.trades(tradeId);
  const creator = String(trade.creator ?? trade[0] ?? '');
  if (!creator || creator === ethers.ZeroAddress) return null;
  const statusNum = Number(trade.status ?? trade[6]);
  const expiresAtMs = Number(trade.expiresAt ?? trade[5] ?? 0) * 1000;
  let status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'incomplete' =
    escrowStatusFromNum(statusNum, expiresAtMs);
  if (status === 'pending') {
    const creatorMissing = await pendingDepositCount(contract, tradeId, 0);
    if (creatorMissing > 0) status = 'incomplete';
  }
  const offered = await contract.getItems(tradeId, 0);
  const requested = await contract.getItems(tradeId, 1);
  const mapItems = (list: any[]) =>
    list.map((item) => ({
      contract: item.token || item[0],
      tokenId: (item.id ?? item[1]).toString(),
      amount: (item.amount ?? item[2]).toString(),
      standard: Number(item.standard ?? item[3]) === 1 ? 'ERC1155' : 'ERC721',
    }));
  return {
    id: `${address.toLowerCase()}-${tradeId}`,
    from: creator,
    to: String(trade.counterparty ?? trade[1]),
    offer: mapItems(offered),
    requested: mapItems(requested),
    offeredMonad: ethers.formatEther(trade.offeredETH ?? trade[2] ?? BigInt(0)),
    requestedMonad: ethers.formatEther(trade.requestedETH ?? trade[3] ?? BigInt(0)),
    offeredChog: ethers.formatEther(trade.offeredChog ?? BigInt(0)),
    requestedChog: ethers.formatEther(trade.requestedChog ?? BigInt(0)),
    status,
    blockchainTradeId: String(tradeId),
    tradeContract: address,
    tradeType: 'escrow-program' as const,
    createdAt: undefined,
    expiresAt: expiresAtMs ? new Date(expiresAtMs) : undefined,
  };
}

export function explainEscrowError(error: unknown) {
  const text = [
    (error as { shortMessage?: string })?.shortMessage,
    (error as { reason?: string })?.reason,
    (error as { message?: string })?.message,
    (error as { code?: string })?.code,
  ]
    .filter(Boolean)
    .join(' ');
  if (isWalletRejected(error)) {
    return 'You closed a wallet confirm. NFTs you already claimed are back. Tap Claim for the rest.';
  }
  if (/NOT_REFUNDABLE/i.test(text)) {
    return 'The offer is still open, so escrow cannot send NFTs back yet. Confirm cancel, then claim again.';
  }
  if (/NOT_DEPOSITED/i.test(text)) {
    return 'That NFT is not in escrow for this wallet.';
  }
  if (/DEPOSITOR_ONLY|PARTICIPANTS_ONLY/i.test(text)) {
    return 'Switch to the wallet that sent this NFT into escrow.';
  }
  if (/missing revert data|CALL_EXCEPTION/i.test(text)) {
    return 'Escrow could not return that NFT. If the offer is still open, confirm cancel first, then claim each NFT.';
  }
  return friendlyTradeError(error);
}
