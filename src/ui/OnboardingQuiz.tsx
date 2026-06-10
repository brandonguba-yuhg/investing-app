import { useState } from "react";
import type {
  DiversificationStyle,
  InvestmentFocus,
  InvestmentHorizon,
  InvestorProfile,
  RiskTolerance,
} from "../core/types";

interface Props {
  /** Existing profile when editing; null on first-time onboarding. */
  initial: InvestorProfile | null;
  onSave: (profile: Omit<InvestorProfile, "createdAt" | "updatedAt">) => void;
  onCancel?: () => void;
}

const SECTORS = [
  "Technology",
  "Healthcare",
  "Financial Services",
  "Energy",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Industrials",
  "Utilities",
  "Real Estate",
  "Communication Services",
];

/**
 * One-time investor questionnaire shown on the Dashboard. Answers are stored
 * locally and shape the AI's framing (position analysis) and the allocation
 * guardrail thresholds. Defaults are pre-selected so saving is one tap away.
 */
export function OnboardingQuiz({ initial, onSave, onCancel }: Props) {
  const [risk, setRisk] = useState<RiskTolerance>(initial?.riskTolerance ?? "balanced");
  const [horizon, setHorizon] = useState<InvestmentHorizon>(initial?.horizon ?? "long");
  const [focus, setFocus] = useState<InvestmentFocus>(initial?.focus ?? "mixed");
  const [diversification, setDiversification] = useState<DiversificationStyle>(
    initial?.diversification ?? "balanced",
  );
  const [sectors, setSectors] = useState<string[]>(initial?.preferredSectors ?? []);

  const toggleSector = (s: string) => {
    setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <div className="quiz">
      <div className="quiz-head">
        <h3>{initial ? "Your investor profile" : "Set up your investor profile"}</h3>
        <p className="quiz-sub">
          A few quick questions so portfolio insights and AI analysis fit how you
          actually invest. Stored on this device only.
        </p>
      </div>

      <QuizQuestion label="How much risk are you comfortable with?">
        <Chip on={risk === "conservative"} onClick={() => setRisk("conservative")}>
          Conservative
        </Chip>
        <Chip on={risk === "balanced"} onClick={() => setRisk("balanced")}>
          Balanced
        </Chip>
        <Chip on={risk === "aggressive"} onClick={() => setRisk("aggressive")}>
          Aggressive
        </Chip>
      </QuizQuestion>

      <QuizQuestion label="How long do you plan to stay invested?">
        <Chip on={horizon === "short"} onClick={() => setHorizon("short")}>
          Under 3 years
        </Chip>
        <Chip on={horizon === "medium"} onClick={() => setHorizon("medium")}>
          3–10 years
        </Chip>
        <Chip on={horizon === "long"} onClick={() => setHorizon("long")}>
          10+ years
        </Chip>
      </QuizQuestion>

      <QuizQuestion label="What are you mainly after?">
        <Chip on={focus === "growth"} onClick={() => setFocus("growth")}>
          Growth
        </Chip>
        <Chip on={focus === "income"} onClick={() => setFocus("income")}>
          Dividend income
        </Chip>
        <Chip on={focus === "mixed"} onClick={() => setFocus("mixed")}>
          A mix
        </Chip>
      </QuizQuestion>

      <QuizQuestion label="How do you like to weight positions?">
        <Chip
          on={diversification === "concentrated"}
          onClick={() => setDiversification("concentrated")}
        >
          Few big bets
        </Chip>
        <Chip on={diversification === "balanced"} onClick={() => setDiversification("balanced")}>
          Somewhere in between
        </Chip>
        <Chip
          on={diversification === "diversified"}
          onClick={() => setDiversification("diversified")}
        >
          Spread out widely
        </Chip>
      </QuizQuestion>

      <QuizQuestion label="Any sectors you want to lean into? (optional)">
        {SECTORS.map((s) => (
          <Chip key={s} on={sectors.includes(s)} onClick={() => toggleSector(s)}>
            {s}
          </Chip>
        ))}
      </QuizQuestion>

      <div className="quiz-actions">
        <button
          className="pe-btn primary"
          onClick={() =>
            onSave({
              riskTolerance: risk,
              horizon,
              focus,
              diversification,
              preferredSectors: sectors,
            })
          }
        >
          {initial ? "Update profile" : "Save profile"}
        </button>
        {onCancel && (
          <button className="pe-btn" onClick={onCancel}>
            {initial ? "Cancel" : "Maybe later"}
          </button>
        )}
      </div>
    </div>
  );
}

function QuizQuestion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="quiz-q">
      <div className="quiz-q-label">{label}</div>
      <div className="quiz-chips">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={on ? "quiz-chip on" : "quiz-chip"} onClick={onClick}>
      {children}
    </button>
  );
}
