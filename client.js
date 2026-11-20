/**
 * Client half of the prompt-optimizer bundle.
 *
 * The button lives in `conversation.input.right` (composer tool row, before
 * the submit action); the result card lives in `conversation.input.dock`
 * (the full-width seat above the composer card). Clicking the button calls the
 * Host side-channel route `/api/prompt-optimizer` (same-origin, authenticated
 * by the page session) — the optimization runs as a one-shot model call on the
 * Host and never enters the conversation, so it costs no session turns.
 * On confirmation the optimized prompt is written back through
 * `inputActions.setDraft`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-optimizer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = '/api/prompt-optimizer';
    const MODES = ['basic', 'professional', 'planning'];
    const MODE_LABELS = { basic: '基础优化', professional: '精准优化', planning: '结构化规划' };
    // 几何常量：显式像素值，不借用主题几何 token（--dsw-radius-* / --dsw-shadow-overlay
    // 在 Chrome 与 Firefox 中解析结果不同，曾导致圆角/阴影跨浏览器不一致）。
    const RADIUS_LG = '8px';
    const RADIUS_XL = '12px';
    const CARD_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.06)';
    const MODE_HINTS = {
      basic: '消除模糊表达，补充关键信息',
      professional: '细化参数、标准与边界',
      planning: '改写为角色-步骤-输出的规划式提示词',
    };

    /** Shared store so the button (input.right) and card (input.dock) stay in sync. */
    const store = {
      state: null, // null | { sessionId, seq, phase: 'loading'|'done'|'error', mode, original, optimized, route, error, showHistory }
      listeners: new Set(),
      set(next) { this.state = next; for (const fn of this.listeners) fn(); },
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    };
    function useStore() {
      const [, force] = React.useState(0);
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
      return store.state;
    }

    /** 请求句柄:同一时刻只允许一个进行中的优化,新请求自动取消旧请求。 */
    let inflight = null; // { controller, sessionId, seq, timedOut }
    let runSeq = 0;

    /** 调用 Host 优化路由;signal 可取消(关闭卡片/重新发起/超时)。返回 { optimized, route }。 */
    async function optimize(mode, original, { signal } = {}) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, mode }),
        signal,
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.optimized === undefined) {
        throw new Error(payload?.error ?? `服务请求失败(HTTP ${response.status})`);
      }
      return { optimized: payload.optimized, route: payload.route ?? null };
    }

    /** 发起一次优化:取消在途请求 → loading 态 → 完成后一次性展示结果。 */
    function runOptimization(sessionId, mode, original) {
      if (inflight !== null) inflight.controller.abort();
      const seq = ++runSeq;
      const controller = new AbortController();
      const rec = { controller, sessionId, seq, timedOut: false };
      inflight = rec;
      store.set({ sessionId, seq, phase: 'loading', mode, original, optimized: '', route: null, error: null, showHistory: false });
      const timer = setTimeout(() => { rec.timedOut = true; controller.abort(); }, 120000);
      const settle = (patch) => {
        clearTimeout(timer);
        if (inflight === rec) inflight = null;
        const cur = store.state;
        if (cur !== null && cur.seq === seq) store.set({ ...cur, ...patch, showHistory: false });
      };
      optimize(mode, original, { signal: controller.signal }).then(
        ({ optimized, route }) => {
          pushHistory({ original, optimized, mode, strength: null, time: 0 });
          settle({ phase: 'done', optimized, route, error: null });
        },
        (error) => {
          const aborted = error?.name === 'AbortError';
          if (aborted && rec.timedOut) settle({ phase: 'error', optimized: null, error: '优化超时(120 秒),请稍后重试或降低强度' });
          else if (aborted) return; // 主动取消(关闭卡片/发起新请求),静默
          settle({ phase: 'error', optimized: null, error: error instanceof Error ? error.message : String(error) });
        },
      );
    }

    /** 关闭卡片时中止在途请求。 */
    function closeCard() {
      if (inflight !== null) inflight.controller.abort();
      store.set(null);
    }

    /** 关闭卡片时中止在途请求。 */
    function closeCard() {
      if (inflight !== null) inflight.controller.abort();
      store.set(null);
    }

    /** One-off style sheet for the card's keyframes and hover states. */
    const STYLE_ID = 'prompt-optimizer-styles';
    function ensureStyles() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        // 旋转指示器：标准 + -webkit- 前缀双写
        '@keyframes po-spin{to{transform:rotate(360deg)}}',
        '@-webkit-keyframes po-spin{to{transform:rotate(360deg)}}',
        '.po-spin{display:inline-block;-webkit-animation:po-spin .9s linear infinite;animation:po-spin .9s linear infinite}',
        // 文本区滚动条：Firefox 标准属性 + Chromium 私有属性双写
        '.po-area{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l4) transparent;-webkit-scrollbar-width:thin}',
        '.po-area::-webkit-scrollbar{width:8px;height:8px}',
        '.po-area::-webkit-scrollbar-track{background:transparent}',
        '.po-area::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l4);border-radius:4px}',
        '.po-area::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-secondary)}',
        // 表单控件外观统一：去除各浏览器原生差异
        '.po-settings select{-webkit-appearance:none;-moz-appearance:none;appearance:none;padding-right:30px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27><path d=%27M1 1l4 4 4-4%27 stroke=%23888 stroke-width=%271.5%27 fill=%27none%27/></svg>");background-repeat:no-repeat;background-position:right 10px center}',
        '.po-settings input[type="checkbox"]{-webkit-appearance:none;-moz-appearance:none;appearance:none;width:15px;height:15px;flex:none;margin:0;border:1px solid var(--dsw-alias-border-l4);border-radius:4px;background:var(--dsw-alias-bg-base);cursor:pointer;display:inline-grid;place-content:center}',
        '.po-settings input[type="checkbox"]::before{content:"";width:9px;height:9px;transform:scale(0);transition:transform .12s ease-in-out;background:var(--dsw-alias-button-primary-label,var(--dsw-alias-state-business-primary,#fff));clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0,43% 62%)}',
        '.po-settings input[type="checkbox"]:checked{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
        '.po-settings input[type="checkbox"]:checked::before{transform:scale(1)}',
        // 聚焦环统一：替换 Chrome focus ring / Firefox dotted outline 的默认差异
        '.po-settings select:focus,.po-settings input:focus,.po-settings textarea:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-border-l4))}',
        '.po-mode:focus-visible,.po-quiet:focus-visible,.po-primary:focus-visible,.po-refresh:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
        // 交互反馈（保留原有 hover）
        '.po-mode:hover:not(:disabled):not(.po-mode-active){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.po-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
        '.po-primary:hover:not(:disabled){filter:brightness(1.06)}',
        '.po-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
        '.po-area:focus{outline:none}',
        // 方案 A 标志性装饰:卡片顶部 2px 品牌渐变发丝线
        // 禁用态:半透明弱化,与方案一致
        '.po-primary:disabled,.po-quiet:disabled,.po-refresh:disabled,.po-mode:disabled,.icon-disabled{opacity:.5;cursor:default}',
        '.po-mode:hover:disabled{background:transparent}',
        '.po-card{position:relative}',
        // 历史面板:滚动/悬停/选中态(与卡片滚动条、交互风格同源)
        // ---- 历史面板:消息流式布局(头栏 + 滚动列表 + 网格化条目) ----
        '.po-history-wrap{display:flex;flex-direction:column;gap:10px;min-width:0}',
        '.po-history{display:flex;flex-direction:column;gap:10px;max-height:340px;overflow-y:auto;padding:2px 4px 2px 2px;margin:-2px -4px -2px -2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l4) transparent;overscroll-behavior:contain}',
        '.po-history::-webkit-scrollbar{width:8px}',
        '.po-history::-webkit-scrollbar-track{background:transparent}',
        '.po-history::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l4);border-radius:999px}',
        '.po-history::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-secondary)}',
        '.po-history-item{border:1px solid var(--dsw-alias-border-l4);border-left:3px solid transparent;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-base);min-width:0;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}',
        '.po-history-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06));border-color:var(--dsw-alias-border-l3);box-shadow:0 1px 2px rgba(0,0,0,.04)}',
        '.po-history-item:focus-within{border-color:var(--dsw-alias-border-l3)}',
        '.po-history-item.sel{border-left-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-selected-soft,rgba(59,130,246,.07))}',
        '.po-history-item.sel:hover{background:var(--dsw-alias-interactive-bg-selected-soft,rgba(59,130,246,.10))}',
        '.po-history-item .meta{display:flex;align-items:center;gap:8px;min-width:0}',
        '.po-history-item .chip{flex:none;font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.12);color:var(--dsw-alias-label-secondary)}',
        '.po-history-item.sel .chip{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-button-primary-label,#fff)}',
        '.po-history-item .tm{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
        '.po-history-item .blk{display:grid;grid-template-columns:34px minmax(0,1fr);gap:8px;align-items:start}',
        '.po-history-item .lab{font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap}',
        '.po-history-item .txt{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}',
        '.po-history-item .txt.line1{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.po-history-item .txt.clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        '.po-history-item .blk.new .lab{color:var(--dsw-alias-state-business-primary);font-weight:600}',
        '.po-history-item .blk.new .txt{font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.po-history-item .ops{display:flex;justify-content:flex-end;gap:8px;padding-top:2px;border-top:1px dashed var(--dsw-alias-border-l4);opacity:.85;transition:opacity .12s ease}',
        '.po-history-item:hover .ops,.po-history-item:focus-within .ops,.po-history-item.sel .ops{opacity:1}',
        '.po-history-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:140px;padding:20px 16px;border:1px dashed var(--dsw-alias-border-l4);border-radius:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-subtle,transparent);text-align:center}',
        '.po-history-empty .t{font-size:13px;color:var(--dsw-alias-label-primary);font-weight:500}',
        '.po-history-empty .h{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-width:320px}',
        '.po-history-empty svg{width:22px;height:22px;opacity:.5}',        '.po-card::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--dsw-alias-state-business-primary),transparent 70%)}',
      ].join('\n');
      document.head.appendChild(style);
    }

    const cardStyle = {
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid var(--dsw-alias-border-l4)',
      borderRadius: RADIUS_XL,
      padding: '0',
      display: 'flex', flexDirection: 'column',
      width: 'var(--dsh-composer-card-max-width, 720px)',
      maxWidth: '100%',
      margin: '0 auto 12px',
      boxShadow: CARD_SHADOW,
      overflow: 'hidden',
    };
    const headerStyle = {
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 16px',
      background: 'var(--dsw-alias-bg-subtle, transparent)',
      borderBottom: '1px solid var(--dsw-alias-border-l4)',
    };
    const badgeStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24, height: 24, flex: 'none',
      borderRadius: RADIUS_LG,
      background: 'var(--dsw-alias-state-business-primary)',
      color: '#fff', fontSize: 13,
    };
    const titleStyle = { fontSize: 13, fontWeight: 600, lineHeight: '18px' };
    const segmentedStyle = {
      display: 'inline-flex',
      border: '1px solid var(--dsw-alias-border-l4)',
      borderRadius: RADIUS_LG,
      overflow: 'hidden',
    };
    const modeButtonStyle = (active) => ({
      font: 'inherit', fontSize: 12,
      padding: '4px 12px',
      border: 'none',
      cursor: 'pointer',
      background: active ? 'var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-state-business-primary))' : 'transparent',
      color: active ? 'var(--dsw-alias-button-primary-label, #fff)' : 'var(--dsw-alias-label-secondary)',
    });
    const quietButtonStyle = {
      font: 'inherit', fontSize: 12, cursor: 'pointer',
      borderRadius: RADIUS_LG, padding: '4px 12px',
      border: '1px solid var(--dsw-alias-border-l4)',
      background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
    };
    const iconButtonStyle = {
      ...quietButtonStyle,
      border: 'none', padding: '4px 6px',
    };
    const primaryButtonStyle = {
      ...quietButtonStyle,
      background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary))',
      color: 'var(--dsw-alias-button-primary-label, #fff)',
      border: 'none',
    };
    const areaStyle = {
      width: '100%', boxSizing: 'border-box', resize: 'none',
      minHeight: '150px', maxHeight: '320px', overflowY: 'auto',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      border: 'none', outline: 'none',
      padding: '14px 16px', font: 'inherit', fontSize: 13, lineHeight: '22px',
    };
    const bodyStyle = { display: 'flex', flexDirection: 'column', gap: 12 };
    const footerStyle = {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 16px',
      borderTop: '1px solid var(--dsw-alias-border-l4)',
      background: 'var(--dsw-alias-bg-subtle, transparent)',
    };
    const errorStyle = {
      display: 'flex', alignItems: 'center', gap: 8,
      margin: '14px 16px 0',
      padding: '10px 12px',
      border: '1px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l4))',
      borderRadius: RADIUS_LG,
      background: 'var(--dsw-alias-state-error-bg, transparent)',
      color: 'var(--dsw-alias-state-error-primary)',
      fontSize: 13, lineHeight: '20px',
    };
    const paddedStyle = { padding: '14px 16px' };

    /** Optimizer card in the seat above the composer card. */
    function OptimizerCard(props) {
      const state = useStore();
      const optimizedRef = React.useRef(null);
      const active = state !== null && state.sessionId === props.sessionId;

      React.useEffect(() => { ensureStyles(); }, []);
      if (!active || state === null) return null;
      const loading = state.phase === 'loading';
      const busy = loading;
      const done = state.phase === 'done';

      const retry = () => runOptimization(state.sessionId, state.mode, state.original);

      const children = [
        // Header: identity, mode switcher, re-run and close.
        h('div', { style: headerStyle }, [
          h('span', { style: badgeStyle, 'aria-hidden': true }, '✦'),
          h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } }, [
            h('span', { style: titleStyle }, '提示词优化'),
          ]),
          h('div', { style: segmentedStyle, role: 'radiogroup', 'aria-label': '优化模式' },
            MODES.map((mode) => h('button', {
              key: mode,
              className: 'po-mode' + (state.mode === mode ? ' po-mode-active' : ''),
              disabled: loading,
              title: MODE_HINTS[mode],
              style: modeButtonStyle(state.mode === mode),
              onClick: () => { if (!busy && mode !== state.mode) runOptimization(state.sessionId, mode, state.original); },
            }, MODE_LABELS[mode])),
          ),
          h('button', {
            className: 'po-refresh',
            style: iconButtonStyle,
            disabled: busy,
            title: '基于当前原文重新优化',
            'aria-label': '重新优化',
            onClick: retry,
          }, busy
            ? h('span', { className: 'po-spin', style: { display: 'inline-block' } }, '◌')
            : '↻'),
          h('button', {
            className: 'po-quiet', style: iconButtonStyle,
            onClick: () => store.set({ ...state, showHistory: !state.showHistory }),
            title: '优化历史(最近 5 条)',
            'aria-label': '优化历史',
          }, h('svg', {
            width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
            style: { display: 'block' },
          }, [
            h('circle', { cx: 12, cy: 12, r: 8.5, stroke: 'currentColor', strokeWidth: 1.6 }),
            h('path', { d: 'M12 7v5l3.2 2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
          ])),
          h('button', {
            className: 'po-quiet',
            style: iconButtonStyle,
            onClick: closeCard,
            title: '关闭',
            'aria-label': '关闭',
          }, '✕'),
        ]),
      ];

      if (state.showHistory) {
        const list = loadHistory();
        const selected = state.phase === 'done' ? state.optimized : null;
        children.push(h('div', { style: bodyStyle }, [
          h('div', { className: 'po-history-wrap' }, [
            list.length === 0
              ? h('div', { className: 'po-history-empty' }, [
                  h('svg', {
                    viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
                  }, [
                    h('circle', { cx: 12, cy: 12, r: 8.5, stroke: 'currentColor', strokeWidth: 1.5 }),
                    h('path', { d: 'M12 7.5v5l3 2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
                  ]),
                  h('span', { className: 't' }, '还没有优化记录'),
                  h('span', { className: 'h' }, '完成一次优化后会保留最近 5 条,可随时回看、回填或再次采用。'),
                ])
              : h('div', { className: 'po-history' },
                  list.map((item, i) => h('div', {
                    key: i,
                    className: 'po-history-item' + (selected !== null && item.optimized === selected ? ' sel' : ''),
                  }, [
                    // 元信息行:模式胶囊 + 时间
                    h('div', { className: 'meta' }, [
                      h('span', { className: 'chip' }, MODE_LABELS[item.mode] ?? item.mode),
                      h('span', { className: 'tm' }, new Date(item.time).toLocaleString()),
                    ]),
                    // 原文:单行截断,悬浮显示全文
                    h('div', { className: 'blk' }, [
                      h('span', { className: 'lab' }, '原文'),
                      h('span', { className: 'txt line1', title: item.original }, item.original),
                    ]),
                    // 结果:两行截断
                    h('div', { className: 'blk new' }, [
                      h('span', { className: 'lab' }, '结果'),
                      h('span', { className: 'txt clamp2', title: item.optimized }, item.optimized),
                    ]),
                    // 操作区
                    h('div', { className: 'ops' }, [
                      h('button', {
                        className: 'po-quiet', style: quietButtonStyle,
                        onClick: () => store.set({ ...state, showHistory: false, phase: 'done', optimized: item.optimized, original: item.original, mode: item.mode, error: null }),
                      }, '查看结果'),
                      h('button', {
                        className: 'po-primary', style: primaryButtonStyle,
                        onClick: () => { props.inputActions.setDraft(item.optimized); store.set(null); },
                      }, '采用'),
                    ]),
                  ]))),
          ]),
        ]));
      } else if (loading) {
        children.push(h('div', { style: bodyStyle }, [
          h('div', { style: { ...areaStyle, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dsw-alias-label-secondary)', minHeight: 90 } },
            h('span', { className: 'po-spin', style: { display: 'inline-block', flex: 'none' } }, '◌'),
            '正在优化，请稍候…'),
        ]));
      } else if (state.phase === 'error') {
        children.push(h('div', { style: bodyStyle }, [
          h('div', { style: errorStyle, role: 'alert' }, [
            h('span', { style: { flex: 1 } }, `优化失败：${state.error}`),
            h('button', {
              className: 'po-quiet', onClick: retry,
              style: { ...quietButtonStyle, border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', background: 'transparent' },
            }, '重试'),
          ]),
          h('div', { style: { ...areaStyle, ...paddedStyle, color: 'var(--dsw-alias-label-secondary)', minHeight: 70 } }, state.original),
        ]));
      } else if (done) {
        children.push(h('div', { style: bodyStyle }, [
          h('textarea', {
            style: areaStyle,
            className: 'po-area',
            spellCheck: false,
            defaultValue: state.optimized,
            key: 'opt' + state.optimized.length + state.optimized.slice(-20),
            ref: (el) => { optimizedRef.current = el; },
          }),
        ]));
      }

      // Footer actions.
      children.push(h('div', { style: footerStyle }, [
        h('span', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' } },
          state.phase === 'done' && state.route ? `模型:${state.route.provider} / ${state.route.model}` : ''),
        h('button', {
          className: 'po-quiet',
          style: quietButtonStyle,
          onClick: closeCard,
        }, '取消'),
        state.showHistory
          ? h('button', {
              className: 'po-primary',
              style: primaryButtonStyle,
              onClick: () => store.set({ ...state, showHistory: false }),
            }, '返回结果')
          : h('button', {
              className: 'po-primary',
              style: primaryButtonStyle,
              disabled: !done,
              onClick: () => {
                const area = optimizedRef.current;
                const next = area !== null && area.value.trim() !== '' ? area.value.trim() : state.optimized;
                props.inputActions.setDraft(next);
                store.set(null);
              },
            }, '采用此结果'),
      ]));

      return h('div', { className: 'po-card', style: cardStyle, role: 'region', 'aria-label': '提示词优化' }, children);
    }

    const defaultModeRef = { current: 'basic' };
    const SUMMARY_TEXT = '一键优化输入框草稿 · 三种模式 · 自定义模板与模型路由';

    // ---- 优化历史:localStorage 保留最近 5 条(原文/结果/模式/强度/时间) ----
    const HISTORY_KEY = 'po-optimization-history';
    const HISTORY_MAX = 5;
    function loadHistory() {
      try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? []; } catch { return []; }
    }
    function saveHistory(list) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch {}
    }
    function pushHistory(entry) {
      const list = loadHistory();
      list.unshift({ ...entry, time: Date.now() });
      saveHistory(list);
    }

    // ---------------------------------------------------------------------------
    // Settings page: rendered into the `main` slot (sidebar entry + bundle card),
    // persisted through the Host bridge into the `settings` service namespace
    // `prompt-optimizer`. Form organization follows the general shape of
    // linshenkx/prompt-optimizer's preferences (model, optimization mode,
    // custom template) without reusing its code.
    // ---------------------------------------------------------------------------

    const STRENGTH_LABELS = { concise: '精炼', balanced: '均衡', detailed: '深入' };
    const STRENGTH_HINTS = {
      concise: '控制篇幅，快速改写',
      balanced: '默认策略，清晰与完整的平衡',
      detailed: '允许扩充结构化细节与验收标准',
    };

    const settingsCardStyle = {
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid var(--dsw-alias-border-l4)',
      borderRadius: RADIUS_XL,
      padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 18,
      maxWidth: 760,
    };
    const fieldRowStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
    const sectionDividerStyle = { borderBottom: '1px solid var(--dsw-alias-border-l4)', paddingBottom: 18 };
    const fieldLabelStyle = { fontSize: 13, fontWeight: 600, lineHeight: '20px' };
    const fieldHintStyle = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', lineHeight: '18px' };
    const settingsSegmentedStyle = { ...segmentedStyle, alignSelf: 'flex-start', width: 'fit-content' };
    const settingsSegmentButtonStyle = (active) => ({
      font: 'inherit', fontSize: 12,
      padding: '6px 14px',
      border: 'none',
      cursor: 'pointer',
      background: active ? 'var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-state-business-primary))' : 'transparent',
      color: active ? 'var(--dsw-alias-button-primary-label, #fff)' : 'var(--dsw-alias-label-secondary)',
    });
    const settingsInputStyle = {
      font: 'inherit', fontSize: 13,
      padding: '8px 10px',
      border: '1px solid var(--dsw-alias-border-l4)',
      borderRadius: RADIUS_LG,
      background: 'var(--dsw-alias-bg-subtle, transparent)',
      color: 'var(--dsw-alias-label-primary)',
      width: '100%', boxSizing: 'border-box',
    };
    const settingsTextareaStyle = {
      ...settingsInputStyle,
      resize: 'vertical', minHeight: 90, lineHeight: '20px',
    };
    const settingsStatusStyle = (tone) => ({
      fontSize: 12, lineHeight: '18px',
      color: tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
        : tone === 'success' ? 'var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary))'
        : 'var(--dsw-alias-label-secondary)',
    });

    /** Settings form for one namespace value. */
    function SettingsCard({ page }) {
      const [loaded, setLoaded] = React.useState(null); // { revision, value }
      const [draft, setDraft] = React.useState(null);   // value being edited
      const [models, setModels] = React.useState(null); // { providers, defaultSelection }
      const [status, setStatus] = React.useState(null); // { tone, text }
      const [saving, setSaving] = React.useState(false);

      const load = React.useCallback(async () => {
        try {
          const [settingsRes, modelsRes] = await Promise.all([
            fetch(API + '/settings'),
            fetch(API + '/models'),
          ]);
          const settings = await settingsRes.json();
          const modelsPayload = await modelsRes.json().catch(() => null);
          if (!settingsRes.ok || settings?.ok !== true) throw new Error(settings?.message ?? `HTTP ${settingsRes.status}`);
          setLoaded({ revision: settings.revision, value: settings.value });
          setDraft(settings.value);
          if (modelsRes.ok && modelsPayload?.ok) setModels(modelsPayload);
        } catch (error) {
          setStatus({ tone: 'error', text: '加载设置失败：' + (error instanceof Error ? error.message : String(error)) });
        }
      }, []);

      React.useEffect(() => { ensureStyles(); }, []);
      React.useEffect(() => { void load(); }, [load]);

      if (loaded === null || draft === null) {
        return h('div', { style: { ...(page ? {} : { padding: '12px 16px' }), color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
          status !== null ? status.text : '正在加载设置…');
      }

      const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.value);
      const setField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

      const save = async () => {
        setSaving(true);
        setStatus({ tone: 'info', text: '正在保存…' });
        const ops = Object.keys(draft).map((key) => ({ op: 'set', path: [key], value: draft[key] }));
        try {
          const response = await fetch(API + '/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ops, expectedRevision: loaded.revision }),
          });
          const payload = await response.json();
          if (response.status === 409 && payload?.code === 'conflict') {
            setLoaded({ revision: payload.revision, value: payload.value });
            setDraft(payload.value);
            setStatus({ tone: 'error', text: '设置已被其他页面修改，已刷新为最新值，请重新调整后再保存。' });
          } else if (!response.ok || payload?.ok !== true) {
            setStatus({ tone: 'error', text: '保存失败：' + (payload?.message ?? `HTTP ${response.status}`) });
          } else {
            setLoaded({ revision: payload.revision, value: payload.value });
            setDraft(payload.value);
            setStatus({ tone: 'success', text: '已保存，新配置即时生效。' });
            if (MODE_LABELS[payload.value?.template] !== undefined) defaultModeRef.current = payload.value.template;
          }
        } catch (error) {
          setStatus({ tone: 'error', text: '保存失败：' + (error instanceof Error ? error.message : String(error)) });
        } finally {
          setSaving(false);
        }
      };

      const cancel = () => {
        setDraft(loaded.value);
        setStatus(dirty ? { tone: 'info', text: '已放弃未保存的修改。' } : null);
      };

      const DEFAULTS = { template: 'basic', strength: 'balanced', instruction: '', followDefaultModel: true, provider: '', model: '' };
      const restoreDefaults = async () => {
        if (!window.confirm('确认恢复全部设置为默认值?当前自定义内容将被覆盖。')) return;
        setSaving(true);
        setStatus({ tone: 'info', text: '正在恢复默认…' });
        const ops = Object.keys(DEFAULTS).map((key) => ({ op: 'set', path: [key], value: DEFAULTS[key] }));
        try {
          const response = await fetch(API + '/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ops, expectedRevision: loaded.revision }),
          });
          const payload = await response.json();
          if (response.ok && payload?.ok === true) {
            setLoaded({ revision: payload.revision, value: payload.value });
            setDraft(payload.value);
            setStatus({ tone: 'success', text: '已恢复默认设置。' });
            defaultModeRef.current = 'basic';
          } else {
            setStatus({ tone: 'error', text: '恢复默认失败:' + (payload?.message ?? `HTTP ${response.status}`) });
          }
        } catch (error) {
          setStatus({ tone: 'error', text: '恢复默认失败:' + (error instanceof Error ? error.message : String(error)) });
        } finally {
          setSaving(false);
        }
      };

      const selectedProvider = typeof draft.provider === 'string' && draft.provider !== '' ? draft.provider : (models?.defaultSelection?.provider ?? '');
      const providerOptions = models === null ? [] : models.providers;
      const providerModels = (providerOptions.find((p) => p.id === selectedProvider)?.models) ?? [];

      return h('div', { className: 'po-settings po-card', style: { ...(page ? settingsCardStyle : { ...settingsCardStyle, padding: '14px 16px', gap: 12 }) } }, [
        page ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
          h('div', { style: { fontSize: 16, fontWeight: 600 } }, '提示词优化 · 设置'),
          h('div', { style: fieldHintStyle }, '配置优化模式、优化强度、自定义模板与模型路由；保存后即时生效。'),
        ]) : null,

        // 优化模式
        h('div', { style: { ...fieldRowStyle, ...sectionDividerStyle } }, [
          h('div', { style: fieldLabelStyle }, '默认优化模式'),
          h('div', { style: settingsSegmentedStyle, role: 'radiogroup', 'aria-label': '默认优化模式' },
            MODES.map((mode) => h('button', {
              key: mode,
              className: 'po-mode' + (draft.template === mode ? ' po-mode-active' : ''),
              style: settingsSegmentButtonStyle(draft.template === mode),
              title: MODE_HINTS[mode],
              onClick: () => setField('template', mode),
            }, MODE_LABELS[mode])),
          ),
          h('div', { style: fieldHintStyle }, MODE_HINTS[draft.template] ?? ''),
        ]),

        // 优化强度
        h('div', { style: { ...fieldRowStyle, ...sectionDividerStyle } }, [
          h('div', { style: fieldLabelStyle }, '优化强度'),
          h('div', { style: settingsSegmentedStyle, role: 'radiogroup', 'aria-label': '优化强度' },
            Object.keys(STRENGTH_LABELS).map((key) => h('button', {
              key,
              className: 'po-mode' + (draft.strength === key ? ' po-mode-active' : ''),
              style: settingsSegmentButtonStyle(draft.strength === key),
              title: STRENGTH_HINTS[key],
              onClick: () => setField('strength', key),
            }, STRENGTH_LABELS[key])),
          ),
          h('div', { style: fieldHintStyle }, STRENGTH_HINTS[draft.strength] ?? ''),
        ]),

        // 自定义模板
        h('div', { style: { ...fieldRowStyle, ...sectionDividerStyle } }, [
          h('div', { style: fieldLabelStyle }, '自定义提示词模板'),
          h('div', { style: fieldHintStyle }, '留空使用内置模板；填写后将作为系统提示词替代所选模式（占位符与细节保留规则仍会附加）。'),
          h('textarea', {
            style: settingsTextareaStyle,
            className: 'po-area',
            spellCheck: false,
            placeholder: '（留空 = 使用内置优化模板）',
            value: draft.instruction ?? '',
            onChange: (event) => setField('instruction', event.target.value),
          }),
        ]),

        // 模型路由
        h('div', { style: fieldRowStyle }, [
          h('div', { style: fieldLabelStyle }, '模型路由'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h('input', {
              type: 'checkbox',
              checked: draft.followDefaultModel !== false,
              onChange: (event) => setField('followDefaultModel', event.target.checked),
            }),
            '跟随 DSH 当前默认模型' + (models?.defaultSelection ? `（${models.defaultSelection.provider ?? '未知'} / ${models.defaultSelection.model ?? '未知'}）` : '')),
          h('div', {
            style: { ...fieldRowStyle, paddingLeft: 4, gap: 10, opacity: draft.followDefaultModel === false ? 1 : 0.45, pointerEvents: draft.followDefaultModel === false ? 'auto' : 'none' },
          }, [
            h('div', { style: fieldRowStyle }, [
              h('div', { style: fieldHintStyle }, 'Provider（来自 DSH 已配置的模型列表）'),
              providerOptions.length > 0
                ? h('select', {
                    style: settingsInputStyle,
                    value: selectedProvider,
                    onChange: (event) => {
                      const provider = event.target.value;
                      const firstModel = (providerOptions.find((p) => p.id === provider)?.models ?? [])[0] ?? '';
                      setDraft((prev) => ({ ...prev, provider, model: firstModel }));
                    },
                  }, providerOptions.map((p) => h('option', { key: p.id, value: p.id }, p.label ?? p.id)))
                : h('input', {
                    style: settingsInputStyle,
                    placeholder: '如 deepseek / openai …',
                    value: draft.provider ?? '',
                    onChange: (event) => setField('provider', event.target.value),
                  }),
            ]),
            h('div', { style: fieldRowStyle }, [
              h('div', { style: fieldHintStyle }, 'Model'),
              providerModels.length > 0
                ? h('select', {
                    style: settingsInputStyle,
                    value: draft.model ?? '',
                    onChange: (event) => setField('model', event.target.value),
                  }, providerModels.map((id) => h('option', { key: id, value: id }, id)))
                : h('input', {
                    style: settingsInputStyle,
                    placeholder: '模型 ID（如 deepseek-chat）',
                    value: draft.model ?? '',
                    onChange: (event) => setField('model', event.target.value),
                  }),
              providerOptions.length === 0 ? h('div', { style: fieldHintStyle }, '未能获取模型目录（可能未配置任何 Provider），可手动填写或改回跟随默认模型。') : null,
            ]),
          ]),
        ]),

        // Status + actions
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, [
          h('span', { style: { flex: 1, ...settingsStatusStyle(status?.tone ?? 'info') } },
            status !== null ? status.text : (dirty ? '有未保存的修改。' : '')),
          h('button', {
            className: 'po-quiet', style: quietButtonStyle,
            disabled: saving || !dirty,
            onClick: cancel,
          }, '取消'),
          h('button', {
            className: 'po-quiet', style: quietButtonStyle,
            disabled: saving,
            onClick: restoreDefaults,
          }, '恢复默认'),
          h('button', {
            className: 'po-primary', style: primaryButtonStyle,
            disabled: saving || !dirty,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
        ]),
      ]);
    }

    function PromptOptimizerSettingsPage() {
      React.useEffect(() => { ensureStyles(); }, []);
      return h('div', {
        style: { height: '100%', minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '16px 150px 24px 24px' },
      }, h(SettingsCard, { page: true }));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Pick up the configured default template from the Host route (best effort).
        void (async () => {
          try {
            const response = await fetch(API);
            if (!response.ok) return;
            const payload = await response.json();
            if (payload?.template !== undefined && MODE_LABELS[payload.template] !== undefined) {
              defaultModeRef.current = payload.template;
            }
          } catch {}
        })();

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'prompt-optimizer', order: 50 },
          (props) => {
            const draft = props.useInput((s) => s.draft);
            const busyPhase = props.useInput((s) => s.phase);
            const state = useStore();
            const locked = busyPhase !== 'plain';
            const cardOpen = state !== null;
            const draftLen = draft.trim().length;
            const nearCap = draftLen > 18000; // 上限 20000,90% 起预警

            function onClick() {
              const original = draft.trim();
              if (original === '' || locked) return;
              if (cardOpen) { store.set(null); return; }
              runOptimization(props.sessionId, defaultModeRef.current, original);
            }

            return h('button', {
              type: 'button',
              title: `一键优化提示词(草稿 ${draftLen} 字 / 上限 20000)`,
              'aria-label': '一键优化提示词',
              disabled: locked,
              onClick: onClick,
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 4,
                font: 'inherit', fontSize: 12,
                color: nearCap ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
                background: 'transparent', border: 'none', cursor: locked ? 'default' : 'pointer',
                borderRadius: RADIUS_LG, padding: '4px 6px',
              },
            }, '✦ 优化');
          },
        ));

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
          { name: 'conversation.input.dock', id: 'prompt-optimizer', order: 50 },
          (props) => OptimizerCard(props),
        ));

        // Settings entries live in the plugins UI only (bundle detail page and
        // the row card), mirroring the dsh-free-search pattern — no sidebar
        // entry. `main` renders the standalone page that both seats open.
        // Seat keys must match the plugin-manager page's lookup keys exactly:
        // bundle → pkg.name, row → `${pkg.name}#${rowId}`.
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: 'prompt-optimizer' },
          PromptOptimizerSettingsPage,
        ));
        const seat = (name, key) => ctx.slots.register(
          { name, key },
          (slotProps) => (slotProps && slotProps.view === 'summary')
            ? SUMMARY_TEXT
            : h(SettingsCard, { page: true }),
        );
        ctx.slots.inject('plugins.bundle.config', () => seat('plugins.bundle.config', 'dsh-prompt-optimizer'));
        ctx.slots.inject('plugins.row.config', () => seat('plugins.row.config', 'dsh-prompt-optimizer#prompt-optimizer'));
      },
    };
  },
});
