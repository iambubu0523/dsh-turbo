/**
 * Client half of dsh-turbo-mode: the Standard | Fast switch in the composer
 * dock.
 *
 * It talks to its own host half over `/turbo/*` (same origin, loopback only)
 * and renders exactly what the host measured. Nothing here decides whether
 * Fast is in effect — the host reports `effective` after checking the
 * endpoint's real capability, and the switch shows that answer even when it is
 * "this provider has no priority tier".
 */

window.__ModuleLoader__.load({
  id: 'dsh-turbo-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ---- copy -------------------------------------------------------------

    const COPY = {
      en: {
        label: 'Turbo',
        standard: 'Standard',
        fast: 'Fast',
        fastPending: 'Fast asked…',
        unsupported: 'This endpoint has no documented priority tier. Fast stays off.',
        noGain: 'Measured here: no reproducible speed-up, so Fast stays off.',
        unclassified: 'Send one message first: the plugin cannot classify this endpoint yet.',
        unreachable: 'Turbo host is not reachable.',
        noMetrics: 'no samples yet',
        firstToken: 'first token',
        throughput: 'tok/s',
        scopeProfile: 'all sessions',
        scopeSession: 'this session',
        held: 'throttled, waiting',
      },
      zh: {
        label: 'Turbo',
        standard: '标准',
        fast: '极速',
        fastPending: '已请求极速…',
        unsupported: '该接入点没有官方优先档位，Fast 未生效。',
        noGain: '实测无可复现加速，Fast 未生效。',
        unclassified: '先发一条消息：插件还无法判定这个接入点。',
        unreachable: '连不上 Turbo 宿主端。',
        noMetrics: '暂无样本',
        firstToken: '首字',
        throughput: 'tok/s',
        scopeProfile: '全部会话',
        scopeSession: '当前会话',
        held: '被限流，等待中',
      },
    }

    /** Best-effort read of the app language; never throws. */
    function languageOf(ctx) {
      try {
        const snap = ctx.locale?.getSnapshot?.()
        const value = snap?.locale ?? snap?.language ?? snap?.current ?? snap?.id
        if (typeof value === 'string' && value !== '') return value
      } catch {}
      const nav = typeof navigator === 'object' ? navigator.language : undefined
      return typeof nav === 'string' && nav !== '' ? nav : 'en'
    }

    function dictionary(ctx) {
      return languageOf(ctx).toLowerCase().startsWith('zh') ? COPY.zh : COPY.en
    }

    // ---- host API ---------------------------------------------------------

    function createApi() {
      async function call(path, init) {
        const response = await fetch(`/turbo${path}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          ...init,
          headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
        }
        return payload
      }
      return {
        state: (sessionId) =>
          call(typeof sessionId === 'string' && sessionId !== '' ? `/state?sessionId=${encodeURIComponent(sessionId)}` : '/state'),
        setSpeed: (speed, sessionId) =>
          call('/speed', {
            method: 'POST',
            body: JSON.stringify(typeof sessionId === 'string' && sessionId !== '' ? { speed, sessionId } : { speed }),
          }),
      }
    }

    /** The open conversation, so the switch acts on the session on screen. */
    function useSessionId(ctx) {
      const sessions = ctx.get?.('sessions')
      const read = React.useCallback(() => {
        try {
          const snap = sessions?.getSnapshot?.()
          const value = snap?.current
          return typeof value === 'string' && value !== '' ? value : undefined
        } catch {
          return undefined
        }
      }, [sessions])
      const [sessionId, setSessionId] = React.useState(read)
      React.useEffect(() => {
        setSessionId(read())
        if (typeof sessions?.subscribe === 'function') {
          const off = sessions.subscribe(() => setSessionId(read()))
          return () => {
            if (typeof off === 'function') off()
          }
        }
        const timer = setInterval(() => setSessionId(read()), 2000)
        return () => clearInterval(timer)
      }, [sessions, read])
      return sessionId
    }

    // ---- styles -----------------------------------------------------------

    const S = {
      root: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28))',
        borderRadius: 999,
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))',
      },
      name: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px 0 4px',
        fontSize: 11,
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
        whiteSpace: 'nowrap',
      },
      option: {
        border: 0,
        borderRadius: 999,
        padding: '0 9px',
        fontSize: 11,
        lineHeight: '20px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
      },
      optionOn: {
        background: 'var(--dsw-alias-brand-primary, #247bbf)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
      },
      optionOff: {
        background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18))',
        color: 'var(--dsw-alias-label-primary, #d0d0d0)',
      },
      dot: { width: 6, height: 6, borderRadius: 999, display: 'block', flex: '0 0 auto' },
      metrics: {
        fontSize: 11,
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-tertiary, #777)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },
      warn: {
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-state-warn-primary, #b7791f)',
      },
      error: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary, #d64545)' },
    }

    function dotColor(effective, busy) {
      if (busy) return 'var(--dsw-alias-label-dimmed, #999)'
      return effective ? 'var(--dsw-alias-state-success-primary, #2f9e44)' : 'var(--dsw-alias-border-l3, #9a9a9a)'
    }

    // ---- component --------------------------------------------------------

    function TurboToggle(props) {
      const api = props.api
      const ctx = props.ctx
      const text = dictionary(ctx)
      const sessionId = useSessionId(ctx)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        const load = () => {
          api.state(sessionId)
            .then((payload) => {
              if (!alive) return
              setState(payload?.state ?? payload)
              setError(null)
            })
            .catch((cause) => {
              if (alive) setError(cause instanceof Error ? cause.message : String(cause))
            })
        }
        load()
        const timer = setInterval(load, 3000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [api, sessionId])

      const choose = React.useCallback(
        (speed) => {
          setBusy(true)
          api
            .setSpeed(speed, sessionId)
            .then((payload) => {
              setState(payload?.state ?? payload)
              setError(null)
            })
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setBusy(false))
        },
        [api, sessionId],
      )

      if (error !== null) {
        return h('div', { style: S.root, title: error }, h('span', { style: S.name }, text.label), h('span', { style: S.error }, text.unreachable))
      }
      if (state === null) return null

      const speed = state.speed === 'fast' ? 'fast' : 'standard'
      const effective = state.effective === true
      const support = state.capability?.support ?? 'unknown'

      // Fast was asked for but the endpoint cannot honour it: say so, plainly.
      const blocked = speed === 'fast' && !effective
      const note = blocked
        ? support === 'unknown'
          ? text.unclassified
          : support === 'unsupported'
            ? text.unsupported
            : text.noGain
        : null

      const tier = state.metrics?.byTier?.[speed]
      const samples = Number(tier?.requests ?? 0)
      const firstToken = samples > 0 ? Math.round(Number(tier?.medianFirstTokenMs ?? 0)) : 0
      const rate = samples > 0 ? Number(tier?.medianTokensPerSecond ?? 0) : 0
      const metricText =
        samples > 0 && firstToken > 0
          ? `${text.firstToken} ${firstToken}ms · ${rate > 0 ? `${rate.toFixed(1)} ${text.throughput}` : '—'}`
          : text.noMetrics

      const holding = state.transport?.holding === true

      const option = (key, label) =>
        h(
          'button',
          {
            type: 'button',
            key,
            style: { ...S.option, ...(speed === key ? S.optionOn : S.optionOff) },
            disabled: busy,
            'aria-pressed': speed === key,
            onClick: () => {
              if (speed !== key) choose(key)
            },
          },
          label,
        )

      return h(
        'div',
        { style: S.root, 'data-turbo-mode': speed, 'data-turbo-effective': effective ? 'true' : 'false' },
        h(
          'span',
          {
            style: S.pill,
            title: `${state.provider ?? '—'} · ${state.model ?? '—'} · ${state.endpoint ?? '—'}\n${
              sessionId === undefined ? text.scopeProfile : text.scopeSession
            }\n${state.capability?.note ?? ''}`,
          },
          h('span', { style: S.name }, h('span', { style: { ...S.dot, background: dotColor(effective, busy) } }), text.label),
          option('standard', text.standard),
          option('fast', text.fast),
        ),
        h('span', { style: S.metrics }, holding ? `${metricText} · ${text.held}` : metricText),
        note !== null ? h('span', { style: S.warn }, note) : null,
      )
    }

    // ---- plugin -----------------------------------------------------------

    return {
      inject: ['slots'],
      apply(ctx) {
        const api = createApi()
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'turbo',
              order: 6,
              inject: () => ({ api, ctx }),
            },
            TurboToggle,
          ),
        )
      },
    }
  },
})
