import Link from 'next/link';
import SiteNav from '../components/SiteNav';
import EtaLogo from '../components/EtaLogo';

const principles = [
  {
    title: 'Wallet custody first',
    body: 'In-wallet offers do not move NFTs into etatrade when created. They remain with the owner until accept. Escrow is a separate, opt-in hold used only when a collection blocks that path.',
  },
  {
    title: 'Atomic settlement',
    body: 'Acceptance either completes every agreed NFT and ETH transfer together, or the transaction reverts. There is no partial trade.',
  },
  {
    title: 'Clear intent',
    body: 'A trade records both wallets, each side’s NFT list, and any attached ETH. The receiving wallet can inspect the exact terms before signing.',
  },
];

const lifecycle = [
  ['Create', 'The offerer chooses up to eight NFTs and optional ETH, signs in an EVM wallet, and sends a shareable trade link.'],
  ['Review', 'The other wallet opens the link or Activity and checks the exact NFTs and ETH before signing.'],
  ['Accept or counter', 'They can accept as written, or Change offer and send a counter. A counter closes the original link, same as Steam.'],
  ['Settle', 'In wallet: one accept transaction moves both sides. Escrow: each side deposits, then accept swaps the held NFTs. If an item is gone, the swap reverts — nothing partial.'],
  ['Cancel', 'The offerer can cancel a pending offer. Escrow deposits can be claimed back after cancel or expiry.'],
];

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen glass-page text-ink">
      <SiteNav />

      <main className="mx-auto max-w-[860px] px-6 pb-24 pt-14 sm:pt-20">
        <section className="relative overflow-hidden border-b border-black/[0.08] pb-12 dark:border-white/[0.1]">
          <div aria-hidden="true" className="absolute -left-24 -top-28 h-56 w-56 rounded-full bg-[#ff453a]/10 blur-3xl" />
          <div className="relative inline-flex items-center gap-2 rounded-full border border-[#ff453a]/25 bg-[#ff453a]/10 px-3 py-1.5 text-[12px] font-medium text-[#ff6b61]">
            <EtaLogo size={16} />
            Whitepaper · Robinhood Chain
          </div>
          <h1 className="relative mt-6 max-w-[720px] text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[56px]">
            Direct NFT trading, with two clear settlement paths.
          </h1>
          <p className="relative mt-5 max-w-[650px] text-[17px] leading-7 text-soft">
            etatrade is a two-sided NFT trade protocol for EVM wallets. The default In-wallet path keeps NFTs
            with their owners until accept. Escrow is an optional hold-then-swap when a collection blocks that send.
          </p>
          <p className="relative mt-5 text-[13px] leading-6 text-faint">
            September 2026 · Robinhood Chain · Beta. Contracts are not a substitute for an audit.
          </p>
        </section>

        <section className="py-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">01 · Abstract</p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-tight">The trade should not require a custody hand-off by default.</h2>
          <p className="mt-4 text-[15px] leading-7 text-soft">
            Traditional NFT escrow moves assets into a contract before the other person decides to accept. etatrade
            defaults to a signed set of terms while NFTs remain in each owner’s wallet. The In-wallet contract only
            transfers the agreed assets during a successful acceptance. When a collection refuses that operator
            transfer, the same board can send an Escrow offer instead: each owner deposits, then accept swaps both sides.
          </p>
        </section>

        <section className="grid gap-3 border-y border-black/[0.08] py-12 dark:border-white/[0.1] sm:grid-cols-3">
          {principles.map((principle, index) => (
            <article key={principle.title} className="glass relative overflow-hidden rounded-2xl p-5">
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[#ff453a]/50" />
              <span className="text-[11px] font-semibold text-[#ff6b61]">0{index + 1}</span>
              <h2 className="text-[16px] font-semibold">{principle.title}</h2>
              <p className="mt-2 text-[14px] leading-6 text-soft">{principle.body}</p>
            </article>
          ))}
        </section>

        <section className="py-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">02 · How settlement works</p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-tight">One offer. Two wallets. Atomic settlement.</h2>
          <ol className="mt-7 space-y-5">
            {lifecycle.map(([title, body], index) => (
              <li key={title} className="grid grid-cols-[30px_1fr] gap-4">
                <span className="pt-0.5 text-[13px] font-semibold text-[#ff6b61]">0{index + 1}</span>
                <div>
                  <h3 className="text-[16px] font-semibold">{title}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-soft">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="transfer-policy" className="scroll-mt-24 py-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">03 · Collection transfer policy</p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-tight">Why some collections block In-wallet settlement.</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-7 text-soft">
            <p>
              ERC-721 does not attach a sale price to a transfer. A wallet-to-wallet send can complete with no
              marketplace fee and no creator fee. Marketplaces such as OpenSea, and collections that adopt their
              operator-filter pattern, respond by restricting who may move the token after <code className="text-[13px]">setApprovalForAll</code>.
              Often only an allowlisted marketplace contract can spend that approval. Unapproved operators revert,
              commonly as <code className="text-[13px]">UnauthorizedTransfer</code>.
            </p>
            <p>
              In-wallet settlement uses the etatrade trade contract as the mover at accept. If the collection
              does not allow that operator, the offer cannot complete on that path. That is a collection rule,
              not a failure of the offer terms.
            </p>
            <p>
              Escrow is the fallback on the same 8-slot board. Each owner transfers their NFTs into a dedicated
              escrow contract. Many filters still allow the current owner to send their own token; they block
              unapproved operators, not every owner-initiated transfer. After both deposits, accept swaps the
              two sides. If the counterparty never accepts, the depositor cancels and withdraws their NFTs.
            </p>
            <p>
              Escrow is a custody mode for blocked collections. It is not a marketplace listing, and it is not
              presented as a way to avoid creator or marketplace fees. Some collections may still revert on
              escrow deposits. Users should choose the style that the collection actually allows, and read both
              sides of the offer before signing.
            </p>
          </div>
        </section>

        <section className="glass relative overflow-hidden rounded-2xl border border-[#ff453a]/20 p-6 sm:p-8">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-[#ff453a]" />
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">04 · Security model</p>
          <h2 className="mt-3 text-[25px] font-semibold tracking-tight">Less custody risk, not zero risk.</h2>
          <div className="mt-4 space-y-4 text-[14px] leading-6 text-soft">
            <p>
              In-wallet offers do not pool or warehouse users’ NFTs. That limits the exposure created by a contract
              holding many assets. A pending In-wallet offer can become unavailable if its owner transfers or burns an
              item; acceptance then stops instead of settling a partial trade. Escrow offers do hold deposited NFTs
              until accept, cancel, or refund. Only use Escrow when In wallet cannot complete.
            </p>
            <p>
              NFT approvals and smart-contract interactions still carry risk. Only approve the verified etatrade
              contract on the intended network, inspect the final wallet confirmation, and never share a seed phrase or private key.
            </p>
            <p>
              ETH attached to a pending offer is held by the relevant contract until the offer is accepted or cancelled.
              In-wallet offers do not hold NFTs. Escrow offers hold deposited NFTs until swap or withdrawal.
            </p>
          </div>
        </section>

        <section className="py-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#ff6b61]">05 · Network status</p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-tight">Built on Robinhood Chain.</h2>
          <p className="mt-4 text-[15px] leading-7 text-soft">
            etatrade currently runs on Robinhood Chain. The board is built for standard EVM wallets and ERC-721
            collections. Treat it as a live beta: verify every prompt, and only trade wallets you trust.
          </p>
        </section>

        <section className="rounded-2xl bg-cta px-6 py-10 text-center text-on-cta sm:px-10">
          <h2 className="text-[28px] font-semibold tracking-tight">Read it. Test it. Trade carefully.</h2>
          <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-6 opacity-80">
            Use test assets, verify every wallet prompt, and inspect both sides of an offer before accepting.
          </p>
          <Link href="/trade" className="mt-6 inline-flex rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black">
            Open the trade board
          </Link>
        </section>
      </main>

      <footer className="border-t border-black/[0.08] py-8 dark:border-white/[0.1]">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-4 px-6 text-[12px] text-faint">
          <Link href="/" aria-label="etatrade home" className="inline-flex items-center text-subtle hover:text-ink">
            <EtaLogo size={18} />
          </Link>
          <Link href="/trade" className="hover:text-ink">Trade</Link>
          <a href="https://discord.gg/etalabs" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Discord
          </a>
        </div>
      </footer>
    </div>
  );
}
