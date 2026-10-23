'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import WalletButton from './WalletButton';
import NetworkSwitcher from './NetworkSwitcher';
import EtaLogo from './EtaLogo';
import { getIncomingOfferCount } from '@/services/blockchain';

const links = [
  { href: '/trade', label: 'Trade' },
  { href: '/activity', label: 'Activity' },
  { href: '/whitepaper', label: 'Whitepaper' },
  { href: 'https://entertheanime.com', label: 'Collection', external: true },
  { href: 'https://discord.gg/etalabs', label: 'Discord', external: true },
];

export default function SiteNav() {
  const pathname = usePathname();
  const { address } = useAccount();
  const settingsActive = pathname.startsWith('/settings') || pathname.startsWith('/recover');
  const [incoming, setIncoming] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!address) {
      setIncoming(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      getIncomingOfferCount(address)
        .then((count) => {
          if (!cancelled) setIncoming(count);
        })
        .catch(() => {
          /* keep the last verified count */
        });
    };
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address]);

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setMenuOpen(false);
          document.getElementById('mobile-menu-toggle')?.focus();
        }
      }}
    >
    <header className="glass-nav sticky top-0 z-50">
      <div className="mx-auto flex h-14 lg:h-12 max-w-[1200px] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-10">
          <Link href="/" aria-label="etatrade home" className="flex items-center text-ink">
            <EtaLogo size={26} />
          </Link>
            <nav className="hidden lg:flex items-center gap-7" aria-label="Main navigation">
            {links.map((link) => {
              const isTrade = link.href === '/trade';
              const active = !link.external && pathname === link.href;
              const offers = link.href === '/activity';
              const className = isTrade
                ? 'inline-flex items-center rounded-full border border-[#ff453a] px-3 py-1 text-[12px] font-semibold text-[#ff453a] hover:bg-[#ff453a] hover:text-white'
                : `inline-flex items-center gap-1.5 text-[12px] ${active ? 'text-ink' : 'text-subtle hover:text-ink'}`;
              if (link.external) {
                return (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
                    {link.label}
                  </a>
                );
              }
              return (
                <Link key={link.href} href={link.href} className={className}>
                  {link.label}
                  {offers && incoming > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[11px] font-semibold text-white">
                      {incoming > 99 ? '99+' : incoming}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="hidden lg:flex items-center gap-3">
          <Link
            href="/settings"
            className={`text-[12px] ${settingsActive ? 'text-ink' : 'text-subtle hover:text-ink'}`}
          >
            Settings
          </Link>
          <div className="flex items-center gap-1.5">
            <NetworkSwitcher />
            <WalletButton />
          </div>
        </div>
        <div className="flex items-center gap-1.5 lg:hidden">
          <NetworkSwitcher compact />
          <WalletButton mobile />
          <button id="mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/70 text-[#f5f5f7] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <span className="mb-0.5 text-[22px] font-normal leading-none tracking-normal" aria-hidden="true">
              {menuOpen ? '×' : '☰'}
            </span>
          </button>
        </div>
      </div>
    </header>
      {menuOpen && (
        <div id="mobile-navigation" className="fixed inset-x-0 top-14 bottom-0 z-[60] overflow-y-auto bg-[#0b0b0d] px-5 pb-8 lg:hidden">
          <nav aria-label="Mobile navigation" className="py-2">
            {[
              ...links,
              { href: '/settings', label: 'Settings' },
            ].map(link => {
              const isTrade = link.href === '/trade';
              const className = isTrade
                ? 'my-2 inline-flex min-h-10 items-center justify-center rounded-full border border-[#ff453a] px-4 text-[15px] font-semibold text-[#ff453a]'
                : `flex min-h-12 items-center justify-between border-b border-white/5 text-[15px] ${
                    !link.external && pathname === link.href ? 'text-[#ff6961]' : 'text-ink'
                  }`;
              if (link.external) {
                return (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className={className}>
                    {link.label}
                  </a>
                );
              }
              return (
              <Link key={link.href} href={link.href === '/activity' && incoming > 0 ? '/activity?inbox=1' : link.href} onClick={() => setMenuOpen(false)} aria-current={pathname === link.href ? 'page' : undefined} className={className}>
                {link.label}
                {link.href === '/activity' && incoming > 0 && <span className="rounded-full bg-[#ff453a] px-2 py-0.5 text-[11px] text-white">{incoming > 99 ? '99+' : incoming}</span>}
              </Link>
              );
            })}
          </nav>
          <div className="pt-3"><WalletButton /></div>
        </div>
      )}
    </div>
  );
}
