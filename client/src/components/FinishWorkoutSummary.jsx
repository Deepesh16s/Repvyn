import { CheckCircle2, Trophy, X } from "lucide-react";
import useModalEscapeAndFocus from "../hooks/useModalEscapeAndFocus";
import "./FinishWorkoutSummary.css";

function FinishWorkoutSummary({ summary, onClose }) {
  useModalEscapeAndFocus(!!summary, onClose);

  if (!summary) return null;

  const {
    durationMinutes,
    totalVolume,
    exerciseCount,
    setCount,
    prExerciseCount,
    badges = [],
    currentStreak,
  } = summary;

  const prLabel =
    prExerciseCount > 0
      ? `${prExerciseCount} ${prExerciseCount === 1 ? "exercise" : "exercises"}`
      : "—";

  return (
    <div className="finish-summary-overlay">
      <div
        className="finish-summary-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-summary-title"
      >
        <button
          type="button"
          className="finish-summary-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} strokeWidth={2} />
        </button>

        <div className="finish-summary-icon">
          <CheckCircle2 size={28} strokeWidth={1.8} />
        </div>
        <p className="finish-summary-title" id="finish-summary-title">Workout Complete</p>

        <div className="finish-summary-grid">
          <div className="finish-summary-stat">
            <span>Duration</span>
            <strong>{durationMinutes < 1 ? "<1 min" : `${durationMinutes} min`}</strong>
          </div>
          <div className="finish-summary-stat">
            <span>Volume</span>
            <strong>{Math.round(totalVolume).toLocaleString()} kg</strong>
          </div>
          <div className="finish-summary-stat">
            <span>Exercises</span>
            <strong>{exerciseCount}</strong>
          </div>
          <div className="finish-summary-stat">
            <span>Sets</span>
            <strong>{setCount}</strong>
          </div>
          <div className="finish-summary-stat">
            <span>New PRs</span>
            <strong>{prLabel}</strong>
          </div>
          <div className="finish-summary-stat">
            <span>Consistency</span>
            <strong>{currentStreak > 0 ? `🔥 Day ${currentStreak}` : "—"}</strong>
          </div>
        </div>

        {badges.length > 0 && (
          <div className="finish-summary-badges">
            {badges.map((badge) => (
              <span className="finish-summary-badge" key={badge.key}>
                <Trophy size={12} strokeWidth={2} /> {badge.label}
              </span>
            ))}
          </div>
        )}

        <button type="button" className="finish-summary-done-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export default FinishWorkoutSummary;
