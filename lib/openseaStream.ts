import {
  applyLiveNftMove,
  getOpenSeaKeys,
  invalidateAccountNftCache,
  isWatchedInventoryWallet,
  type OpenSeaNft,
  watchInventoryWallet,
} from './opensea';

type StreamFrame = [string | null, string | null, string, string, any];
type TransferListener = (wallet: string) => void;

const listeners = ((globalThis as any).__etaswapTransferListeners ??= new Set()) as Set<TransferListener>;
const lastEventAt = new Map<string, number>();

let started = false;
let socket: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
let ref = 2;
let keyIndex = 0;
let backoffMs = 1_500;
let lastPong = 0;

export function onWatchedTransfer(listener: TransferListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function eventTime(body: any) {
  const raw =
    body?.event_timestamp ||
    body?.payload?.event_timestamp ||
    body?.sent_at ||
    body?.payload?.transaction?.timestamp;
  const value = Date.parse(String(raw || ''));
  return Number.isFinite(value) ? value : Date.now();
}

function walletsFromEvent(payload: any): string[] {
  const wallets = new Set<string>();
  const raw = [
    payload?.from_account?.address,
    payload?.to_account?.address,
    payload?.from_account?.user?.address,
    payload?.to_account?.user?.address,
    payload?.maker?.address,
    payload?.taker?.address,
    payload?.seller?.address,
    payload?.buyer?.address,
    payload?.winner_account?.address,
    payload?.owner?.address,
    payload?.item?.nft_id,
    payload?.nft_id,
    payload?.payload?.from_account?.address,
    payload?.payload?.to_account?.address,
  ];
  for (const value of raw) {
    const text = String(value || '');
    const match = text.match(/0x[a-fA-F0-9]{40}/g) || [];
    for (const found of match) wallets.add(found.toLowerCase());
  }
  return [...wallets];
}

function nftFromPayload(payload: any): OpenSeaNft | null {
  const nftId = String(payload?.item?.nft_id || payload?.nft?.nft_id || '');
  const parts = nftId.split('/');
  const contract = String(payload?.item?.contract || payload?.nft?.contract || parts[1] || '').toLowerCase();
  const identifier = String(payload?.nft?.identifier || payload?.item?.identifier || payload?.item?.token_id || parts[2] || '');
  if (!contract.startsWith('0x') || !identifier) return null;
  const meta = payload?.item?.metadata || {};
  const image = meta.image_url || payload?.nft?.display_image_url || payload?.nft?.image_url || '';
  return {
    identifier,
    contract,
    collection: payload?.collection?.slug || payload?.item?.collection || payload?.nft?.collection || '',
    name: meta.name || payload?.nft?.name || identifier,
    image_url: image,
    display_image_url: image,
    token_standard: payload?.item?.chain ? 'erc721' : payload?.nft?.token_standard || 'erc721',
  };
}

function publish(wallet: string, at: number) {
  const previous = lastEventAt.get(wallet) || 0;
  if (at + 50 < previous) return;
  lastEventAt.set(wallet, at);
  invalidateAccountNftCache(wallet);
  listeners.forEach((listener) => {
    try {
      listener(wallet);
    } catch {
      /* ignore listener errors */
    }
  });
}

function handleEvent(eventName: string, body: any) {
  const type = String(body?.event_type || eventName || '');
  if (
    type !== 'item_transferred' &&
    type !== 'item_sold' &&
    !type.includes('transfer') &&
    type !== 'item_received'
  ) {
    return;
  }
  const at = eventTime(body);
  const payload = body?.payload || body;
  const nft = nftFromPayload(payload);
  const from = String(
    payload?.from_account?.address || payload?.maker?.address || payload?.seller?.address || ''
  ).toLowerCase();
  const to = String(
    payload?.to_account?.address || payload?.taker?.address || payload?.winner_account?.address || payload?.buyer?.address || ''
  ).toLowerCase();
  if (nft) applyLiveNftMove({ from, to, nft });
  const watched = walletsFromEvent(payload).filter(isWatchedInventoryWallet);
  for (const wallet of watched) publish(wallet, at);
}

function stopSocket() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  socket = null;
}

function connect() {
  if (typeof WebSocket === 'undefined') return;
  const keys = getOpenSeaKeys();
  if (!keys.length) return;
  const key = keys[keyIndex % keys.length];
  stopSocket();
  const url = `wss://stream-api.opensea.io/socket/websocket?token=${encodeURIComponent(key)}&vsn=2.0.0`;
  const next = new WebSocket(url);
  socket = next;
  lastPong = Date.now();

  next.addEventListener('open', () => {
    backoffMs = 1_500;
    next.send(
      JSON.stringify([
        '1',
        '1',
        'collection:*',
        'phx_join',
        { event_types: ['item_transferred', 'item_sold'] },
      ])
    );
    heartbeat = setInterval(() => {
      if (next.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPong > 35_000) {
        scheduleReconnect(1_000);
        return;
      }
      ref += 1;
      next.send(JSON.stringify([null, String(ref), 'phoenix', 'heartbeat', {}]));
    }, 30_000);
  });

  next.addEventListener('message', (event) => {
    try {
      const frame = JSON.parse(String(event.data)) as StreamFrame;
      if (!Array.isArray(frame) || frame.length < 5) return;
      const topic = String(frame[2] || '');
      const name = String(frame[3] || '');
      const body = frame[4];
      if (name === 'phx_reply') {
        lastPong = Date.now();
        if (body?.status === 'error') {
          keyIndex = (keyIndex + 1) % Math.max(keys.length, 1);
          scheduleReconnect(1_500);
        }
        return;
      }
      if (topic.startsWith('collection:') && name !== 'phx_error') {
        handleEvent(name, body);
      }
    } catch {
      /* ignore malformed frames */
    }
  });

  next.addEventListener('close', () => scheduleReconnect(backoffMs));
  next.addEventListener('error', () => {
    keyIndex = (keyIndex + 1) % Math.max(keys.length, 1);
    scheduleReconnect(backoffMs);
  });
}

function scheduleReconnect(delayMs: number) {
  if (reconnect || !started) return;
  stopSocket();
  reconnect = setTimeout(() => {
    reconnect = null;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    connect();
  }, delayMs);
}

export function startOpenSeaStream() {
  if (typeof window !== 'undefined') return;
  const globalState = globalThis as typeof globalThis & { __etaswapOpenSeaStreamStop?: () => void };
  if (started) return;
  started = true;
  globalState.__etaswapOpenSeaStreamStop?.();
  globalState.__etaswapOpenSeaStreamStop = () => {
    started = false;
    if (reconnect) clearTimeout(reconnect);
    reconnect = null;
    stopSocket();
  };
  connect();
}

export function watchWalletsForStream(wallets: string[]) {
  for (const wallet of wallets) watchInventoryWallet(wallet);
}
