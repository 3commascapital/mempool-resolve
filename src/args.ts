import 'dotenv/config'
import yargs from 'yargs'
import _ from 'lodash'

export const args = _.memoize(() => {
  const argv = yargs(process.argv.slice(2))
    .env('MEMRES')
    .options({
      rpcs: {
        type: 'array',
        description: 'RPC URLs to compare',
        coerce: (value) => value.flatMap((v: string) => v.split(',')),
      },
      widecast: {
        type: 'boolean',
        description: 'Whether to send transactions to every endpoint that is missing them',
        default: false,
      },
      rebroadcastBlockInterval: {
        type: 'number',
        description: 'The number of blocks between rebroadcasting transactions',
        default: 10,
      },
      minBalanceEther: {
        type: 'number',
        description: 'The minimum balance of the account in ether',
        default: 100_000,
      },
      balanceBlockInterval: {
        type: 'number',
        description: 'The number of blocks between checking the balance of the account',
        default: 4,
      },
    })
    .parseSync()
  return argv
})

export type Args = ReturnType<typeof args>
