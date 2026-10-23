function decodeB64(value: string) {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(value, 'base64').toString('utf-8')
    : atob(value);
}

function encodeB64(value: string) {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(value, 'utf-8').toString('base64')
    : btoa(value);
}

/** Drop the thick black frame on etaswap test SVG art. */
export function softenEtaSwapImage(src?: string) {
  if (!src || !src.includes('image/svg+xml')) return src || '';
  try {
    const comma = src.indexOf(',');
    if (comma < 0) return src;
    const svg = decodeB64(src.slice(comma + 1));
    if (!svg.includes('#0b0b0d') && !svg.includes('#0B0B0D')) return src;
    const next = svg
      .replace(/<rect width="400" height="400" rx="48" fill="#0b0b0d"\s*\/>/i, '')
      .replace('x="28" y="28" width="344" height="344" rx="36"', 'width="400" height="400" rx="48"');
    return `${src.slice(0, comma + 1)}${encodeB64(next)}`;
  } catch {
    return src;
  }
}
