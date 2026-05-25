import type { QualityScores } from "../core/types";

interface Props {
  scores: QualityScores;
}

const ZONE_LABEL: Record<string, string> = {
  safe: "Safe zone",
  grey: "Grey zone",
  distress: "Distress zone",
};

export function CompanyScores({ scores }: Props) {
  if (scores.unavailable || (!scores.piotroski && !scores.altman && !scores.composite)) {
    return (
      <div className="loading">Quality scores unavailable for this company.</div>
    );
  }

  return (
    <div className="scores">
      {scores.asOf && (
        <p className="scores-note">
          Based on the latest annual financials (FY {scores.asOf.slice(0, 4)}).
        </p>
      )}

      {scores.composite && (
        <section className="score-card composite">
          <div className="composite-head">
            <div className={`grade grade-${scores.composite.grade[0].toLowerCase()}`}>
              {scores.composite.grade}
            </div>
            <div>
              <div className="composite-title">Quality Rating</div>
              <div className="composite-score">{scores.composite.score}/100</div>
            </div>
          </div>
          <div className="composite-bars">
            {scores.composite.breakdown.map((b) => (
              <div className="cbar" key={b.label}>
                <div className="cbar-head">
                  <span>{b.label}</span>
                  <span className="cbar-pts">
                    {b.points}/{b.max}
                  </span>
                </div>
                <div className="cbar-track">
                  <div
                    className="cbar-fill"
                    style={{ width: `${(b.points / b.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="score-grid">
        {scores.piotroski && (
          <section className="score-card">
            <div className="score-card-head">
              <h3>Piotroski F-Score</h3>
              <span className="score-big">
                {scores.piotroski.score}
                <span className="score-denom">/9</span>
              </span>
            </div>
            <p className="score-blurb">
              Nine pass/fail checks of profitability, leverage, and efficiency.
              7–9 is strong, 0–3 is weak.
            </p>
            <ul className="criteria">
              {scores.piotroski.criteria.map((c) => (
                <li key={c.label} className={c.pass ? "pass" : "fail"}>
                  <span className="tick">{c.pass ? "✓" : "✕"}</span>
                  <span className="crit-label" title={c.detail}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {scores.altman && (
          <section className="score-card">
            <div className="score-card-head">
              <h3>Altman Z-Score</h3>
              <span className={`zone-badge ${scores.altman.zone}`}>
                {scores.altman.z.toFixed(2)} · {ZONE_LABEL[scores.altman.zone]}
              </span>
            </div>
            <p className="score-blurb">
              Bankruptcy-risk model. Above 2.99 is safe, 1.81–2.99 is grey,
              below 1.81 signals distress.
            </p>
            <table className="altman-table">
              <tbody>
                {scores.altman.components.map((comp) => (
                  <tr key={comp.label}>
                    <td className="row-label">{comp.label}</td>
                    <td className="num">{comp.value.toFixed(2)}</td>
                    <td className="num contrib">{comp.contribution >= 0 ? "+" : ""}{comp.contribution.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
