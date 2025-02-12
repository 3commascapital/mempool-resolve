import _ from 'lodash'

let isRunning = true

let shutdownResolve!: (v: unknown) => void

export const shutdown = new Promise((resolve) => {
  shutdownResolve = resolve
})

export const raceShutdown = (...promises: Promise<unknown>[]) => {
  return Promise.race([...promises, shutdown])
}

export const processIsRunning = () => {
  return isRunning
}

export const stop = () => {
  shutdownResolve(null)
  isRunning = false
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
