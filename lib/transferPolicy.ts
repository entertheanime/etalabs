import { createPublicClient, http, parseAbi } from 'viem';
import { ACTIVE_CHAIN, RPC_URL } from './chain';
import { getKnownTradeContractAddresses, getTradeContractAddress } from './contracts';

export type OperatorSend = 'open' | 'blocked' | 'unknown';

export type CollectionSendCheck = {
  contractAddress: string;
  tokenId?: string;
  name?: string;
  operatorSend: OperatorSend;
};

export type ProbeItem = {
  contractAddress?: string;
  collectionId?: string;
  tokenId?: string | number;
  collectionName?: string;
  name?: string;
  owner?: string;
  recipient?: string;
  standard?: string;
};

const client = createPublicClient({
  chain: ACTIVE_CHAIN as any,
  transport: http(RPC_URL),
});

const PROBE_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function OPERATOR_FILTER_REGISTRY() view returns (address)',
  'function isOperatorAllowed(address operator) view returns (bool)',
  'function getTransferValidator() view returns (address)',
]);

const REGISTRY_ABI = parseAbi([
  'function isOperatorAllowed(address registrant, address operator) view returns (bool)',
]);

const ZERO = '0x0000000000000000000000000000000000000000';
const SINK = '0x0000000000000000000000000000000000000001';

const BLOCKED_RE =
  /unauthorizedtransfer|1de5204e|8435809d|39646e1a|temporaryfriendlocked|friend.?locked|operator.?filter|operator.?not.?allowed|not.?allowed.?operator|filtered.?operator|transfer.?restricted|enforcement|transfervalidator|creator.?fee|soulbound|non.?transferable|transfer.?locked|temporarily.?locked/i;
const VANILLA_RE =
  /erc721insufficientapproval|erc721incorrectowner|erc721invalidapprover|erc721invalidoperator|erc721invalidsender|not approved|not token owner|caller is not owner nor approved|insufficient approval/i;
const NETWORK_RE = /timeout|timed out|fetch failed|http request|econnreset|network/i;

type CacheRow = { result: OperatorSend; at: number };
const cache = new Map<string, CacheRow>();
const CACHE_MS = 20_000;

function asAddress(value?: string): `0x${string}` | null {
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : null;
}

function errText(err: unknown) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const anyErr = err as {
    shortMessage?: string;
    message?: string;
    details?: string;
    data?: string | { errorName?: string; errorSignature?: string; data?: string };
    info?: { error?: { data?: string | { data?: string } } };
  };
  const data = anyErr.data;
  const dataHex = typeof data === 'string' ? data : data?.data || '';
  const nested = anyErr.info?.error?.data;
  let dumped = '';
  try {
    dumped = JSON.stringify(err);
  } catch {
    dumped = '';
  }
  return [
    anyErr.shortMessage,
    anyErr.message,
    anyErr.details,
    typeof data === 'object' ? data?.errorName : '',
    typeof data === 'object' ? data?.errorSignature : '',
    dataHex,
    typeof nested === 'string' ? nested : nested?.data,
    dumped,
  ]
    .filter(Boolean)
    .join('\n');
}

function classifyRevert(text: string): OperatorSend {
  if (NETWORK_RE.test(text)) return 'unknown';
  if (BLOCKED_RE.test(text)) return 'blocked';
  if (VANILLA_RE.test(text)) return 'open';
  return 'unknown';
}

function operatorsToProbe(preferred?: string) {
  const list = new Set<string>();
  const extra = asAddress(preferred);
  if (extra) list.add(extra.toLowerCase());
  const current = asAddress(getTradeContractAddress());
  if (current) list.add(current.toLowerCase());
  for (const address of getKnownTradeContractAddresses()) {
    const parsed = asAddress(address);
    if (parsed) list.add(parsed.toLowerCase());
  }
  return [...list] as `0x${string}`[];
}

function cacheGet(key: string, fresh?: boolean) {
  if (fresh) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: OperatorSend) {
  cache.set(key, { result, at: Date.now() });
}

async function operatorFilterBlocks(nft: `0x${string}`, operator: `0x${string}`): Promise<boolean | null> {
  try {
    const allowed = await client.readContract({
      address: nft,
      abi: PROBE_ABI,
      functionName: 'isOperatorAllowed',
      args: [operator],
    });
    return allowed ? false : true;
  } catch {
    /* no helper */
  }
  try {
    const registry = await client.readContract({
      address: nft,
      abi: PROBE_ABI,
      functionName: 'OPERATOR_FILTER_REGISTRY',
    });
    if (registry && registry.toLowerCase() !== ZERO) {
      const allowed = await client.readContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: 'isOperatorAllowed',
        args: [nft, operator],
      });
      return allowed ? false : true;
    }
  } catch {
    /* no registry */
  }
  return null;
}

async function simulateSend(params: {
  nft: `0x${string}`;
  tokenId: bigint;
  owner: `0x${string}`;
  sender: `0x${string}`;
  to?: `0x${string}` | null;
  erc1155: boolean;
}): Promise<OperatorSend> {
  const to =
    params.to && params.to.toLowerCase() !== params.owner.toLowerCase()
      ? params.to
      : params.owner.toLowerCase() === SINK
        ? ('0x0000000000000000000000000000000000000002' as `0x${string}`)
        : SINK;
  try {
    if (params.erc1155) {
      await client.simulateContract({
        address: params.nft,
        abi: PROBE_ABI,
        functionName: 'safeTransferFrom',
        args: [params.owner, to, params.tokenId, 1n, '0x'],
        account: params.sender,
      });
    } else {
      await client.simulateContract({
        address: params.nft,
        abi: PROBE_ABI,
        functionName: 'transferFrom',
        args: [params.owner, to, params.tokenId],
        account: params.sender,
      });
    }
    return 'open';
  } catch (err) {
    return classifyRevert(errText(err));
  }
}

async function probeOneOperator(
  nft: `0x${string}`,
  tokenId: bigint,
  ownerHint: `0x${string}` | null,
  operator: `0x${string}`,
  erc1155: boolean,
  recipient: `0x${string}` | null,
  fresh?: boolean
): Promise<OperatorSend> {
  const cacheKey = `${ACTIVE_CHAIN.id}:${nft.toLowerCase()}:${tokenId}:${(ownerHint || ZERO).toLowerCase()}:${(recipient || ZERO).toLowerCase()}:${operator.toLowerCase()}:${erc1155 ? '1155' : '721'}`;
  const hit = cacheGet(cacheKey, fresh);
  if (hit) return hit;

  const filterBlocks = await operatorFilterBlocks(nft, operator);
  if (filterBlocks === true) {
    cacheSet(cacheKey, 'blocked');
    return 'blocked';
  }

  let owner = ownerHint || SINK;
  if (!erc1155) {
    try {
      owner = await client.readContract({
        address: nft,
        abi: PROBE_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      });
    } catch {
      if (!ownerHint) {
        cacheSet(cacheKey, 'unknown');
        return 'unknown';
      }
    }
  }

  const asOperator = await simulateSend({ nft, tokenId, owner, sender: operator, to: recipient, erc1155 });
  const asOwner = await simulateSend({ nft, tokenId, owner, sender: owner, to: recipient, erc1155 });
  const result: OperatorSend =
    asOperator === 'blocked' || asOwner === 'blocked'
      ? 'blocked'
      : asOperator === 'unknown' || asOwner === 'unknown'
        ? 'unknown'
        : 'open';
  cacheSet(cacheKey, result);
  return result;
}

export async function assertTokensCanMove(
  items: Array<{ contractAddress: string; tokenId: string; owner: string; standard?: string | number }>
) {
  for (const item of items) {
    const nft = asAddress(item.contractAddress);
    const owner = asAddress(item.owner);
    if (!nft || !owner) throw new Error('Could not check this NFT.');
    let tokenId: bigint;
    try {
      tokenId = BigInt(item.tokenId);
    } catch {
      throw new Error('Could not check this NFT.');
    }
    const erc1155 = item.standard === 1 || String(item.standard || '').toUpperCase() === 'ERC1155';
    const result = await simulateSend({ nft, tokenId, owner, sender: owner, erc1155 });
    if (result === 'blocked') {
      throw new Error('This NFT is locked and cannot move yet. Wait until it unlocks. Don’t send another offer.');
    }
    if (result === 'unknown') {
      throw new Error('Could not confirm this NFT can move. Wait a second, then try again.');
    }
  }
}

export async function probeOperatorSend(params: {
  nft: string;
  tokenId: string | number | bigint;
  owner: string;
  recipient?: string;
  operator?: string;
  standard?: string;
  fresh?: boolean;
}): Promise<OperatorSend> {
  const nft = asAddress(params.nft);
  if (!nft) return 'unknown';
  let tokenId: bigint;
  try {
    tokenId = BigInt(params.tokenId);
  } catch {
    return 'unknown';
  }

  const ownerHint = asAddress(params.owner);
  const recipient = asAddress(params.recipient);
  const erc1155 = String(params.standard || '').toUpperCase() === 'ERC1155';
  const results = await Promise.all(
    operatorsToProbe(params.operator).map((operator) =>
      probeOneOperator(nft, tokenId, ownerHint, operator, erc1155, recipient, params.fresh)
    )
  );
  if (results.includes('blocked')) return 'blocked';
  if (results.includes('unknown')) return 'unknown';
  if (results.includes('open')) return 'open';
  return 'unknown';
}

export function selectionFingerprint(items: ProbeItem[]) {
  return items
    .map((item) => {
      const address = (item.contractAddress || item.collectionId || '').toLowerCase();
      return `${address}:${item.tokenId || ''}:${(item.owner || '').toLowerCase()}:${(item.recipient || '').toLowerCase()}:${item.standard || ''}`;
    })
    .sort()
    .join('|');
}

export async function probeSelectedCollections(
  items: ProbeItem[],
  operator?: string,
  opts?: { fresh?: boolean }
): Promise<CollectionSendCheck[]> {
  const results: CollectionSendCheck[] = [];
  for (const item of items) {
    const contractAddress = (item.contractAddress || item.collectionId || '').toLowerCase();
    if (!asAddress(contractAddress) || !item.tokenId || item.tokenId === 'unknown') {
      results.push({
        contractAddress,
        tokenId: String(item.tokenId || ''),
        name: item.collectionName || item.name || 'This NFT',
        operatorSend: 'unknown',
      });
      continue;
    }
    const operatorSend = await probeOperatorSend({
      nft: contractAddress,
      tokenId: item.tokenId,
      owner: item.owner || ZERO,
      recipient: item.recipient,
      operator,
      standard: item.standard,
      fresh: opts?.fresh,
    });
    results.push({
      contractAddress,
      tokenId: String(item.tokenId),
      name: item.collectionName || item.name || `${contractAddress.slice(0, 6)}…${contractAddress.slice(-4)}`,
      operatorSend,
    });
  }
  return results;
}

export function needsEscrow(check: CollectionSendCheck) {
  return check.operatorSend === 'blocked';
}

export function blockedCollectionNames(checks: CollectionSendCheck[]) {
  return checks.filter(needsEscrow).map((check) => check.name || 'This collection');
}

export function unknownCollectionNames(checks: CollectionSendCheck[]) {
  return checks.filter((check) => check.operatorSend === 'unknown').map((check) => check.name || 'This collection');
}

export function inWalletReady(checks: CollectionSendCheck[], expectedCount: number) {
  return (
    expectedCount > 0 &&
    checks.length === expectedCount &&
    checks.every((check) => check.operatorSend === 'open')
  );
}

export async function classifyOfferItems(
  items: ProbeItem[],
  operator?: string,
  opts?: { fresh?: boolean }
) {
  const checks = await probeSelectedCollections(items, operator, opts);
  return {
    checks,
    blocked: blockedCollectionNames(checks),
    unknown: unknownCollectionNames(checks),
    fingerprint: selectionFingerprint(items),
    canInWallet: inWalletReady(checks, items.length),
  };
}
