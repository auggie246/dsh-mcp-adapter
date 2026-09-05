/**
 * Resolve the Settings write face across DSH harness generations.
 *
 * DSH 0.1.2-rc.1 removed the `connection` service's `api` face, moving the
 * settings write surface onto the `remote` service (its `settings` namespace is
 * mounted by the @deepseek-ai/dsh-api-remotes client bundle). The new face
 * takes positional `(ns, patch | ops, expectedRevision)` arguments and answers
 * a flat `{ ok, value | error }` envelope. DSH 0.1.1-rc.2 keeps the write
 * surface on `connection.api.settings`, with one request-object argument and a
 * `{ result: { ok, value | error } }` envelope.
 *
 * Both faces normalize to the controller's contract: `update` and `mutate`
 * take one request object and answer `{ result: { ok, value, error } }`, so
 * callers stay unaware of which harness generation is running. Prefer the
 * `remote` face when it exists: it is the only one DSH 0.1.2-rc.1 provides.
 */
export function createSettingsApi(ctx) {
  const remoteSettings = ctx.remote?.settings
  if (remoteSettings !== undefined) return remoteSettingsApi(remoteSettings)

  const connectionSettings = ctx.connection?.api?.settings
  if (connectionSettings !== undefined) return connectionSettings

  throw new Error(
    'No DSH settings write API: expected ctx.remote.settings (DSH 0.1.2+) '
    + 'or ctx.connection.api.settings (DSH 0.1.1-rc.2). Upgrade '
    + '@auggieteo/dsh-mcp-adapter to a release supporting this harness.',
  )
}

/** Wrap the 0.1.2-rc.1 `remote.settings` face in the controller's contract. */
function remoteSettingsApi(remote) {
  return {
    async update({ ns, patch, expectedRevision }) {
      return { result: await remote.update(ns, patch, expectedRevision) }
    },
    async mutate({ ns, ops, expectedRevision }) {
      return { result: await remote.mutate(ns, ops, expectedRevision) }
    },
  }
}
