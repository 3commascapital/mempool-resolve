import type { Block, Hex, RpcTransaction } from 'viem'
import { mempools, type Pool } from './watch.js'
import _ from 'lodash'
import type { InkApp, UI } from './ui/App.js'
import { processIsRunning, raceShutdown } from './process.js'
import { enoughBalanceToCover, type PoolType, serializeRpcTransaction, type TxType, typeList, wait } from './utils.js'
import { Endpoint } from './verification.js'
import { retry } from './utils.js'
import promiseLimit from 'promise-limit'
import { args } from './args.js'

const widecastLimiter = promiseLimit<[Hex, bigint]>(16)

export type Summary = {
  pending: Set<Hex>
  queued: Set<Hex>
}

export type RpcTransactionWithExtras = RpcTransaction & {
  from: Hex
  pool: PoolType
  origins: Set<Endpoint> // keys of the rpc endpoints that have this tx in their mempool
}

export type MempoolStructure = {
  byHash: Map<Hex, RpcTransactionWithExtras>
  byAddress: Map<Hex, Set<RpcTransactionWithExtras>>
  poolSummary: Map<Endpoint, Summary>
}

export type PricePartition = {
  wellPriced: Set<Hex>
  lowerPriced: Set<Hex>
}

export type MempoolDeltas = {
  highEndTransactions: Map<Hex, bigint>
  differences: Map<Endpoint, Map<Endpoint, PricePartition>>
  mischaracterized: Map<Endpoint, Set<Hex>>
}

export type BalanceData = {
  amount: bigint
  latestNonce: bigint
  block: Block
}

export type MempoolWidecasted = {
  widecasted: Set<Hex>
  recentBroadcastAttempts: Map<Endpoint, Map<Hex, WidecastStatus>>
}

export type MempoolFilters = {
  addresses: Set<Hex>
  balancesByAddress: Map<Hex, BalanceData>
}

export type PreviousMempoolSnapshot = (MempoolStructure & MempoolDeltas & MempoolFilters) | undefined

let lastMempoolStructure: PreviousMempoolSnapshot = undefined

let lastWidecastedTransactions: MempoolWidecasted | undefined = undefined

let lastWidecastable: MempoolDeltas | undefined = undefined

const knownErrors = {
  NONCE_TOO_LOW: 'nonce too low',
  GAS_LIMIT_EXCEEDED: 'exceeds block gas limit',
  INSUFFICIENT_FUNDS: 'insufficient funds for gas * price + value',
}
/**
 * loop over the mempool structure and find differences between endpoints
 * update the endpoints with any missing transactions when widecast is enabled
 * @param ui - the ink app to update
 */
export const printMempoolDiffs = async (ui: InkApp) => {
  let lastIdentifier: number | undefined = undefined

  while (true) {
    if (!processIsRunning()) return
    const { identifier, pools } = mempools()
    if (lastIdentifier !== identifier && pools.size) {
      const structure = getMempoolStructure(pools)
      const widecastable = widecastableTransactions(pools, structure)
      ui.update({
        byHash: structure.byHash,
        pools: pools,
        args: args(),
        summary: structure.poolSummary,
        previousSummary: lastMempoolStructure?.poolSummary,
        lastRestarted: new Date(),
        ...widecastable,
      })
      const filtered = await getFilters(pools, lastMempoolStructure, structure, widecastable)
      const widecastedTransactions = await widecastTransactions(pools, structure, widecastable, filtered, ui.update)
      if (!processIsRunning()) return
      ui.update({
        ...widecastedTransactions,
      })
      lastWidecastedTransactions = widecastedTransactions
      lastMempoolStructure = { ...structure, ...widecastable, ...widecastedTransactions, ...filtered }
      lastWidecastable = widecastable
    } else {
      ui.update({
        ...lastMempoolStructure,
        ...lastWidecastable,
        ...lastWidecastedTransactions,
      })
    }
    lastIdentifier = identifier
    // how often should we check to see if there is new data to diff?
    if (!processIsRunning()) return
    await raceShutdown(wait(100))
  }
}

const oneEther = 10n ** 18n
/** the minimum balance of an account to be considered for widecasting */
const minimumBalance = BigInt(args().minBalanceEther) * oneEther

/** the number of blocks between checking the balance of an account */
const balanceBlockInterval = BigInt(args().balanceBlockInterval)

export type WidecastStatus = {
  lastBlock: bigint
  error: string | null
}

// the result of the last widecast attempt
const recentBroadcastAttempts = new Map<Endpoint, Map<Hex, WidecastStatus>>()

// the number of blocks to wait before rebroadcasting a tx, again
const rebroadcastBlockInterval = BigInt(args().rebroadcastBlockInterval)

/**
 * widecast transactions to endpoints that are missing them
 * @param pools - the pools to widecast to
 * @param structure - the mempool structure
 * @param deltas - the deltas between endpoints
 * @param filters - the filters to apply to the transactions
 * @param onUpdate - the function to call when the widecasted transactions are updated
 * @returns the widecasted transactions
 */
const widecastTransactions = async (
  pools: Map<Endpoint, Pool>,
  structure: MempoolStructure,
  deltas: MempoolDeltas,
  filters: MempoolFilters,
  onUpdate: (ui: UI) => void
) => {
  if (!args().widecast) {
    return {
      widecasted: new Set<Hex>(),
      recentBroadcastAttempts: new Map<Endpoint, Map<Hex, WidecastStatus>>(),
    }
  }
  const widecasted = new Set<Hex>()
  const block = [...pools.values()][0]!.block
  const transactionsSortedByPriority = _([...deltas.highEndTransactions.entries()])
    .sortBy(([hash]) => {
      // first sort by signer, then, if it's the same signer, sort by nonce
      const rpcTx = structure.byHash.get(hash)!
      return `${rpcTx.from}:${rpcTx.nonce}`.toLowerCase()
    })
    .uniqBy(([hash]) => {
      const rpcTx = structure.byHash.get(hash)!
      return rpcTx.from.toLowerCase()
    })
    .filter(([hash]) => {
      // check that there is more than enough balance to cover the tx, including a minimum balance to reduce
      // non urgent transactions from bots or other spam
      const rpcTx = structure.byHash.get(hash)!
      const balance = filters.balancesByAddress.get(rpcTx.from)
      if (!balance) {
        return false
      }
      if (balance.amount < minimumBalance) {
        return false
      }
      if (balance.latestNonce !== BigInt(rpcTx.nonce)) {
        return false
      }
      return enoughBalanceToCover(rpcTx, block, balance.amount)
    })
    .sort((a, b) => {
      // sort by highest priority fees to lowest so that nodes are better off
      return a[1] > b[1] ? -1 : 1
    })
    .value()
  onUpdate({
    possibleWidecasts: transactionsSortedByPriority.length,
  })
  // const errors = new Map<Endpoint, Map<string, number[]>>()
  const addError = (endpoint: Endpoint, error: string, tx: Hex) => {
    const existing = recentBroadcastAttempts.get(endpoint) ?? new Map<Hex, WidecastStatus>()
    existing.set(tx, { lastBlock: block.number!, error })
    recentBroadcastAttempts.set(endpoint, existing)
  }
  const widecastedTransactions = {
    widecasted,
    recentBroadcastAttempts,
  }
  for (const endpoint of pools.keys()) {
    const existing = recentBroadcastAttempts.get(endpoint) ?? new Map<Hex, WidecastStatus>()
    for (const [hash, status] of existing.entries()) {
      if (status.lastBlock + rebroadcastBlockInterval <= block.number!) {
        existing.delete(hash)
      }
    }
  }
  const currentRoundBroadcast = {} as Record<`${Endpoint['id']}-${TxType}`, Map<Hex, WidecastStatus>>
  let breakout = false
  await widecastLimiter.map(transactionsSortedByPriority, async ([tx]) => {
    if (!processIsRunning() || breakout) return
    const rpcTx = structure.byHash.get(tx)
    if (!rpcTx) return
    const sent = await Promise.all(
      pools.entries().map(async ([endpoint, pool]) => {
        if (rpcTx.origins.has(endpoint)) return 0 // endpoint already has this tx
        const endpointRebroadcasts = recentBroadcastAttempts.get(endpoint) || new Map<Hex, WidecastStatus>()
        recentBroadcastAttempts.set(endpoint, endpointRebroadcasts)
        const successfulRebroadcastAt = endpointRebroadcasts?.get(tx)
        if (successfulRebroadcastAt) {
          return 0
        }
        const txTypeNumber = Number(rpcTx.type)
        const type = typeList[txTypeNumber] as TxType
        const k = `${endpoint.id}-${type}` as const
        const count = currentRoundBroadcast[k] || new Map<Hex, WidecastStatus>()
        if (count.size >= 50) {
          // we return null to indicate that 50 txs have already been broadcasted to this endpoint
          // this allows the loop to break early
          return null
        }
        currentRoundBroadcast[k] = count
        const serialized = serializeRpcTransaction(rpcTx)
        if (!serialized) {
          return 0
        }
        try {
          await pool.publicClient
            .sendRawTransaction({
              serializedTransaction: serialized,
            })
            .catch((e) => {
              let firstLine = e.details.split('\n')[0]
              if (firstLine.includes(knownErrors.INSUFFICIENT_FUNDS)) {
                const index = firstLine.indexOf(knownErrors.INSUFFICIENT_FUNDS)
                firstLine = firstLine.slice(0, index + 42)
              } else if (firstLine.includes(knownErrors.NONCE_TOO_LOW)) {
                const index = firstLine.indexOf(knownErrors.NONCE_TOO_LOW)
                firstLine = firstLine.slice(0, index + 13)
              }
              addError(endpoint, firstLine, tx)
              throw e
            })

          count.set(tx, { lastBlock: block.number!, error: null })
          endpointRebroadcasts.set(tx, { lastBlock: block.number!, error: null })
          return 1
        } catch (err) {
          return 0
        }
      })
    )
    onUpdate({
      ...widecastedTransactions,
    })
    const nonNulls = sent.filter((s) => s !== null)
    if (nonNulls.length === 0) {
      breakout = true
    }
  })
  return widecastedTransactions
}

/**
 * find the transactions that are worth widecasting with the provided data
 * @param pools - the pools to check
 * @param structure - the mempool structure
 * @returns the high end transactions
 */
const widecastableTransactions = (pools: Map<Endpoint, Pool>, structure: MempoolStructure) => {
  const highEndTransactions = new Map<Hex, bigint>()
  const differences = new Map<Endpoint, Map<Endpoint, PricePartition>>()
  const mischaracterized = new Map<Endpoint, Set<Hex>>()
  if (pools.size === 0) {
    return { highEndTransactions, differences, mischaracterized }
  }
  const leastExpensiveLatestBlock = [...pools.values()].reduce((acc, pool) => {
    if (!acc.block.baseFeePerGas && pool.block.baseFeePerGas) {
      return pool
    } else if (
      pool.block.baseFeePerGas &&
      acc.block.baseFeePerGas &&
      pool.block.baseFeePerGas < acc.block.baseFeePerGas
    ) {
      return pool
    }
    return acc
  }).block
  const buffer = 11_250n
  const bp = 10_000n
  const bufferedBaseFee = (leastExpensiveLatestBlock.baseFeePerGas! * buffer) / bp
  for (const [hash, tx] of structure.byHash.entries()) {
    const type = Number(tx.type)
    // how "good" of a transaction is this?
    let measure = 0n
    if (type === 2 && tx.maxFeePerGas && BigInt(tx.maxFeePerGas) >= bufferedBaseFee) {
      // only care about type 2 transactions that have
      // a sufficiently high priority fee (5% of maxFeePerGas)
      const maxPriorityFee = BigInt(tx.maxPriorityFeePerGas)
      const maxFee = BigInt(tx.maxFeePerGas)
      const minimumGoodPriorityFee = maxFee / 20n
      measure = maxPriorityFee - minimumGoodPriorityFee
    } else if ((type === 0 || type === 1) && tx.gasPrice && BigInt(tx.gasPrice) >= bufferedBaseFee) {
      measure = BigInt(tx.gasPrice) - bufferedBaseFee
    }
    if (measure <= 0n) {
      continue
    }
    highEndTransactions.set(hash, measure)
  }
  ;[...pools.entries()].forEach(([endpointA, poolA]) => {
    ;[...pools.entries()].forEach(([endpointB]) => {
      const aDiffs = differences.get(endpointA) ?? new Map<Endpoint, PricePartition>()
      const pairDiffs = aDiffs.get(endpointB) ?? {
        wellPriced: new Set<Hex>(),
        lowerPriced: new Set<Hex>(),
      }
      if (endpointA !== endpointB) {
        for (const hash of poolA.all.values()) {
          const tx = structure.byHash.get(hash)
          if (!tx) continue
          const isInEndpointA = tx.origins.has(endpointA)
          const isInEndpointB = tx.origins.has(endpointB)
          if (isInEndpointA && isInEndpointB) continue
          if (highEndTransactions.has(hash)) {
            pairDiffs.wellPriced.add(hash)
          } else {
            pairDiffs.lowerPriced.add(hash)
          }
        }
      }
      aDiffs.set(endpointB, pairDiffs)
      differences.set(endpointA, aDiffs)
    })
  })
  return {
    highEndTransactions,
    differences,
    mischaracterized,
  }
}

/**
 * get the filters for the provided data
 * @param pools - the pools to check
 * @param previousStructure - the previous mempool structure
 * @param structure - the current mempool structure
 * @param widecastable - the widecastable transactions
 * @returns the filters (addresses and balances)
 */
const getFilters = async (
  pools: Map<Endpoint, Pool>,
  previousStructure: PreviousMempoolSnapshot,
  structure: MempoolStructure,
  widecastable: MempoolDeltas
): Promise<MempoolFilters> => {
  const addresses = new Set<Hex>()
  for (const tx of widecastable.highEndTransactions.keys()) {
    const rpcTx = structure.byHash.get(tx)!
    if (previousStructure) {
    }
    addresses.add(rpcTx.from)
  }
  const firstPool = [...pools.values()][0]!
  const balancesByAddress = new Map<Hex, BalanceData>()
  const currentBlock = firstPool.block
  await Promise.all(
    [...addresses.values()].map((address) => {
      if (previousStructure) {
        const previousBalanceData = previousStructure.balancesByAddress.get(address)
        if (previousBalanceData) {
          if (previousBalanceData.block.number! >= currentBlock.number! - balanceBlockInterval) {
            // if the balance is less than x blocks old, we don't need to check it
            return
          }
        }
      }
      return Promise.all([
        retry(() =>
          firstPool.publicClient.getBalance({
            address,
            blockNumber: currentBlock.number!,
          })
        ),
        retry(() =>
          firstPool.publicClient.getTransactionCount({
            address,
            blockTag: 'latest',
          })
        ),
      ]).then(([bal, latestNonce]) => {
        if (bal < minimumBalance) {
          // if the balance is less than the minimum, we should treat it as if it were 0
          bal = 0n
        }
        balancesByAddress.set(address, {
          amount: bal,
          latestNonce: BigInt(latestNonce),
          block: currentBlock,
        })
      })
    })
  )
  return {
    addresses,
    balancesByAddress,
  }
}

/**
 * get the mempool structure from the provided pools
 * @param pools - the pools to check
 * @returns the mempool structure
 * @notice only the first transaction from each address is considered
 */
const getMempoolStructure = (pools: Map<Endpoint, Pool>): MempoolStructure => {
  const byHash = new Map<Hex, RpcTransactionWithExtras>()
  const byAddress = new Map<Hex, Set<RpcTransactionWithExtras>>()
  const poolSummary = new Map<Endpoint, Summary>()
  const structure: MempoolStructure = { byHash, byAddress, poolSummary }
  for (const [endpoint, pool] of pools.entries()) {
    const append = appendRpcTransaction(structure)
    const { pending, queued } = pool.contents
    for (const txs of Object.values(pending)) {
      for (const tx of Object.values(txs)) {
        append('pending', endpoint, tx)
        break
      }
    }
    for (const txs of Object.values(queued)) {
      for (const tx of Object.values(txs)) {
        append('queued', endpoint, tx)
        break
      }
    }
  }
  return structure
}

/**
 * append a transaction to the mempool structure
 * @param structure - the mempool structure
 * @returns the function to append a transaction to the mempool structure
 */
const appendRpcTransaction =
  (structure: MempoolStructure) => (key: PoolType, endpoint: Endpoint, tx: RpcTransaction) => {
    // increment the global counts
    const summary = structure.poolSummary.get(endpoint) ?? { pending: new Set<Hex>(), queued: new Set<Hex>() }
    summary[key].add(tx.hash)
    structure.poolSummary.set(endpoint, summary)
    // add the tx to the global map by tx hash
    // print(tx)
    const txWithExtras = structure.byHash.get(tx.hash) ?? {
      ...tx,
      pool: key,
      origins: new Set<Endpoint>(),
      from: tx.from as Hex,
    }
    txWithExtras.origins.add(endpoint)
    structure.byHash.set(tx.hash, txWithExtras)
    // add the tx to the global map by address
    const signer = tx.from.toLowerCase() as Hex
    const existingUnderAddress = structure.byAddress.get(signer) ?? new Set<RpcTransactionWithExtras>()
    existingUnderAddress.add(txWithExtras)
    structure.byAddress.set(signer, existingUnderAddress)
  }
