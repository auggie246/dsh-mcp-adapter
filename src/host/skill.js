import { readFileSync as defaultReadFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { errorMessage } from './errors.js'

/** Absolute directory of the bundled skill, resolved from this module. */
export const SKILL_DIR = fileURLToPath(new URL('../../skills/mcp-adapter/', import.meta.url))

const SKILL_FILE = 'SKILL.md'
const SKILL_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/**
 * Split one `SKILL.md` into its frontmatter fields and body. The block must
 * open the file: `---`, flat `key: value` lines, then a closing `---`. Only
 * `name`, `description`, and `whenToUse` are read; everything after the
 * closing fence is the skill body. A missing or misplaced block throws.
 */
export function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) {
    throw new Error('the bundled skill file must open with a --- frontmatter block')
  }
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (entry !== null) fields[entry[1]] = entry[2]
  }
  return {
    name: fields.name,
    description: fields.description,
    whenToUse: fields.whenToUse === '' ? undefined : fields.whenToUse,
    body: match[0].length < text.length ? text.slice(match[0].length).replace(/^\r?\n+/, '') : '',
  }
}

/**
 * Register the bundled `mcp-adapter` skill on the `skills` service so agents
 * discover how to drive the Proxy Tool. The body lives in
 * `skills/mcp-adapter/SKILL.md` next to the package root, so a human can edit
 * the wording without touching code; frontmatter still drives routing.
 *
 * The skill is a convenience, never a dependency: an unreadable file or bad
 * frontmatter logs a warning and registers nothing. `readFileSync` and `dir`
 * are injectable for tests.
 */
export function installMcpSkill(ctx, { readFileSync = defaultReadFileSync, dir = SKILL_DIR } = {}) {
  const fail = (reason) => {
    ctx.logger?.warn?.(`dsh-mcp-adapter: bundled skill unavailable (${reason})`)
    return undefined
  }
  try {
    const text = String(readFileSync(`${dir}${SKILL_FILE}`, 'utf8'))
    const { name, description, whenToUse, body } = parseSkillFrontmatter(text)
    if (typeof name !== 'string' || SKILL_NAME.test(name) === false) {
      return fail(`frontmatter name ${JSON.stringify(name ?? null)} is not kebab-case`)
    }
    if (typeof description !== 'string' || description === '') {
      return fail('frontmatter requires a non-empty description')
    }
    return ctx.skills.register({
      name,
      description,
      ...(whenToUse === undefined ? {} : { whenToUse }),
      source: 'runtime',
      content: body,
      resourceBase: { kind: 'directory', path: dir },
    })
  } catch (error) {
    return fail(errorMessage(error))
  }
}
