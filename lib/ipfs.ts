export function ipfsToHttp(url: string) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('ipfs://')) {
    return `https://gateway.pinata.cloud/ipfs/${value.slice('ipfs://'.length)}`;
  }
  return value;
}
