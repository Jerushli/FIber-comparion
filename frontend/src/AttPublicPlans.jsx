
import { useState } from 'react'

const API_BASE = 'http://localhost:5000'

function formatSpeed(speedMbps) {
  if (!Number.isFinite(Number(speedMbps))) return 'Speed not reported'
  return Number(speedMbps) >= 1000
    ? `${Number(speedMbps) / 1000} Gbps`
    : `${speedMbps} Mbps`
}

function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export default function AttPublicPlans() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchPlans() {
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch(`${API_BASE}/api/att/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      setResult(data.result || data)
    } catch (err) {
      setError(err.message || 'Could not retrieve AT&T public plans.')
    } finally {
      setLoading(false)
    }
  }

  const plans = Array.isArray(result?.plans) ? result.plans : []

  return (
    <section className="att-public-section">
      <div className="section-heading">
        <div>
          <span className="section-kicker">03 / UNITED STATES</span>
          <h2>AT&amp;T public Internet offers</h2>
          <p>
            Advertised offers retrieved directly from AT&amp;T's public website.
            These are separate from address-specific availability checks.
          </p>
        </div>

        <button
          className="button button-primary"
          onClick={fetchPlans}
          disabled={loading}
        >
          {loading ? 'Fetching live offers…' : 'Fetch AT&T plans'}
        </button>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          <strong>Could not fetch AT&amp;T offers</strong>
          <p>{error}</p>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="empty-panel">
          <strong>Ready to fetch public offers</strong>
          <p>
            Click the button to make a fresh request to the AT&amp;T website.
          </p>
        </div>
      )}

      {loading && (
        <div className="loading-panel">
          <span className="spinner" />
          <span>Retrieving current AT&amp;T offers…</span>
        </div>
      )}

      {result && (
        <>
          <div className="att-public-meta">
            <span className="status-pill status-good">
              {result.extractionStatus === 'plans_extracted'
                ? 'Offers extracted'
                : result.extractionStatus === 'failed'
                  ? 'Fetch failed'
                  : 'No matching offers found'}
            </span>
            <span>HTTP: {result.httpStatus ?? 'Not reported'}</span>
            <span>Plans: {result.planCount ?? plans.length}</span>
            <span>
              Fetch time:{' '}
              {Number.isFinite(Number(result.durationMs))
                ? `${(Number(result.durationMs) / 1000).toFixed(1)}s`
                : 'Not reported'}
            </span>
          </div>

          {plans.length > 0 ? (
            <div className="att-public-grid">
              {plans.map((plan, index) => (
                <article className="att-public-plan" key={`${plan.planName}-${index}`}>
                  <div className="att-public-plan-top">
                    <span className="att-plan-label">AT&amp;T FIBER</span>
                    <span className="status-pill status-warning">
                      Address not checked
                    </span>
                  </div>

                  <h3>{plan.planName || 'AT&T Internet offer'}</h3>

                  <div className="att-public-price">
                    <strong>
                      {plan.monthlyPrice != null
                        ? new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: plan.currency || 'USD',
                          }).format(plan.monthlyPrice)
                        : 'Price not reported'}
                    </strong>
                    <span>/month advertised</span>
                  </div>

                  <p className="att-public-speed">
                    {formatSpeed(plan.speedMbps)}
                  </p>

                  {plan.promotionalPeriod && (
                    <p className="att-promo">
                      Promotional period: {plan.promotionalPeriod}
                    </p>
                  )}

                  {plan.conditions && (
                    <details className="plan-details">
                      <summary>Offer conditions and evidence</summary>
                      <p>{plan.conditions}</p>
                      {plan.sourceEvidence && (
                        <p>
                          <strong>Matched page text:</strong>{' '}
                          {plan.sourceEvidence}
                        </p>
                      )}
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>No offers extracted</strong>
              <p>
                {result.note ||
                  'The live page did not provide matching plan details. No prices were estimated.'}
              </p>
            </div>
          )}

          <p className="source-time">
            Last fetched: {formatDate(result.fetchedAt)}
          </p>

          <p className="att-public-disclaimer">
            {result.note ||
              'Advertised offers may have eligibility requirements and may not be available at every address.'}
          </p>

          <a
            className="source-link"
            href={result.sourceUrl || 'https://www.att.com/internet/fiber/'}
            target="_blank"
            rel="noreferrer"
          >
            Verify on AT&amp;T's official website ↗
          </a>

          <p className="freshness-note">
            Fresh fetch requested: {result.priceCacheUsed === false ? 'Yes' : 'Not confirmed'}.
            Address availability: not checked by this request.
          </p>
        </>
      )}
    </section>
  )
}
