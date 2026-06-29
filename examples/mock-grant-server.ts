import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';

const COTI_TESTNET_CHAIN_ID = 7082400;
const PORT = Number(process.env.MOCK_GRANT_PORT ?? 8787);
const RPC_URL = process.env.MOCK_GRANT_RPC_URL ?? 'https://testnet.coti.io/rpc';
const PRIVATE_KEY = process.env.MOCK_GRANT_PRIVATE_KEY;
const GRANT_AMOUNT_WEI = process.env.MOCK_GRANT_AMOUNT_WEI;
const GRANT_AMOUNT_COTI = process.env.MOCK_GRANT_AMOUNT_COTI ?? '1';
const MAX_GRANTS_PER_ADDRESS = Number(process.env.MOCK_GRANT_MAX_PER_ADDRESS ?? 3);

if (process.env.NODE_ENV === 'production') {
  throw new Error('mock-grant-server must never run in production.');
}

if (!PRIVATE_KEY) {
  throw new Error('MOCK_GRANT_PRIVATE_KEY is required for local grant testing.');
}

const provider = new JsonRpcProvider(RPC_URL, COTI_TESTNET_CHAIN_ID);
const wallet = new Wallet(PRIVATE_KEY, provider);
const grantsByAddress = new Map<string, number>();

const grantAmount = GRANT_AMOUNT_WEI
  ? BigInt(GRANT_AMOUNT_WEI)
  : parseEther(GRANT_AMOUNT_COTI);

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('Request body too large.'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const { address, chainId } = JSON.parse(await readBody(req)) as {
      address?: string;
      chainId?: number;
    };

    if (chainId !== COTI_TESTNET_CHAIN_ID) {
      sendJson(res, 400, { error: 'Mock grant only supports COTI Testnet.' });
      return;
    }

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      sendJson(res, 400, { error: 'Invalid address.' });
      return;
    }

    const normalizedAddress = address.toLowerCase();
    const grantCount = grantsByAddress.get(normalizedAddress) ?? 0;
    if (grantCount >= MAX_GRANTS_PER_ADDRESS) {
      sendJson(res, 429, { error: 'Grant limit reached for address.' });
      return;
    }

    grantsByAddress.set(normalizedAddress, grantCount + 1);
    const balanceBefore = await provider.getBalance(address);
    const tx = await wallet.sendTransaction({ to: address, value: grantAmount });
    console.log(
      `Grant sent: ${grantAmount.toString()} wei to ${address} on chain ${chainId}. tx=${tx.hash}. balanceBefore=${balanceBefore.toString()}`,
    );
    sendJson(res, 200, {
      txHash: tx.hash,
      amountWei: grantAmount.toString(),
      status: 'submitted',
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Mock grant failed.',
    });
  }
}).listen(PORT, () => {
  console.log(`Mock COTI grant server listening on http://localhost:${PORT}`);
});

