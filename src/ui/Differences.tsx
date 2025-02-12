import React, { ReactNode } from 'react'
import { Box, Text } from 'ink'
import type { UI } from './App.js'
import type { PricePartition } from '../diff.js'
import type { Endpoint } from '../verification.js'
import Spinner from 'ink-spinner'

export const Differences = (props: UI) => {
  const differences = props.differences || new Map<Endpoint, Map<Endpoint, PricePartition>>()
  const matrix = new Map(
    [...differences.entries()].map(([endpointA, diffs]) => {
      return [
        endpointA.id,
        [...diffs.entries()].map(([endpointB, diff]) => {
          if (endpointA === endpointB) {
            return null
          }
          return {
            idA: endpointA.id,
            idB: endpointB.id,
            wellPriced: diff.wellPriced.size,
            lowerPriced: diff.lowerPriced.size,
          }
        }),
      ] as const
    })
  )
  const keys = (width: number, axis: 'x' | 'y', color: string = 'green', extra: (k: string) => ReactNode = () => []) =>
    [...differences.keys()].map((endpoint) => {
      const key = `${axis}-${endpoint.id}`
      return (
        <Box width={width} marginX={marginX} key={key} justifyContent="space-between">
          <Text color={color}>{endpoint.id}</Text>
          {extra(key)}
        </Box>
      )
    }) || []
  const idWidth = 2
  const width = 14
  const marginX = 1
  const marginXTotal = marginX * 2
  const dataCellTotal = width + marginXTotal
  const bodyWidth = dataCellTotal * differences.size
  const totalWidth = idWidth + marginXTotal + bodyWidth + marginXTotal
  return (
    <Box flexDirection="column">
      <Box>
        <Text>Transaction Count Differences Between Endpoints</Text>
      </Box>
      {!differences.size ? (
        <Spinner />
      ) : (
        <Box flexDirection="column" width={totalWidth} borderStyle="single" borderColor="grey">
          <Box flexDirection="row">
            <Box width={idWidth} marginX={marginX}>
              <Text color="gray">ID</Text>
            </Box>
            {keys(width, 'x', 'yellow')}
          </Box>
          <Box flexDirection="row">
            <Box flexDirection="column">{keys(idWidth, 'y', 'yellow')}</Box>
            <Box flexDirection="column">
              {[...matrix.entries()].flatMap(([idA, cells]) => (
                <Box flexDirection="row" key={`row-${idA}`}>
                  {cells.map((cell) => (
                    <Box
                      width={width}
                      key={`${idA}-${cell?.idB || idA}`}
                      marginX={marginX}
                      justifyContent="space-between"
                    >
                      <Text>{cell ? cell.wellPriced : '-'}</Text>
                      <Text>{cell ? cell?.lowerPriced : '-'}</Text>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
