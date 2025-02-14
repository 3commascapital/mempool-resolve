import fetchCookie from 'fetch-cookie'
global.fetch = fetchCookie(global.fetch, new fetchCookie.toughCookie.CookieJar())

import { args } from '../args.js'
import { verifySameChain, watchMempools, printMempoolDiffs } from '../index.js'
import { setupUI } from '../ui/index.js'

const { rpcs } = args()

Promise.resolve().then(async () => {
  const ui = await setupUI()

  return verifySameChain(rpcs)
    .then((clients) => {
      return Promise.all([
        // watch for changes in the mempool
        watchMempools(clients, ui),
        // print diffs as they arise
        printMempoolDiffs(ui),
      ])
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
    .finally(() => {
      ui.unmount()
    })
})
