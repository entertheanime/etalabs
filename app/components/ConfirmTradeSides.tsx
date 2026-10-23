import SafeImage from './SafeImage';

type ConfirmNft = {
  image?: string;
  name?: string;
  tokenId?: string;
  contract?: string;
  contractAddress?: string;
  selectedCount?: number;
  amount?: string | number;
};

function itemKey(nft: ConfirmNft, index: number) {
  return `${(nft.contractAddress || nft.contract || 'nft').toLowerCase()}-${nft.tokenId || index}`;
}

function Side({
  label,
  items,
  eth,
  chog,
  nativeSymbol = 'ETH',
}: {
  label: string;
  items: ConfirmNft[];
  eth?: string;
  chog?: string;
  nativeSymbol?: string;
}) {
  const count = items.reduce((sum, nft) => {
    const qty = Number(nft.selectedCount ?? nft.amount ?? 1);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }, 0);
  const ethNum = Number(eth);
  const chogNum = Number(chog);
  const hasEth = Number.isFinite(ethNum) && ethNum > 0;
  const hasChog = Number.isFinite(chogNum) && chogNum > 0;
  const cash = [
    hasEth ? `${eth} ${nativeSymbol}` : '',
    hasChog ? `${chog} CHOG` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="rounded-[16px] bg-black/[0.04] p-3 text-left dark:bg-black/35">
      <div className="flex items-center justify-between gap-3 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
        <span>{label}</span>
        <span className="text-[#8e8e93]">
          {count === 1 ? '1 item' : `${count} items`}
          {cash ? ` · ${cash}` : ''}
        </span>
      </div>
      {count > 0 ? (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {items.map((nft, index) => (
            <div
              key={itemKey(nft, index)}
              className="relative aspect-square overflow-hidden rounded-[10px] bg-zinc-800 ring-1 ring-black/5 dark:ring-white/10"
            >
              <SafeImage
                src={nft.image || '/placeholder.svg'}
                alt={nft.name || `NFT ${nft.tokenId || ''}`}
                className="h-full w-full object-cover"
              />
              {Number(nft.selectedCount ?? nft.amount ?? 1) > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white">
                  ×{Number(nft.selectedCount ?? nft.amount ?? 1)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[#8e8e93]">{cash ? `${cash} only` : 'Nothing'}</p>
      )}
    </div>
  );
}

export default function ConfirmTradeSides({
  offer,
  receive,
  offerEth,
  receiveEth,
  offerChog,
  receiveChog,
  nativeSymbol = 'ETH',
}: {
  offer: ConfirmNft[];
  receive: ConfirmNft[];
  offerEth?: string;
  receiveEth?: string;
  offerChog?: string;
  receiveChog?: string;
  nativeSymbol?: string;
}) {
  return (
    <div className="mt-5 space-y-2">
      <Side label="You offer" items={offer} eth={offerEth} chog={offerChog} nativeSymbol={nativeSymbol} />
      <Side label="You receive" items={receive} eth={receiveEth} chog={receiveChog} nativeSymbol={nativeSymbol} />
    </div>
  );
}
