import { ethers } from "ethers";
import { getPrivateTokensForChain } from "../index";
import { POD_PTOKEN_ABI, PRIVACY_PORTAL_ABI } from "../../contracts/pod";

/** Native ETH (or chain native) PoD fees from pToken.estimateFee(); total is sent as tx value. */
export const readPodEstimateFeeWei = async (
  provider: ethers.Provider,
  chainId: number,
  addresses: Record<string, string>,
  publicSymbol: string,
): Promise<{ totalFeeWei: bigint; callbackFeeWei: bigint }> => {
  const plain = publicSymbol.replace(/^p\./, "");
  const priv = getPrivateTokensForChain(chainId).find(t => t.symbol === `p.${plain}`);
  const pAddr = priv?.addressKey ? addresses[priv.addressKey] : undefined;
  if (!pAddr) return { totalFeeWei: 0n, callbackFeeWei: 0n };
  try {
    const c = new ethers.Contract(pAddr, POD_PTOKEN_ABI, provider);
    const fee = await c.estimateFee();
    return {
      totalFeeWei: BigInt(fee[0].toString()),
      callbackFeeWei: BigInt(fee[2].toString()),
    };
  } catch {
    return { totalFeeWei: 0n, callbackFeeWei: 0n };
  }
};

export const parseMintRequestIdFromPodDeposit = (
  receipt: ethers.TransactionReceipt,
  portalAddress: string,
): string | undefined => {
  const iface = new ethers.Interface(PRIVACY_PORTAL_ABI);
  const want = portalAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== want) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "DepositRequested") {
        const mid = parsed.args.mintRequestId;
        return ethers.hexlify(mid as ethers.BytesLike);
      }
    } catch {
      /* wrong log shape */
    }
  }
  return undefined;
};
