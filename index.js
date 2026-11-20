/**
 * Host half of the prompt-optimizer bundle.
 *
 * Browser-facing HTTP lives on one exact route family registered on the real
 * webServer (runtime-injected sub-fiber — the proven profile-bundle pattern):
 *
 * - GET  /api/prompt-optimizer            → metadata: modes, strengths, effective defaults
 * - POST /api/prompt-optimizer            → one-shot optimization `{ text, mode }` → `{ optimized }`
 * - GET  /api/prompt-optimizer/settings   → `{ revision, value }` (settings namespace)
 * - POST /api/prompt-optimizer/settings   → path ops → settings.mutate (revision-checked)
 * - GET  /api/prompt-optimizer/models     → providers and their advertised models
 *
 * Settings persist through the `settings` service under the `prompt-optimizer`
 * namespace; the plugin's static patch config only seeds the defaults. The
 * optimization itself is a one-shot `llm.stream` call on the Host — it never
 * enters a conversation.
 *
 * The optimization templates follow the design of linshenkx/prompt-optimizer
 * (AGPL-3.0): optimize the prompt text itself — never execute it; wrap the
 * original draft as JSON evidence against instruction injection; preserve the
 * user's intent, concrete details, and placeholder tokens; output only the
 * rewritten prompt. These templates are original text written for this
 * plugin, not copies of that project's AGPL templates.
 */

import z from '@deepseek-ai/schemastery';
import { TEMPLATES, STRENGTHS, OUTPUT_RULES, DEFAULT_SETTINGS, evidenceUserMessage } from './templates.js';

const ROUTE_PATH = '/api/prompt-optimizer';
const MAX_INPUT_CHARS = 20000;
const NS = 'prompt-optimizer';

export const Config = z.object({
  template: z.union(['basic', 'professional', 'planning']).default('basic').volatile(),
  strength: z.union(['concise', 'balanced', 'detailed']).default('balanced').volatile(),
  instruction: z.string().default('').volatile(),
  followDefaultModel: z.boolean().default(true).volatile(),
  provider: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
});

/** 路由注册/回收诊断输出:可见于 dsh web 的标准输出日志。 */
function warn(...args) {
  try { console.warn('[prompt-optimizer]', ...args); } catch {}
}

/** Strip one wrapping code fence or quote pair from model output. */
export function cleanOutput(raw) {
  let out = raw.trim();
  out = out.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1')
    .replace(/^"([\s\S]*)"$/s, '$1')
    .trim();
  if (out === '') throw new Error('模型返回了空内容,请重试或调整优化强度');
  return out;
}

export const inject = ['commands', 'settings'];

/** Read the plugin's live settings, merged over the built-in defaults. */
export function readSettings(settings) {
  try {
    const descriptor = settings.describe({ redactSecrets: true }).find((entry) => String(entry.ns) === NS);
    if (descriptor !== undefined && descriptor.value !== null && typeof descriptor.value === 'object') {
      return { revision: descriptor.revision, value: { ...DEFAULT_SETTINGS, ...descriptor.value } };
    }
    return { revision: descriptor?.revision ?? 0, value: DEFAULT_SETTINGS };
  } catch {
    return { revision: 0, value: DEFAULT_SETTINGS };
  }
}

/** Host plugin body: registers routes and the slash command for the plugin lifetime. */
export function apply(ctx) {
  /** Resolve the model route: settings first, then the default selection. */
  async function resolveRoute(value) {
    const provider = typeof value?.provider === 'string' ? value.provider.trim() : '';
    const model = typeof value?.model === 'string' ? value.model.trim() : '';
    // 「跟随默认模型」具有最高优先级:开启时忽略设置里残留的 provider/model,
    // 始终取当前默认模型选择,避免旧值"抢跑"导致与设置页显示不一致。
    if (value?.followDefaultModel !== false) {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
      const picked = { provider: selection?.provider, model: selection?.model };
      if (!picked.provider || !picked.model) {
        throw new Error('未找到可用的默认模型，请在设置页选择具体模型');
      }
      return picked;
    }
    if (provider === '' || model === '') {
      throw new Error('自定义模型未配置完整，请在设置页补全或改回跟随默认模型');
    }
    return { provider, model };
  }

  /** Stream one optimization; onDelta receives accumulated text; isCancelled() stops early.
  * Resolves to { optimized, route }. */
  async function optimize(text, mode, llm, value, onDelta, isCancelled) {
    const template = TEMPLATES[mode] ?? TEMPLATES.basic;
    const strength = STRENGTHS[value?.strength] ?? STRENGTHS.balanced;
    const route = await resolveRoute(value);
    const custom = typeof value?.instruction === 'string' && value.instruction.trim() !== '' ? value.instruction.trim() : undefined;
    const system = custom !== undefined
      ? [custom, '', strength.guidance, OUTPUT_RULES].join('\n')
      : [template.system, '', strength.guidance].join('\n');
    let out = '';
    const chunks = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: evidenceUserMessage(template.label)(JSON.stringify(text)) }],
      }],
      temperature: strength.temperature,
    });
    for await (const chunk of chunks) {
      if (isCancelled?.() === true) break;
      if (chunk.type === 'text-delta') { out += chunk.text; onDelta?.(out); }
    }
    return { optimized: cleanOutput(out), route };
  }

  ctx.plugin({
      name: 'prompt-optimizer:route',
      inject: ['webServer', 'connection', 'llm', 'settings'],
      apply(sctx) {
        sctx.effect(() => {
          // Prefer the webServer instance that actually owns the listening
          // socket — composition rebuilds can expose fresh service instances
          // that only carry configuration values.
          let webServer = sctx.get('webServer');
          try {
            const carrier = sctx.get('connection')?.owner?.get?.('webServer');
            if (carrier !== undefined && carrier !== null && carrier !== webServer && carrier?.server?.listening === true) {
              webServer = carrier;
            }
          } catch {}
          const conn = sctx.get('connection');
          const llm = sctx.get('llm');
          const settings = sctx.get('settings');

          const guard = (req, res) => {
            let rejection = 503;
            try {
              rejection = conn.requestRejection(req) ?? 0;
            } catch {}
            if (rejection === 0) return true;
            res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : 'unauthorized');
            return false;
          };

          const readBodyJson = async (req) => {
            const chunks = [];
            let tooLarge = false;
            return await new Promise((resolve, reject) => {
              req.on('data', (part) => {
                chunks.push(part);
                if (chunks.reduce((n, c) => n + c.length, 0) > MAX_INPUT_CHARS + 4096) { tooLarge = true; req.destroy(); }
              });
              req.on('error', reject);
              req.on('end', () => {
                if (tooLarge) return resolve({ error: { status: 413, payload: { error: 'input too large' } } });
                try {
                  resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
                } catch {
                  resolve({ error: { status: 400, payload: { error: 'invalid JSON body' } } });
                }
              });
            });
          };

          const nodeHandler = async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://local');
            const sub = url.pathname.slice(ROUTE_PATH.length); // '', '/settings', '/models'
            if (!guard(req, res)) return;
            const send = (status, payload) => {
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
              res.end(JSON.stringify(payload));
            };
            try {
              // Settings read/write.
              if (sub === '/settings') {
                if (req.method === 'GET') {
                  const current = readSettings(settings);
                  return send(200, { ok: true, revision: current.revision, value: current.value });
                }
                if (req.method === 'POST') {
                  const { body, error } = await readBodyJson(req);
                  if (error !== undefined) return send(error.status, error.payload);
                  const ops = Array.isArray(body?.ops) ? body.ops : null;
                  if (ops === null) return send(400, { ok: false, code: 'bad-request', message: '缺少 ops 数组' });
                  try {
                    await settings.mutate(NS, ops, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined);
                    const current = readSettings(settings);
                    return send(200, { ok: true, revision: current.revision, value: current.value });
                  } catch (error) {
                    if (error?.code === 'SETTINGS_CONFLICT') {
                      const current = readSettings(settings);
                      return send(409, { ok: false, code: 'conflict', revision: current.revision, value: current.value, message: '设置已被其他页面修改，请重试' });
                    }
                    return send(400, { ok: false, code: 'rejected', message: error instanceof Error ? error.message : String(error) });
                  }
                }
                return send(405, { ok: false, code: 'method-not-allowed' });
              }

              // Model catalog for the settings page picker.
              if (sub === '/models' && req.method === 'GET') {
                let selection;
                try { selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null; } catch { selection = null; }
                const providers = [];
                try {
                  for (const info of llm.listProviders()) {
                    let models = [];
                    try { models = (await llm.listModels(info.id)).map((m) => m?.id ?? String(m)).filter((id) => typeof id === 'string' && id !== ''); } catch {}
                    providers.push({ id: info.id, label: info.label ?? info.id, models });
                  }
                } catch (error) {
                  return send(502, { ok: false, message: error instanceof Error ? error.message : String(error) });
                }
                return send(200, { ok: true, providers, defaultSelection: selection ?? null });
              }

              // Optimization: POST { text, mode }; GET = metadata.
              if (sub === '') {
                if (req.method === 'GET' || req.method === 'HEAD') {
                  const current = readSettings(settings).value;
                  return send(200, {
                    template: TEMPLATES[current.template] !== undefined ? current.template : 'basic',
                    modes: Object.keys(TEMPLATES),
                    labels: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.label])),
                  });
                }
                if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
                const { body, error } = await readBodyJson(req);
                if (error !== undefined) return send(error.status, error.payload);
                const text = typeof body?.text === 'string' ? body.text.trim() : '';
                const mode = typeof body?.mode === 'string' ? body.mode : 'basic';
                if (text === '') return send(400, { error: 'empty draft' });
                if (text.length > MAX_INPUT_CHARS) return send(413, { error: 'input too large' });
                const value = readSettings(settings).value;
                // 客户端中断(关闭卡片/重新发起/超时)时中止模型调用,避免浪费 token
                let clientGone = false;
                req.on('close', () => { clientGone = true; });
                try {
                  const { optimized, route } = await optimize(text, mode, llm, value, undefined, () => clientGone);
                  return send(200, { optimized, route });
                } catch (optError) {
                  return send(502, { error: optError instanceof Error ? optError.message : String(optError) });
                }
              }

              return send(404, { error: 'not found' });
            } catch (handlerError) {
              return send(502, { error: handlerError instanceof Error ? handlerError.message : String(handlerError) });
            }
          };

          // Exact for the bare optimize/metadata path; prefix for the
          // /settings and /models subpaths. The two live in separate
          // tables, so same-path registration is allowed. Each registration
          // is isolated so a leftover from a broken earlier mount cannot
          // block the other (a dsh-web restart clears both).
          const disposers = [];
          for (const kind of ['exact', 'prefix']) {
            try {
              disposers.push(webServer.register({ kind, path: ROUTE_PATH, handler: nodeHandler }));
            } catch (error) {
              // 路由残留:旧挂载的闭包可能仍在服务且引用已失活的服务。
              // 修复方式:systemctl --user restart dsh-web 后重新安装插件。
              warn(`注册 ${kind} 路由失败(疑似残留路由占用),建议重启 dsh-web 后重装:`, String(error));
            }
          }
          return () => {
            for (const dispose of disposers) {
              try { dispose(); } catch (error) { warn('路由回收失败:', String(error)); }
            }
          };
        }, 'prompt-optimizer: route ' + ROUTE_PATH);
      },
    });

  // Secondary channel: a slash command over the authenticated remote commands
  // registry. The raw input is JSON `{ text, mode }`; the optimized prompt
  // returns as the command's success text.
  const commands = ctx.get('commands');
  if (commands !== undefined) {
    const disposeCommand = commands.register({
      definitionId: 'prompt-optimizer-optimize',
      name: 'po-optimize',
      description: '内部命令：优化提示词草稿（由提示词优化插件调用）',
      handler: async (invocation) => {
        try {
          const llm = ctx.get('llm');
          const settings = ctx.get('settings');
          const parsed = JSON.parse(invocation.rawInput || '{}');
          const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
          const mode = typeof parsed?.mode === 'string' ? parsed.mode : 'basic';
          if (text === '') return { kind: 'error', text: '空草稿' };
          if (text.length > MAX_INPUT_CHARS) return { kind: 'error', text: '输入过长' };
          const value = readSettings(settings).value;
          const optimized = await optimize(text, mode, llm, value);
          return { kind: 'success', text: optimized };
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    ctx.effect(disposeCommand, 'prompt-optimizer: command po-optimize');
  }
}
