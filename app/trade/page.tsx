'use client';

import { Suspense } from 'react';
import { useAccount } from 'wagmi';
import TradeInterface from '../components/TradeInterface';
import TradePanel from '../components/TradePanel';
import SiteNav from '../components/SiteNav';

export default function TradePage() {
  const { address } = useAccount();

  return (
    <div className="min-h-screen glass-page text-[#f5f5f7]">
      <SiteNav />
      <Suspense fallback={null}>
        <TradeInterface userAddress={address || ''} TradePanelComponent={TradePanel} />
      </Suspense>
    </div>
  );
}
