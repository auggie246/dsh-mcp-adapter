/**
 * Resolve the Settings write face on the DSH 0.1.7 harness.
 *
 * The settings write surface is the `remote` service's `settings` namespace
 * (mounted by the @deepseek-ai/dsh-api-remotes client bundle): positional
 * `(ns, patch | ops, expectedRevision)` arguments answering a flat
 * `{ ok, value | error }` envelope, where `ns` is a profile Loader ENTRY id —
 * for the Adapter that is `mcp-adapter`, the id cordis.patch.yml registers.
 *
 * The face normalizes to the controller's contract: `update` and `mutate`
 * take one request object and answer `{ result: { ok, value, error } }`.
 */
export function createSettingsApi(ctx) {
  const remoteSettings = readRemoteSettings(ctx)
  if (remoteSettings !== undefined) return remoteSettingsApi(remoteSettings)

  throw new Error(
    'No DSH settings write API: expected the ctx.remote.settings namespace '
    + '(DSH 0.1.7 with @deepseek-ai/dsh-api-remotes). Upgrade '
    + '@auggieteo/dsh-mcp-adapter to a release supporting this harness.',
  )
}

/**
 * Read the mounted `remote.settings` namespace without declaring it in
 * `inject`. It is a traced dotted service: reading it as
 * `ctx.remote.settings` makes cordis compose the `remote.settings` key and
 * throw `cannot get property "remote.settings" without inject` for any plugin
 * that did not declare the exact service, and declaring it would park the
 * fiber forever on a profile that never mounts the remotes bundle. `ctx.get`
 * is cordis's inject-free read and resolves the mounted namespace through the
 * root isolate. The direct `ctx.remote?.settings` read stays as a fallback
 * for runners and test doubles that expose the face as a plain property.
 */
function readRemoteSettings(ctx) {
  if (typeof ctx.get === 'function') {
    try {
      const mounted = ctx.get('remote.settings')
      if (mounted !== undefined) return mounted
    } catch { /* fall through to the direct read */ }
  }
  try {
    return ctx.remote?.settings
  } catch { /* the governed dotted read — ctx.get already covered it */ }
  return undefined
}

/** Wrap the `remote.settings` face in the controller's contract. */
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
