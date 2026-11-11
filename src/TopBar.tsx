import { useMemo, useState } from 'react'
import { type Match, formatClock, formatDay, formatStart, humanOutcome, shortId } from './data'
import { OUTCOME_LABEL } from './Sidebar'

interface Props {
  mapName: string
  scope: string
  matches: Match[]
  match: Match | null
  shareUrl: string
  onBack: () => void
}

/** Headline numbers for whatever is on screen: the filtered set, or the open match. */
export function TopBar({ mapName, scope, matches, match, shareUrl, onBack }: Props) {
  const totals = useMemo(() => summarize(matches), [matches])
  const [copied, setCopied] = useState(false)

  if (match) {
    const outcome = humanOutcome(match)
    const copy = () => {
      navigator.clipboard?.writeText(shareUrl).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    }
    return (
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} title="Back to the overview (Esc)" aria-label="Back to the overview">
          ←
        </button>
        <div className="title">
          <h2>
            Match <code>{shortId(match.id)}</code>
            {outcome && <span className={`badge ${outcome}`}>{OUTCOME_LABEL[outcome]}</span>}
          </h2>
          <span>
            {mapName} · {formatDay(match.day)}, {formatStart(match.startedAt)} UTC
          </span>
        </div>
        <div className="stats">
          <Stat label="Length" value={formatClock(match.duration)} sub="First to last recorded event" />
          <Stat
            label={match.bots ? 'Humans + bots' : match.humans === 1 ? 'Human' : 'Humans'}
            value={match.bots ? `${match.humans} + ${match.bots}` : match.humans}
          />
          <Stat label="Kills" value={match.counts.kill} tone="kill" />
          <Stat label="Loot" value={match.counts.loot} tone="loot" />
        </div>
        <button className="ghost" onClick={copy} title="Copy a link to this match at the current time">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </header>
    )
  }

  return (
    <header className="topbar">
      <div className="title">
        <h2>{mapName}</h2>
        <span>{scope}</span>
      </div>
      <div className="stats">
        <Stat label="Matches" value={matches.length} />
        <Stat label="Survived" value={pct(totals.survived, totals.runs)} sub={`${totals.survived} of ${totals.runs} runs`} tone="ok" />
        <Stat label="Kills" value={totals.kills.toLocaleString()} tone="kill" />
        <Stat label="Deaths" value={totals.deaths} tone="death" />
        <Stat label="Storm deaths" value={totals.storm} tone="storm" />
        <Stat label="Avg length" value={formatClock(matches.length ? totals.duration / matches.length : 0)} />
      </div>
    </header>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className={tone ? `stat ${tone}` : 'stat'} title={sub}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function summarize(matches: Match[]) {
  const t = { runs: 0, survived: 0, kills: 0, deaths: 0, storm: 0, duration: 0 }
  for (const m of matches) {
    t.kills += m.counts.kill
    t.deaths += m.counts.death
    t.storm += m.counts.storm
    t.duration += m.duration
    for (const j of m.journeys) {
      if (j.bot) continue
      t.runs++
      if (j.outcome === 'survived') t.survived++
    }
  }
  return t
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–')
