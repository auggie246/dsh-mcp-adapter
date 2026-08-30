export const MCP_SETTINGS_CSS = `
.mcp-settings{max-width:980px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
.mcp-settings *{box-sizing:border-box}
.mcp-title{margin:0;font-size:18px;line-height:26px;font-weight:600}
.mcp-intro,.mcp-muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.mcp-toolbar,.mcp-actions,.mcp-row,.mcp-card-head{display:flex;align-items:center;gap:8px}
.mcp-toolbar{justify-content:space-between;flex-wrap:wrap}
.mcp-actions{flex-wrap:wrap}
.mcp-button{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:17px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 13px;font:inherit;font-size:13px;cursor:pointer}
.mcp-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mcp-button:disabled{cursor:not-allowed;opacity:.5}
.mcp-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mcp-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill)}
.mcp-button-danger{color:var(--dsw-alias-state-error-primary)}
.mcp-error,.mcp-warning{border-radius:8px;padding:9px 11px;font-size:12px;line-height:18px}
.mcp-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.mcp-warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.mcp-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px;align-items:start}
.mcp-sidebar,.mcp-card,.mcp-empty,.mcp-modal-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base)}
.mcp-sidebar{padding:6px;display:flex;flex-direction:column;gap:3px}
.mcp-server-button{width:100%;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);padding:9px 10px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;text-align:left;cursor:pointer;font:inherit}
.mcp-server-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mcp-server-button[aria-current=true]{background:var(--dsw-alias-button-ghost-active-fill)}
.mcp-server-name{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:500}
.mcp-server-count{color:var(--dsw-alias-label-tertiary);font-size:11px}
.mcp-status-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-quaternary)}
.mcp-status-connected{background:var(--dsw-alias-state-success-primary)}
.mcp-status-connecting{background:var(--dsw-alias-state-warn-primary)}
.mcp-status-error{background:var(--dsw-alias-state-error-primary)}
.mcp-status-disabled{background:var(--dsw-alias-label-quaternary)}
.mcp-card{padding:16px;display:flex;flex-direction:column;gap:16px;min-width:0}
.mcp-card-head{align-items:flex-start}
.mcp-card-title{margin:0;font-size:16px;line-height:24px;font-weight:600;overflow-wrap:anywhere}
.mcp-card-head .mcp-actions{margin-left:auto;justify-content:flex-end}
.mcp-badge{border:1px solid var(--dsw-alias-border-l3);border-radius:5px;padding:2px 7px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.mcp-form{display:flex;flex-direction:column;gap:13px}
.mcp-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.mcp-field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mcp-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.mcp-input,.mcp-select,.mcp-textarea{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.mcp-input,.mcp-select{height:36px;padding:0 10px}
.mcp-textarea{min-height:82px;padding:9px 10px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:19px}
.mcp-input:focus,.mcp-select:focus,.mcp-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.mcp-checkbox{display:flex;align-items:flex-start;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.mcp-checkbox input{margin-top:3px}
.mcp-section{border-top:1px solid var(--dsw-alias-border-l3);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.mcp-section-title{margin:0;font-size:13px;font-weight:600;line-height:20px}
.mcp-secret-row{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(140px,1.2fr) auto;gap:7px;align-items:center}
.mcp-promotion-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.mcp-promotion{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:8px 10px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start}
.mcp-promotion-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:anywhere}
.mcp-promotion-description{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.mcp-empty{padding:34px 20px;text-align:center;display:flex;align-items:center;flex-direction:column;gap:10px}
.mcp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000}
.mcp-modal-card{width:min(620px,100%);max-height:min(760px,90vh);overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px;box-shadow:0 18px 60px rgba(0,0,0,.24)}
.mcp-modal-title{margin:0;font-size:16px;line-height:24px}
.mcp-confirm{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
@media(max-width:760px){.mcp-layout{grid-template-columns:1fr}.mcp-sidebar{max-height:190px;overflow:auto}.mcp-field-row{grid-template-columns:1fr}.mcp-card-head{flex-direction:column}.mcp-card-head .mcp-actions{margin-left:0}.mcp-secret-row{grid-template-columns:1fr}.mcp-toolbar{align-items:flex-start}}
`

export function installMcpSettingsStyles() {
  const id = 'dsh-mcp-adapter-settings'
  const existing = document.querySelector(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = id
  style.textContent = MCP_SETTINGS_CSS
  document.head.appendChild(style)
  return () => style.remove()
}
