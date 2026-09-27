import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import {
  MCP_SETTINGS_NAMESPACE,
  McpConfigSchema,
  validateMcpSettings,
} from './settings.js'
import { errorMessage } from './errors.js'

// 0.1.7 importLegacyDocument renames the profile's settings.yaml to
// settings.yaml.imported and moves only sections whose name matches a Loader
// entry id. The Adapter's legacy section is `mcp` while its entry id is
// `mcp-adapter`, so the platform leaves it behind; this import finishes the
// migration exactly once per profile.
const LEGACY_DOCUMENT_NAMES = ['settings.yaml.imported', 'settings.yaml']
const LEGACY_SECTION = 'mcp'
const MARKER_NAME = 'mcp-adapter.legacy-imported'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether the entry still answers with pure defaults and no user section. */
function isUntouched(descriptor) {
  if (descriptor === undefined) return false
  const user = descriptor.user
  if (user !== undefined && Object.keys(user).length > 0) return false
  const value = descriptor.value
  if (!isPlainObject(value)) return true
  return Object.keys(value.mcpServers ?? {}).length === 0
}

/**
 * Import the removed settings.yaml `mcp` section into this entry's profile
 * Config once. Runs after the Loader settles (the platform import runs first
 * and skips our mismatched section name). A `user` section or non-default
 * servers on the entry mean the config was already written, so the legacy
 * data stays untouched in the imported document; failures only warn, they
 * never throw. On success a marker file prevents re-import, so deliberately
 * clearing every Server later never resurrects the legacy list.
 */
export async function importLegacyMcpSettings(ctx, deps = {}) {
  const settings = deps.settings ?? ctx.get('settings')
  const profileContext = deps.profileContext ?? ctx.get('profileContext')
  const logger = deps.logger ?? ctx.logger
  if (settings === undefined || profileContext?.home === undefined) return

  const home = profileContext.home
  const readFileFn = deps.readFile ?? ((path) => readFile(path, 'utf8'))
  const writeFileFn = deps.writeFile ?? ((path, text) => writeFile(path, text))
  const markerPath = join(home, MARKER_NAME)

  try {
    try {
      await readFileFn(markerPath)
      return // already imported for this profile
    } catch {
      // No marker yet; continue.
    }

    let documentPath
    let sections
    for (const name of LEGACY_DOCUMENT_NAMES) {
      let text
      try {
        text = await readFileFn(join(home, name))
      } catch {
        continue
      }
      const parsed = parseYaml(text)
      if (isPlainObject(parsed) && isPlainObject(parsed[LEGACY_SECTION])) {
        documentPath = join(home, name)
        sections = parsed
        break
      }
    }
    if (documentPath === undefined) return

    const descriptor = settings
      .describe({ redactSecrets: true })
      .find((entry) => entry.ns === MCP_SETTINGS_NAMESPACE)
    if (!isUntouched(descriptor)) {
      logger?.info?.(
        'dsh-mcp-adapter: %s already has written Config; the legacy "mcp" section in %s was left in place',
        MCP_SETTINGS_NAMESPACE,
        documentPath,
      )
      return
    }

    // Keep only fields this entry declares; anything else in the legacy
    // section would make the reloaded entry fail schema validation.
    const legacy = sections[LEGACY_SECTION]
    const section = {
      mcpServers: isPlainObject(legacy.mcpServers) ? legacy.mcpServers : {},
      ...(typeof legacy.skillInstall === 'string'
        ? { skillInstall: legacy.skillInstall }
        : {}),
    }
    const resolved = McpConfigSchema(section)
    validateMcpSettings({
      mcpServers: resolved.mcpServers.get(),
      skillInstall: resolved.skillInstall.get(),
    })

    await settings.update(MCP_SETTINGS_NAMESPACE, section)
    await writeFileFn(markerPath, `imported the "${LEGACY_SECTION}" section of ${documentPath}\n`)
    logger?.info?.(
      'dsh-mcp-adapter: imported the legacy "mcp" settings section from %s into the %s entry',
      documentPath,
      MCP_SETTINGS_NAMESPACE,
    )
  } catch (error) {
    logger?.warn?.(
      'dsh-mcp-adapter: legacy "mcp" settings import failed; copy the "mcp" section into the profile manually: %s',
      errorMessage(error),
    )
  }
}
