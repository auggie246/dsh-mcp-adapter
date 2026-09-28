// The Settings shell picks its nav icon from a hard-coded map inside
// dsh-client-ui-settings-general, and the settings.section slot carries no
// icon option, so an unfamiliar section id (ours: `mcp`) falls back to the
// settings gear. This module inserts one marked branch into the installed
// shell bundle. installMcpNavIconPatch runs on every activation, so a fresh
// install and every DSH upgrade (which replaces the patched file) self-heal
// on the next start. scripts/patch-dsh-settings-nav-icon.mjs is the CLI over
// the same core, for manual runs and `--revert`. See ADR 0011.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const NAV_ICON_MARKER = '// dsh-mcp-adapter'
export const NAV_ICON_DEFAULT = 'IconLinkOutlineMedium'
export const NAV_ICON_SHELL_RELATIVE = join(
  'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js',
)

/** The models branch, with every build-generated identifier captured. 0.1.7
 * renamed the icon exports from `*16` to `*Medium` sizes, so only the `Icon`
 * prefix is pinned. */
const MODELS_BRANCH = /(\t+)if \(id === "models"\) return \(0, ([A-Za-z_$][\w$]*)\.jsx\)\(([A-Za-z_$][\w$]*)\.Icon\w+, \{\n\t+className: ([A-Za-z_$][\w$]*)\.navIcon,\n\t+size: 16\n\t+\}\);/

const MCP_BRANCH = new RegExp(
  `\\n\\t+if \\(id === "mcp"\\) return \\(0, [A-Za-z_$][\\w$]*\\.jsx\\)\\([A-Za-z_$][\\w$]*\\.Icon\\w+, \\{\\n\\t+className: [A-Za-z_$][\\w$]*\\.navIcon,\\n\\t+size: 16\\n\\t+\\}\\); ${NAV_ICON_MARKER.replace(/\//g, '\\/')}`,
)

function buildMcpBranch(indent, jsxRuntime, primitivesModule, cssModule, iconName) {
  return [
    `${indent}if (id === "mcp") return (0, ${jsxRuntime}.jsx)(${primitivesModule}.${iconName}, {`,
    `${indent}\tclassName: ${cssModule}.navIcon,`,
    `${indent}\tsize: 16`,
    `${indent}}); ${NAV_ICON_MARKER}`,
  ].join('\n')
}

// The DSH install a process runs from: the nearest ancestor of its CLI entry
// whose package.json names @deepseek-ai/dsh. A global `dsh` runs through a
// bin symlink whose argv path stays the symlink, so resolve it first.
export function navIconDshRoot(entry = process.argv[1]) {
  if (typeof entry !== 'string' || entry === '') return undefined
  let resolved = entry
  try {
    resolved = realpathSync(entry)
  } catch {
    // Keep the raw path; a missing entry cannot name a root anyway.
  }
  let dir = dirname(resolved)
  for (;;) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === '@deepseek-ai/dsh') {
        return dir
      }
    } catch {
      // Not a package directory: keep walking up.
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function npmGlobalDshRoot() {
  try {
    return join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai', 'dsh')
  } catch {
    // npm unavailable: skip the global-root candidate.
    return undefined
  }
}

// Search order: the explicit root, then the install this process runs from,
// then (CLI opt-in only) the npm global root. The startup hook never uses
// the npm candidate: it must only ever patch the install it is running in,
// and must guess nothing when that install is unidentifiable.
export function locateNavIconShell({ dshRoot, argv, includeNpmRoot = false } = {}) {
  const entry = argv === undefined ? process.argv[1] : argv[1]
  const roots = [
    typeof dshRoot === 'string' ? dshRoot : undefined,
    navIconDshRoot(entry),
    includeNpmRoot ? npmGlobalDshRoot() : undefined,
  ]
  for (const root of roots) {
    if (typeof root !== 'string') continue
    const file = join(root, NAV_ICON_SHELL_RELATIVE)
    if (existsSync(file)) return file
  }
  return undefined
}

/** Returns 'patched' or 'already-patched'; throws when the shell bundle
 * predates or postdates the pinned models-branch shape. */
export function patchNavIconShell(file, icon = NAV_ICON_DEFAULT) {
  const source = readFileSync(file, 'utf8')
  if (source.includes(NAV_ICON_MARKER)) return 'already-patched'
  const match = MODELS_BRANCH.exec(source)
  if (match === null) {
    throw new Error(
      `Could not find the models branch of navIcon() in ${file}. The DSH build changed; update the MODELS_BRANCH pattern in src/host/nav-icon.js.`,
    )
  }
  const [, indent, jsxRuntime, primitivesModule, cssModule] = match
  const insert = `\n${buildMcpBranch(indent, jsxRuntime, primitivesModule, cssModule, icon)}`
  writeFileSync(file, source.replace(match[0], `${match[0]}${insert}`))
  return 'patched'
}

/** Returns 'reverted' or 'nothing' when no insert is present. */
export function revertNavIconShell(file) {
  const source = readFileSync(file, 'utf8')
  if (!MCP_BRANCH.test(source)) return 'nothing'
  writeFileSync(file, source.replace(MCP_BRANCH, ''))
  return 'reverted'
}

// Applied at every activation. Only the DSH install this process runs from
// is ever patched; when it cannot be identified — a headless test, an
// unusual launcher — nothing is patched and only a warning is logged.
// Failures never throw: Settings chrome must not break the Adapter.
export function installMcpNavIconPatch(ctx, options = {}) {
  const icon = options.icon ?? NAV_ICON_DEFAULT
  try {
    const file = locateNavIconShell({
      dshRoot: options.dshRoot ?? process.env.DSH_ROOT,
      argv: options.argv,
    })
    if (file === undefined) {
      ctx.logger?.warn?.(
        'dsh-mcp-adapter: could not locate the DSH settings shell bundle to patch; the Settings MCP nav row keeps the gear icon. Set DSH_ROOT=<path to @deepseek-ai/dsh> if this install is non-standard.',
      )
      return
    }
    if (patchNavIconShell(file, icon) === 'patched') {
      ctx.logger?.info?.(
        `dsh-mcp-adapter: patched the Settings MCP nav icon (${icon}) into ${file}; restart dsh web and refresh the page if the icon does not appear.`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`dsh-mcp-adapter: the Settings MCP nav icon patch did not apply: ${message}`)
  }
}
