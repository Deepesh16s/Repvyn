import "./dashboard.css";
import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Dumbbell,
  Flame,
  Activity,
  CalendarDays,
  BarChart2,
  Zap,
  Trophy,
  CalendarRange,
  Plus,
  ChevronRight,
  ChevronDown,
  Timer,
  HeartPulse,
  CheckCircle2,
  X,
  MapPin,
  Target,
  Footprints,
  AlertTriangle,
  FlaskConical,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import AddWorkoutModal from "../components/AddWorkoutModal";
import AnimatedNumber from "../components/AnimatedNumber";
import AddCardioModal from "../components/AddCardioModal";
import MuscleBodyMap from "../components/MuscleBodyMap";
import WorkoutSession from "../components/WorkoutSession";
import StartWorkoutModal from "../components/StartWorkoutModal";
import ResumeWorkoutPrompt from "../components/ResumeWorkoutPrompt";
import FinishWorkoutSummary from "../components/FinishWorkoutSummary";
import useWorkoutSession from "../hooks/useWorkoutSession";
import { getDashboardSummaryData } from "../services/dashboardService";
import { getWorkouts } from "../services/workoutService";
import { getGoals } from "../services/goalService";
import { getPlannedWorkouts } from "../services/plannedWorkoutService";
import { getDailySteps, setDailySteps } from "../services/dailyStepsService";
import { getSessionBadges } from "../progression/liveWorkoutEngine";
import { computeLongestRestAwareStreak, trainedDayKeys } from "../utils/activityStates";
import { generateReminders } from "../reminders/reminderEngine";
import { generateNotifications } from "../services/notificationService";
import { getCardioOverview } from "../progression/cardioProgressionEngine";
import { buildProgressionSeries, filterWorkoutsByTimeRange } from "../progression";
import { getStrengthCardioSplit } from "../intelligence/balanceEngine";
import { generateTrainingBrief, generateWeeklyCoachReport, generateCoachPriority } from "../trainingIntelligence";
import WeeklyCoachReport from "../components/WeeklyCoachReport";
import LoadErrorBanner from "../components/LoadErrorBanner";
import { getGoalAnalytics } from "../utils/goalAnalytics";
import {
  buildSessionSummaries,
  sortSessions,
  formatSessionDate,
  getSessionTypeLabel,
  isCardioEntry,
  getCardioActivityLabel,
  formatCardioSummary,
  formatSetBreakdown,
  getSetCount,
  getWorkoutVolume,
  computeCurrentStreak,
} from "../utils/workoutUtils";
import { getSessionTypeColor } from "../constants/sessionTypes";
import { formatDurationLong, formatClockTime, formatRelativeTime } from "../utils/timeFormat";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const VOLUME_RANGE_OPTIONS = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "365d", label: "365D", days: 365 },
];

function buildDailyVolumeSeries(workouts, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  const totals = new Map();
  workouts
    .filter((w) => !isCardioEntry(w))
    .forEach((w) => {
      const d = new Date(w.date || w.createdAt);
      d.setHours(0, 0, 0, 0);
      if (d < cutoff) return;
      totals.set(d.toDateString(), (totals.get(d.toDateString()) || 0) + getWorkoutVolume(w));
    });

  return Array.from({ length: days }, (_, i) => {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + i);
    return {
      day:
        days <= 7
          ? d.toLocaleDateString("en-US", { weekday: "short" })
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      volume: Math.round(totals.get(d.toDateString()) || 0),
    };
  });
}

function buildYearlyVolumeSeries(workouts) {
  const filtered = filterWorkoutsByTimeRange(workouts, "1y");
  return buildProgressionSeries(filtered, { granularity: "month" }).map((b) => ({
    day: b.label,
    volume: Math.round(b.volume),
  }));
}

const getTodayDateKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getTodayLongLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getFirstName() {
  try {
    const stored = JSON.parse(localStorage.getItem("user") || "null");
    return stored?.name?.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

function PrimaryCard({ title, value, numericValue, formatValue, sub, icon: Icon, accent, onClick }) {
  return (
    <div
      className={`primary-card ${accent ? "primary-card--accent" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="primary-card__icon">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <div className="primary-card__body">
        <span className="primary-card__label">{title}</span>
        <span className="primary-card__value">
          {numericValue != null ? (
            <AnimatedNumber value={numericValue} format={formatValue} />
          ) : (
            value ?? <SkeletonVal />
          )}
        </span>
        {sub && <span className="primary-card__sub">{sub}</span>}
      </div>
      <ChevronRight className="primary-card__arrow" size={16} />
    </div>
  );
}

function SecondaryCard({ title, value, sub, icon: Icon, children }) {
  return (
    <div className="secondary-card">
      <div className="secondary-card__head">
        <Icon size={16} strokeWidth={1.8} className="secondary-card__icon" />
        <span className="secondary-card__label">{title}</span>
      </div>
      <span className="secondary-card__value">{value ?? <SkeletonVal />}</span>
      {sub && <span className="secondary-card__sub">{sub}</span>}
      {children}
    </div>
  );
}

function TodayStepsCard({
  steps,
  dailyGoalTarget,
  loading,
  editing,
  inputValue,
  onInputChange,
  onEditStart,
  onSave,
  onCancel,
  saving,
}) {
  if (loading) {
    return (
      <div className="today-steps-card today-steps-card--premium">
        <span
          className="skeleton"
          style={{ width: "100%", height: 96, borderRadius: 16, display: "block" }}
        />
      </div>
    );
  }

  const hasGoal = dailyGoalTarget != null && dailyGoalTarget > 0;
  const percent = hasGoal ? Math.min(100, Math.round(((steps || 0) / dailyGoalTarget) * 100)) : 0;
  const remaining = hasGoal ? Math.max(0, dailyGoalTarget - (steps || 0)) : null;
  const isCloseToGoal = hasGoal && percent >= 90 && percent < 100;
  const isGoalMet = hasGoal && percent >= 100;

  return (
    <div
      className={`today-steps-card today-steps-card--premium${
        isGoalMet ? " today-steps-card--complete" : ""
      }`}
    >
      <div className="today-steps-card__icon-badge">
        <Footprints size={26} strokeWidth={2} />
      </div>

      <div className="today-steps-card__body">
        {editing ? (
          <div className="today-steps-card__edit">
            <input
              type="number"
              min="0"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={inputValue}
              onChange={onInputChange}
              placeholder="e.g. 8532"
            />
            <div className="today-steps-card__edit-actions">
              <button type="button" onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button type="button" onClick={onCancel} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="today-steps-card__value-btn" onClick={onEditStart}>
            <span className="today-steps-card__value">
              {steps != null ? (
                <AnimatedNumber value={steps} format={(n) => n.toLocaleString()} />
              ) : (
                "Log steps"
              )}
            </span>
            <span className="today-steps-card__value-label">Today's Steps</span>
          </button>
        )}

        {hasGoal && (
          <>
            <div
              className={`today-steps-card__bar${
                isCloseToGoal ? " today-steps-card__bar--pulse" : ""
              }`}
            >
              <div className="today-steps-card__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="today-steps-card__stats">
              <span>
                <strong>{dailyGoalTarget.toLocaleString()}</strong> Goal
              </span>
              <span>
                {isGoalMet ? (
                  <strong className="today-steps-card__goal-met">Goal reached 🎉</strong>
                ) : (
                  <>
                    <strong>{remaining.toLocaleString()}</strong> remaining
                  </>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const BRIEF_ICON_BY_KEY = {
  workoutRecommendation: Dumbbell,
  plannedWorkout: CalendarDays,
  goalFocus: Target,
  stepsFocus: Footprints,
  streakNudge: Flame,
};

function BriefListItem({ item, onStartPlanned }) {
  const Icon = BRIEF_ICON_BY_KEY[item.key] || Zap;
  const isActionable = item.key === "plannedWorkout" && onStartPlanned;
  const [whyOpen, setWhyOpen] = useState(false);
  const hasExplanation = item.explanation?.length > 0;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={`hero-brief-item hero-brief-item--${item.tone} ${
        isActionable ? "hero-brief-item--actionable" : ""
      }`}
      onClick={isActionable ? () => onStartPlanned(item.plannedWorkoutId) : undefined}
      role={isActionable ? "button" : undefined}
      tabIndex={isActionable ? 0 : undefined}
      onKeyDown={
        isActionable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStartPlanned(item.plannedWorkoutId);
              }
            }
          : undefined
      }
    >
      <span className="hero-brief-item__icon">
        <Icon size={13} strokeWidth={2.5} />
      </span>
      <span className="hero-brief-item__text">
        <strong>{item.title}</strong>
        {item.detail && <> — {item.detail}</>}
        {hasExplanation && (
          <>
            {" "}
            <button
              type="button"
              className="hero-brief-item__why-btn"
              aria-expanded={whyOpen}
              onClick={(e) => {
                e.stopPropagation();
                setWhyOpen((o) => !o);
              }}
            >
              Why?
            </button>
          </>
        )}
        {hasExplanation && whyOpen && (
          <ul className="hero-brief-item__why-list">
            {item.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </span>
      {isActionable && <span className="hero-brief-item__action">Start</span>}
    </li>
  );
}

const RESEARCH_REFERENCES = [
  {
    name: "ACSM Position Stand",
    year: "2009",
    description: "Progression Models in Resistance Training for Healthy Adults",
    url: "https://doi.org/10.1249/MSS.0b013e3181915670",
  },
  {
    name: "Schoenfeld et al.",
    year: "2017",
    description: "Dose-response relationship between weekly training volume and muscle mass",
    url: "https://doi.org/10.1080/02640414.2016.1210197",
  },
  {
    name: "Resistance Training Dose-Response Meta-Regression",
    year: "2025",
    description: "Weekly volume and frequency effects on hypertrophy and strength, with diminishing returns",
    url: "https://pubmed.ncbi.nlm.nih.gov/41343037/",
  },
];

function CoachExplanation({ sections, recommendedCategory, generatedAt }) {
  const [open, setOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const panelId = useId();
  const researchPanelId = useId();
  if (!sections.length) return null;

  const heading = recommendedCategory
    ? `Why Repvyn recommends ${recommendedCategory} today`
    : "Why this recommendation?";
  const buttonLabel = recommendedCategory ? `${heading}?` : heading;

  return (
    <div className="coach-why">
      <button
        type="button"
        className="coach-why__btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {buttonLabel}
      </button>
      {open && (
        <div id={panelId} className="coach-explanation" role="region" aria-label={heading}>
          <p className="coach-explanation__heading">{heading}</p>
          {generatedAt && (
            <p className="coach-explanation__generated">Generated Today • {formatClockTime(generatedAt)}</p>
          )}
          <ul className="coach-explanation__list">
            {sections.map((section) => {
              const Icon = section.tone === "warning" ? AlertTriangle : CheckCircle2;
              return (
                <li className={`coach-explanation__item coach-explanation__item--${section.tone}`} key={section.key}>
                  <Icon size={15} strokeWidth={2} className="coach-explanation__icon" />
                  <span>{section.sentence}</span>
                </li>
              );
            })}
          </ul>

          <div className="coach-explanation__research">
            <button
              type="button"
              className="coach-explanation__research-btn"
              aria-expanded={researchOpen}
              aria-controls={researchPanelId}
              onClick={() => setResearchOpen((o) => !o)}
            >
              <FlaskConical size={13} strokeWidth={2} />
              Research
            </button>
            {researchOpen && (
              <div
                id={researchPanelId}
                className="coach-explanation__research-panel"
                role="region"
                aria-label="Research references"
              >
                <p className="coach-explanation__research-intro">
                  Inspired by general concepts from published training research — not a literal implementation of
                  any single study&apos;s exact formula.
                </p>
                <ul className="coach-explanation__research-list">
                  {RESEARCH_REFERENCES.map((ref) => (
                    <li key={ref.url}>
                      <a href={ref.url} target="_blank" rel="noopener noreferrer">
                        <span className="coach-explanation__research-name">
                          {ref.name}
                          {ref.year ? ` (${ref.year})` : ""}
                        </span>
                        <span className="coach-explanation__research-desc">{ref.description}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const COACH_PRIORITY_ICON = {
  goal: Target,
  plateau: AlertTriangle,
  fatigue: Flame,
  planner: CalendarRange,
  streak: Zap,
};

function CoachPriorityBanner({ signal, onNavigate }) {
  if (!signal) return null;
  const Icon = COACH_PRIORITY_ICON[signal.category] || AlertTriangle;
  const isClickable = signal.navigationTarget && signal.navigationTarget !== "/dashboard";

  const content = (
    <>
      <span className="coach-priority-banner__icon">
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="coach-priority-banner__body">
        <span className="coach-priority-banner__title">{signal.title}</span>
        {signal.detail && <span className="coach-priority-banner__detail">{signal.detail}</span>}
      </span>
      {isClickable && <ChevronRight size={16} strokeWidth={2} />}
    </>
  );

  if (!isClickable) {
    return (
      <div className={`coach-priority-banner coach-priority-banner--${signal.severity}`}>{content}</div>
    );
  }

  return (
    <button
      type="button"
      className={`coach-priority-banner coach-priority-banner--clickable coach-priority-banner--${signal.severity}`}
      onClick={() => onNavigate(signal.navigationTarget)}
    >
      {content}
    </button>
  );
}

const formatGoalProgress = (goal, analytics) =>
  goal.unit === "days" ? `${goal.current} / ${goal.target} days` : `${analytics.percent}%`;

function GoalsWidget({ goals, onViewAll }) {
  const topGoals = goals
    .filter((g) => g.status !== "Completed")
    .map((g) => ({ goal: g, analytics: getGoalAnalytics(g) }))
    .sort((a, b) => b.analytics.percent - a.analytics.percent)
    .slice(0, 3);

  if (!topGoals.length) return null;

  return (
    <section className="section">
      <div className="goals-widget-head">
        <p className="section__label">Goals</p>
        <button type="button" className="goals-widget-link" onClick={onViewAll}>
          View all
        </button>
      </div>
      <div className="goals-widget">
        {topGoals.map(({ goal, analytics }) => (
          <div className="goals-widget__row" key={goal._id}>
            <div className="goals-widget__row-top">
              <span className="goals-widget__title">{goal.title}</span>
              <span className="goals-widget__value">{formatGoalProgress(goal, analytics)}</span>
            </div>
            <div className="goals-widget__bar">
              <div
                className="goals-widget__bar-fill"
                style={{ width: `${Math.min(100, analytics.percent)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SkeletonVal() {
  return (
    <span
      className="skeleton"
      style={{ width: 64, height: 22, display: "inline-block", borderRadius: 6 }}
    />
  );
}

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__label">{label}</p>
      <p className="chart-tooltip__value">
        {Number(payload[0].value).toLocaleString()} kg
      </p>
    </div>
  );
}

function LastSessionCard({ session, loading }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="last-session-card">
        <span
          className="skeleton"
          style={{ width: "40%", height: 20, borderRadius: 6 }}
        />
        <span
          className="skeleton"
          style={{
            width: "100%",
            height: 60,
            borderRadius: 10,
            marginTop: 16,
            display: "block",
          }}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="last-session-card last-session-card--empty">
        <div className="empty-state__icon">
          <Dumbbell size={24} strokeWidth={1.6} />
        </div>
        <p>No sessions completed yet.</p>
      </div>
    );
  }

  const typeColor = getSessionTypeColor(session.sessionType);
  const label = getSessionTypeLabel(session);

  const strengthEntries = session.workouts.filter((w) => !isCardioEntry(w));
  const cardioEntries = session.workouts.filter((w) => isCardioEntry(w));

  const sessionTime = formatClockTime(session.date);

  return (
    <div className="last-session-card">
      <div className="last-session-card__top">
        <div className="last-session-card__title-row">
          <span
            className="last-session-card__badge"
            style={{ background: typeColor.bg, color: typeColor.text }}
          >
            {label}
          </span>
          <span className="last-session-card__date">
            {formatSessionDate(session.date)} · {sessionTime}
          </span>
        </div>
        {session.sessionDuration != null && (
          <span className="last-session-card__duration">
            <Timer size={14} strokeWidth={1.8} />
            {session.startedAt && session.endedAt ? (
              <>
                {formatClockTime(session.startedAt)}
                {" – "}
                {formatClockTime(session.endedAt)}
                <span className="last-session-card__duration-sep">&bull;</span>
                {formatDurationLong(session.sessionDuration)}
              </>
            ) : (
              formatDurationLong(session.sessionDuration)
            )}
          </span>
        )}
      </div>

      {session.sessionId && (
        <p className="last-session-card__timing-note">
          Timing doesn't match your actual workout?{" "}
          <button
            type="button"
            className="last-session-card__timing-note-link"
            onClick={() => navigate("/workouts")}
          >
            Edit it from Workouts.
          </button>
        </p>
      )}

      <div className="last-session-card__footer">
        {session.stats.exerciseCount > 0 && (
          <div className="last-session-card__stat">
            <span className="last-session-card__stat-label">Volume</span>
            <span className="last-session-card__stat-value">
              {session.stats.volume.toLocaleString()} kg
            </span>
          </div>
        )}
        {session.stats.muscles.length > 0 && (
          <div className="last-session-card__muscles">
            {session.stats.muscles.map((m) => (
              <span className="last-session-card__muscle-tag" key={m}>
                {m}
              </span>
            ))}
          </div>
        )}
        <button
          type="button"
          className="last-session-card__expand-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide" : "View"} full details
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={expanded ? "rotated" : ""}
          />
        </button>
      </div>

      {expanded && (
        <div className="last-session-card__detail-list">
          {strengthEntries.map((w) => (
            <div className="last-session-card__detail-item" key={w._id}>
              <div className="last-session-card__detail-item-head">
                <span className="last-session-card__detail-item-name">
                  <Dumbbell size={13} strokeWidth={1.8} />
                  {w.exercise?.name || "Unknown exercise"}
                </span>
                {w.exercise?.muscleGroup && (
                  <span className="last-session-card__detail-item-muscle">
                    {w.exercise.muscleGroup}
                  </span>
                )}
              </div>
              <p className="last-session-card__detail-item-sets">
                {formatSetBreakdown(w)}
              </p>
              <div className="last-session-card__detail-item-meta">
                <span>{getSetCount(w)} sets</span>
                <span>{getWorkoutVolume(w).toLocaleString()} kg</span>
              </div>
            </div>
          ))}

          {cardioEntries.map((w) => (
            <div className="last-session-card__detail-item" key={w._id}>
              <div className="last-session-card__detail-item-head">
                <span className="last-session-card__detail-item-name">
                  <HeartPulse size={13} strokeWidth={1.8} />
                  {getCardioActivityLabel(w)}
                </span>
              </div>
              <p className="last-session-card__detail-item-sets">
                {formatCardioSummary(w)
                  .map((m) => m.text)
                  .join(" · ")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentSessionRow({ session }) {
  const [expanded, setExpanded] = useState(false);
  const { stats } = session;
  const typeColor = getSessionTypeColor(session.sessionType);
  const label = getSessionTypeLabel(session);

  const strengthEntries = session.workouts.filter((w) => !isCardioEntry(w));
  const cardioEntries = session.workouts.filter((w) => isCardioEntry(w));

  return (
    <div className="recent-session-row">
      <div
        className="recent-session-row__main"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span
          className="recent-session-row__badge"
          style={{ background: typeColor.bg, color: typeColor.text }}
        >
          {label}
        </span>

        <div className="recent-session-row__info">
          <p className="recent-session-row__meta">
            {session.sessionDuration != null &&
              `${session.sessionDuration} min · `}
            {strengthEntries.length > 0 &&
              `${strengthEntries.length} exercise${
                strengthEntries.length === 1 ? "" : "s"
              }`}
            {strengthEntries.length > 0 && cardioEntries.length > 0 && " · "}
            {cardioEntries.length > 0 &&
              `${cardioEntries.length} cardio activit${
                cardioEntries.length === 1 ? "y" : "ies"
              }`}
          </p>
          <p className="recent-session-row__time">
            Completed {formatRelativeTime(session.date)}
          </p>
        </div>

        {stats.volume > 0 && (
          <span className="recent-session-row__volume">
            {stats.volume.toLocaleString()} kg
          </span>
        )}

        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`recent-session-row__chevron ${expanded ? "rotated" : ""}`}
        />
      </div>

      {expanded && (
        <div className="recent-session-row__detail">
          {strengthEntries.map((w) => (
            <div className="recent-session-row__detail-item" key={w._id}>
              <Dumbbell size={13} strokeWidth={1.8} />
              <span>{w.exercise?.name}</span>
            </div>
          ))}
          {cardioEntries.map((w) => {
            const durationMetric = formatCardioSummary(w).find(
              (m) => m.key === "duration"
            );
            return (
              <div className="recent-session-row__detail-item" key={w._id}>
                <HeartPulse size={13} strokeWidth={1.8} />
                <span>
                  {getCardioActivityLabel(w)}
                  {durationMetric ? ` · ${durationMetric.text}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showModal, setShowModal] = useState(false);
  const [showCardioModal, setShowCardioModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const workoutSession = useWorkoutSession();

  const [showStartModal, setShowStartModal] = useState(false);
  const [pendingAddModal, setPendingAddModal] = useState(false);

  const [moreStatsOpen, setMoreStatsOpen] = useState(false);

  const [replacingEntryId, setReplacingEntryId] = useState(null);

  const [finishSummary, setFinishSummary] = useState(null);

  const [stats, setStats] = useState({
    totalSessions: null,
    sessionsLast7Days: null,
    sessionsLast30Days: null,
    currentStreak: null,
    lastSession: null,
    averageVolumeRecent: null,
    averageSessionDuration: null,
    topExercise: "",
    topExerciseCount: 0,
    topMuscle: "",
    topMuscleCount: 0,
    personalRecords: {},
  });

  const [recentSessions, setRecentSessions] = useState([]);

  const [volumeRange, setVolumeRange] = useState("7d");

  const [muscleWorkouts, setMuscleWorkouts] = useState([]);

  const [goals, setGoals] = useState([]);

  const [plannedWorkouts, setPlannedWorkouts] = useState([]);
  const hasAppliedPlannedWorkoutDeepLink = useRef(false);

  const todayDateKey = getTodayDateKey();
  const latestStreakRef = useRef(0);
  const [todaySteps, setTodaySteps] = useState(null);
  const [stepsEditing, setStepsEditing] = useState(false);
  const [stepsInput, setStepsInput] = useState("");
  const [stepsSaving, setStepsSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- fetchDashboardData is declared below, but effects run after render commits so it's already initialized here.
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [summaryData, workoutsRes, goalsRes, dailyStepsRes, plannedWorkoutsRes] =
        await Promise.all([
          getDashboardSummaryData(),
          getWorkouts(500),
          getGoals(),
          getDailySteps({ from: todayDateKey, to: todayDateKey }),
          getPlannedWorkouts(),
        ]);
      setGoals(goalsRes.data);
      setPlannedWorkouts(plannedWorkoutsRes.data);
      const todayEntry = dailyStepsRes.data.find((e) => e.date === todayDateKey);
      setTodaySteps(todayEntry ? todayEntry.steps : null);

      const [
        summary,
        streak,
        topExercise,
        topMuscle,
        records,
        recentSessionsRes,
      ] = summaryData;

      latestStreakRef.current = streak.data.currentStreak;
      setMuscleWorkouts(workoutsRes.data);

      const notificationCandidates = generateReminders({
        workouts: workoutsRes.data,
        goals: goalsRes.data,
        plannedWorkouts: plannedWorkoutsRes.data,
      });
      if (notificationCandidates.length) {
        generateNotifications(notificationCandidates).catch((error) => console.log(error));
      }

      setStats({
        totalSessions: summary.data.totalSessions,
        sessionsLast7Days: summary.data.sessionsLast7Days,
        sessionsLast30Days: summary.data.sessionsLast30Days,
        lastSession: summary.data.lastSession,
        averageVolumeRecent: Math.round(summary.data.averageVolumeRecent || 0),
        averageSessionDuration:
          summary.data.averageSessionDuration != null
            ? Math.round(summary.data.averageSessionDuration)
            : null,
        currentStreak: streak.data.currentStreak,
        topExercise: topExercise.data.exercise,
        topExerciseCount: topExercise.data.count,
        topMuscle: topMuscle.data.topMuscle,
        topMuscleCount: topMuscle.data.count,
        personalRecords: records.data,
      });

      setRecentSessions(
        sortSessions(buildSessionSummaries(recentSessionsRes.data), "newest")
      );

      return workoutsRes.data;
    } catch (err) {
      console.error("Dashboard Error:", err);
      setLoadError(true);
      return muscleWorkouts;
    } finally {
      setLoading(false);
    }
  };

  const handleAddExercise = (payload) => {
    workoutSession.addExercise(payload);
    setShowModal(false);
  };

  const handleOpenReplaceExercise = (entryId) => {
    setReplacingEntryId(entryId);
  };

  const handleReplaceExercise = ({ exercise }) => {
    if (replacingEntryId) {
      workoutSession.replaceEntryExercise(replacingEntryId, exercise);
    }
    setReplacingEntryId(null);
  };

  const handleAddCardio = (payload) => {
    workoutSession.addCardioEntry(payload);
    setShowCardioModal(false);
  };

  const handleOpenStartModal = () => {
    if (workoutSession.active) return;
    setPendingAddModal(false);
    setShowStartModal(true);
  };

  const handleEmptyStateAddWorkout = () => {
    if (workoutSession.active) {
      setShowModal(true);
      return;
    }
    setPendingAddModal(true);
    setShowStartModal(true);
  };

  const handleStartModalClose = () => {
    setShowStartModal(false);
    setPendingAddModal(false);
  };

  const handleStartModalConfirm = (sessionType, customSessionType) => {
    workoutSession.startSession(sessionType, customSessionType);
    setShowStartModal(false);
    if (pendingAddModal) {
      setShowModal(true);
      setPendingAddModal(false);
    }
  };

  const handleStartPlannedWorkout = (plannedWorkoutId) => {
    if (workoutSession.active) return;
    const plan = plannedWorkouts.find((p) => p._id === plannedWorkoutId);
    if (!plan) return;
    workoutSession.startSessionFromPlan(plan);
  };

  useEffect(() => {
    if (hasAppliedPlannedWorkoutDeepLink.current) return;
    const planId = searchParams.get("startPlannedWorkoutId");
    if (!planId || loading) return;

    hasAppliedPlannedWorkoutDeepLink.current = true;
    handleStartPlannedWorkout(planId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("startPlannedWorkoutId");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, loading, plannedWorkouts]);

  const handleFinishWorkout = async (localSummary) => {
    const success = await workoutSession.finishWorkout();
    if (success) {
      setShowModal(false);
      const freshWorkouts = await fetchDashboardData();

      setFinishSummary({
        ...localSummary,
        badges: getSessionBadges(freshWorkouts, {
          durationMinutes: localSummary.durationMinutes,
          setCount: localSummary.setCount,
        }),
        currentStreak: latestStreakRef.current,
      });
    }
  };

  const handleStartEditSteps = () => {
    setStepsInput(todaySteps != null ? String(todaySteps) : "");
    setStepsEditing(true);
  };

  const handleCancelEditSteps = () => {
    setStepsEditing(false);
    setStepsInput("");
  };

  const handleSaveSteps = async () => {
    if (stepsInput === "" || isNaN(Number(stepsInput)) || Number(stepsInput) < 0) return;
    setStepsSaving(true);
    try {
      const res = await setDailySteps(todayDateKey, Number(stepsInput));
      setTodaySteps(res.data.steps);
      setStepsEditing(false);
    } catch (error) {
      console.log(error);
    } finally {
      setStepsSaving(false);
    }
  };

  const dailyStepsGoal = goals.find(
    (g) => g.type === "Cardio Goal" && g.metric === "steps" && g.dailyTarget
  );

  const weeklyVolumeChartData = useMemo(() => {
    if (volumeRange === "365d") return buildYearlyVolumeSeries(muscleWorkouts);
    const opt = VOLUME_RANGE_OPTIONS.find((o) => o.key === volumeRange);
    return buildDailyVolumeSeries(muscleWorkouts, opt.days);
  }, [muscleWorkouts, volumeRange]);

  const barChartData =
    weeklyVolumeChartData.length > 0
      ? weeklyVolumeChartData
      : DAY_ORDER.map((d) => ({ day: d, volume: 0 }));

  const todaysPlannedWorkout = useMemo(() => {
    return (
      plannedWorkouts.find((p) => {
        if (p.status !== "Planned") return false;
        const d = new Date(p.scheduledDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
        return key === todayDateKey;
      }) || null
    );
  }, [plannedWorkouts, todayDateKey]);

  const trainingBrief = useMemo(
    () =>
      generateTrainingBrief(muscleWorkouts, goals, {
        todaySteps,
        dailyGoalTarget: dailyStepsGoal?.dailyTarget ?? null,
        todaysPlannedWorkout,
      }),
    [muscleWorkouts, goals, todaySteps, dailyStepsGoal, todaysPlannedWorkout]
  );
  const todaysBrief = trainingBrief.brief;

  const weeklyCoachReport = useMemo(() => generateWeeklyCoachReport(muscleWorkouts), [muscleWorkouts]);

  const coachPriority = useMemo(
    () => generateCoachPriority(muscleWorkouts, { goals, plannedWorkouts }),
    [muscleWorkouts, goals, plannedWorkouts]
  );

  const cardioWeekOverview = useMemo(
    () => getCardioOverview(muscleWorkouts, { period: "week" }),
    [muscleWorkouts]
  );

  const cardioStreak = useMemo(
    () => computeCurrentStreak(muscleWorkouts.filter(isCardioEntry)),
    [muscleWorkouts]
  );

  const latestCardioWorkout = useMemo(() => {
    const cardioOnly = muscleWorkouts.filter(isCardioEntry);
    if (!cardioOnly.length) return null;
    return cardioOnly.reduce((latest, w) => {
      const t = new Date(w.date || w.createdAt).getTime();
      return !latest || t > new Date(latest.date || latest.createdAt).getTime() ? w : latest;
    }, null);
  }, [muscleWorkouts]);

  const trainingBalance = useMemo(() => getStrengthCardioSplit(muscleWorkouts), [muscleWorkouts]);

  const activeCardioGoal = useMemo(() => {
    const candidates = goals
      .filter((g) => g.type === "Cardio Goal" && g.status !== "Completed")
      .map((g) => ({ goal: g, analytics: getGoalAnalytics(g) }))
      .sort((a, b) => b.analytics.percent - a.analytics.percent);
    return candidates[0] || null;
  }, [goals]);

  const lastSessionVolumeValue = (() => {
    const ls = stats.lastSession;
    if (!ls) return "—";
    if (ls.exerciseCount > 0) return `${ls.volume.toLocaleString()} kg`;
    if (ls.cardioCount > 0) return ls.cardioActivities[0]?.activityType || "Cardio";
    return "—";
  })();

  const lastSessionVolumeNumeric =
    stats.lastSession && stats.lastSession.exerciseCount > 0 ? stats.lastSession.volume : null;

  const lastSessionVolumeSub = (() => {
    const ls = stats.lastSession;
    if (!ls) return null;
    if (ls.exerciseCount > 0 && ls.cardioCount > 0) {
      return `+${ls.cardioCount} Cardio Activit${ls.cardioCount === 1 ? "y" : "ies"}`;
    }
    if (ls.exerciseCount === 0 && ls.cardioCount > 0) {
      return ls.sessionDuration != null ? `${ls.sessionDuration} min` : null;
    }
    return "Previous Session";
  })();

  const lastSessionVolumeTrend = (() => {
    const [latest, previous] = recentSessions;
    if (!latest || !previous) return null;
    if (!(latest.stats.exerciseCount > 0) || !(previous.stats.exerciseCount > 0)) return null;
    const prevVolume = previous.stats.volume;
    if (!prevVolume) return null;
    const changePct = Math.round(((latest.stats.volume - prevVolume) / prevVolume) * 100);
    if (changePct === 0) return null;
    return { changePct, positive: changePct > 0 };
  })();

  const lastSessionSubDisplay = lastSessionVolumeTrend
    ? `${lastSessionVolumeTrend.positive ? "↑" : "↓"} ${
        lastSessionVolumeTrend.positive ? "+" : ""
      }${lastSessionVolumeTrend.changePct}% vs previous`
    : lastSessionVolumeSub;

  const weeklySessionTrend = (() => {
    const sessions = buildSessionSummaries(muscleWorkouts);
    const now = Date.now();
    const oneWeekMs = 7 * 86400000;
    const thisWeek = sessions.filter((s) => now - new Date(s.date).getTime() < oneWeekMs).length;
    const lastWeek = sessions.filter((s) => {
      const age = now - new Date(s.date).getTime();
      return age >= oneWeekMs && age < oneWeekMs * 2;
    }).length;
    return thisWeek - lastWeek;
  })();

  const longestStreakEver = computeLongestRestAwareStreak(trainedDayKeys(muscleWorkouts));
  const showLongestStreakFallback = stats.currentStreak === 0 && longestStreakEver > 0;

  const avgSessionDurationValue =
    stats.averageSessionDuration != null
      ? `${stats.averageSessionDuration} min`
      : "—";

  const firstName = getFirstName();

  const heroSubtitle = loading ? "Loading your progress..." : "Ready to crush today's session?";

  return (
    <div className="dash-page">
      <main className="dash-main">
        {loadError && (
          <LoadErrorBanner
            message="Couldn't load your dashboard. Check your connection and try again."
            onRetry={fetchDashboardData}
          />
        )}

        <section className="hero-card">
          <div className="hero-card__left">
            <span className="hero-card__eyebrow">
              <span className="hero-card__dot" />
              Live dashboard
              <span className="hero-card__eyebrow-sep" aria-hidden="true">·</span>
              <span className="hero-card__date">{getTodayLongLabel()}</span>
            </span>
            <h1 className="hero-card__title">
              {getTimeGreeting()}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            {!loading && todaysBrief.length > 0 ? (
              <>
                <p className="hero-brief-label">Today's Brief</p>
                <ul className="hero-brief-list">
                  {todaysBrief.map((item) => (
                    <BriefListItem
                      key={item.key}
                      item={item}
                      onStartPlanned={handleStartPlannedWorkout}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <p className="hero-card__sub">{heroSubtitle}</p>
            )}
          </div>
          <div className="hero-card__right">
            <button
              className="cta-btn"
              onClick={handleOpenStartModal}
              disabled={workoutSession.active || workoutSession.isSaving}
            >
              <Plus size={16} strokeWidth={2.5} />
              New Workout
            </button>
          </div>
        </section>

        <section className="section hero-last-session">
          <p className="section__label">Last Session</p>
          <LastSessionCard session={recentSessions[0] || null} loading={loading} />
        </section>

        {!workoutSession.active && workoutSession.saveSuccess && (
          <div className="save-success-banner" role="status">
            <CheckCircle2 size={18} strokeWidth={2} />
            <span>{workoutSession.saveSuccess}</span>
            <button
              type="button"
              className="save-success-banner__close"
              onClick={workoutSession.clearSaveSuccess}
              aria-label="Dismiss"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}

        {workoutSession.active && !workoutSession.justStarted && (
          <ResumeWorkoutPrompt
            startTime={workoutSession.startTime}
            onResume={workoutSession.confirmResume}
            onDiscard={workoutSession.discardSession}
          />
        )}

        {workoutSession.active && workoutSession.justStarted && (
          <WorkoutSession
            startTime={workoutSession.startTime}
            entryCount={workoutSession.entries.length}
            entries={workoutSession.entries}
            historicalWorkouts={muscleWorkouts}
            onAddExercise={() => setShowModal(true)}
            onAddCardio={() => setShowCardioModal(true)}
            onDiscard={() => workoutSession.discardSession()}
            onRemoveEntry={workoutSession.removeEntry}
            onAddSet={workoutSession.addSet}
            onDeleteSet={workoutSession.deleteSet}
            onUpdateSet={workoutSession.updateSet}
            onReorderEntry={workoutSession.reorderEntry}
            onDuplicateEntry={workoutSession.duplicateEntry}
            onReplaceEntry={handleOpenReplaceExercise}
            sessionNote={workoutSession.sessionNote}
            onSessionNoteChange={workoutSession.setSessionNote}
            onUpdateEntryNote={workoutSession.updateEntryNote}
            onFinishWorkout={handleFinishWorkout}
            isSaving={workoutSession.isSaving}
            saveError={workoutSession.saveError}
          />
        )}

        {!loading &&
          (trainingBrief.weeklyGrade ||
            trainingBrief.trainingBalance.available ||
            trainingBrief.fatigueBand ||
            trainingBrief.recommendedWorkout) && (
          <section className="section">
            <p className="section__label">Today's Focus</p>
            <CoachPriorityBanner signal={coachPriority.top} onNavigate={navigate} />
            <CoachExplanation
              sections={trainingBrief.explanationSections}
              recommendedCategory={trainingBrief.recommendedCategory}
              generatedAt={trainingBrief.generatedAt}
            />
          </section>
        )}

        <section className="section muscle-map-hero-section">
          <div className="muscle-map-hero">
            <div className="muscle-map-hero__head">
              <div>
                <p className="muscle-map-hero__title">Muscle Map</p>
              </div>
            </div>
            <MuscleBodyMap
              workouts={muscleWorkouts}
              loading={loading}
              personalRecords={stats.personalRecords}
              onSelectMuscle={(muscle) =>
                navigate(`/progression?muscle=${encodeURIComponent(muscle)}`)
              }
            />
          </div>
        </section>

        <section className="section dash-summary-row">
          <div className="dash-summary-row__stats">
            <p className="section__label">Overview</p>
            <div className="primary-grid primary-grid--compact">
              <PrimaryCard
                title="Total Sessions"
                numericValue={loading ? null : stats.totalSessions}
                formatValue={(n) => String(n)}
                sub={
                  loading || weeklySessionTrend === 0
                    ? null
                    : `${weeklySessionTrend > 0 ? "↑" : "↓"} ${
                        weeklySessionTrend > 0 ? "+" : ""
                      }${weeklySessionTrend} this week`
                }
                icon={Dumbbell}
                accent
                onClick={() => navigate("/workouts")}
              />
              <PrimaryCard
                title="Last Session Volume"
                value={loading ? null : lastSessionVolumeValue}
                numericValue={loading ? null : lastSessionVolumeNumeric}
                formatValue={(n) => `${Math.round(n).toLocaleString()} kg`}
                sub={loading ? null : lastSessionSubDisplay}
                icon={Flame}
                onClick={() => navigate("/analytics")}
              />
              <PrimaryCard
                title="Sessions Logged"
                numericValue={loading ? null : stats.sessionsLast7Days}
                formatValue={(n) => `${n} (7d)`}
                icon={Activity}
                onClick={() => navigate("/workouts")}
              />
              <PrimaryCard
                title={showLongestStreakFallback ? "Longest Streak" : "Current Streak"}
                numericValue={
                  loading ? null : showLongestStreakFallback ? longestStreakEver : stats.currentStreak
                }
                formatValue={(n) => `${n}d`}
                icon={CalendarDays}
                onClick={() => navigate("/calendar")}
              />
            </div>
          </div>

          {weeklyCoachReport.available && (
            <div className="dash-summary-row__report">
              <WeeklyCoachReport report={weeklyCoachReport} />
            </div>
          )}
        </section>

        <section className="section charts-row">
          <div className="chart-card chart-card--bar">
            <div className="chart-card__head">
              <div>
                <p className="chart-card__title">Training Volume</p>
                <p className="chart-card__sub">
                  Total weight lifted {volumeRange === "365d" ? "per month" : "per day"} (kg)
                </p>
              </div>
              <div className="chart-card__range-toggle">
                {VOLUME_RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`chart-card__range-btn ${
                      volumeRange === opt.key ? "chart-card__range-btn--active" : ""
                    }`}
                    onClick={() => setVolumeRange(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={barChartData}
                barSize={26}
                margin={{ top: 8, right: 0, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="dashVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--go-primary)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--go-primary)" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: "var(--go-text-faint)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--go-text-faint)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<CustomBarTooltip />}
                  cursor={{ fill: "var(--go-primary-50)" }}
                />
                <Bar
                  dataKey="volume"
                  fill="url(#dashVolumeGradient)"
                  radius={[6, 6, 0, 0]}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {!loading && <GoalsWidget goals={goals} onViewAll={() => navigate("/goals")} />}

        {!loading && (
          <section className="section">
            <TodayStepsCard
              steps={todaySteps}
              dailyGoalTarget={dailyStepsGoal?.dailyTarget ?? null}
              loading={loading}
              editing={stepsEditing}
              inputValue={stepsInput}
              onInputChange={(e) => setStepsInput(e.target.value)}
              onEditStart={handleStartEditSteps}
              onSave={handleSaveSteps}
              onCancel={handleCancelEditSteps}
              saving={stepsSaving}
            />

            <button
              type="button"
              className="more-stats-toggle"
              onClick={() => setMoreStatsOpen((v) => !v)}
              aria-expanded={moreStatsOpen}
              aria-controls="dashboard-more-stats"
            >
              <p className="section__label" style={{ margin: 0 }}>More Stats</p>
              <ChevronDown
                size={16}
                strokeWidth={2}
                className={`more-stats-toggle__chevron ${moreStatsOpen ? "more-stats-toggle__chevron--open" : ""}`}
              />
            </button>

            {moreStatsOpen && (
              <div id="dashboard-more-stats" className="more-stats-panel">
                <div className="secondary-grid">
                  <SecondaryCard
                    title="Avg Volume (Last 5)"
                    value={`${stats.averageVolumeRecent?.toLocaleString()} kg`}
                    icon={BarChart2}
                  />
                  <SecondaryCard
                    title="Avg Session Duration (Last 5)"
                    value={avgSessionDurationValue}
                    icon={Timer}
                  />
                  <SecondaryCard
                    title="Top Muscle"
                    value={stats.topMuscle || "—"}
                    sub={stats.topMuscleCount ? `${stats.topMuscleCount} sets` : null}
                    icon={Zap}
                  />
                  <SecondaryCard
                    title="Top Exercise"
                    value={stats.topExercise || "—"}
                    sub={
                      stats.topExerciseCount
                        ? `${stats.topExerciseCount}× performed`
                        : null
                    }
                    icon={Trophy}
                  />
                  <SecondaryCard
                    title="Sessions (30d)"
                    value={stats.sessionsLast30Days}
                    icon={CalendarRange}
                  />
                </div>

                {cardioWeekOverview.hasCardioData && (
                  <div className="secondary-grid more-stats-panel__cardio">
                    <SecondaryCard
                      title="Weekly Cardio Distance"
                      value={`${cardioWeekOverview.periodDistance} km`}
                      sub={`${cardioWeekOverview.periodSessions} sessions this week`}
                      icon={MapPin}
                    />
                    <SecondaryCard
                      title="Weekly Cardio Duration"
                      value={`${cardioWeekOverview.periodDuration} min`}
                      icon={Timer}
                    />
                    <SecondaryCard title="Cardio Streak" value={`${cardioStreak}d`} icon={HeartPulse} />
                    <SecondaryCard
                      title="Latest Cardio Session"
                      value={latestCardioWorkout ? getCardioActivityLabel(latestCardioWorkout) : "—"}
                      sub={latestCardioWorkout ? formatSessionDate(latestCardioWorkout.date) : null}
                      icon={Activity}
                    />
                    {trainingBalance.available && (
                      <SecondaryCard
                        title="Cardio vs Strength"
                        value={`${trainingBalance.strengthPct}% / ${trainingBalance.cardioPct}%`}
                        sub="Strength / Cardio sessions"
                        icon={BarChart2}
                      />
                    )}
                    {activeCardioGoal && (
                      <SecondaryCard
                        title={activeCardioGoal.goal.title}
                        value={`${activeCardioGoal.goal.current}/${activeCardioGoal.goal.target} ${activeCardioGoal.goal.unit}`}
                        sub={`${activeCardioGoal.analytics.percent}% complete`}
                        icon={Target}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="activity-row">
          <div className="activity-card activity-card--recent">
            <div className="activity-card__head">
              <p className="activity-card__title">Recent Sessions</p>
              <button className="view-all-btn" onClick={() => navigate("/workouts")}>
                View all <ChevronRight size={14} />
              </button>
            </div>

            {!loading && recentSessions.length > 0 && (
              <p className="activity-card__timing-hint">
                Notice a workout's timing looks off? You can edit it anytime from Workouts.
              </p>
            )}

            {loading ? (
              <div className="activity-list">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="workout-row workout-row--skeleton">
                    <span
                      className="skeleton"
                      style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0 }}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span
                        className="skeleton"
                        style={{ width: "55%", height: 13, borderRadius: 5 }}
                      />
                      <span
                        className="skeleton"
                        style={{ width: "38%", height: 11, borderRadius: 5 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentSessions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">
                  <Dumbbell size={26} strokeWidth={1.6} />
                </div>
                <p>No sessions logged yet.</p>
                <button className="empty-btn" onClick={handleEmptyStateAddWorkout}>
                  Log your first workout
                </button>
              </div>
            ) : (
              <div className="activity-list">
                {recentSessions.map((session) => (
                  <RecentSessionRow key={session.key} session={session} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <StartWorkoutModal
        open={showStartModal}
        onClose={handleStartModalClose}
        onStart={handleStartModalConfirm}
      />

      {showModal && (
        <AddWorkoutModal
          closeModal={() => setShowModal(false)}
          onAddExercise={handleAddExercise}
        />
      )}

      {replacingEntryId && (
        <AddWorkoutModal
          mode="replace"
          closeModal={() => setReplacingEntryId(null)}
          onAddExercise={handleReplaceExercise}
        />
      )}

      <FinishWorkoutSummary summary={finishSummary} onClose={() => setFinishSummary(null)} />

      {showCardioModal && (
        <AddCardioModal
          closeModal={() => setShowCardioModal(false)}
          onAddCardio={handleAddCardio}
        />
      )}
    </div>
  );
}

export default Dashboard;