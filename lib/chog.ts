export const CHOG_TOKEN_ADDRESS = '0x350035555E10d9AfAF1566AaebfCeD5BA6C27777';
export const CHOG_DECIMALS = 18;
export const CHOG_SYMBOL = 'CHOG';

export function parseChog(amount?: string): bigint {
  const raw = String(amount || '').trim();
  if (!raw || raw === '0') return 0n;
  const [whole = '0', frac = ''] = raw.split('.');
  const fracPadded = (frac + '0'.repeat(CHOG_DECIMALS)).slice(0, CHOG_DECIMALS);
  return BigInt(whole || '0') * 10n ** BigInt(CHOG_DECIMALS) + BigInt(fracPadded || '0');
}

export function formatChog(amount: bigint | string | number | undefined) {
  const value = BigInt(amount || 0);
  if (value === 0n) return '0';
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10n ** BigInt(CHOG_DECIMALS);
  const frac = (abs % 10n ** BigInt(CHOG_DECIMALS)).toString().padStart(CHOG_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function hasChogAmount(amount?: string) {
  return parseChog(amount) > 0n;
}

export async function readChogBalance(wallet?: string) {
  const address = String(wallet || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return '0';
  const data = `0x70a08231000000000000000000000000${address.slice(2).toLowerCase()}`;
  const res = await fetch('https://rpc.monad.xyz', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: CHOG_TOKEN_ADDRESS, data }, 'latest'],
    }),
  });
  const json = await res.json();
  if (!json.result || json.result === '0x') return '0';
  return formatChog(BigInt(json.result));
}
