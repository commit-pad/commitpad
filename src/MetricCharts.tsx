import type { MetricPoint } from '../lib/types'
import { number } from './components'
export function MetricCharts({ points, quoteSymbol }: { points: MetricPoint[]; quoteSymbol: string }) {
  return <div className="metrics-grid">{([
    ['volume24h', '24h volume', 'USD'], ['holders', 'Token holders', 'wallets'], ['revenue', 'Creator revenue', quoteSymbol],
  ] as const).map(([key, title, unit]) => {
    const valid = points.filter(point => point[key] !== null), values = valid.map(point => point[key]!), min = Math.min(...values), max = Math.max(...values)
    const start = valid[0]?.time || 0, end = valid.at(-1)?.time || 0
    const x = (time: number) => valid.length === 1 ? 160 : 8 + (time - start) / Math.max(end - start, 1) * 304
    const y = (value: number) => max === min ? 52 : 94 - (value - min) / (max - min) * 80
    const path = valid.map((point, index) => `${index ? 'L' : 'M'}${x(point.time)},${y(point[key]!)}`).join(' ')
    return <section className="metric-chart" key={key}><h3>{title}</h3><strong>{number(values.at(-1))} <small>{unit}</small></strong>{valid.length ? <svg viewBox="0 0 320 110" role="img" aria-label={`${title}, ${valid.length} recorded observations`}><line x1="8" x2="312" y1="95" y2="95" className="chart-grid-line"/><path d={path} className="chart-price-line"/>{valid.length === 1 && <circle cx={160} cy={52} r={3} className="chart-point"/>}</svg> : <div className="chart-empty" style={{ minHeight: 110 }}>Awaiting verified observations</div>}<p>{valid.length ? `${new Date(start).toLocaleDateString()} → ${new Date(end).toLocaleDateString()} · recorded snapshots` : 'History begins when the index first records data.'}</p></section>
  })}</div>
}
