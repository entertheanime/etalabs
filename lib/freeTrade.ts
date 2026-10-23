import { isEtaMintCollection } from '@/lib/videoArt';

export const CHOG_GENESIS_ADDRESS = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

function blob(value?: string) {
  return String(value || '').trim().toLowerCase();
}

type CollectionHint = {
  id?: string;
  slug?: string;
  name?: string;
  collectionId?: string;
  collectionName?: string;
  collectionSlug?: string;
};

export function isEtaCollection(input: CollectionHint) {
  const name = blob(input.name || input.collectionName);
  const slug = blob(input.slug || input.collectionSlug);
  return name === 'eta' || slug === 'eta' || isEtaMintCollection(name) || isEtaMintCollection(input.collectionName);
}

export function isChogCollection(input: CollectionHint) {
  const id = blob(input.id || input.collectionId);
  const slug = blob(input.slug || input.collectionSlug);
  const name = blob(input.name || input.collectionName);
  if (id === CHOG_GENESIS_ADDRESS) return true;
  if (slug === 'chog-genesis' || slug.includes('chog-genesis')) return true;
  return name === 'chog genesis' || name === 'chog';
}

export function isFreeTradeCollection(input: CollectionHint) {
  return isEtaCollection(input) || isChogCollection(input);
}

export function showsFreeTrade(input: CollectionHint, network?: string) {
  if (isEtaCollection(input)) return true;
  return network === 'monad' && isChogCollection(input);
}

export function freeTradePass(
  holdings: Array<{
    collectionId?: string;
    collectionName?: string;
    collectionSlug?: string;
    tokens?: unknown[];
  }>
): 'chog' | 'eta' | '' {
  let chog = false;
  for (const holding of holdings) {
    if (!holding.tokens?.length) continue;
    if (isEtaCollection(holding)) return 'eta';
    if (isChogCollection(holding)) chog = true;
  }
  return chog ? 'chog' : '';
}
