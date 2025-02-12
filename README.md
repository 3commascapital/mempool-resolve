# Mempool Resolve

Sometimes transactions get stuck in a mempool and they are not communicated to other mempools. This might be ok for underpriced transactions, but for well priced transactions, this generally should not happen. You can use these scripts to find well priced transactions and re-broadcast them (widecast) between pools.

Install Dependencies

```sh
pnpm i
```

Start the monitoring scripts

```sh
pnpm run start
```

Start monitoring and widecast

```sh
pnpm run start --widecast
```

Other params:

| name                       | default   |
| -------------------------- | --------- |
| `rpcs`                     | `[]`      |
| `widecast`                 | `false`   |
| `rebroadcastBlockInterval` | `10`      |
| `minBalanceEther`          | `100_000` |
| `balanceBlockInterval`     | `4`       |

All params can be prefixed with `MEMRES_` and exported to the process to be automatically picked up. Names above are in `camelCase`. While writing them directly, they must be in `kebab-case`.
