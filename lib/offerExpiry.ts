export const OFFER_DURATIONS = [
  { seconds: 5 * 60, label: '5 min' },
  { seconds: 15 * 60, label: '15 min' },
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 6 * 60 * 60, label: '6 hours' },
  { seconds: 12 * 60 * 60, label: '12 hours' },
  { seconds: 24 * 60 * 60, label: '1 day' },
  { seconds: 7 * 24 * 60 * 60, label: '7 days' },
] as const;

export const DEFAULT_OFFER_DURATION = 60 * 60;
export const MIN_OFFER_DURATION = 5 * 60;
export const MAX_IN_WALLET_OFFER_DURATION = 24 * 60 * 60;
export const MAX_OFFER_DURATION = 7 * 24 * 60 * 60;

export function clampOfferDuration(seconds: number, max = MAX_OFFER_DURATION) {
  if (!Number.isFinite(seconds)) return DEFAULT_OFFER_DURATION;
  return Math.min(max, Math.max(MIN_OFFER_DURATION, Math.floor(seconds)));
}

export function offerDurationLabel(seconds: number) {
  return OFFER_DURATIONS.find((option) => option.seconds === seconds)?.label || `${Math.round(seconds / 60)} min`;
}
