import { useId } from "react";
import { lookupMetric } from "../core/glossary";

/**
 * Small "ⓘ" affordance that reveals a plain-English explanation of a metric
 * on hover or keyboard focus. Built for retail investors who may not know
 * what a ratio means or how to read it.
 *
 * Pass a `metric` key (matching a `Multiples` field) to pull copy from the
 * shared glossary, or pass `title`/`body` directly for ad-hoc tips.
 */
interface Props {
  metric?: string;
  title?: string;
  body?: string;
}

export function InfoTip({ metric, title, body }: Props) {
  const id = useId();
  const entry = metric ? lookupMetric(metric) : undefined;

  const heading = title ?? entry?.name;
  const plain = body ?? entry?.plain;
  const typical = entry?.typical;

  if (!heading && !plain) return null;

  return (
    <span className="infotip">
      <button
        type="button"
        className="infotip-btn"
        aria-label={heading ? `What is ${heading}?` : "More info"}
        aria-describedby={id}
      >
        i
      </button>
      <span role="tooltip" id={id} className="infotip-pop">
        {heading && <span className="infotip-head">{heading}</span>}
        {plain && <span className="infotip-plain">{plain}</span>}
        {typical && <span className="infotip-typical">{typical}</span>}
      </span>
    </span>
  );
}
