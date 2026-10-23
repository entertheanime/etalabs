'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Sidebar from '../components/Sidebar';
import MobileMenuButton from '../components/MobileMenuButton';
import ChainSwitcher from '../components/ChainSwitcher';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import { getVerifiedNFTsUserHoldsSmart, type VerifiedNFTHolding } from '@/services/verifiedNFTChecker';
import { VERIFIED_NFTS } from '@/app/config/verifiedNFTs';

export default function LendPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'lend' | 'offers' | 'borrow' | 'loans'>('offers');
  const LEND_COMING_SOON = true; // Toggle to disable/enable the lend panel UI
  const { address, isConnected } = useAccount();

  // Borrow tab state
  const [holdings, setHoldings] = useState<VerifiedNFTHolding[]>([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false);
  const [selected, setSelected] = useState<{ collectionId: string; collectionName: string; tokenId: string; image?: string; floor?: number } | null>(null);
  const [borrowAmount, setBorrowAmount] = useState<number>(0);
  const [aprPct, setAprPct] = useState<number>(60);
  const [durationDays, setDurationDays] = useState<number>(14);
  const platformLtvCap = 0.5; // 50% for MVP

  // Offers tab state (placeholder until backend)
  const [collectionQuery, setCollectionQuery] = useState('');
  const offersData = useMemo(
    () => [
      {
        id: 'molandaks',
        name: 'Molandaks',
        image: '/public/images/MolandakHD.png'.replace('/public', ''),
        availablePool: 55.8,
        bestOffer: 0.41,
        apy: 220,
        duration: 3,
        stats: '1 of 3 offers taken'
      },
      {
        id: 'madlads',
        name: 'Mad Lads',
        image: '/public/images/Chog.png'.replace('/public', ''),
        availablePool: 16.0,
        bestOffer: 0.42,
        apy: 180,
        duration: 16,
        stats: '0 of 5 offers taken'
      },
      {
        id: 'spikes',
        name: 'Spikes',
        image: '/public/images/4ksalmonad.png'.replace('/public', ''),
        availablePool: 719.9,
        bestOffer: 0.35,
        apy: 180,
        duration: 7,
        stats: 'Awaiting lenders'
      }
    ],
    []
  );
  const filteredOffers = offersData.filter((c) => c.name.toLowerCase().includes(collectionQuery.toLowerCase()));

  useEffect(() => {
    if (!isConnected || !address) return;
    if (activeTab !== 'borrow') return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoadingHoldings(true);
        const data = await getVerifiedNFTsUserHoldsSmart(address);
        if (!cancelled) setHoldings(data);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setIsLoadingHoldings(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, address, isConnected]);

  // Update defaults when an NFT is selected
  useEffect(() => {
    if (!selected) return;
    const maxBorrow = Math.max(0, Math.floor((selected.floor || 0) * platformLtvCap));
    setBorrowAmount(maxBorrow);
    setAprPct(60);
    setDurationDays(14);
  }, [selected]);

  const repayAmount = useMemo(() => {
    const principal = Number(borrowAmount) || 0;
    const apr = Number(aprPct) / 100;
    const interest = principal * apr * (durationDays / 365);
    return principal + interest;
  }, [borrowAmount, aprPct, durationDays]);

  const dueDateStr = useMemo(() => {
    const d = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString();
  }, [durationDays]);

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      <div className="flex-1 lg:pl-72">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <MobileMenuButton 
                isOpen={isSidebarOpen}
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              />
            </div>
            
            <div className="flex items-center gap-4">
              <ChainSwitcher />
              <ConnectButton label="Connect" showBalance={false} />
            </div>
          </div>
          
          {/* Lend Panel MVP */}
          <div className="relative">
          <div className={`max-w-6xl mx-auto space-y-6 ${LEND_COMING_SOON ? 'blur-sm pointer-events-none select-none' : ''}` }>
            {/* Tabs */}
            <div className="flex items-center justify-center gap-10 text-sm">
              <button onClick={() => setActiveTab('lend')} className={`${activeTab==='lend' ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}>Lend</button>
              <button onClick={() => setActiveTab('offers')} className={`${activeTab==='offers' ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}>Offers</button>
              <button onClick={() => setActiveTab('borrow')} className={`${activeTab==='borrow' ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}>Borrow</button>
              <button onClick={() => setActiveTab('loans')} className={`${activeTab==='loans' ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'}`}>Loans</button>
            </div>

            {/* Lend tab: Create Offer form */}
            {activeTab === 'lend' && (
              <div className="glass-card rounded-2xl p-5 border border-zinc-800">
                <h2 className="text-lg font-semibold mb-4">Create a Collection Offer</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Collection</label>
                    <input className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 placeholder-zinc-500" placeholder="0x... (collection address)" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Principal (MON)</label>
                    <input className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200" placeholder="e.g. 5" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Duration</label>
                    <select className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200">
                      <option>7 days</option>
                      <option>14 days</option>
                      <option>30 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">APR (simple)</label>
                    <input className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200" placeholder="e.g. 60 (%)" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Max LTV</label>
                    <input className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200" placeholder="e.g. 50 (%)" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Offer Capacity</label>
                    <input className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200" placeholder="# of loans" />
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Reset</button>
                  <button className="px-4 py-2 rounded-lg bg-green-500 text-black hover:bg-green-400">Create Offer</button>
                </div>
              </div>
            )}

            {/* Offers tab: marketplace list placeholder */}
            {activeTab === 'offers' && (
              <div className="space-y-4">
                {/* Header */}
                <div>
                  <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Make loan offers on NFT collections.</h1>
                  <p className="text-zinc-400 mt-2 max-w-3xl">
                    Browse collections below and name your price. The current best offer will be shown to borrowers. If they take your offer, their NFT is escrowed as collateral. You’ll be repaid at the end of the loan, plus interest. If they fail to repay, you keep the NFT.
                  </p>
                </div>

                {/* Search/Sort bar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <input
                      value={collectionQuery}
                      onChange={(e) => setCollectionQuery(e.target.value)}
                      placeholder="search collections…"
                      className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-500"
                    />
                  </div>
                  <button className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">Sort</button>
                </div>

                {/* Table-like list */}
                <div className="space-y-3">
                  {filteredOffers.map((c) => (
                    <div key={c.id} className="rounded-2xl bg-zinc-900/40 border border-zinc-800 p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-6 items-center gap-3">
                        {/* Collection */}
                        <div className="col-span-2 sm:col-span-2 flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800">
                            <img src={c.image} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <div className="font-semibold">{c.name}</div>
                            <div className="text-xs text-zinc-500">{c.stats}</div>
                          </div>
                        </div>
                        {/* Pool */}
                        <div className="hidden sm:block">
                          <div className="text-[11px] text-zinc-400">Available Pool</div>
                          <div className="text-white">{c.availablePool.toFixed(2)} MON</div>
                        </div>
                        {/* Best offer */}
                        <div className="hidden sm:block">
                          <div className="text-[11px] text-zinc-400">Best Offer</div>
                          <div className="text-white">{c.bestOffer.toFixed(2)} MON</div>
                        </div>
                        {/* APY */}
                        <div className="hidden sm:block">
                          <div className="text-[11px] text-zinc-400">APY</div>
                          <div className="text-green-400 font-semibold">{c.apy}%</div>
                        </div>
                        {/* Duration */}
                        <div className="hidden sm:block">
                          <div className="text-[11px] text-zinc-400">Duration</div>
                          <div className="text-white">{c.duration}d</div>
                        </div>
                        <div className="flex justify-end">
                          <button className="px-4 py-2 rounded-lg bg-green-500 text-black hover:bg-green-400">Lend</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Borrow tab: select NFT placeholder */}
            {activeTab === 'borrow' && (
              <div className="glass-card rounded-2xl p-5 border border-zinc-800">
                <h3 className="font-semibold mb-4">Borrow against your NFT</h3>
                {!isConnected ? (
                  <div className="text-sm text-zinc-400">Connect your wallet to view your NFTs and available loan offers.</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Inventory */}
                    <div className="lg:col-span-2">
                      <div className="text-xs text-zinc-400 mb-2">Your inventory</div>
                      {isLoadingHoldings ? (
                        <div className="text-zinc-400 text-sm">Loading your verified NFTs…</div>
                      ) : holdings.length === 0 ? (
                        <div className="text-zinc-400 text-sm">No verified NFTs found.</div>
                      ) : (
                        <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                          {holdings.map((h) => (
                            <div key={h.collectionId} className="">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-6 h-6 rounded bg-zinc-800 overflow-hidden">
                                  {(() => {
                                    const override = VERIFIED_NFTS.find(v => v.address.toLowerCase() === h.collectionId.toLowerCase())?.mediaOverride || '';
                                    const src = h.collectionImage || override;
                                    return src ? (
                                      src.endsWith('.mp4') || src.endsWith('.webm') || src.endsWith('.mov') ? (
                                        <video src={src} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                                      ) : (
                                        <img src={src} className="w-full h-full object-cover" />
                                      )
                                    ) : null;
                                  })()}
                                </div>
                                <div className="text-sm text-white">{h.collectionName}</div>
                                {h.collectionFloorPrice ? (
                                  <div className="text-xs text-zinc-400 ml-2">Floor: {Math.round(h.collectionFloorPrice)} Mon</div>
                                ) : null}
                              </div>
                              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                                {h.tokens.map((t) => (
                                  <button
                                    key={t.tokenId}
                                    onClick={() =>
                                      setSelected({ collectionId: h.collectionId, collectionName: h.collectionName, tokenId: t.tokenId, image: t.image, floor: h.collectionFloorPrice || 0 })
                                    }
                                    className={`aspect-square rounded-lg overflow-hidden border ${
                                      selected && selected.collectionId === h.collectionId && selected.tokenId === t.tokenId
                                        ? 'border-green-500'
                                        : 'border-zinc-700'
                                    } bg-zinc-800`}
                                  >
                                    <img src={t.image || '/placeholder.svg'} className="w-full h-full object-cover" onError={(e) => ((e.currentTarget.src = '/placeholder.svg'))} />
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Offer panel */}
                    <div className="lg:col-span-1">
                      <div className="text-xs text-zinc-400 mb-2">Offer</div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                        {!selected ? (
                          <div className="text-sm text-zinc-400">Select an NFT to see the best offer.</div>
                        ) : (
                          <div className="space-y-3">
                <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800">
                                <img src={selected.image || '/placeholder.svg'} className="w-full h-full object-cover" />
                              </div>
                              <div>
                                <div className="text-sm text-white truncate">{selected.collectionName}</div>
                                <div className="text-xs text-zinc-400">Token #{selected.tokenId}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
                                <div className="text-[11px] text-zinc-400">Floor</div>
                                <div className="text-white">{Math.round(selected.floor || 0)} Mon</div>
                              </div>
                              <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
                                <div className="text-[11px] text-zinc-400">Max LTV</div>
                                <div className="text-white">{Math.round(platformLtvCap * 100)}%</div>
                              </div>
                              <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2 col-span-2">
                                <div className="text-[11px] text-zinc-400">Amount to Borrow (MON)</div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    value={borrowAmount}
                                    min={0}
                                    max={Math.max(0, Math.floor((selected.floor || 0) * platformLtvCap))}
                                    onChange={(e) => setBorrowAmount(Math.max(0, Math.min(Number(e.target.value || 0), Math.max(0, Math.floor((selected.floor || 0) * platformLtvCap)))))}
                                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-white"
                                  />
                                  <button
                                    onClick={() => setBorrowAmount(Math.max(0, Math.floor((selected.floor || 0) * platformLtvCap)))}
                                    className="px-2 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs"
                                  >
                                    Max
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <label className="block text-[11px] text-zinc-400 mb-1">Duration</label>
                                <select
                                  value={durationDays}
                                  onChange={(e) => setDurationDays(Number(e.target.value))}
                                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-1.5 text-zinc-200 text-sm"
                                >
                                  <option value={7}>7 days</option>
                                  <option value={14}>14 days</option>
                                  <option value={30}>30 days</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-zinc-400 mb-1">APR</label>
                                <input
                                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-1.5 text-zinc-200 text-sm"
                                  placeholder="e.g. 60"
                                  type="number"
                                  value={aprPct}
                                  onChange={(e) => setAprPct(Math.max(0, Number(e.target.value || 0)))}
                                />
                              </div>
                            </div>
                            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-400">You receive</span>
                                <span className="text-white font-medium">{borrowAmount.toFixed(2)} MON</span>
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-zinc-400">You will repay by {dueDateStr}</span>
                                <span className="text-white font-medium">{repayAmount.toFixed(2)} MON</span>
                              </div>
                            </div>
                            <button
                              onClick={() => toast.success('Loan acceptance flow coming soon (escrow NFT, send MON).')}
                              className="w-full px-4 py-2 rounded-lg bg-green-500 text-black hover:bg-green-400"
                            >
                              Accept Loan
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Loans tab: portfolio placeholder */}
            {activeTab === 'loans' && (
              <div className="glass-card rounded-2xl p-5 border border-zinc-800">
                <h3 className="font-semibold mb-3">Your Loans</h3>
                <div className="divide-y divide-zinc-800">
                  <div className="py-3 flex items-center justify-between">
                    <div className="text-sm text-zinc-300">Loan #001 • 5 MON → repay 5.8 MON • Due in 6d</div>
                    <button className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 text-sm">Repay</button>
                  </div>
                  <div className="py-3 flex items-center justify-between">
                    <div className="text-sm text-zinc-300">Loan #000 • Defaulted • Lender can claim NFT</div>
                    <button className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm">View</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {LEND_COMING_SOON && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="jupiter-card px-8 py-6 rounded-2xl text-center bg-black/50 backdrop-blur-xl border border-zinc-800 shadow-2xl">
                <div className="text-2xl font-extrabold text-white">Lending is coming soon</div>
                <div className="text-zinc-300 text-sm mt-2 max-w-md">We’re polishing the experience. You’ll be able to make offers and borrow using MON soon.</div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
} 