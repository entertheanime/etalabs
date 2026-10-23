export function isEscrowMode(trade?: { tradeType?: string } | null) {
  return trade?.tradeType === 'escrow-program';
}

export function isIncompleteEscrowOffer(trade?: { status?: string } | null) {
  return (trade?.status || '').toLowerCase() === 'incomplete';
}

export function tradeModeLabel(trade?: { tradeType?: string } | null) {
  return isEscrowMode(trade) ? 'Escrow' : 'In wallet';
}

export const STAY_IN_WALLET_BLURB =
  'NFTs stay in your wallet until they accept. Use this unless a collection blocks the transfer.';

export const ESCROW_BLURB =
  'Both sides send NFTs into etatrade escrow first. Accept then swaps them. Use this when a collection blocks a direct wallet-to-wallet send.';
