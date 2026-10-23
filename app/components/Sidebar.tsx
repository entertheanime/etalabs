'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const navigationItems = [
  { name: 'Home', href: '/', emoji: '⌂', description: 'Overview' },
  { name: 'Trade', href: '/trade', emoji: '⇄', description: 'P2P NFT swap' },
  { name: 'My Trades', href: '/activity', emoji: '◈', description: 'Open & past trades' },
  { name: 'Settings', href: '/settings', emoji: '⚙', description: 'Recover trade' },
];

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div
      className={`
      fixed top-0 left-0 z-50 flex h-screen w-72 flex-col overflow-hidden border-r border-zinc-800 bg-[#0c0c0e] transform transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
    `}
    >
      <div className="flex h-20 flex-shrink-0 items-center border-b border-zinc-800 px-6">
        <div className="flex w-full items-center justify-between">
          <Link href="/" className="min-w-0">
            <h1 className="truncate text-2xl font-bold leading-7 tracking-tight text-white">
              etatrade
            </h1>
            <p className="truncate text-xs text-zinc-500">NFT trade · Robinhood Chain</p>
          </Link>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white lg:hidden"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <nav className="flex-shrink-0 space-y-1 p-4">
          <div className="mb-4 px-2 text-[11px] font-semibold uppercase tracking-[.08em] text-zinc-500">
            Trade
          </div>
          {navigationItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`
                group relative block rounded-lg px-3 py-2.5 transition-colors duration-150
                ${
                  isActive(item.href)
                    ? 'border border-emerald-400/30 bg-emerald-400/[0.06]'
                    : 'border border-transparent hover:bg-white/[0.03]'
                }
              `}
            >
              <div className="relative flex items-center gap-2.5">
                <span
                  className={`w-5 text-center text-[18px] leading-none ${
                    isActive(item.href) ? 'text-emerald-300' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                >
                  {item.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[14px] leading-5 ${
                      isActive(item.href) ? 'font-bold text-white' : 'font-semibold text-zinc-300'
                    }`}
                  >
                    {item.name}
                  </div>
                  <div className="truncate text-[12px] leading-4 text-zinc-500">{item.description}</div>
                </div>
                {isActive(item.href) && (
                  <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                )}
              </div>
            </Link>
          ))}
        </nav>
        <div className="min-h-0 flex-1" />
        <div className="border-t border-zinc-800 p-4 text-center text-[11px] text-zinc-600">
          EVM only · Robinhood Chain
        </div>
      </div>
    </div>
  );
}
