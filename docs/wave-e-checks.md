# Wave E checks

Checks ran after the four implementation commits, before the documentation commit. No deployment or live provider was called.

## `pnpm exec tsc --noEmit -p .`

```text
(no output)
Exit code: 0
```

## `pnpm exec eslint convex lib tests`

```text
(no output)
Exit code: 0
```

## `pnpm exec prettier --check <all 29 touched files>`

```text
Checking formatting...
All matched files use Prettier code style!
Exit code: 0
```

## `pnpm exec vitest run`

```text

 Test Files  22 passed (22)
      Tests  153 passed (153)
   Start at  05:09:04
   Duration  1.72s (tests 50%, import 21%, environment 17%, transform 11%, worker 2%)

    Isolate  22 workers spawned · ~162ms startup each (spawn + environment, per file)
             at least ~348ms faster with isolate: false — reuses workers across files instead of one per file
Exit code: 0
```

The demo seed passes its two existing tests. The replacement test also checks nonempty achievements and weekly review data. `pnpm seed:demo` was not run against the shared deployment.
