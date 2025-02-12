import React from 'react'
import { Box, Text } from 'ink'
import type { UI } from './App.js'
import Spinner from 'ink-spinner'
import { typeList } from '../utils.js'
import type { Hex } from 'viem'

type InnerEntry = [null | string, (Set<Hex> | null)[]]

const sortInnerEntry = (a: InnerEntry, b: InnerEntry) => {
  if (a[0] === null && b[0] !== null) {
    return -1
  } else if (a[0] !== null && b[0] === null) {
    return 1
  } else if (a[0] === null && b[0] === null) {
    return 0
  }
  return a[0]! < b[0]! ? -1 : 1
}

type Entry = readonly [number, Map<null | string, (Set<Hex> | null)[]>]

const sortTable = (a: Entry, b: Entry) => {
  if (a[0] > b[0]) {
    return 1
  } else if (a[0] < b[0]) {
    return -1
  }
  return 0
}

export const Widecasts = (props: UI) => {
  const marginX = 1
  const idSpace = 2
  const typeSpace = 7
  const errorSpace = 32
  const totalMarginX = marginX * 2
  const columns = [idSpace, ...typeList.map(() => typeSpace), errorSpace]
  const totalWidth = columns.reduce((acc, column) => acc + column + totalMarginX, 0) + totalMarginX
  const rows = new Map<number, Map<null | string, (Set<Hex> | null)[]>>()
  for (const [endpoint, recentBroadcastAttempts] of props.recentBroadcastAttempts?.entries() || []) {
    const endpointRows = new Map<null | string, (Set<Hex> | null)[]>()
    for (const [hash, status] of recentBroadcastAttempts.entries()) {
      const rpcTx = props.byHash?.get(hash)!
      if (!rpcTx) continue
      const type = Number(rpcTx.type)
      const counts = endpointRows.get(status.error) || new Array<Set<Hex> | null>(typeList.length).fill(null)
      counts[type] = counts[type] || new Set<Hex>()
      counts[type].add(hash)
      endpointRows.set(status.error, counts)
      endpointRows.set(null, endpointRows.get(null) || new Array<Set<Hex> | null>(typeList.length).fill(null))
    }
    rows.set(endpoint.id, endpointRows)
  }
  const sortedRows = [...rows.entries()]
    .map(([endpointId, counts]) => [endpointId, new Map([...counts.entries()].sort(sortInnerEntry))] as const)
    .sort(sortTable)
  if (!props.args?.widecast) {
    return null
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={totalWidth}>
        <Box>
          <Text>
            Widecasts <Text color="gray">({props.possibleWidecasts || 0} possible)</Text>
          </Text>
        </Box>
        <Box>
          <Text color="gray">
            Last restarted:{' '}
            {props.lastRestarted
              ? `${Math.floor((new Date().getTime() - props.lastRestarted.getTime()) / 1000)}s ago`
              : '...'}
          </Text>
        </Box>
      </Box>
      {!props.recentBroadcastAttempts?.size ? (
        <Spinner />
      ) : (
        <Box flexDirection="column" width={totalWidth} borderStyle="single" borderColor="grey">
          <Box flexDirection="row">
            <Box width={idSpace} marginX={marginX}>
              <Text color="gray">ID</Text>
            </Box>
            {typeList.map((type) => (
              <Box width={typeSpace} marginX={marginX} key={type}>
                <Text color="green">{type}</Text>
              </Box>
            ))}
            <Box width={errorSpace} marginX={marginX}>
              <Text color="red">Errors</Text>
            </Box>
          </Box>
          {sortedRows.map(([endpointId, counts]) => (
            <Box key={endpointId} flexDirection="column">
              {[...counts.entries()].map(([k, counts]) => (
                <Box key={`${endpointId}-${k}`} flexDirection="row">
                  <Box width={idSpace} marginX={marginX}>
                    <Text color="yellow">{k ? null : endpointId}</Text>
                  </Box>
                  {typeList.map((type, index) => (
                    <Box width={typeSpace} marginX={marginX} key={`${endpointId}-${type}`}>
                      {counts[index] ? (
                        <Text color={k ? 'gray' : undefined}>{counts[index].size}</Text>
                      ) : (
                        <Text color="gray">-</Text>
                      )}
                    </Box>
                  ))}
                  <Box width={errorSpace} marginX={marginX}>
                    {k ? (
                      <Text color="gray" wrap="truncate-end">
                        {k}
                      </Text>
                    ) : (
                      <Text color="gray">-</Text>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
