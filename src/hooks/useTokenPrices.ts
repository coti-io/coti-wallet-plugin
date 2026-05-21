import { useState, useEffect, useCallback } from 'react';
import { band } from "@bandprotocol/bandchain.js";

const RPC_ENDPOINT = "https://band-testnet-rpc.polkachu.com";

export interface TokenPriceMap {
    [symbol: string]: number;
}

export interface UseTokenPricesReturn {
    prices: TokenPriceMap | null;
    amountsForOneDollar: TokenPriceMap | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

/**
 * Hook to fetch current cryptocurrency prices from Band Protocol
 * and calculate the amount of each token equivalent to $1.00 USD.
 */
export const useTokenPrices = (): UseTokenPricesReturn => {
    const [prices, setPrices] = useState<TokenPriceMap | null>(null);
    const [amountsForOneDollar, setAmountsForOneDollar] = useState<TokenPriceMap | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchPrices = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const { createRPCQueryClient } = band.ClientFactory;
            const client = await createRPCQueryClient({ rpcEndpoint: RPC_ENDPOINT });

            if (client.band?.feeds?.v1beta1?.allPrices) {
                const response = await client.band.feeds.v1beta1.allPrices();
                const allPrices = response.prices || [];

                // Target symbols from src/contracts/config.ts: WETH, WBTC, USDT, USDC.e, WADA, gCOTI
                // Note: Band uses different signals, we map them as best as possible.
                // Typical Band signals: ETH, BTC, USDT, USDC, ADA, COTI
                const targetSignals = ["CS:ETH-USD", "CS:BTC-USD", "CS:ADA-USD", "CS:COTI-USD", "CS:USDT-USD", "CS:USDC-USD"];

                const priceMap: TokenPriceMap = {};

                allPrices.forEach((p: any) => {
                    if (targetSignals.includes(p.signalId)) {
                        const priceVal = Number(p.price) / 1e9;
                        let symbol = p.signalId.replace("CS:", "").replace("-USD", "");

                        // Map Band symbols to our token symbols
                        if (symbol === "ETH") symbol = "WETH";
                        if (symbol === "BTC") symbol = "WBTC";
                        if (symbol === "ADA") symbol = "WADA";
                        if (symbol === "USDC") symbol = "USDC.e";

                        priceMap[symbol] = priceVal;
                    }
                });

                setPrices(priceMap);

                // Calculate amounts for $1.00 USD
                const amounts: TokenPriceMap = {};
                for (const [symbol, price] of Object.entries(priceMap)) {
                    if (price > 0) {
                        amounts[symbol] = 1 / price;
                    }
                }
                setAmountsForOneDollar(amounts);
            } else {
                throw new Error("Band Protocol client feeds not available");
            }
        } catch (err: any) {
            console.error("Error fetching prices:", err.message);
            setError(err.message || "Failed to fetch prices");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPrices();

        // Refresh every 5 minutes
        const interval = setInterval(fetchPrices, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchPrices]);

    return {
        prices,
        amountsForOneDollar,
        isLoading,
        error,
        refresh: fetchPrices
    };
};
