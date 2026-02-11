import type { loadConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";
import { loadOpenClawPlugins } from "../plugins/loader.js";

export function loadGatewayPlugins(params: {
  cfg: ReturnType<typeof loadConfig>;
  workspaceDir: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  coreGatewayHandlers: Record<string, GatewayRequestHandler>;
  baseMethods: string[];
}) {
  const dispatchMessage = async (params: import("../plugins/types.js").PluginSendMessageParams) => {
    const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
    const { loadConfig } = await import("../config/config.js");
    const { resolveOutboundTarget } = await import("../infra/outbound/targets.js");

    const cfg = loadConfig();
    const resolved = resolveOutboundTarget({
      channel: params.channel,
      to: params.to,
      cfg,
      accountId: params.accountId,
      mode: "explicit",
    });

    if (!resolved.ok) {
      return { ok: false, error: String(resolved.error) };
    }

    try {
      const results = await deliverOutboundPayloads({
        cfg,
        channel: params.channel,
        to: resolved.to,
        accountId: params.accountId,
        payloads: [{ text: params.message }],
      });

      const last = results.at(-1);
      if (!last) {
        return { ok: false, error: "No delivery result" };
      }

      if ("error" in last) {
        return { ok: false, error: String(last.error) };
      }

      return { ok: true, messageId: last.messageId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  };

  const pluginRegistry = loadOpenClawPlugins({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
    dispatchMessage,
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  if (pluginRegistry.diagnostics.length > 0) {
    for (const diag of pluginRegistry.diagnostics) {
      const details = [
        diag.pluginId ? `plugin=${diag.pluginId}` : null,
        diag.source ? `source=${diag.source}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(", ");
      const message = details
        ? `[plugins] ${diag.message} (${details})`
        : `[plugins] ${diag.message}`;
      if (diag.level === "error") {
        params.log.error(message);
      } else {
        params.log.info(message);
      }
    }
  }
  return { pluginRegistry, gatewayMethods };
}
