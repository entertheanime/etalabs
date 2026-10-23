import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const ZERO = '0x0000000000000000000000000000000000000000';

function tradeField(chainId?: number) {
  if (chainId === 143) return 'monadV9';
  if (chainId === 57073) return 'inkV9';
  return 'robinhoodTestnet';
}

function escrowField(chainId: number) {
  if (chainId === 143) return 'monadEscrowV1';
  if (chainId === 57073) return 'inkEscrowV1';
  return 'escrowV1';
}

export async function saveSharedTradeContract(address: string, chainId?: number) {
  try {
    if (!address || address.toLowerCase() === ZERO) return;
    await setDoc(
      doc(db, 'settings', 'contracts'),
      { [tradeField(chainId)]: address.toLowerCase(), updatedAt: Date.now() },
      { merge: true }
    );
  } catch (error) {
    console.warn('Could not save shared trade contract', error);
  }
}

export async function getSharedTradeContract(chainId?: number): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'contracts'));
    const addr = snap.data()?.[tradeField(chainId)];
    if (typeof addr === 'string' && addr && addr.toLowerCase() !== ZERO) {
      return addr;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveSharedEscrowContract(address: string, chainId: number) {
  try {
    if (!address || address.toLowerCase() === ZERO) return;
    await setDoc(
      doc(db, 'settings', 'contracts'),
      {
        [escrowField(chainId)]: address.toLowerCase(),
        escrowV1: address.toLowerCase(),
        escrowV1ChainId: chainId,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn('Could not save shared escrow contract', error);
  }
}

export async function getSharedEscrowContract(chainId: number): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'contracts'));
    const data = snap.data();
    const keyed = data?.[escrowField(chainId)];
    if (typeof keyed === 'string' && keyed && keyed.toLowerCase() !== ZERO) {
      return keyed;
    }
    if (Number(data?.escrowV1ChainId) !== chainId) return null;
    const addr = data?.escrowV1;
    if (typeof addr === 'string' && addr && addr.toLowerCase() !== ZERO) {
      return addr;
    }
  } catch {
    /* ignore */
  }
  return null;
}
