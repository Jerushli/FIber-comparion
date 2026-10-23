
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import AttPublicPlans from './AttPublicPlans'
const API_BASE = 'http://localhost:5000'

const PROVIDER_INFO = {
  airtel: {
    tagline: 'Broadband for Chennai',
    accent: 'airtel',
    icon: 'A',
  },
  tataplay: {
    tagline: 'Fiber plans for Chennai',
    accent: 'tata',
    icon: 'T',
  },
  bsnl: {
    tagline: 'Bharat Fiber',
    accent: 'bsnl',
    icon: 'B',
  },
}

function formatLabel(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function firstValue(object, candidates) {
  for (const key of candidates) {
    if (object?.[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key]
    }
  }
  return null
}

function getPlanName(plan, index) {
  return firstValue(plan, [
    'name',
    'planName',
    'plan_name',
    'title',
    'plan',
    'offerName',
  ]) || `Plan ${index + 1}`
}

function getPlanPrice(plan) {
  return firstValue(plan, [
    'price',
    'monthlyPrice',
    'monthly_price',
    'amount',
    'mrp',
    'basePrice',
    'base_price',
    'priceText',
    'price_text',
  ])
}

function getPlanSpeed(plan) {
  return firstValue(plan, [
    'speed',
    'speedMbps',
    'speed_mbps',
    'downloadSpeed',
    'download_speed',
    'speedText',
    'speed_text',
  ])
}

function getPlanBenefits(plan) {
  return firstValue(plan, [
    'benefits',
    'features',
    'ott',
    'ottBenefits',
    'ott_benefits',
    'dataAllowance',
    'data_allowance',
  ])
}

function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function statusText(result) {
  const status = String(result?.extractionStatus || '').toLowerCase()

  if (status === 'blocked') return 'Source blocked'
  if (status === 'failed') return 'Fetch failed'
  if (status === 'thin_or_blocked_content') return 'Limited source data'
  if (status === 'content_received') return 'Source retrieved'
  if (status === 'success') return 'Source retrieved'
  if (status === 'partial') return 'Partial data'

  return status ? formatLabel(status) : 'Status not reported'
}

function statusClass(result) {
  const status = String(result?.extractionStatus || '').toLowerCase()

  if (status === 'blocked' || status === 'failed') return 'status-bad'
  if (status === 'thin_or_blocked_content' || status === 'partial') {
    return 'status-warning'
  }
  if (status === 'content_received' || status === 'success') return 'status-good'

  return 'status-neutral'
}

function ProviderCard({ provider, result, loading }) {
  const info = PROVIDER_INFO[provider.id] || {
    tagline: provider.city || 'Provider plans',
    accent: 'default',
    icon: (provider.name || '?').charAt(0),
  }

  const plans = Array.isArray(result?.plans) ? result.plans : []
  const retrieved = Boolean(result)
  const error = result?.error
  const sourceUrl = result?.sourceUrl || provider.url

  return (
    <article className={`provider-card provider-${info.accent}`}>
      <div className="provider-card-top">
        <div className="provider-brand">
          <div className={`provider-icon icon-${info.accent}`}>
            {info.icon}
          </div>
          <div>
            <h3>{provider.name}</h3>
            <p>{info.tagline}</p>
          </div>
        </div>

        {retrieved && (
          <span className={`status-pill ${statusClass(result)}`}>
            {statusText(result)}
          </span>
        )}
      </div>

      {loading && !retrieved ? (
        <div className="loading-panel">
          <span className="spinner" />
          <span>Fetching current source data...</span>
        </div>
      ) : !retrieved ? (
        <div className="empty-panel">
          <div className="empty-icon">↗</div>
          <strong>Ready to compare</strong>
          <p>Run a fresh comparison to retrieve data from this provider.</p>
        </div>
      ) : (
        <>
          <div className="provider-metrics">
            <div>
              <span className="metric-label">Plans extracted</span>
              <strong>{result.planCount ?? plans.length}</strong>
            </div>
            <div>
              <span className="metric-label">Fetch duration</span>
              <strong>
                {Number.isFinite(Number(result.durationMs))
                  ? `${(Number(result.durationMs) / 1000).toFixed(1)}s`
                  : '—'}
              </strong>
            </div>
          </div>

          {error && (
            <div className="notice notice-error">
              <strong>Could not complete this fetch</strong>
              <p>{error}</p>
            </div>
          )}

          {plans.length > 0 ? (
            <div className="plans-list">
              {plans.map((plan, index) => {
                const price = getPlanPrice(plan)
                const speed = getPlanSpeed(plan)
                const benefits = getPlanBenefits(plan)

                const excludedKeys = new Set([
                  'name', 'planName', 'plan_name', 'title', 'plan', 'offerName',
                  'price', 'monthlyPrice', 'monthly_price', 'amount', 'mrp',
                  'basePrice', 'base_price', 'priceText', 'price_text',
                  'speed', 'speedMbps', 'speed_mbps', 'downloadSpeed',
                  'download_speed', 'speedText', 'speed_text',
                  'benefits', 'features', 'ott', 'ottBenefits', 'ott_benefits',
                  'dataAllowance', 'data_allowance',
                ])

                const extraEntries = Object.entries(plan || {}).filter(
                  ([key, value]) =>
                    !excludedKeys.has(key) &&
                    value !== null &&
                    value !== undefined &&
                    value !== '' &&
                    typeof value !== 'object',
                )

                return (
                  <div className="plan-item" key={`${provider.id}-${index}`}>
                    <div className="plan-heading">
                      <h4>{getPlanName(plan, index)}</h4>
                      {price !== null && (
                        <div className="plan-price">
                          <strong>{formatValue(price)}</strong>
                        </div>
                      )}
                    </div>

                    <div className="plan-highlights">
                      {speed !== null && (
                        <span className="plan-highlight">
                          <span aria-hidden="true">↓</span>
                          {formatValue(speed)}
                        </span>
                      )}
                      {benefits !== null && (
                        <span className="plan-highlight">
                          {formatValue(benefits)}
                        </span>
                      )}
                    </div>

                    {extraEntries.length > 0 && (
                      <details className="plan-details">
                        <summary>More source details</summary>
                        <dl>
                          {extraEntries.map(([key, value]) => (
                            <div className="detail-row" key={key}>
                              <dt>{formatLabel(key)}</dt>
                              <dd>{formatValue(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>
                {String(result.extractionStatus).toLowerCase() === 'blocked'
                  ? 'Provider check blocked'
                  : 'No plans extracted'}
              </strong>
              <p>
                {result.note ||
                  result.error ||
                  'The source did not provide verifiable plan records in this fetch. No prices are being estimated.'}
              </p>
            </div>
          )}

          {result.fetchedAt && (
            <p className="source-time">
              Source fetched: {formatDate(result.fetchedAt)}
            </p>
          )}

          {sourceUrl && (
            <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">
              Open provider website →
            </a>
          )}
        </>
      )}
    </article>
  )
}

function CoverageCard({ provider }) {
  const download = provider.maxDownloadMbps
  const upload = provider.maxUploadMbps

  return (
    <article className="coverage-provider-card">
      <div className="coverage-provider-heading">
        <div>
          <h3>{provider.brandName || 'Provider'}</h3>
          <p>{provider.technologyDetail || provider.technology || 'Technology not reported'}</p>
        </div>
        <span className="coverage-technology">
          {provider.technology || 'Unknown'}
        </span>
      </div>

      <div className="coverage-speeds">
        <div>
          <span>Max. reported download</span>
          <strong>
            {download != null ? `${Number(download).toLocaleString()} Mbps` : 'Not reported'}
          </strong>
        </div>
        <div>
          <span>Max. reported upload</span>
          <strong>
            {upload != null ? `${Number(upload).toLocaleString()} Mbps` : 'Not reported'}
          </strong>
        </div>
      </div>

      {provider.lowLatency != null && (
        <p className="coverage-detail">
          Low latency reported: <strong>{provider.lowLatency ? 'Yes' : 'No'}</strong>
        </p>
      )}

      {provider.reportedLocationCount != null && (
        <p className="coverage-detail">
          Reported location count: <strong>{provider.reportedLocationCount}</strong>
        </p>
      )}
    </article>
  )
}

function App() {
  const [providers, setProviders] = useState([])
  const [results, setResults] = useState({})
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [health, setHealth] = useState('checking')

  const [address, setAddress] = useState('')
  const [attResult, setAttResult] = useState(null)
  const [attPublicFallback, setAttPublicFallback] = useState(null)
  const [attLoading, setAttLoading] = useState(false)
  const [attError, setAttError] = useState('')

  const [viasatAddress, setViasatAddress] = useState('')
  const [viasatResult, setViasatResult] = useState(null)
  const [viasatLoading, setViasatLoading] = useState(false)
  const [viasatError, setViasatError] = useState('')

  const [coverageAddress, setCoverageAddress] = useState('')
  const [coverageResult, setCoverageResult] = useState(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageError, setCoverageError] = useState('')

  const [logs, setLogs] = useState([])
  const [logsOpen, setLogsOpen] = useState(false)

  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/providers`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setProviders(Array.isArray(data.providers) ? data.providers : [])
      setHealth('online')
      setPageError('')
    } catch {
      setHealth('offline')
      setPageError(
        'Cannot connect to the backend. Check that the backend server is running at http://localhost:5000.',
      )
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const comparePlans = async () => {
    setLoading(true)
    setPageError('')
    setComparison(null)
    setResults({})

    try {
      const response = await fetch(`${API_BASE}/api/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.details || data.error || `HTTP ${response.status}`)
      }

      const nextResults = {}
      for (const result of data.results || []) {
        if (result.providerId) nextResults[result.providerId] = result
      }

      setResults(nextResults)
      setComparison(data)
    } catch (error) {
      setPageError(error.message || 'The comparison request failed.')
    } finally {
      setLoading(false)
    }
  }

  const checkAttAddress = async (event) => {
    event.preventDefault()
    setAttLoading(true)
    setAttError('')
    setAttResult(null)
    setAttPublicFallback(null)

    try {
      const response = await fetch(`${API_BASE}/api/att/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.details || `HTTP ${response.status}`)
      }

      setAttResult(data.result || data)
      setAttPublicFallback(data.publicOffers || null)
    } catch (error) {
      setAttError(error.message || 'The address lookup failed.')
    } finally {
      setAttLoading(false)
    }
  }


const checkViasatAddress = async (event) => {
  event.preventDefault()
  setViasatLoading(true)
  setViasatError('')
  setViasatResult(null)

  try {
    const response = await fetch(`${API_BASE}/api/viasat/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: viasatAddress.trim() }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.details || `HTTP ${response.status}`)
    }

    setViasatResult(data.result || data)
  } catch (error) {
    setViasatError(error.message || 'The Viasat address lookup failed.')
  } finally {
    setViasatLoading(false)
  }
}

  const checkCoverage = async (event) => {
    event.preventDefault()
    setCoverageLoading(true)
    setCoverageError('')
    setCoverageResult(null)

    try {
      const response = await fetch(`${API_BASE}/api/address-coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: coverageAddress.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.details || `HTTP ${response.status}`)
      }

      if (!data.result || !Array.isArray(data.result.providers)) {
        throw new Error('The coverage service returned an unexpected response.')
      }

      setCoverageResult(data)
    } catch (error) {
      setCoverageError(error.message || 'The coverage request failed.')
    } finally {
      setCoverageLoading(false)
    }
  }

  const loadLogs = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/logs?limit=20`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setLogs(Array.isArray(data.logs) ? data.logs : [])
      setLogsOpen(true)
    } catch (error) {
      setPageError(`Could not load scrape logs: ${error.message}`)
    }
  }

  const chennaiProviders = providers.filter((provider) => !provider.addressRequired)
  const attProvider = providers.find((provider) => provider.id === 'att')
  const coverage = coverageResult?.result

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FiberCompare home">
          <span className="brand-mark">F</span>
          <span>Fiber<span className="brand-accent">Compare</span></span>
        </a>

        <div className="topbar-right">
          <span className={`connection-dot ${health}`} />
          <span className="connection-label">
            {health === 'online'
              ? 'Backend connected'
              : health === 'checking'
                ? 'Connecting...'
                : 'Backend offline'}
          </span>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              LIVE PLAN COMPARISON
            </span>
            <h1>Find the fiber plan that fits <span>your needs.</span></h1>
            <p className="hero-description">
              Compare broadband information collected directly from provider
              websites. See what was retrieved, when it was fetched, and when a
              source could not be verified.
            </p>

            <div className="hero-actions">
              <button
                className="button button-primary"
                onClick={comparePlans}
                disabled={loading || health !== 'online'}
              >
                {loading ? (
                  <>
                    <span className="spinner spinner-light" />
                    Comparing providers...
                  </>
                ) : (
                  <>Compare plans <span aria-hidden="true">→</span></>
                )}
              </button>
              <span className="freshness-note">
                <span aria-hidden="true">↻</span> Fresh fetch on each comparison
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="signal-card signal-card-top">
              <span className="signal-dot" />
              Live source checks
            </div>
            <div className="wifi-symbol">
              <span className="wifi-arc arc-one" />
              <span className="wifi-arc arc-two" />
              <span className="wifi-arc arc-three" />
              <span className="wifi-dot" />
            </div>
            <div className="signal-card signal-card-bottom">
              <span className="signal-check">✓</span>
              Evidence-first results
            </div>
          </div>
        </section>

        {pageError && (
          <div className="notice notice-error page-notice" role="alert">
            <strong>Something needs attention</strong>
            <p>{pageError}</p>
            {health === 'offline' && (
              <button className="text-button" onClick={loadProviders}>
                Retry connection
              </button>
            )}
          </div>
        )}

        <section className="comparison-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">01 / CHENNAI</span>
              <h2>Broadband providers</h2>
              <p>Plan information returned by each fresh source fetch.</p>
            </div>
            {comparison && (
              <div className="comparison-meta">
                <span className="meta-label">Last comparison</span>
                <strong>{formatDate(comparison.completedAt)}</strong>
                <span>
                  Total time:{' '}
                  {Number.isFinite(Number(comparison.durationMs))
                    ? `${(Number(comparison.durationMs) / 1000).toFixed(1)} seconds`
                    : 'Not reported'}
                </span>
              </div>
            )}
          </div>

          <div className="provider-grid">
            {chennaiProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                result={results[provider.id]}
                loading={loading}
              />
            ))}
          </div>

          {chennaiProviders.length === 0 && health === 'online' && (
            <div className="empty-panel">
              <strong>No providers returned</strong>
              <p>Check the backend provider configuration.</p>
            </div>
          )}

          {comparison && (
            <div className="comparison-footnote">
              <span className="footnote-icon">i</span>
              <div>
                <strong>How to read these results</strong>
                <p>
                  A plan is shown only when the backend returns a plan record.
                  A blocked or incomplete source does not mean the provider has
                  no plans. Prices and plan details may need confirmation on the
                  provider website.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="att-section">
          <div className="att-intro">
            <span className="section-kicker">02 / UNITED STATES</span>
            <h2>Check AT&amp;T at a specific address</h2>
            <p>
              AT&amp;T availability depends on the full US service address, so
              it is checked separately from the Chennai providers.
            </p>
            <a
              href={attProvider?.url || 'https://www.att.com/internet/availability/'}
              target="_blank"
              rel="noreferrer"
              className="source-link"
            >
              Official AT&amp;T availability page →
            </a>
          </div>

          <div className="att-form-card">
            <form onSubmit={checkAttAddress}>
              <label htmlFor="att-address">Full US street address</label>
              <input
                id="att-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Street, city, state, ZIP code"
                minLength={8}
                maxLength={300}
                required
              />
              <button
                className="button button-primary button-full"
                type="submit"
                disabled={attLoading || health !== 'online'}
              >
                {attLoading ? (
                  <>
                    <span className="spinner spinner-light" />
                    Checking address...
                  </>
                ) : (
                  'Check availability →'
                )}
              </button>
              <p className="privacy-note">
                Only submit an address you are authorized to use.
              </p>
            </form>

            {attError && (
              <div className="notice notice-error att-result" role="alert">
                <strong>Lookup could not be completed</strong>
                <p>{attError}</p>
              </div>
            )}

            {attResult && (
              <div className="att-result">
                <div className="att-result-heading">
                  <strong>Address lookup result</strong>
                  <span className={`status-pill ${
                    attResult.extractionStatus === 'blocked'
                      ? 'status-bad'
                      : 'status-warning'
                  }`}>
                    {attResult.extractionStatus === 'blocked'
                      ? 'Validation blocked'
                      : 'Address unverified'}
                  </span>
                </div>

                <p className="att-result-address">
                  {attResult.address || address}
                </p>

                {attResult.note && <p>{attResult.note}</p>}

                <div className="att-result-details">
                  <span>
                    Plans returned: <strong>{attResult.planCount ?? attResult.plans?.length ?? 0}</strong>
                  </span>
                  {attResult.validationHttpStatus != null && (
                    <span>
                      Validation HTTP status:{' '}
                      <strong>{attResult.validationHttpStatus}</strong>
                    </span>
                  )}
                  {attResult.extractionStatus && (
                    <span>
                      Extraction: <strong>{formatLabel(attResult.extractionStatus)}</strong>
                    </span>
                  )}
                </div>

                {Array.isArray(attResult.plans) && attResult.plans.length > 0 && (
                  <div className="plans-list">
                    {attResult.plans.map((plan, index) => (
                      <div className="plan-item" key={`att-${index}`}>
                        <h4>{getPlanName(plan, index)}</h4>
                        <p>
                          {plan.monthlyPrice != null
                            ? `${plan.currency === 'USD' ? '$' : ''}${Number(plan.monthlyPrice).toLocaleString('en-US')} / month`
                            : plan.displayedPrice != null
                              ? `${plan.currency === 'USD' ? '$' : ''}${Number(plan.displayedPrice).toLocaleString('en-US')} (billing period unverified)`
                              : 'Price not provided by source'}
                        </p>
                        {plan.speedMbps != null && <p>Download: {plan.speedMbps} Mbps</p>}
                        <p>Address eligibility: not verified</p>
                      </div>
                    ))}
                  </div>
                )}

                {attPublicFallback && (
                  <div className="coverage-warning" role="status">
                    <strong>Public AT&amp;T offers — not verified for this address</strong>
                    <p>{attPublicFallback.note}</p>
                    <p>Public offer retrieval: {formatLabel(attPublicFallback.extractionStatus || 'unknown')}</p>
                    {Array.isArray(attPublicFallback.plans) && attPublicFallback.plans.length > 0 && (
                      <div className="plans-list">
                        {attPublicFallback.plans.map((plan, index) => (
                          <div className="plan-item" key={`att-public-${index}`}>
                            <h4>{getPlanName(plan, index)}</h4>
                            <p>{plan.monthlyPrice != null
                              ? `${plan.currency === 'USD' ? '$' : ''}${Number(plan.monthlyPrice).toLocaleString('en-US')} / month (public offer)`
                              : plan.displayedPrice != null
                                ? `${plan.currency === 'USD' ? '$' : ''}${Number(plan.displayedPrice).toLocaleString('en-US')} (billing period unverified)`
                                : 'No verified price returned'}</p>
                            {plan.speedMbps != null && <p>Advertised speed: {plan.speedMbps} Mbps</p>}
                            <p>Address eligibility: not verified</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {attPublicFallback.sourceUrl && (
                      <a className="source-link" href={attPublicFallback.sourceUrl} target="_blank" rel="noreferrer">
                        Review public offers on AT&amp;T →
                      </a>
                    )}
                    {attPublicFallback.fetchedAt && (
                      <p className="source-time">Public offers checked: {formatDate(attPublicFallback.fetchedAt)}</p>
                    )}
                  </div>
                )}
                <p className="source-time">
                  Checked: {formatDate(attResult.fetchedAt)}
                </p>
              </div>
            )}
          </div>
        </section>

<section className="att-section viasat-section">
  <div className="att-intro">
    <span className="section-kicker">03 / UNITED STATES</span>
    <h2>Check Viasat at a specific address</h2>
    <p>
      Submit a full US address to check the official Viasat ordering flow.
      Extracted plan candidates are clearly marked until eligibility is verified.
    </p>
    <a
      href="https://buy.viasat.com/"
      target="_blank"
      rel="noreferrer"
      className="source-link"
    >
      Open official Viasat ordering page →
    </a>
  </div>

  <div className="att-form-card">
    <form onSubmit={checkViasatAddress}>
      <label htmlFor="viasat-address">Full US street address</label>
      <input
        id="viasat-address"
        value={viasatAddress}
        onChange={(event) => setViasatAddress(event.target.value)}
        placeholder="1393 Lincoln Pl, Brooklyn, NY 11213"
        minLength={8}
        maxLength={300}
        required
      />

      <button
        className="button button-primary button-full"
        type="submit"
        disabled={viasatLoading || health !== 'online'}
      >
        {viasatLoading ? (
          <>
            <span className="spinner spinner-light" />
            Checking Viasat...
          </>
        ) : (
          'Check Viasat plans →'
        )}
      </button>

      <p className="privacy-note">
        Only submit an address you are authorized to use.
      </p>
    </form>

    {viasatError && (
      <div className="notice notice-error att-result" role="alert">
        <strong>Viasat lookup could not be completed</strong>
        <p>{viasatError}</p>
      </div>
    )}

    {viasatResult && (
      <div className="att-result">
        <div className="att-result-heading">
          <strong>Viasat lookup result</strong>
          <span className={`status-pill ${
            viasatResult.addressEligibilityVerified
              ? 'status-good'
              : 'status-warning'
          }`}>
            {viasatResult.addressEligibilityVerified
              ? 'Address verified'
              : 'Not verified'}
          </span>
        </div>

        <p className="att-result-address">
          {viasatResult.address || viasatAddress}
        </p>

        {viasatResult.note && <p>{viasatResult.note}</p>}

        <div className="att-result-details">
          <span>
            Plans returned:{' '}
            <strong>
              {viasatResult.planCount ?? viasatResult.plans?.length ?? 0}
            </strong>
          </span>
          <span>
            Extraction:{' '}
            <strong>
              {formatLabel(viasatResult.extractionStatus || 'unknown')}
            </strong>
          </span>
          <span>
            Availability:{' '}
            <strong>
              {formatLabel(viasatResult.availabilityStatus || 'unknown')}
            </strong>
          </span>
        </div>

        {Array.isArray(viasatResult.plans) &&
          viasatResult.plans.length > 0 && (
            <div className="plans-list">
              {viasatResult.plans.map((plan, index) => (
                <div className="plan-item" key={`viasat-${index}`}>
                  <h4>{getPlanName(plan, index)}</h4>

                  <p>
                    {Number.isFinite(Number(plan.monthlyPrice)) &&
                    Number(plan.monthlyPrice) > 0
                      ? `$${Number(plan.monthlyPrice).toFixed(2)} / month`
                      : 'Price not provided by source'}
                  </p>

                  {plan.speedMbps != null && (
                    <p>Reported speed: {plan.speedMbps} Mbps</p>
                  )}

                  <p>
                    Address eligibility:{' '}
                    {plan.addressEligibility === 'verified'
                      ? 'Verified'
                      : 'Not verified'}
                  </p>
                </div>
              ))}
            </div>
          )}

        <p className="source-time">
          Checked: {formatDate(viasatResult.fetchedAt)}
        </p>

        <a
          className="source-link"
          href={viasatResult.sourceUrl || 'https://buy.viasat.com/'}
          target="_blank"
          rel="noreferrer"
        >
          Review Viasat source →
        </a>
      </div>
    )}
  </div>
</section>

        <section className="coverage-section">
          <div className="coverage-intro">
            <span className="section-kicker">03 / US COVERAGE ESTIMATES</span>
            <h2>Explore providers for a US address</h2>
            <p>
              Get a fresh coverage estimate from InternetProviders.ai. This is
              separate from AT&amp;T's direct address checker.
            </p>
          </div>

          <div className="coverage-form-card">
            <form onSubmit={checkCoverage}>
              <label htmlFor="coverage-address">US street address</label>
              <input
                id="coverage-address"
                value={coverageAddress}
                onChange={(event) => setCoverageAddress(event.target.value)}
                placeholder="Street, city, state, ZIP code"
                minLength={8}
                maxLength={300}
                required
              />

              <button
                className="button button-primary button-full"
                type="submit"
                disabled={coverageLoading || health !== 'online'}
              >
                {coverageLoading ? (
                  <>
                    <span className="spinner spinner-light" />
                    Fetching coverage estimates...
                  </>
                ) : (
                  'Find estimated providers →'
                )}
              </button>
            </form>

            {coverageError && (
              <div className="notice notice-error coverage-result" role="alert">
                <strong>Coverage request failed</strong>
                <p>{coverageError}</p>
              </div>
            )}

            {coverage && (
              <div className="coverage-result">
                <div className="coverage-result-heading">
                  <div>
                    <span className="section-kicker">ESTIMATED RESULTS</span>
                    <h3>
                      {[
                        coverage.location?.city,
                        coverage.location?.state,
                        coverage.location?.zip,
                      ].filter(Boolean).join(', ') || 'Coverage area'}
                    </h3>
                  </div>
                  <span className="status-pill status-warning">
                    Not address-confirmed
                  </span>
                </div>

                <div className="coverage-warning">
                  <strong>Important: these are estimates, not confirmed service.</strong>
                  <p>
                    Providers and speeds may be reported for a surrounding
                    coverage area. This result does not prove that a provider
                    can install service at your exact address. Current plan
                    prices were not returned.
                  </p>
                </div>

                <div className="coverage-summary">
                  <div>
                    <span>Providers reported</span>
                    <strong>{coverage.summary?.totalProviders ?? coverage.providers.length}</strong>
                  </div>
                  <div>
                    <span>Technology options</span>
                    <strong>{coverage.summary?.totalOptions ?? 'Not reported'}</strong>
                  </div>
                  <div>
                    <span>Highest reported download</span>
                    <strong>
                      {coverage.summary?.maxDownloadSpeed != null
                        ? `${Number(coverage.summary.maxDownloadSpeed).toLocaleString()} Mbps`
                        : 'Not reported'}
                    </strong>
                  </div>
                </div>

                <div className="coverage-provider-grid">
                  {coverage.providers.map((provider, index) => (
                    <CoverageCard
                      key={`${provider.providerId}-${provider.technology}-${index}`}
                      provider={provider}
                    />
                  ))}
                </div>

                {coverage.providers.length === 0 && (
                  <div className="empty-panel compact">
                    <strong>No provider estimates returned</strong>
                    <p>The coverage service did not report any provider options for this request.</p>
                  </div>
                )}

                <p className="source-time">
                  Retrieved: {formatDate(coverageResult.completedAt)}
                  {' · '}
                  Source: {coverage.source || 'InternetProviders.ai'}
                </p>

                <a
                  className="source-link"
                  href="https://www.internetproviders.ai/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit InternetProviders.ai →
                </a>
              </div>
            )}
          </div>
        </section>

        <AttPublicPlans />

        <section className="transparency-strip">
          <div className="transparency-icon">✓</div>
          <div>
            <strong>No invented prices. No cached comparison results.</strong>
            <p>
              Comparison requests and address coverage requests fetch fresh
              data. SQLite is used for scrape logging, not as a source of saved
              plan prices. Coverage estimates are not guaranteed serviceability.
            </p>
          </div>
        </section>

        <section className="logs-section">
          <div className="logs-heading">
            <div>
              <span className="section-kicker">DEVELOPER TOOLS</span>
              <h2>Scrape activity</h2>
              <p>Inspect recent backend scrape-log records.</p>
            </div>
            <button className="button button-secondary" onClick={loadLogs}>
              Load recent logs
            </button>
          </div>

          {logsOpen && (
            <div className="logs-table-wrap">
              {logs.length === 0 ? (
                <p className="logs-empty">No log entries were returned.</p>
              ) : (
                <table className="logs-table">
                  <thead>
                    <tr>
                      {Object.keys(logs[0]).map((key) => (
                        <th key={key}>{formatLabel(key)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, index) => (
                      <tr key={log.id ?? log.requestId ?? index}>
                        {Object.keys(logs[0]).map((key) => (
                          <td key={key}>{formatValue(log[key]) ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#top">
          <span className="brand-mark">F</span>
          <span>Fiber<span className="brand-accent">Compare</span></span>
        </a>
        <p>Live source retrieval · Transparent results · Chennai + US coverage</p>
      </footer>
    </div>
  )
}

export default App
