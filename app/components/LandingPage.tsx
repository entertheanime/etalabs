'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import SiteNav from './SiteNav';
import EtaLogo from './EtaLogo';
import FeatureShowcase from './FeatureShowcase';

const reasons = [
  {
    title: 'Person to person',
    body: 'You pick the NFTs and ETH on both sides. There is no bot inventory and no hidden markup on the items.',
  },
  {
    title: 'Two offer styles',
    body: 'In wallet is the default: NFTs stay with you until they accept. Escrow is the fallback when a collection blocks a direct send.',
  },
  {
    title: 'Fast two-pane board',
    body: 'Load your inventory, drop items into eight slots, send the offer. Accept from Activity when it lands.',
  },
  {
    title: 'On-chain, on Robinhood',
    body: 'Trades settle on Robinhood Chain. You confirm in your wallet — nothing moves until you sign.',
  },
];

const steps = [
  {
    n: '01',
    title: 'Connect',
    body: 'Open Trade and connect the wallet that holds the NFTs you want to offer.',
  },
  {
    n: '02',
    title: 'Build the offer',
    body: 'Put your items on top, theirs underneath. Add ETH if the deal needs it.',
  },
  {
    n: '03',
    title: 'Send',
    body: 'Confirm in your EVM wallet. You get a shareable /trade/… link — send that to them. They also see a red badge on Activity.',
  },
  {
    n: '04',
    title: 'Accept or counter',
    body: 'They open the link or Activity. They can accept, or Change offer and send a counter — that closes your original link. In wallet settles in one accept; Escrow deposits first, then swaps.',
  },
];

const faqs = [
  {
    q: 'How do I trade safely?',
    a: 'Only trade wallets you trust. Check every NFT id, ETH amount, and whether the offer is In wallet or Escrow before you sign. Never share a seed phrase.',
  },
  {
    q: 'Is this a bot or a direct trade?',
    a: 'Direct. etatrade is a two-sided offer between wallets. We are not a middleman sitting on a skin warehouse. The contract only moves the items you both agreed to, when the counterparty accepts.',
  },
  {
    q: 'Do my NFTs leave my wallet when I make an offer?',
    a: 'In wallet: no. They stay yours until accept, and you can cancel a pending offer you created. Escrow: yes — they leave when you send, and you get them back if you cancel before accept. ETH attached to an offer is held with the trade.',
  },
  {
    q: 'What if someone burns or transfers an NFT after the offer?',
    a: 'Accept will fail with a clear message that the NFT is no longer in that wallet. Nothing else in the deal moves.',
  },
  {
    q: 'When should I use escrow?',
    a: 'Start with In wallet. If the collection blocks a direct send between wallets, use Escrow: you deposit first, they deposit on accept, then both sides swap. If they never accept, cancel and get your NFTs back. Escrow is a hold-then-swap, not a marketplace listing.',
  },
  {
    q: 'Why do some collections block In wallet?',
    a: 'A normal NFT send has no sale price and no creator fee. Some collections, including many listed on OpenSea, only let approved marketplace contracts move the token after you approve them. etatrade In wallet is not on that list, so the send can fail. Escrow is you depositing the NFT yourself, then swapping. That is a second offer style, not a way to skip marketplace rules.',
  },
  {
    q: 'Can they counter my offer?',
    a: 'Yes. Change offer opens the same board with both sides filled in. Send counter creates a new link to you and closes the old one. Only the new offer can be accepted.',
  },
  {
    q: 'What chain is this on?',
    a: 'Robinhood Chain. Connect a wallet that can sign on that network, then use Trade.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-6 py-5 text-left"
        aria-expanded={open}
      >
        <span className="text-[16px] font-medium text-ink">{q}</span>
        <span className="text-[22px] leading-none text-subtle">{open ? '–' : '+'}</span>
      </button>
      {open && <p className="pb-5 text-[14px] leading-6 text-soft">{a}</p>}
    </div>
  );
}

function TradePreview() {
  const offeredNfts = [
    '/images/eta-preview/azure.png',
    '/images/eta-preview/racer.png',
    '/images/eta-preview/fire.png',
    '/images/eta-preview/bear.png',
  ];
  const requestedNfts = [
    '/images/eta-preview/fur.png',
    '/images/eta-preview/orange.png',
    '/images/eta-preview/tattoo.png',
    '/images/eta-preview/blond.png',
  ];

  const NftTiles = ({ items, alt }: { items: string[]; alt: string }) => (
    <div className="mt-2 grid grid-cols-4 gap-1.5">
      {items.map((src, index) => (
        <div key={src} className="relative aspect-square overflow-hidden rounded-[7px] bg-zinc-800 ring-1 ring-white/10">
          <Image
            src={src}
            alt={`${alt} NFT ${index + 1}`}
            fill
            sizes="56px"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="eta-device relative mx-auto mt-8 w-[230px] sm:mt-10 sm:w-[272px]">
      <div className="eta-device-glow absolute -inset-10 -z-10 rounded-full bg-[#ff453a]/20 blur-[75px]" />
      <div className="transition duration-500 hover:-translate-y-1 hover:rotate-[0.7deg] rounded-[33px] border border-white/15 bg-[#111113] p-3 shadow-[0_26px_90px_rgba(0,0,0,0.55)]">
        <div className="rounded-[24px] border border-white/10 bg-[#17171a] p-4">
          <div className="flex items-center justify-between text-[9px] text-[#8e8e93]">
            <span>ETA TRADE</span><span>LIVE</span>
          </div>
          <div className="mt-4 rounded-[16px] bg-black/35 p-3">
            <div className="flex items-center justify-between text-[10px] text-[#f5f5f7]"><span>You offer</span><span className="text-[#8e8e93]">4 items</span></div>
            <NftTiles items={offeredNfts} alt="Offered" />
          </div>
          <div className="my-3 flex items-center justify-center text-[15px] text-[#ff453a]">↕</div>
          <div className="rounded-[16px] bg-black/35 p-3">
            <div className="flex items-center justify-between text-[10px] text-[#f5f5f7]"><span>You receive</span><span className="text-[#8e8e93]">4 items</span></div>
            <NftTiles items={requestedNfts} alt="Requested" />
          </div>
          <div className="mt-4 rounded-full bg-[#ff453a] py-2 text-center text-[10px] font-semibold text-white">Review offer</div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [heroScroll, setHeroScroll] = useState(0);

  useEffect(() => {
    const onScroll = () => setHeroScroll(Math.min(window.scrollY / 720, 1));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen glass-page text-ink">
      <SiteNav />

      <main className="mx-auto max-w-[1180px] px-6 pb-24">
        <section
          className="relative overflow-hidden pt-20 pb-16 text-center sm:pt-28 sm:pb-24"
          style={{
            opacity: 1 - heroScroll * 0.72,
            transform: `translateY(${-heroScroll * 46}px) scale(${1 - heroScroll * 0.025})`,
          }}
        >
          <div className="absolute inset-x-0 top-14 h-[460px] -z-10 bg-[radial-gradient(ellipse_at_center,rgba(255,69,58,0.13),transparent_57%)]" />
          <p className="hero-reveal hero-reveal-1 mb-6 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff5a52]">
            Self-custodial · Robinhood Chain
          </p>
          <h1 className="mx-auto max-w-[1080px] text-[44px] font-semibold leading-[0.96] tracking-[-0.065em] sm:text-[72px] lg:text-[90px]">
            <span className="hero-reveal hero-reveal-2 block"><span className="text-[#6e6e73]">TRADE NFTs</span>{' '}<span className="text-ink">LIKE YOU</span></span>
            <span className="hero-reveal hero-reveal-3 block"><span className="text-ink">TRADE</span>{' '}<span className="text-[#6e6e73]">SKINS.</span></span>
          </h1>
          <div className="hero-reveal hero-reveal-4 mx-auto mt-1 grid max-w-[1000px] grid-cols-1 items-end gap-6 sm:mt-3 sm:grid-cols-[1fr_300px_1fr] sm:gap-6">
            <p className="order-1 mx-auto max-w-[230px] text-[14px] leading-5 text-soft sm:order-none sm:mb-10 sm:text-left">
              Person-to-person NFT trades. No bot inventory. Two offer styles.
            </p>
            <div className="order-3 sm:order-none">
              <TradePreview />
            </div>
            <div className="order-2 mx-auto max-w-[230px] sm:order-none sm:mb-10 sm:text-left">
              <p className="text-[14px] leading-5 text-soft">Build an offer, send the link. They accept — or send a counter. In wallet swaps on accept.</p>
              <Link href="/trade" className="mt-5 inline-flex rounded-full bg-[#ff453a] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#ff5c54]">
                Start trading
              </Link>
            </div>
          </div>
          <div className="hero-reveal hero-reveal-5 mt-4 flex flex-wrap items-center justify-center gap-3 sm:-mt-2">
            <Link href="/activity" className="text-[13px] font-medium text-subtle transition hover:text-ink">View activity →</Link>
            <span className="text-[#636366]">·</span>
            <Link href="/whitepaper" className="text-[13px] font-medium text-subtle transition hover:text-ink">Read the whitepaper →</Link>
          </div>
        </section>

        <section className="border-y border-black/10 py-16 text-center dark:border-white/10 sm:py-24">
          <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#ff5a52]">etatrade</p>
          <h2 className="mt-4 text-[40px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[64px]">
            Built for the trade.<br />
            <span className="text-[#6e6e73]">Cut the middleman.</span>{' '}<span className="text-ink">Keep control.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[500px] text-[16px] leading-7 text-soft">
            Default offers keep NFTs in your wallet until accept. Escrow is only when a collection will not allow that send.
          </p>
        </section>

        <FeatureShowcase />

        <section className="mt-16">
          <h2 className="text-[28px] font-semibold tracking-tight">How a trade works</h2>
          <p className="mt-2 max-w-[540px] text-[15px] leading-6 text-soft">
            Same idea as a Steam offer: put up what you give, ask for what you want, wait for accept — or a counter.
          </p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2">
            {steps.map((step) => (
              <li key={step.n} className="flex gap-4">
                <span className="text-[13px] font-medium text-[#636366]">{step.n}</span>
                <div>
                  <h3 className="text-[16px] font-semibold">{step.title}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-soft">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16 glass rounded-2xl p-6 sm:p-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">Why two styles</p>
          <h2 className="mt-3 text-[22px] font-semibold tracking-tight">In wallet first. Escrow when a collection blocks the send.</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-7 text-soft">
            <p>
              Standard NFTs move with a plain wallet send. There is no sale price on that send, so there is no
              built-in creator fee. Marketplaces like OpenSea keep fees in the path by letting collections allow
              only approved marketplace contracts to move the token after you approve them.
            </p>
            <p>
              In wallet uses etatrade as that mover at accept. If the collection is not open to that, the
              transfer fails. Escrow does not ask the collection to treat etatrade as an approved marketplace.
              You send your NFTs in yourself, they do the same on accept, then escrow swaps both sides.
              Cancel and get yours back if they never accept.
            </p>
            <p>
              Use Escrow when In wallet cannot complete. It is a hold-then-swap for blocked collections,
              not a marketplace listing and not a way around creator or marketplace rules.
            </p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-black/[0.04] p-4 dark:bg-white/5">
              <p className="text-[13px] font-semibold">In wallet</p>
              <p className="mt-1.5 text-[13px] leading-5 text-soft">
                NFTs stay with you until they accept. Start here for collections that allow a direct swap.
              </p>
            </div>
            <div className="rounded-2xl bg-black/[0.04] p-4 dark:bg-white/5">
              <p className="text-[13px] font-semibold">Escrow</p>
              <p className="mt-1.5 text-[13px] leading-5 text-soft">
                You deposit now. They deposit on accept. Then both sides swap. Use this if the collection blocks In wallet.
              </p>
            </div>
          </div>
          <p className="mt-5 text-[13px] leading-6 text-subtle">
            More detail is in the{' '}
            <Link href="/whitepaper#transfer-policy" className="underline hover:text-ink">
              whitepaper
            </Link>
            .
          </p>
        </section>

        <section className="mt-16">
          <h2 className="text-[28px] font-semibold tracking-tight">Questions</h2>
          <div className="mt-4">
            {faqs.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </section>

        <section className="mt-16 text-center">
          <h2 className="text-[28px] font-semibold tracking-tight">Ready when you are</h2>
          <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-6 text-soft">
            Connect a wallet, load inventories, and send the first offer.
          </p>
          <Link
            href="/trade"
            className="mt-6 inline-flex rounded-full bg-cta px-5 py-2.5 text-[14px] font-semibold text-on-cta"
          >
            Open the trade board
          </Link>
        </section>
      </main>

      <footer className="border-t border-black/10 py-8 dark:border-white/10">
        <div className="mx-auto flex max-w-[920px] flex-wrap items-center justify-between gap-4 px-6 text-[12px] text-faint">
          <Link href="/" aria-label="etatrade home" className="inline-flex items-center text-subtle">
            <EtaLogo size={18} />
          </Link>
          <div className="flex gap-5">
            <Link href="/trade" className="hover:text-ink">
              Trade
            </Link>
            <Link href="/activity" className="hover:text-ink">
              Activity
            </Link>
            <Link href="/settings" className="hover:text-ink">
              Settings
            </Link>
            <Link href="/whitepaper" className="hover:text-ink">
              Whitepaper
            </Link>
            <a href="https://entertheanime.com" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              Collection
            </a>
            <a href="https://discord.gg/etalabs" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              Discord
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
