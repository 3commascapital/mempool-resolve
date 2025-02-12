import React from 'react'
import type { UI } from './App.js'
import _ from 'lodash'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

export const Summary = (props: UI) => {
  const rows = _([...(props.summary || new Map()).entries()])
    .sortBy(([endpoint]) => endpoint.id)
    .flatMap(([endpoint, summary]) => {
      const pools = props.pools!.get(endpoint)!
      // allows us to focus on the hostname without leaving (most) api keys in logs
      const url = new URL(endpoint.rpc || 'https://rpc.ankr.com/eth')
      const info = {
        id: endpoint.id,
        rpc: `${url.hostname}${url.pathname.length > 1 ? '/…' : ''}`,
        block: Number(props.pools!.get(endpoint)!.block.number),
        pending: summary.pending.size,
        queued: summary.queued.size,
        pendingDeltaAdd: null as number | null,
        pendingDeltaRemove: null as number | null,
        queuedDeltaAdd: null as number | null,
        queuedDeltaRemove: null as number | null,
      }
      const { pending, queued } = pools.deltas
      if (pending.added) {
        info.pendingDeltaAdd = pending.added.size
      }
      if (pending.removed) {
        info.pendingDeltaRemove = pending.removed.size
      }
      if (queued.added) {
        info.queuedDeltaAdd = queued.added.size
      }
      if (queued.removed) {
        info.queuedDeltaRemove = queued.removed.size
      }
      return info
    })
    .value()
  const idSpace = 2
  const rpcSpace = 24
  const maxBlockLength = Math.max(...rows.map((row) => row.block.toString().length)) + 2
  const summarySpace = 18
  const marginX = 1
  const marginXTotal = marginX * 2
  const columns = [
    idSpace + marginXTotal,
    rpcSpace + marginXTotal,
    maxBlockLength + marginXTotal,
    summarySpace + marginXTotal,
    summarySpace + marginXTotal,
  ]
  const totalWidth = columns.reduce((acc, column) => acc + column, 0) + 2
  // @ts-ignore
  return (
    <Box flexDirection="column">
      <Box>
        <Text>Summary</Text>
      </Box>
      {!rows.length ? (
        <Spinner />
      ) : (
        <Box flexDirection="column" width={totalWidth} borderStyle="single" borderColor="grey">
          <Box flexDirection="row">
            <Box width={idSpace} marginX={marginX}>
              <Text color="gray">ID</Text>
            </Box>
            <Box width={rpcSpace} marginX={marginX}>
              <Text color="gray">RPC</Text>
            </Box>
            <Box width={maxBlockLength} marginX={marginX}>
              <Text color="gray">Block#</Text>
            </Box>
            <Box width={summarySpace} marginX={marginX} justifyContent="space-between">
              <Text color="gray">Pending</Text>
              <Text color="gray">Δ</Text>
            </Box>
            <Box width={summarySpace} marginX={marginX} justifyContent="space-between">
              <Text color="gray">Queued</Text>
              <Text color="gray">Δ</Text>
            </Box>
          </Box>
          {rows.map((row) => (
            <Box key={row.rpc} flexDirection="row">
              <Box marginX={marginX} width={idSpace}>
                <Text color="yellow">{row.id}</Text>
              </Box>
              <Box marginX={marginX} width={rpcSpace}>
                <Text wrap="truncate-middle">{row.rpc}</Text>
              </Box>
              <Box marginX={marginX} width={maxBlockLength}>
                <Text>{row.block}</Text>
              </Box>
              <Box marginX={marginX} width={summarySpace} justifyContent="space-between">
                <Text>{row.pending}</Text>
                <Box>
                  <Text color="green">+{row.pendingDeltaAdd}</Text>
                  <Text color="gray">/</Text>
                  <Text color="red">-{row.pendingDeltaRemove}</Text>
                </Box>
              </Box>
              <Box marginX={marginX} width={summarySpace} justifyContent="space-between">
                <Text>{row.queued}</Text>
                <Box>
                  <Text color="green">+{row.queuedDeltaAdd}</Text>
                  <Text color="gray">/</Text>
                  <Text color="red">-{row.queuedDeltaRemove}</Text>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
