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
    const MODE_HINTS = {
      basic: '消除模糊表达，补充关键信息',
      professional: '细化参数、标准与边界',
      planning: '改写为角色-步骤-输出的规划式提示词',
    };

    /** Shared store so the button (input.right) and card (input.dock) stay in sync. */
    const store = {
      state: null, // null | { sessionId, phase: 'loading'|'done'|'error', mode, original, optimized, error }
      listeners: new Set(),
      set(next) { this.state = next; for (const fn of this.listeners) fn(); },
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    };
    function useStore() {
      const [, force] = React.useState(0);
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
      return store.state;
    }

    /** Call the Host side-channel route once. */
    async function optimize(mode, original) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, mode }),
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.optimized === undefined) {
        throw new Error(payload?.error ?? `服务返回异常（HTTP ${response.status}）`);
      }
      return payload.optimized;
    }

    /** Kick off one optimization run for the current card state. */
    function runOptimization(sessionId, mode, original) {
      store.set({ sessionId, phase: 'loading', mode, original, optimized: null, error: null });
      optimize(mode, original).then(
        (optimized) => {
          const current = store.state;
          if (current !== null && current.sessionId === sessionId) {
            store.set({ ...current, phase: 'done', optimized, error: null });
          }
        },
        (error) => {
          const current = store.state;
          if (current !== null && current.sessionId === sessionId) {
            store.set({ ...current, phase: 'error', optimized: null, error: error instanceof Error ? error.message : String(error) });
          }
        },
      );
    }

    /** One-off style sheet for the card's keyframes and hover states. */
    const STYLE_ID = 'prompt-optimizer-styles';
    function ensureStyles() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        '@keyframes po-spin{to{transform:rotate(360deg)}}',
        `.po-spin{display:inline-block;animation:po-spin .9s linear infinite}`,
        `.po-mode:hover:not(:disabled):not(.po-mode-active){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}`,
        `.po-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}`,
        `.po-primary:hover:not(:disabled){filter:brightness(1.06)}`,
        `.po-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary)}`,
        `.po-area:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-border-l4))}`,
      ].join('\n');
      document.head.appendChild(style);
    }

    const cardStyle = {
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-xl, 12px)',
      padding: '0',
      display: 'flex', flexDirection: 'column',
      width: 'var(--dsh-composer-card-max-width, 720px)',
      maxWidth: '100%',
      margin: '0 auto 12px',
      boxShadow: 'var(--dsw-shadow-overlay, 0 8px 28px rgba(0,0,0,0.14))',
      overflow: 'hidden',
    };
    const headerStyle = {
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 16px',
      background: 'var(--dsw-alias-bg-subtle, transparent)',
      borderBottom: '0.5px solid var(--dsw-alias-border-l4)',
    };
    const badgeStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24, height: 24, flex: 'none',
      borderRadius: 'var(--dsw-radius-lg, 8px)',
      background: 'var(--dsw-alias-state-business-primary)',
      color: '#fff', fontSize: 13,
    };
    const titleStyle = { fontSize: 13, fontWeight: 600, lineHeight: '18px' };
    const segmentedStyle = {
      display: 'inline-flex',
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-lg, 8px)',
      overflow: 'hidden',
    };
    const modeButtonStyle = (active) => ({
      font: 'inherit', fontSize: 12,
      padding: '4px 12px',
      border: 'none',
      cursor: 'pointer',
      background: active ? 'var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-state-business-primary))' : 'transparent',
      color: active ? 'var(--dsw-alias-button-primary-label, var(--dsw-alias-label-primary))' : 'var(--dsw-alias-label-secondary)',
    });
    const quietButtonStyle = {
      font: 'inherit', fontSize: 12, cursor: 'pointer',
      borderRadius: 'var(--dsw-radius-lg, 8px)', padding: '4px 12px',
      border: '0.5px solid var(--dsw-alias-border-l4)',
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
      borderTop: '0.5px solid var(--dsw-alias-border-l4)',
      background: 'var(--dsw-alias-bg-subtle, transparent)',
    };
    const errorStyle = {
      display: 'flex', alignItems: 'center', gap: 8,
      margin: '14px 16px 0',
      padding: '10px 12px',
      border: '0.5px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l4))',
      borderRadius: 'var(--dsw-radius-lg, 8px)',
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
              onClick: () => { if (mode !== state.mode) runOptimization(state.sessionId, mode, state.original); },
            }, MODE_LABELS[mode])),
          ),
          h('button', {
            className: 'po-refresh',
            style: iconButtonStyle,
            disabled: loading,
            title: '基于当前原文重新优化',
            'aria-label': '重新优化',
            onClick: retry,
          }, loading
            ? h('span', { className: 'po-spin', style: { display: 'inline-block' } }, '◌')
            : '↻'),
          h('button', {
            className: 'po-quiet',
            style: iconButtonStyle,
            onClick: () => store.set(null),
            title: '关闭',
            'aria-label': '关闭',
          }, '✕'),
        ]),
      ];

      if (loading) {
        children.push(h('div', { style: bodyStyle }, [
          h('div', { style: { ...areaStyle, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dsw-alias-label-secondary)', minHeight: 90 } },
            h('span', { className: 'po-spin', style: { display: 'inline-block', flex: 'none' } }, '◌'),
            '正在优化，请稍候…'),
        ]));
      } else if (state.phase === 'error') {
        children.push(h('div', { style: bodyStyle }, [
          h('div', { style: errorStyle, role: 'alert' }, [
            h('span', { style: { flex: 1 } }, `优化失败：${state.error}`),
            h('button', { className: 'po-quiet', style: quietButtonStyle, onClick: retry }, '重试'),
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
        h('span', { style: { flex: 1 } }),
        h('button', {
          className: 'po-quiet',
          style: quietButtonStyle,
          onClick: () => store.set(null),
        }, '取消'),
        h('button', {
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

      return h('div', { style: cardStyle, role: 'region', 'aria-label': '提示词优化' }, children);
    }

    const defaultModeRef = { current: 'basic' };

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
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-xl, 12px)',
      padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 18,
      maxWidth: 760,
    };
    const fieldRowStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
    const sectionDividerStyle = { borderBottom: '0.5px solid var(--dsw-alias-border-l4)', paddingBottom: 18 };
    const fieldLabelStyle = { fontSize: 13, fontWeight: 600, lineHeight: '20px' };
    const fieldHintStyle = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', lineHeight: '18px' };
    const settingsSegmentedStyle = { ...segmentedStyle, alignSelf: 'flex-start', width: 'fit-content' };
    const settingsSegmentButtonStyle = (active) => ({
      font: 'inherit', fontSize: 12,
      padding: '6px 14px',
      border: 'none',
      cursor: 'pointer',
      background: active ? 'var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-state-business-primary))' : 'transparent',
      color: active ? 'var(--dsw-alias-button-primary-label, var(--dsw-alias-label-primary))' : 'var(--dsw-alias-label-secondary)',
    });
    const settingsInputStyle = {
      font: 'inherit', fontSize: 13,
      padding: '8px 10px',
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-lg, 8px)',
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

      const selectedProvider = typeof draft.provider === 'string' && draft.provider !== '' ? draft.provider : (models?.defaultSelection?.provider ?? '');
      const providerOptions = models === null ? [] : models.providers;
      const providerModels = (providerOptions.find((p) => p.id === selectedProvider)?.models) ?? [];

      return h('div', { style: { ...(page ? settingsCardStyle : { ...settingsCardStyle, padding: '14px 16px', gap: 12 }) } }, [
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

            function onClick() {
              const original = draft.trim();
              if (original === '' || locked) return;
              if (cardOpen) { store.set(null); return; }
              runOptimization(props.sessionId, defaultModeRef.current, original);
            }

            return h('button', {
              type: 'button',
              title: '一键优化提示词',
              'aria-label': '一键优化提示词',
              disabled: locked,
              onClick: onClick,
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 4,
                font: 'inherit', fontSize: 12,
                color: 'var(--dsw-alias-label-secondary)',
                background: 'transparent', border: 'none', cursor: locked ? 'default' : 'pointer',
                borderRadius: 'var(--dsw-radius-lg, 8px)', padding: '4px 6px',
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
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: 'dsh-prompt-optimizer' },
          (slotProps) => (slotProps && slotProps.view === 'summary')
            ? '一键优化输入框草稿 · 三种模式 · 自定义模板与模型路由'
            : h(SettingsCard, { page: true }),
        ));
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
          { name: 'plugins.row.config', key: 'dsh-prompt-optimizer#prompt-optimizer' },
          (slotProps) => (slotProps && slotProps.view === 'summary')
            ? '一键优化输入框草稿 · 三种模式 · 自定义模板与模型路由'
            : h(SettingsCard, { page: true }),
        ));
      },
    };
  },
});
