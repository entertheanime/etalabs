function shortAddr(value?: string) {
  if (!value) return 'the other wallet';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function nftMissingMessage(wallet: string, isYou: boolean) {
  if (isYou) {
    return 'This NFT isn’t in your wallet anymore, so the trade can’t complete.';
  }
  return `The NFT you’re trading isn’t in ${shortAddr(wallet)}’s wallet anymore. Contact your co-trader.`;
}

export function ethMissingMessage(wallet: string, isYou: boolean) {
  if (isYou) {
    return 'You don’t have enough ETH for this trade.';
  }
  return `${shortAddr(wallet)} doesn’t have enough ETH for this trade. Contact your co-trader.`;
}

function errorText(raw: unknown) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  const err = raw as {
    message?: string;
    shortMessage?: string;
    reason?: string;
    code?: string;
    data?: string;
    info?: { error?: { message?: string; data?: string | { data?: string } } };
  };
  const nestedData = err.info?.error?.data;
  let dumped = '';
  try {
    dumped = JSON.stringify(raw);
  } catch {
    dumped = '';
  }
  return [err.shortMessage, err.reason, err.message, err.code, err.data,
    err.info?.error?.message, typeof nestedData === 'string' ? nestedData : nestedData?.data,
    dumped]
    .filter(Boolean)
    .join(' ');
}

export function isConfirmedMissingNft(raw: unknown): boolean {
  return /NFT_NOT_IN_WALLET|don't own this NFT|doesn'?t own this NFT|nonexistent token|ERC721NonexistentToken|owner query for nonexistent/i.test(errorText(raw));
}

export function isWalletRejected(raw: unknown) {
  return /user rejected|User rejected|ACTION_REJECTED|rejected the request/i.test(errorText(raw));
}

export function friendlyTradeError(raw: unknown, opts?: { you?: string; them?: string; mode?: 'escrow' | 'stay-in-wallet' }) {
  const text = errorText(raw);
  if (/wallet anymore|Contact your co-trader|Approve this collection/i.test(text)) {
    return text.split('\n')[0];
  }
  const you = opts?.you?.toLowerCase();
  const them = opts?.them;

  if (text.includes('INVALID_COUNTERPARTY')) {
    return 'Choose a different, valid wallet for the other side. You cannot send a trade offer to yourself.';
  }

  if (isConfirmedMissingNft(raw)) {
    return 'This NFT isn’t in the wallet anymore, so the trade can’t complete.';
  }
  if (text.includes('MISSING_DEPOSIT')) {
    return 'Not all NFTs are in escrow yet. The other wallet still needs to send theirs, or you still have one left to confirm.';
  }
  if (isWalletRejected(raw)) {
    return 'You closed a wallet confirm. Any NFT already in escrow is still there. Open the offer and send the rest, or cancel to get yours back.';
  }
  if (text.includes('INCORRECT_ETH_VALUE') || text.includes('NOT_ENOUGH_ETH') || /insufficient (monad|eth|funds|balance)/i.test(text)) {
    const mentionedYou = you && text.toLowerCase().includes(you);
    if (mentionedYou || /you don'?t have enough/i.test(text) || text.includes('INCORRECT_ETH_VALUE')) {
      return 'Not enough ETH.';
    }
    return ethMissingMessage(them || '', false);
  }
  if (/BAD_DATA|getApproved|could not decode result data/i.test(text)) {
    return 'Approve the collection in your wallet. If that fails, send this offer as Escrow.';
  }
  if (text.includes('NFT_NOT_APPROVED') || /not approved/i.test(text)) {
    return 'A collection in this trade isn’t approved. Approve it, or ask your co-trader to approve theirs.';
  }
  if (/39646e1a|TemporaryFriendLocked|FriendLocked/i.test(text)) {
    return opts?.mode === 'escrow'
      ? 'This NFT is locked and cannot move yet. Wait until it unlocks, then deposit. Don’t send another offer.'
      : 'This NFT is locked and cannot move in-wallet. Wait until it unlocks, then send a new Escrow offer.';
  }
  if (/1de5204e|UnauthorizedTransfer/i.test(text)) {
    return 'This collection blocks a direct wallet-to-wallet send. Send the same offer as Escrow: you deposit, they deposit, then accept swaps both sides.';
  }
  const first = text.split('\n')[0] || 'Trade failed';
  // A provider may omit revert data for many reasons. Do not falsely claim an NFT
  // was transferred or burned unless V9 returned its explicit ownership error.
  if (/missing revert data/i.test(text)) {
    return 'Not enough ETH.';
  }
  if (/failed to fetch|networkerror|timeout|502|503/i.test(text)) {
    return 'Could not reach the chain. Refresh and try again.';
  }
  return first;
}
