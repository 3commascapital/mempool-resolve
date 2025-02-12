import { createPublicClient, createTestClient, http, type PublicClient, type TestClient } from 'viem'

export type Endpoint = {
  id: number
  rpc: string
  testClient: TestClient
  publicClient: PublicClient
}

export const verifySameChain = async (rpcs: string[]): Promise<Endpoint[]> => {
  const results = await Promise.all(
    rpcs.map(async (rpc, idx) => {
      // const key = rpc.split('://')[1]!
      const testClient = createTestClient({
        transport: http(rpc),
        mode: 'anvil',
      }) as TestClient
      const publicClient = createPublicClient({
        transport: http(rpc),
      }) as PublicClient
      return {
        id: idx + 1,
        rpc,
        testClient,
        publicClient,
      }
    })
  )
  return results
}
