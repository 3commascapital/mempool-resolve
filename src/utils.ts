import { Block, type RpcTransaction, type Signature, serializeTransaction } from 'viem'
import type { SignedAuthorizationList } from 'viem/experimental'

export type PoolType = 'pending' | 'queued'

export const typeList = ['legacy', 'eip2930', 'eip1559', 'eip4844', 'eip7702'] as const

export type TxType = (typeof typeList)[number]

export const wait = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const retry = async <T>(fn: () => Promise<T>, retries = 3): Promise<T> => {
  return fn().catch(async (e) => {
    if (retries > 0) {
      await wait(100)
      return retry(fn, retries - 1)
    }
    throw e
  })
}

/**
 * serialize a transaction for a node
 * @param rpcTx - the transaction to serialize
 * @returns the serialized transaction
 */
export const serializeRpcTransaction = (rpcTx: RpcTransaction) => {
  const txTypeNumber = Number(rpcTx.type)
  const type = typeList[txTypeNumber] as TxType
  const baseline = {
    from: rpcTx.from,
    to: rpcTx.to,
    value: BigInt(rpcTx.value),
    gas: BigInt(rpcTx.gas),
    data: rpcTx.input,
    nonce: Number(rpcTx.nonce),
    chainId: Number(rpcTx.chainId || 369),
  } as const
  const sig = rpcTx as unknown as Signature
  if (type === 'legacy') {
    return serializeTransaction(
      {
        type,
        ...baseline,
        gasPrice: rpcTx.gasPrice ? BigInt(rpcTx.gasPrice) : undefined,
      },
      {
        v: BigInt(sig.v!),
        yParity: Number(sig.v!),
        r: sig.r,
        s: sig.s,
      }
    )
  } else if (type === 'eip2930') {
    return serializeTransaction(
      {
        ...baseline,
        type,
        accessList: rpcTx.accessList,
        gasPrice: rpcTx.gasPrice ? BigInt(rpcTx.gasPrice) : undefined,
      },
      sig
    )
  } else if (type === 'eip1559') {
    return serializeTransaction(
      {
        ...baseline,
        type,
        accessList: rpcTx.accessList ? rpcTx.accessList : undefined,
        maxFeePerGas: rpcTx.maxFeePerGas ? BigInt(rpcTx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: rpcTx.maxPriorityFeePerGas ? BigInt(rpcTx.maxPriorityFeePerGas) : undefined,
      },
      {
        yParity: Number(sig.v!),
        r: sig.r,
        s: sig.s,
      }
    )
  } else if (type === 'eip7702') {
    return serializeTransaction(
      {
        ...baseline,
        type,
        accessList: rpcTx.accessList?.length && rpcTx.accessList?.length > 0 ? rpcTx.accessList : undefined,
        authorizationList: rpcTx.authorizationList as unknown as SignedAuthorizationList,
      },
      sig
    )
  }
  // we don't support this type of transaction (eip4844)
  return null
}

/**
 * check if the balance of an account is enough to cover the transaction
 * @param tx - the transaction to check
 * @param currentBlock - the current block
 * @param balance - the balance of the account
 * @returns true if the balance is enough to cover the transaction
 */
export const enoughBalanceToCover = (tx: RpcTransaction, currentBlock: Block, balance: bigint) => {
  const type = Number(tx.type)
  const gas = BigInt(tx.gas!)
  const value = BigInt(tx.value ?? 0)
  if (gas > currentBlock.gasLimit) {
    return false
  }
  if (type === 2) {
    const maxFeePerGas = BigInt(tx.maxFeePerGas!)
    const maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas!)
    // assume that the block was full so the base fee will cut against you
    const nextHighBaseFee = (currentBlock.baseFeePerGas! * 11_250n) / 10_000n
    if (nextHighBaseFee > maxFeePerGas) {
      return false
    }
    if ((nextHighBaseFee + maxPriorityFeePerGas) * gas + value > balance) {
      return false
    }
    // bug on node somewhere?
    // The provided tip (`maxPriorityFeePerGas` = x gwei) cannot be
    // higher than the fee cap (`maxFeePerGas` = y gwei).
    if (maxPriorityFeePerGas > maxFeePerGas) {
      return false
    }
  } else if (type === 1 || type === 0) {
    const gasPrice = BigInt(tx.gasPrice!)
    if (gasPrice < currentBlock.baseFeePerGas!) {
      return false
    }
    if (gasPrice * gas + value > balance) {
      return false
    }
  }
  return true
}
