'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { envNetwork, type AppNetwork } from '@/lib/networkPref';

const NetworkPrefContext = createContext<AppNetwork>(envNetwork());

export function NetworkPrefProvider({
  initialNetwork,
  children,
}: {
  initialNetwork: AppNetwork;
  children: ReactNode;
}) {
  return <NetworkPrefContext.Provider value={initialNetwork}>{children}</NetworkPrefContext.Provider>;
}

export function useAppNetwork() {
  return useContext(NetworkPrefContext);
}
