import { guardMcpOutput } from './output-guard.js'

const MAX_SEARCH_RESULTS = 20
const APPROVAL_PREVIEW_CHARS = 600
const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|cookie/i
const PROXY_FIELDS = new Set(['action', 'query', 'server', 'tool', 'args'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function validateProxyArgs(args) {
  const unknown = Object.keys(args).filter((key) => !PROXY_FIELDS.has(key))
  if (unknown.length > 0) {
    throw new Error(`Unknown mcp argument field ${JSON.stringify(unknown[0])}`)
  }
  if (args.query !== undefined && typeof args.query !== 'string') {
    throw new Error('mcp query must be a string when supplied')
  }
}

function requireText(value, field, action) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`mcp action ${JSON.stringify(action)} requires a non-empty ${field}`)
  }
  return value.trim()
}

function prefixedName(server, tool) {
  return `${server}__${tool}`
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function suggestions(values, requested, limit = 3) {
  const query = requested.toLowerCase()
  return [...new Set(values)]
    .map((value) => {
      const candidate = value.toLowerCase()
      const contains = candidate.includes(query) || query.includes(candidate)
      return {
        value,
        score: (contains ? -100 : 0) + editDistance(candidate, query),
      }
    })
    .sort((left, right) => left.score - right.score || left.value.localeCompare(right.value))
    .slice(0, limit)
    .map((entry) => entry.value)
}

function suggestionText(values) {
  return values.length === 0 ? '' : ` Did you mean: ${values.join(', ')}?`
}

function searchScore(tool, query) {
  if (query === '') return 1
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const rawName = tool.tool.toLowerCase()
  const fullName = tool.name.toLowerCase()
  const description = tool.description.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (rawName === term || fullName === term) score += 1_000
    else if (rawName.startsWith(term) || fullName.startsWith(term)) score += 700
    else if (rawName.includes(term) || fullName.includes(term)) score += 500
    else if (description.includes(term)) score += 200
    else return 0
  }
  return score
}

function redactPreview(value, depth = 0) {
  if (depth > 4) return '[nested value omitted]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactPreview(item, depth + 1))
  if (!isRecord(value)) return value
  const output = {}
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactPreview(item, depth + 1)
  }
  return output
}

function argsPreview(args) {
  let preview
  try {
    preview = JSON.stringify(redactPreview(args))
  } catch {
    preview = '[arguments could not be rendered]'
  }
  if (preview.length <= APPROVAL_PREVIEW_CHARS) return preview
  return `${preview.slice(0, APPROVAL_PREVIEW_CHARS - 1)}…`
}

function renderResource(resource) {
  if (typeof resource?.text === 'string') {
    return `[resource ${resource.uri ?? 'unknown'}]\n${resource.text}`
  }
  return `[resource ${resource?.uri ?? 'unknown'}: binary content omitted]`
}

export function renderMcpResult(result, toolName) {
  if (!Array.isArray(result?.content)) {
    if (isRecord(result) && 'toolResult' in result) {
      try {
        return JSON.stringify(result.toolResult)
      } catch {
        return String(result.toolResult)
      }
    }
    if (result?.structuredContent !== undefined) {
      try {
        return JSON.stringify(result.structuredContent)
      } catch {
        return String(result.structuredContent)
      }
    }
    return '(empty result)'
  }

  const parts = result.content.map((block) => {
    if (!isRecord(block)) return '[unsupported MCP content block]'
    if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''
    if (block.type === 'resource') return renderResource(block.resource)
    if (block.type === 'resource_link') return `[resource link: ${block.uri ?? 'unknown'}]`
    if (block.type === 'image') return `[image from ${toolName}: ${block.mimeType ?? 'unknown media type'}]`
    if (block.type === 'audio') return `[audio from ${toolName}: ${block.mimeType ?? 'unknown media type'}]`
    return `[unsupported MCP content type: ${String(block.type)}]`
  })
  const text = parts.filter((part) => part !== '').join('\n')
  return text === '' ? '(empty result)' : text
}

function setupHint(manager, serverName, error) {
  const config = manager.getServerConfig(serverName)
  const base = `MCP Server ${JSON.stringify(serverName)} failed: ${errorMessage(error)}`
  if (config?.disabled) {
    return `${base}\nSetup hint: enable this Server in Settings > MCP.`
  }
  if (typeof config?.command === 'string') {
    return `${base}\nSetup hint: check command ${JSON.stringify(config.command)}, its arguments, executable path, and Server stderr in Settings > MCP.`
  }
  if (typeof config?.url === 'string') {
    return `${base}\nSetup hint: check the URL, Server availability, and header or bearer credentials in Settings > MCP.`
  }
  return `${base}\nSetup hint: check this Server's Config in Settings > MCP.`
}

async function listServerTools(manager, serverName, signal, refresh = false) {
  const config = manager.getServerConfig(serverName)
  if (config === undefined) {
    const names = manager.catalogSnapshot().servers.map((server) => server.name)
    throw new Error(
      `Unknown MCP Server ${JSON.stringify(serverName)}.` +
        suggestionText(suggestions(names, serverName)),
    )
  }
  try {
    return await manager.listTools(serverName, { signal, refresh })
  } catch (error) {
    throw new Error(setupHint(manager, serverName, error), { cause: error })
  }
}

function findTool(tools, serverName, requested) {
  const exact = tools.find((tool) => tool.name === requested)
  if (exact !== undefined) return exact
  const prefix = `${serverName}__`
  if (requested.startsWith(prefix)) {
    return tools.find((tool) => tool.name === requested.slice(prefix.length))
  }
  return undefined
}

export async function resolveMcpTool(manager, serverName, requested, signal) {
  let tools = await listServerTools(manager, serverName, signal)
  let tool = findTool(tools, serverName, requested)
  if (tool !== undefined) return tool

  tools = await listServerTools(manager, serverName, signal, true)
  tool = findTool(tools, serverName, requested)
  if (tool !== undefined) return tool

  const candidates = tools.flatMap((candidate) => [
    candidate.name,
    prefixedName(serverName, candidate.name),
  ])
  throw new Error(
    `Unknown tool ${JSON.stringify(requested)} on MCP Server ${JSON.stringify(serverName)}.` +
      suggestionText(suggestions(candidates, requested)),
  )
}

async function warmCatalog(manager, signal) {
  const errors = []
  const current = manager.catalogSnapshot()
  await Promise.all(
    current.servers
      .filter((server) => !server.disabled && server.tools.length === 0)
      .map(async (server) => {
        try {
          await manager.listTools(server.name, { signal })
        } catch (error) {
          if (signal?.aborted) throw error
          errors.push({ server: server.name, message: setupHint(manager, server.name, error) })
        }
      }),
  )
  errors.sort((left, right) => left.server.localeCompare(right.server))
  return { catalog: manager.catalogSnapshot(), errors }
}

async function searchAction(ctx, manager, query, exec) {
  const { catalog, errors } = await warmCatalog(manager, exec.signal)
  const candidates = catalog.servers.flatMap((server) =>
    server.disabled
      ? []
      : server.tools.map((tool) => ({
          name: prefixedName(server.name, tool.name),
          server: server.name,
          tool: tool.name,
          description: tool.description ?? '',
        })),
  )
  const results = candidates
    .map((tool) => ({ tool, score: searchScore(tool, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, MAX_SEARCH_RESULTS)
    .map((entry) => entry.tool)

  const lines = results.map(
    (tool) => `${tool.name}\n  ${tool.description || '(no description)'}`,
  )
  if (lines.length === 0) lines.push(`No MCP tools matched ${JSON.stringify(query)}.`)
  if (errors.length > 0) {
    lines.push(
      '',
      'Unavailable Servers:',
      ...errors.map((error) => `- ${error.server}: ${error.message.split('\n')[0]}`),
    )
  }
  const data = { results, errors }
  const guarded = await guardMcpOutput(
    ctx,
    exec,
    'catalog',
    'search',
    data,
    lines.join('\n'),
  )
  return {
    action: 'search',
    text: guarded.text,
    data: guarded.data,
    ...(guarded.guard === undefined ? {} : { guard: guarded.guard }),
  }
}

async function describeAction(ctx, manager, serverName, requested, exec) {
  const tool = await resolveMcpTool(manager, serverName, requested, exec.signal)
  const detail = {
    name: prefixedName(serverName, tool.name),
    server: serverName,
    tool: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  }
  const text = [
    detail.name,
    detail.description || '(no description)',
    '',
    'Input schema:',
    JSON.stringify(detail.inputSchema, null, 2),
  ].join('\n')
  const guarded = await guardMcpOutput(
    ctx,
    exec,
    serverName,
    tool.name,
    detail,
    text,
  )
  return {
    action: 'describe',
    text: guarded.text,
    data: guarded.data,
    ...(guarded.guard === undefined ? {} : { guard: guarded.guard }),
  }
}

async function requireApproval(
  ctx,
  manager,
  serverName,
  toolName,
  args,
  exec,
  approvalToolName,
) {
  const config = manager.getServerConfig(serverName)
  if (config?.autoAllow) return
  const approval = ctx.get('approval')
  if (approval === undefined) {
    throw new Error('MCP call requires approval, but the DSH approval Service is unavailable')
  }
  if (exec.agent === undefined) {
    throw new Error('MCP call requires approval, but this tool call has no Agent owner')
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: approvalToolName,
    callId: exec.callId,
    reason:
      `Call MCP Server ${JSON.stringify(serverName)} tool ${JSON.stringify(toolName)}. ` +
      `Arguments preview: ${argsPreview(args)}`,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`MCP call was not approved (${outcome})`)
  }
}

export async function executeMcpToolCall(
  ctx,
  manager,
  serverName,
  requested,
  args,
  exec,
  { approvalToolName = 'mcp' } = {},
) {
  const tool = await resolveMcpTool(manager, serverName, requested, exec.signal)
  await requireApproval(
    ctx,
    manager,
    serverName,
    tool.name,
    args,
    exec,
    approvalToolName,
  )

  let result
  try {
    result = await manager.callTool(serverName, tool.name, args, { signal: exec.signal })
  } catch (error) {
    throw new Error(setupHint(manager, serverName, error), { cause: error })
  }

  const text = renderMcpResult(result, tool.name)
  const guarded = await guardMcpOutput(
    ctx,
    exec,
    serverName,
    tool.name,
    result,
    text,
  )
  if (result?.isError === true) {
    throw new Error(`MCP tool ${prefixedName(serverName, tool.name)} failed: ${guarded.text}`)
  }
  return {
    action: 'call',
    text: guarded.text,
    data: guarded.data,
    ...(guarded.guard === undefined ? {} : { guard: guarded.guard }),
  }
}

export function createMcpCallOutput() {
  return {
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', const: 'call' },
        text: { type: 'string' },
        data: {},
        guard: {},
      },
      required: ['action', 'text', 'data'],
      additionalProperties: false,
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }]
    },
  }
}

export function createMcpProxyTool(ctx, manager) {
  return {
    name: 'mcp',
    description:
      'Discover and call MCP tools without loading every tool schema. ' +
      'Use action "search" with query first. Use "describe" with server and tool for its schema. ' +
      'Use "call" with server, tool, and args. Search names use <server>__<tool>.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'describe', 'call'],
          description: 'Operation to perform.',
        },
        query: {
          type: 'string',
          description: 'Search words. Used by search.',
        },
        server: {
          type: 'string',
          description: 'Configured MCP Server name. Used by describe and call.',
        },
        tool: {
          type: 'string',
          description: 'Raw tool name or <server>__<tool> search name. Used by describe and call.',
        },
        args: {
          type: 'object',
          description: 'Arguments sent to the MCP tool. Used by call.',
          additionalProperties: true,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['search', 'describe', 'call'] },
          text: { type: 'string' },
          data: {},
          guard: {},
        },
        required: ['action', 'text', 'data'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: value.text }]
      },
    },
    async execute(args, exec) {
      if (!isRecord(args)) throw new Error('mcp arguments must be an object')
      validateProxyArgs(args)
      const action = requireText(args.action, 'action', 'unknown')
      if (action === 'search') {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        return searchAction(ctx, manager, query, exec)
      }
      if (action === 'describe') {
        const serverName = requireText(args.server, 'server', action)
        const toolName = requireText(args.tool, 'tool', action)
        return describeAction(ctx, manager, serverName, toolName, exec)
      }
      if (action === 'call') {
        const serverName = requireText(args.server, 'server', action)
        const toolName = requireText(args.tool, 'tool', action)
        if (args.args !== undefined && !isRecord(args.args)) {
          throw new Error('mcp action "call" requires args to be an object when supplied')
        }
        return executeMcpToolCall(
          ctx,
          manager,
          serverName,
          toolName,
          args.args ?? {},
          exec,
        )
      }
      throw new Error(`Unknown mcp action ${JSON.stringify(action)}. Use search, describe, or call.`)
    },
  }
}

export function installMcpProxyTool(ctx, manager) {
  return ctx.tools.register(createMcpProxyTool(ctx, manager))
}
