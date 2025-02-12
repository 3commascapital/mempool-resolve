import { processIsRunning, raceShutdown } from './process.js'
import type { InkApp } from './ui/App.js'
import { PoolType, retry, wait } from './utils.js'
import type { Endpoint } from './verification.js'
import type { Address, Block, GetTxpoolContentReturnType, Hex, RpcTransaction } from 'viem'

const printError = (error: unknown) => {
  console.error(error)
}

export type Pool = Endpoint & {
  contents: GetTxpoolContentReturnType
  all: Set<Hex>
  deltas: {
    pending: {
      added: Set<Hex> | null
      removed: Set<Hex> | null
    }
    queued: {
      added: Set<Hex> | null
      removed: Set<Hex> | null
    }
  }
  block: Block
}
let identifier = 0
let pools = new Map<Endpoint, Pool>()

/**
 * get the current mempool identifier and pools
 * @returns the current mempool identifier and pools
 */
export const mempools = () => ({
  identifier,
  pools,
})
/**
 * convert a mempool contents object to a list of transaction hashes
 * @param pool - the mempool contents object
 * @returns the list of transaction hashes
 */
const toList = <T extends PoolType>(pool: GetTxpoolContentReturnType[T]) => {
  return Object.values(pool).flatMap((tx) => Object.values(tx).map((tx) => tx.hash))
}

/**
 * watch the mempools of the provided endpoints
 * @param endpoints - the endpoints to watch
 * @param ui - the ui to update
 */
export const watchMempools = async (endpoints: Endpoint[], ui: InkApp) => {
  const getBlockParams = {
    blockTag: 'latest',
  } as const
  while (true) {
    if (!processIsRunning()) {
      break
    }
    ui.update({
      updatingMempools: true,
    })
    await Promise.all(
      endpoints.map((endpoint) => {
        return Promise.all([
          retry(() => endpoint.testClient.getTxpoolContent()),
          retry(() => endpoint.publicClient.getBlock(getBlockParams)),
        ])
      })
    )
      .then((p) => {
        if (!processIsRunning()) return
        ++identifier
        const previousPools = pools
        pools = new Map(
          p.map(([pool, block], i) => {
            const endpoint = endpoints[i]!
            const pendingList = new Set(toList(pool.pending))
            const queuedList = new Set(toList(pool.queued))
            const all = new Set([...pendingList, ...queuedList])
            const previousContents = previousPools.get(endpoint)?.contents
            return [
              endpoint,
              {
                ...endpoint,
                block,
                contents: {
                  ...pool,
                },
                all,
                deltas: {
                  pending: findDeltas(previousContents?.pending, pendingList),
                  queued: findDeltas(previousContents?.queued, queuedList),
                },
              },
            ]
          })
        )
      })
      .catch(printError)
    if (!processIsRunning()) {
      break
    }
    await raceShutdown(wait(4_000))
  }
}

/**
 * find the deltas between the previous and current mempool contents
 * @param previous - the previous mempool contents
 * @param current - the current mempool transaction hashes
 * @returns the deltas
 * @notice if there is no previous contents, it is assumed that all transactions are new
 */
const findDeltas = <T extends PoolType>(
  previous: Record<Address, Record<string, RpcTransaction>> | undefined,
  current: Set<Hex>
) => {
  if (!previous) {
    return { added: null, removed: null }
  }
  const prev = new Set<Hex>(toList<T>(previous))
  const added = new Set<Hex>()
  const removed = new Set<Hex>()
  for (const tx of prev) {
    if (!current.has(tx)) {
      removed.add(tx)
    }
  }
  for (const tx of current) {
    if (!prev.has(tx)) {
      added.add(tx)
    }
  }
  return { added, removed }
}
