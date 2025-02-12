import React from 'react'
import _ from 'lodash'
import { Pool } from '../watch.js'
import { Box, Text } from 'ink'
import type { MempoolDeltas, MempoolFilters, MempoolStructure, MempoolWidecasted, Summary } from '../diff.js'
import { Summary as SummaryComponent } from './Summary.js'
import { Differences } from './Differences.js'
import { Widecasts } from './Widecasts.js'
import type { Endpoint } from '../verification.js'
import type { Args } from '../args.js'

export type UI = Partial<MempoolDeltas> &
  Partial<MempoolStructure> &
  Partial<MempoolFilters> &
  Partial<MempoolWidecasted> & {
    previousSummary?: Map<Endpoint, Summary>
    summary?: Map<Endpoint, Summary>
    pools?: Map<Endpoint, Pool>
    endpoints?: Endpoint[]
    currentTime?: Date
    lastUpdated?: Date
    lastRestarted?: Date
    shuttingDown?: boolean
    args?: Args
    updatingMempools?: boolean
    possibleWidecasts?: number
  }

const App = (props: UI) => {
  const update = new Date()
  return (
    <>
      <Box justifyContent="space-between" width={60}>
        <Text italic color="gray">
          Last updated: {update.toISOString().slice(0, 21)}
        </Text>
      </Box>
      <Box>
        <SummaryComponent {...props} />
      </Box>
      <Box>
        <Differences {...props} />
      </Box>
      <Box>
        <Widecasts {...props} />
      </Box>
      {/* <Box>
        <Errors {...props} />
      </Box> */}
      {!props.shuttingDown ? (
        <></>
      ) : (
        <Box>
          <Text>Shutting down...</Text>
        </Box>
      )}
    </>
  )
}

export const setupInkApp = async (ui: UI = {}) => {
  const { render: inkRender } = await import('ink')
  const app = inkRender(<App {...ui} />)

  let previousUI: UI = {}
  const render = (props: UI) => {
    app.rerender(<App {...props} />)
  }
  return {
    update: (newUI: UI) => {
      const props = { ...previousUI, ...newUI }
      previousUI = props
      render(props)
    },
    render,
    unmount: () => {
      app.unmount()
    },
  }
}

export type InkApp = Awaited<ReturnType<typeof setupInkApp>>
