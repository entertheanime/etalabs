export const VIDEO_ART = {
  Flame: {
    imageCid: 'QmRAsBdTogNv6CBD9YCd31QoBbiosMFcYEKYCgEdx7msJk',
    metaCid: 'QmVfcvwF64eEZ6fSnyTut6NmfUdA5wwYbhq45JDZkWtchk',
  },
  Heart: {
    imageCid: 'QmfGUbsxgRecQGhgvsGa58Km1e4YFioVfQFE39twZenej3',
    metaCid: 'Qma5nTBDRv5tpHBT46eiEUsWfXNTJUtKhhSTqpRw4DjW3v',
  },
  Teddy: {
    imageCid: 'QmRCD8cp4PgVmmKzSp9LujKDorKgvU9F4Jk7UDJ1ZzaN3o',
    metaCid: 'QmZXhwZnajeFFmSo8E14qNX9EqwYNejyUyH6DkZiGfXYPB',
  },
} as const;

const PIECE_ORDER = ['Flame', 'Heart', 'Teddy'] as const;

export function appCollectionName(name?: string) {
  const value = String(name || '').trim();
  if (!value) return 'eta';
  if (/\b(etaswap\s*(pets?|video|test)|etapet|etavid)\b/i.test(value)) return 'eta';
  return value;
}

export function isEtaMintCollection(name?: string) {
  return /\b(etaswap\s*(pets?|video|test)|etapet|etavid|^eta$)\b/i.test(String(name || '').trim());
}

function pieceKey(name?: string): keyof typeof VIDEO_ART | undefined {
  const value = String(name || '').toLowerCase();
  return (Object.keys(VIDEO_ART) as Array<keyof typeof VIDEO_ART>).find((item) => value === item.toLowerCase() || value.includes(item.toLowerCase()));
}

export function videoArtImage(name?: string) {
  const key = pieceKey(name);
  if (!key) return '';
  return `https://gateway.pinata.cloud/ipfs/${VIDEO_ART[key].imageCid}`;
}

export function overlayEtaArt(token: { name?: string; tokenId?: string | number; image?: string }, collectionName?: string) {
  return (
    videoArtImage(token.name) ||
    (isEtaMintCollection(collectionName) && Number(token.tokenId) >= 1 && Number(token.tokenId) <= 3
      ? videoArtImage(PIECE_ORDER[Number(token.tokenId) - 1])
      : '') ||
    token.image ||
    ''
  );
}

export function videoArtTokenUri(name: string) {
  const key = Object.keys(VIDEO_ART).find((item) => item.toLowerCase() === String(name || '').trim().toLowerCase()) as
    | keyof typeof VIDEO_ART
    | undefined;
  if (!key) return '';
  return `ipfs://${VIDEO_ART[key].metaCid}`;
}
