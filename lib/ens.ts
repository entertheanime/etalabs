export function isEnsName(value: string) {
  const name = value.trim().toLowerCase();
  if (!name.endsWith('.eth') || name.startsWith('0x') || /\s/.test(name)) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+eth$/.test(name);
}

export function shortWallet(value: string) {
  if (!value || value.length < 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
