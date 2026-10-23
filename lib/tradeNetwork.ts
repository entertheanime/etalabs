import {
  LEGACY_MONAD_STAY_IN_WALLET_ADDRESS,
  MONAD_STAY_IN_WALLET_ADDRESS,
  PRE_CHOG_MONAD_STAY_IN_WALLET_ADDRESS,
  STAY_IN_WALLET_TRADE_ADDRESS,
} from '@/lib/contracts';
import {
  LEGACY_MONAD_ESCROW_V1_ADDRESS,
  MONAD_ESCROW_V1_ADDRESS,
  PRE_CHOG_MONAD_ESCROW_V1_ADDRESS,
} from '@/lib/escrow';

const MONAD_CONTRACTS = new Set(
  [
    MONAD_STAY_IN_WALLET_ADDRESS,
    MONAD_ESCROW_V1_ADDRESS,
    PRE_CHOG_MONAD_STAY_IN_WALLET_ADDRESS,
    PRE_CHOG_MONAD_ESCROW_V1_ADDRESS,
    '0xb83feae93222df783f5bd5616b0f8602ae47bb2e',
    '0xc9379ea759d0ea1fe8c6e8a861deef1902ff0913',
    LEGACY_MONAD_STAY_IN_WALLET_ADDRESS,
    LEGACY_MONAD_ESCROW_V1_ADDRESS,
    process.env.NEXT_PUBLIC_MONAD_TRADE_CONTRACT_ADDRESS,
    process.env.NEXT_PUBLIC_MONAD_ESCROW_CONTRACT_ADDRESS,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
);

const ROBINHOOD_CONTRACTS = new Set(
  [STAY_IN_WALLET_TRADE_ADDRESS, process.env.NEXT_PUBLIC_TRADE_CONTRACT_ADDRESS, process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
);

export function inferTradeNetwork(trade?: { network?: string; tradeContract?: string } | null) {
  const contract = String(trade?.tradeContract || '').toLowerCase();
  if (contract && MONAD_CONTRACTS.has(contract)) return 'monad';
  if (contract && ROBINHOOD_CONTRACTS.has(contract)) return 'robinhood';
  const network = String(trade?.network || '');
  if (network === 'monad' || network === 'robinhood' || network === 'ink' || network === 'ethereum') {
    return network;
  }
  return '';
}
