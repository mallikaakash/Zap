"use client";

/**
 * Pay a 1Click deposit address straight from MetaMask (or any injected EVM wallet).
 * Plain JSON-RPC to window.ethereum: no wallet library, nothing to configure.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

interface ChainInfo {
  id: number;
  name: string;
  rpc: string;
  native: { name: string; symbol: string; decimals: number };
  explorer: string;
}

/** 1Click `blockchain` ids of EVM networks we can pay from. */
export const EVM_CHAINS: Record<string, ChainInfo> = {
  eth: { id: 1, name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", native: { name: "Ether", symbol: "ETH", decimals: 18 }, explorer: "https://etherscan.io" },
  pol: { id: 137, name: "Polygon", rpc: "https://polygon-rpc.com", native: { name: "POL", symbol: "POL", decimals: 18 }, explorer: "https://polygonscan.com" },
  base: { id: 8453, name: "Base", rpc: "https://mainnet.base.org", native: { name: "Ether", symbol: "ETH", decimals: 18 }, explorer: "https://basescan.org" },
  arb: { id: 42161, name: "Arbitrum One", rpc: "https://arb1.arbitrum.io/rpc", native: { name: "Ether", symbol: "ETH", decimals: 18 }, explorer: "https://arbiscan.io" },
  op: { id: 10, name: "OP Mainnet", rpc: "https://mainnet.optimism.io", native: { name: "Ether", symbol: "ETH", decimals: 18 }, explorer: "https://optimistic.etherscan.io" },
  bsc: { id: 56, name: "BNB Smart Chain", rpc: "https://bsc-dataseed.bnbchain.org", native: { name: "BNB", symbol: "BNB", decimals: 18 }, explorer: "https://bscscan.com" },
  avax: { id: 43114, name: "Avalanche C-Chain", rpc: "https://api.avax.network/ext/bc/C/rpc", native: { name: "Avalanche", symbol: "AVAX", decimals: 18 }, explorer: "https://snowtrace.io" },
  gnosis: { id: 100, name: "Gnosis", rpc: "https://rpc.gnosischain.com", native: { name: "xDAI", symbol: "XDAI", decimals: 18 }, explorer: "https://gnosisscan.io" },
};

export const isEvmChain = (chain: string | null | undefined): boolean => !!chain && chain in EVM_CHAINS;
export const hasWallet = (): boolean => typeof window !== "undefined" && !!window.ethereum;
export const txUrl = (chain: string, hash: string): string => `${EVM_CHAINS[chain]?.explorer ?? ""}/tx/${hash}`;

const hex = (n: bigint): string => "0x" + n.toString(16);
const pad32 = (h: string): string => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export class WalletError extends Error {}

function friendly(e: unknown): WalletError {
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return new WalletError("You cancelled the request in your wallet.");
  if (err?.code === -32002) return new WalletError("Your wallet already has a request open. Open MetaMask to finish it.");
  return new WalletError(err?.message?.slice(0, 200) ?? "The wallet returned an error.");
}

async function switchChain(eth: Eip1193, c: ChainInfo): Promise<void> {
  const chainId = "0x" + c.id.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw friendly(e);
    await eth
      .request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: c.name, rpcUrls: [c.rpc], nativeCurrency: c.native, blockExplorerUrls: [c.explorer] }] })
      .catch((err: unknown) => {
        throw friendly(err);
      });
  }
}

/**
 * Send exactly `amount` (minor units) of the token to `to` on `chain`.
 * `tokenContract` empty = the chain's native coin. Returns the transaction hash.
 */
export async function payWithWallet(p: { chain: string; tokenContract?: string; to: string; amount: string }): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new WalletError("No browser wallet found. Install MetaMask, or copy the address and amount instead.");
  const c = EVM_CHAINS[p.chain];
  if (!c) throw new WalletError("This network cannot be paid from MetaMask. Copy the address and amount instead.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.to)) throw new WalletError("The deposit address is not an EVM address.");
  let from: string;
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new WalletError("No account selected in your wallet.");
    from = accounts[0];
  } catch (e) {
    throw e instanceof WalletError ? e : friendly(e);
  }
  await switchChain(eth, c);
  const amount = BigInt(p.amount);
  const tx = p.tokenContract
    ? { from, to: p.tokenContract, value: "0x0", data: "0xa9059cbb" + pad32(p.to) + pad32(amount.toString(16)) }
    : { from, to: p.to, value: hex(amount) };
  try {
    return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  } catch (e) {
    throw friendly(e);
  }
}
