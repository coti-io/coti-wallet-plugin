declare module '@coti/pod-sdk' {
  export const COTI_TESTNET_DEFAULT_INBOX_ADDRESS: string;
  export const SEPOLIA_DEFAULT_INBOX_ADDRESS: string;

  export enum DataType {
    String = 'string',
  }

  export interface PodSdkConfig {
    encryptionNetwork: string;
    chains: Array<{
      chainId: number;
      inboxAddress: string;
      rpcUrl: string;
    }>;
  }

  export class PodContract {
    constructor(
      address: string,
      abi: readonly string[],
      runner: unknown,
      options: {
        config: PodSdkConfig;
        inboxAddress: string;
        encryptionNetwork: string;
      }
    );
    estimateFee(
      method: string,
      args: Array<{ type: DataType; value: string; isCallBackFee?: boolean }>,
      options: Record<string, bigint>
    ): Promise<{ remoteFee: bigint; callBackFee: bigint }>;
    execute(
      method: string,
      args: Array<{ type: DataType; value: string; isCallBackFee?: boolean }>,
      options: Record<string, bigint>
    ): Promise<unknown>;
  }

  export interface RequestTrackingResponse {
    execution?: { errorCode?: bigint | number; errorMessage?: string };
    response?: { minedOnTarget?: boolean };
    minedOnTarget?: boolean;
  }

  export class PodRequest {
    constructor(config: PodSdkConfig);
    trackRequest(chainId: number, requestId: string): Promise<RequestTrackingResponse>;
  }
}
