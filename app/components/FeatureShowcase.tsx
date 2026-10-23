'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const features = [
  { label: 'A deal between two wallets', title: 'Person to person.', body: 'Pick the NFTs and ETH on both sides. No bot inventory and no hidden markup on the items.', caption: 'Your offer. Their choice.' },
  { label: 'Keep your NFTs close', title: 'In wallet by default.', body: 'Most offers leave NFTs with you until accept. Use Escrow only when a collection blocks that send. ETH attached to an offer is held until settlement or cancel.', caption: 'In wallet first. Escrow if needed.' },
  { label: 'Room for the whole trade', title: 'Eight slots. Each side.', body: 'Browse both inventories, build your offer, and share the link. Your trading partner can also find it in Activity.', caption: 'Two inventories. One agreement.' },
  { label: 'Built on Robinhood Chain', title: 'Agreed. Signed. Swapped.', body: 'Approve what you send, share the link, and let the other wallet accept or counter. In wallet settles on accept. Escrow holds deposits until the swap.', caption: 'Signed in your wallet.' },
];

// The blue character is reserved for the hero card; these illustrations use the other NFT art.
const illustrationNfts = [
  '/images/eta-preview/racer.png',
  '/images/eta-preview/fire.png',
  '/images/eta-preview/bear.png',
  '/images/eta-preview/fur.png',
  '/images/eta-preview/orange.png',
  '/images/eta-preview/tattoo.png',
  '/images/eta-preview/blond.png',
];

function NftTile({ number }: { number: number }) {
  return (
    <i className="feature-nft">
      <Image
        src={illustrationNfts[number % illustrationNfts.length]}
        alt=""
        fill
        sizes="80px"
        className="object-cover"
      />
    </i>
  );
}

function Illustration({ index }: { index: number }) {
  return (
    <div className="feature-art" aria-hidden="true">
      <div className="feature-art-label">ETATRADE <span>ILLUSTRATION</span></div>
      {index === 1 ? (
        <div className="feature-wallet"><span>Your wallet</span><div className="feature-tiles">{[0, 1, 2, 3].map(n => <NftTile key={n} number={n} />)}</div><p>Yours until the trade settles</p><span className="feature-status">NFTs stay here</span></div>
      ) : index === 3 ? (
        <div className="feature-settlement"><div className="feature-chain-mark">↔</div><h3>Trade complete</h3><p>Wallet A <span>⇄</span> Wallet B</p><div className="feature-status">NFTs + ETH · settled together</div></div>
      ) : (
        <div className="feature-deal">
          {['You offer', 'You receive'].map((label, side) => <div key={label}><div className="feature-deal-heading">{label}<span>{index === 2 ? '8 slots' : '2 items'}</span></div><div className="feature-tiles">{Array.from({ length: index === 2 ? 8 : 2 }, (_, n) => n > 3 ? <i key={n} className="feature-empty">+</i> : <NftTile key={n} number={n + side * 3} />)}</div></div>)}
          <div className="feature-status">{index === 2 ? 'Ready to share your offer' : 'Wallet to wallet'}</div>
        </div>
      )}
      <p className="feature-art-caption">{features[index].caption}</p>
    </div>
  );
}

export default function FeatureShowcase() {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const media = window.matchMedia('(min-height: 650px) and (prefers-reduced-motion: no-preference)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!section.current || !media.matches) return;
      const rect = section.current.getBoundingClientRect();
      const travel = rect.height - (window.innerHeight - 64);
      const progress = Math.max(0, Math.min(1, (64 - rect.top) / Math.max(1, travel)));
      setActive(Math.min(features.length - 1, Math.floor(progress * features.length)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); media.removeEventListener('change', schedule); };
  }, []);

  return (
    <section ref={section} className="feature-scroll" aria-label="Why etatrade">
      <div className="feature-sticky">
        <div className="feature-panels" aria-label="Scroll down to explore the features">
          {features.map((feature, index) => (
            <article key={feature.title} className={`feature-panel ${active === index ? 'is-active' : ''}`}>
              <div className="feature-copy"><p className="feature-eyebrow">{feature.label}</p><h2>{feature.title}</h2><p className="feature-body">{feature.body}</p><Link href="/whitepaper" className="feature-link">Explore the details <span aria-hidden="true">↗</span></Link></div>
              <Illustration index={index} />
              <div className="feature-mobile-progress" aria-label={`Feature ${index + 1} of 4`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><i style={{ transform: `translateX(${index * 100}%)` }} /></div>
                <span>04</span>
              </div>
            </article>
          ))}
        </div>
        <div className="feature-progress" aria-label={`Feature ${active + 1} of 4`}><span>{String(active + 1).padStart(2, '0')}</span><div className="feature-track"><i style={{ transform: `translateY(${active * 100}%)` }} /></div><span>04</span></div>
      </div>
    </section>
  );
}
