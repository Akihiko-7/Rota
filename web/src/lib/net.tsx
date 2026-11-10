// The network in the URL (/testnet/..., /mainnet/...) and the visitor's last choice.

import { createContext, useContext, type ReactNode } from "react";
import { NETWORKS, type Net, type NetConfig } from "../config";

const KEY = "rota-network";
const ACK = "rota-mainnet-warning-seen";

export function lastNetwork(): Net {
  try {
    return localStorage.getItem(KEY) === "mainnet" ? "mainnet" : "testnet";
  } catch {
    return "testnet";
  }
}

export function rememberNetwork(net: Net): void {
  try {
    localStorage.setItem(KEY, net);
  } catch {
    // Private mode: the URL still carries the network.
  }
}

export function mainnetWarningSeen(): boolean {
  try {
    return localStorage.getItem(ACK) === "1";
  } catch {
    return false;
  }
}

export function markMainnetWarningSeen(): void {
  try {
    localStorage.setItem(ACK, "1");
  } catch {
    // Shown again next time; harmless.
  }
}

interface NetValue {
  net: Net;
  cfg: NetConfig;
  /** "/c/5" → "/testnet/c/5" */
  to(path: string): string;
}

const NetContext = createContext<NetValue | null>(null);

export function NetProvider({ net, children }: { net: Net; children: ReactNode }) {
  const value = { net, cfg: NETWORKS[net], to: (path: string) => `/${net}${path === "/" ? "" : path}` };
  return <NetContext.Provider value={value}>{children}</NetContext.Provider>;
}

export function useNet(): NetValue {
  const v = useContext(NetContext);
  if (!v) throw new Error("useNet outside NetProvider");
  return v;
}
