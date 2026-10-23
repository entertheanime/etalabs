'use client';

import { ACTIVE_CHAIN } from '@/lib/chain';

export default function ChainSwitcher() {
  return (
    <span className="hidden text-[12px] text-[#86868b] sm:inline">
      {ACTIVE_CHAIN.testnet ? 'Testnet' : 'Mainnet'}
    </span>
  );
}
