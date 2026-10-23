'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Sidebar from '../components/Sidebar';
import MobileMenuButton from '../components/MobileMenuButton';
import ChainSwitcher from '../components/ChainSwitcher';

export default function WhitelistMarketplacePage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
          
          {/* Coming Soon Content */}
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="jupiter-card p-12 max-w-2xl text-center">
              <div className="w-20 h-20 bg-cyan-500/20 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <span className="text-4xl">◉</span>
              </div>
              
              
              <div className="space-y-4 text-left mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-zinc-300">Trade whitelist spots</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-zinc-300">Early access pass exchange</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-zinc-300">Community membership tokens</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-zinc-300">Verified access rights</span>
                </div>
              </div>
              
              <div className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-400 px-4 py-2 rounded-full text-sm">
                🚧 Coming Soon
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 