import { useEffect, useState, useCallback } from 'react'

interface HealthState {
  available: boolean | null // null = 未检测
  message?: string
  checking: boolean
}

interface KeyState {
  configured: boolean
  encryptionAvailable: boolean
}

export default function Settings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [routing, setRouting] = useState<RoutingTable>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    window.dubhe.provider.list().then(setProviders)
    window.dubhe.provider.getRouting().then(setRouting)
  }, [])

  return (
    <div className="settings">
      <h2 className="settings__title">服务与模型</h2>
      <p className="settings__hint">
        接入一个服务(填一次 key)即自动获得一批节点。密钥用系统钥匙串加密,只在主进程持有。
      </p>

      <section className="settings__routing">
        <h3 className="settings__section-title">能力路由</h3>
        <p className="settings__hint">
          spec 里写的是 capability,运行时由路由表查出用哪个 provider。换模型、换厂商,工作流一个字不用改。
        </p>
        <div className="routing-grid">
          {Object.entries(routing).map(([cap, providerId]) => (
            <div key={cap} className="routing-grid__row">
              <span className="routing-grid__cap">{cap}</span>
              <select
                className="routing-grid__select"
                value={providerId ?? ''}
                onChange={async (e) => {
                  await window.dubhe.provider.setRoute(cap, e.target.value)
                  setRouting(await window.dubhe.provider.getRouting())
                }}
              >
                {providers
                  .filter((p) => p.capabilities.includes(cap))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="settings__providers">
        <h3 className="settings__section-title">已接入服务</h3>
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            expanded={expanded === p.id}
            onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
          />
        ))}
      </section>
    </div>
  )
}

function ProviderCard({
  provider,
  expanded,
  onToggle
}: {
  provider: ProviderInfo
  expanded: boolean
  onToggle: () => void
}) {
  const [keyState, setKeyState] = useState<KeyState | null>(null)
  const [health, setHealth] = useState<HealthState>({
    available: null,
    checking: false
  })
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const refreshKeyState = useCallback(async () => {
    const status = await window.dubhe.provider.keyStatus(provider.id)
    setKeyState({
      configured: status.fields['api_key'] === true || Object.keys(status.fields).length > 0,
      encryptionAvailable: status.encryptionAvailable
    })
  }, [provider.id])

  useEffect(() => {
    refreshKeyState()
  }, [refreshKeyState])

  const checkHealth = async () => {
    setHealth({ available: null, checking: true })
    try {
      const results = await window.dubhe.provider.health(provider.id)
      const r = results[provider.id]
      setHealth({
        available: r?.available ?? false,
        message: r?.message,
        checking: false
      })
    } catch (err) {
      setHealth({
        available: false,
        message: err instanceof Error ? err.message : String(err),
        checking: false
      })
    }
  }

  const saveKey = async () => {
    for (const field of provider.authFields) {
      const val = inputValues[field.key]
      if (val) {
        await window.dubhe.provider.setKey(provider.id, field.key, val)
      }
    }
    setInputValues({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await refreshKeyState()
  }

  const statusDot =
    health.available === null
      ? 'unknown'
      : health.available
        ? 'ok'
        : 'error'

  return (
    <div className={`pcard ${expanded ? 'is-expanded' : ''}`}>
      <button className="pcard__header" onClick={onToggle}>
        <span className={`pcard__dot pcard__dot--${statusDot}`} />
        <div className="pcard__info">
          <span className="pcard__name">{provider.name}</span>
          <span className="pcard__caps">{provider.capabilities.join(' · ')}</span>
        </div>
        <span className="pcard__locality">{provider.locality}</span>
        <span className="pcard__chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="pcard__body">
          {provider.description && (
            <p className="pcard__desc">{provider.description}</p>
          )}

          {keyState && (
            <p className="pcard__keystatus">
              密钥:{keyState.configured ? '✓ 已配置' : '✗ 未配置'}
              {!keyState.encryptionAvailable && ' · ⚠ 加密不可用(明文降级)'}
            </p>
          )}

          {provider.authFields.map((field) => (
            <div key={field.key} className="pcard__field">
              <label className="pcard__label">{field.label}</label>
              <input
                className="pcard__input"
                type={field.secret ? 'password' : 'text'}
                placeholder={
                  keyState?.configured ? '••••••••(已保存,重新输入可替换)' : field.placeholder
                }
                value={inputValues[field.key] ?? ''}
                onChange={(e) =>
                  setInputValues((v) => ({ ...v, [field.key]: e.target.value }))
                }
              />
            </div>
          ))}

          <div className="pcard__actions">
            <button
              className="btn btn--primary"
              onClick={saveKey}
              disabled={Object.keys(inputValues).length === 0}
            >
              保存密钥
            </button>
            <button
              className="btn"
              onClick={checkHealth}
              disabled={health.checking || !keyState?.configured}
            >
              {health.checking ? '检测中…' : '测试连通'}
            </button>
            {saved && <span className="pcard__saved">已保存 ✓</span>}
          </div>

          {health.available !== null && !health.checking && (
            <p className={`pcard__health pcard__health--${statusDot}`}>
              {health.available ? '连通正常' : `不可用:${health.message ?? '未知'}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
