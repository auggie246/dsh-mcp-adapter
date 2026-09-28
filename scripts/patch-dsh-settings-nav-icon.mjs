// CLI over the nav-icon patch core in src/host/nav-icon.js. The patch also
// applies itself at every plugin activation inside a running dsh (that path
// self-heals after DSH upgrades); this CLI stays for manual runs, for
// `--revert`, and for non-standard installs.
//
// Usage:
//   node scripts/patch-dsh-settings-nav-icon.mjs [--dsh-root <path>] [--icon <IconName>] [--revert]
//
// After patching, restart `dsh web` and refresh the page: the server composes
// module combos at boot and caches them by content hash.

import {
  NAV_ICON_DEFAULT,
  NAV_ICON_MARKER,
  NAV_ICON_SHELL_RELATIVE,
  locateNavIconShell,
  patchNavIconShell,
  revertNavIconShell,
} from '../src/host/nav-icon.js'

function parseArgs(argv) {
  const options = { revert: false, icon: NAV_ICON_DEFAULT, dshRoot: process.env.DSH_ROOT }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--revert') options.revert = true
    else if (arg === '--icon') options.icon = argv[++index]
    else if (arg === '--dsh-root') options.dshRoot = argv[++index]
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const file = locateNavIconShell({
  dshRoot: options.dshRoot,
  argv: process.argv,
  includeNpmRoot: true,
})
if (file === undefined) {
  console.error(
    `Could not locate ${NAV_ICON_SHELL_RELATIVE}.\n` +
      'Pass the DSH install root with --dsh-root <path> or DSH_ROOT=<path>.\n' +
      'The root is the directory containing the @deepseek-ai/dsh package.',
  )
  process.exit(1)
}

if (options.revert) {
  console.log(
    revertNavIconShell(file) === 'reverted'
      ? `Reverted the mcp nav icon in ${file}`
      : `No ${NAV_ICON_MARKER} insert found in ${file}; nothing to revert.`,
  )
  process.exit(0)
}

try {
  const outcome = patchNavIconShell(file, options.icon)
  if (outcome === 'already-patched') {
    console.log(`${file} already carries the ${NAV_ICON_MARKER} insert; nothing to do.`)
  } else {
    console.log(`Patched ${file}`)
    console.log(`The mcp nav row now uses ${options.icon}. Restart dsh web, then refresh the page.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
