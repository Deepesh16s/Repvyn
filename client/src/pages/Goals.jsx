import "./goals.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import { getGoals, createGoal, updateGoal, deleteGoal } from "../services/goalService";
import {
  Plus,
  Target,
  ListChecks,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import {
  GOAL_CATEGORIES,
  TYPE_LABELS,
  TARGET_LABEL,
  FIXED_UNIT,
  CARDIO_UNITS,
  WEIGHT_UNITS,
  MANUAL_GOAL_TYPES as MANUAL_TYPES,
  GOAL_PERIODS,
  CARDIO_SESSION_METRIC,
  CARDIO_GOAL_METRICS,
  CARDIO_GOAL_METRIC_LABELS,
  CARDIO_GOAL_METRIC_UNITS,
  CARDIO_MILESTONE_PRESETS,
  GOAL_STYLES,
  GOAL_STYLE_OPTIONS,
  DAILY_TRACK_OVER,
  DAILY_TRACK_OVER_OPTIONS,
  composePeriod,
  decomposePeriod,
} from "../constants/goalTypes";
import { CARDIO_ACTIVITY_TYPES } from "../constants/cardioMetadata";
import { getGoalAnalytics } from "../utils/goalAnalytics";
import { generateGoalReminders } from "../reminders/goalReminders";
import GoalCard from "../components/GoalCard";
import LoadErrorBanner from "../components/LoadErrorBanner";
import ConfirmDialog from "../components/ConfirmDialog";
import useModalEscapeAndFocus from "../hooks/useModalEscapeAndFocus";

const OTHER_CATEGORY = {
  key: "other",
  label: "Other Goals",
  shortLabel: "Other",
  types: [],
};

const SELECTABLE_CATEGORIES = GOAL_CATEGORIES;

const getKnownTypes = () => SELECTABLE_CATEGORIES.flatMap((c) => c.types);

const getCategoryKeyForType = (type) => {
  const match = SELECTABLE_CATEGORIES.find((c) => c.types.includes(type));
  return match ? match.key : SELECTABLE_CATEGORIES[0].key;
};

const getTypesForCategory = (categoryKey) => {
  const cat = SELECTABLE_CATEGORIES.find((c) => c.key === categoryKey);
  return cat ? cat.types : [];
};

const groupGoalsByCategory = (goals) => {
  const knownTypes = getKnownTypes();

  const known = GOAL_CATEGORIES.map((cat) => ({
    ...cat,
    goals: goals.filter((g) => cat.types.includes(g.type)),
  }));

  const other = {
    ...OTHER_CATEGORY,
    goals: goals.filter((g) => !knownTypes.includes(g.type)),
  };

  return [...known, other].filter((cat) => cat.goals.length > 0);
};

const STATUS_FILTER_OPTIONS = ["All", "In Progress", "Completed"];

const DEFAULT_SORT_KEY = "recent";
const SORT_OPTIONS = [
  { key: "recent", label: "Recently Updated" },
  { key: "progress", label: "Progress %" },
  { key: "deadline", label: "Deadline" },
];

const sortGoalEntries = (entries, sortKey) => {
  const sorted = [...entries];

  if (sortKey === "progress") {
    sorted.sort((a, b) => b.analytics.percent - a.analytics.percent);
  } else if (sortKey === "deadline") {
    sorted.sort((a, b) => {
      if (!a.goal.deadline && !b.goal.deadline) return 0;
      if (!a.goal.deadline) return 1;
      if (!b.goal.deadline) return -1;
      return new Date(a.goal.deadline) - new Date(b.goal.deadline);
    });
  } else {
    sorted.sort(
      (a, b) =>
        new Date(b.goal.lastUpdated || b.goal.updatedAt) -
        new Date(a.goal.lastUpdated || a.goal.updatedAt)
    );
  }

  return sorted;
};

const toDateInputValue = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

function GoalStatCard({ label, value, icon: Icon }) {
  return (
    <div className="go-card goal-stat-card">
      <span className="goal-stat-card__label">
        {Icon && <Icon size={13} strokeWidth={2} style={{ marginRight: 5 }} />}
        {label}
      </span>
      <span className="goal-stat-card__value">{value}</span>
    </div>
  );
}

function GoalStatsHeader({ stats }) {
  return (
    <div className="goal-stats-header">
      <GoalStatCard label="Active Goals" value={stats.active} icon={ListChecks} />
      <GoalStatCard label="On Track" value={stats.onTrack} icon={TrendingUp} />
      <GoalStatCard label="At Risk" value={stats.atRisk} icon={AlertTriangle} />
      <GoalStatCard label="Completed" value={stats.completed} icon={CheckCircle2} />
    </div>
  );
}

function GoalCategorySection({
  label,
  goals,
  analyticsById,
  goalReminderIds,
  onEdit,
  onDelete,
  cardRef,
  highlightedGoalId,
}) {
  return (
    <section className="section">
      <p className="section__label">
        {label} ({goals.length})
      </p>
      <div className="goals-grid">
        {goals.map((goal) => (
          <GoalCard
            key={goal._id}
            goal={goal}
            analytics={analyticsById.get(goal._id)}
            hasReminder={goalReminderIds.has(goal._id)}
            cardRef={(el) => cardRef(goal._id, el)}
            isHighlighted={highlightedGoalId === goal._id}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="goals-empty">
      <Target size={36} strokeWidth={1.4} />
      <p>No goals yet</p>
      <p className="goals-empty__sub">Create your first fitness goal.</p>
      <button className="cta-btn" onClick={onAdd}>
        <Plus size={16} strokeWidth={2.5} />
        Create your first goal
      </button>
    </div>
  );
}

function FilteredEmptyState({ onClear }) {
  return (
    <div className="goals-empty goals-empty--filtered">
      <Target size={30} strokeWidth={1.4} />
      <p>No goals match these filters</p>
      <p className="goals-empty__sub">Try a different status, or clear your filters.</p>
      <button type="button" className="goal-filters-clear-btn" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

const DEFAULT_CATEGORY_KEY = SELECTABLE_CATEGORIES[0].key;
const DEFAULT_TYPE = getTypesForCategory(DEFAULT_CATEGORY_KEY)[0];

const getInitialFormData = (type) => ({
  title: "",
  type,
  target: "",
  exercise: "",
  weightUnit: "kg",
  cardioUnit: "Minutes",
  current: "",
  deadline: "",
  cardioManual: true,
  activityType: "",
  metric: "",
  goalStyle: "",
  dailyTrackOver: "",
  dailyTarget: "",
});

function Goals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const goalCardRefs = useRef({});
  const hasAppliedGoalDeepLink = useRef(false);
  const [highlightedGoalId, setHighlightedGoalId] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState(DEFAULT_SORT_KEY);

  const goalsWithAnalytics = useMemo(
    () => goals.map((goal) => ({ goal, analytics: getGoalAnalytics(goal) })),
    [goals]
  );

  const analyticsById = useMemo(
    () => new Map(goalsWithAnalytics.map(({ goal, analytics }) => [goal._id, analytics])),
    [goalsWithAnalytics]
  );

  const goalReminderIds = useMemo(() => {
    const reminders = generateGoalReminders(goals);
    return new Set(reminders.map((r) => r.metadata?.goalId).filter(Boolean));
  }, [goals]);

  useEffect(() => {
    if (hasAppliedGoalDeepLink.current) return;
    const goalId = searchParams.get("focusGoal");
    if (!goalId || loading) return;
    if (!goals.some((g) => g._id === goalId)) return;

    hasAppliedGoalDeepLink.current = true;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      goalCardRefs.current[goalId]?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    });
    setHighlightedGoalId(goalId);
    setTimeout(() => setHighlightedGoalId(null), 2000);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focusGoal");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, loading, goals, setSearchParams]);

  const goalStats = useMemo(() => {
    const total = goalsWithAnalytics.length;
    const completed = goalsWithAnalytics.filter(({ goal }) => goal.status === "Completed").length;
    const active = total - completed;
    const onTrack = goalsWithAnalytics.filter(
      ({ analytics }) => analytics.health === "On Track" || analytics.health === "Ahead"
    ).length;
    const atRisk = goalsWithAnalytics.filter(
      ({ analytics }) => analytics.health === "At Risk" || analytics.health === "Behind"
    ).length;
    const avgPercent = total
      ? Math.round(
          goalsWithAnalytics.reduce((sum, { analytics }) => sum + analytics.percent, 0) / total
        )
      : 0;
    return { total, completed, active, onTrack, atRisk, avgPercent };
  }, [goalsWithAnalytics]);

  const isFilterOrSortActive = statusFilter !== "All" || sortKey !== DEFAULT_SORT_KEY;

  const filteredSortedEntries = useMemo(() => {
    let entries = goalsWithAnalytics;
    if (statusFilter !== "All") {
      entries = entries.filter(({ goal }) => goal.status === statusFilter);
    }
    return sortGoalEntries(entries, sortKey);
  }, [goalsWithAnalytics, statusFilter, sortKey]);

  const categorizedGoals = useMemo(() => groupGoalsByCategory(goals), [goals]);

  const [showModal, setShowModal] = useState(false);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);

  const closeGoalModal = () => {
    setShowModal(false);
    setEditingGoal(null);
  };

  useModalEscapeAndFocus(showModal, closeGoalModal);

  const [selectedCategory, setSelectedCategory] = useState(DEFAULT_CATEGORY_KEY);
  const [formData, setFormData] = useState(getInitialFormData(DEFAULT_TYPE));

  const [exercises, setExercises] = useState([]);

  const fetchGoals = async () => {
    setLoadError(false);
    try {
      const res = await getGoals();
      setGoals(res.data);
    } catch (error) {
      console.log(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchExercises = async () => {
    try {
      const res = await api.get("/exercises");
      setExercises(res.data);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    fetchGoals();
    fetchExercises();
  }, []);

  const uniqueExercises = exercises.filter((exercise, index, arr) => {
    const key = exercise.name.trim().toLowerCase();
    return (
      arr.findIndex((e) => e.name.trim().toLowerCase() === key) === index
    );
  });

  const availableTypes = getTypesForCategory(selectedCategory);
  const isManual =
    formData.type === "Weight Goal" ||
    (formData.type === "Cardio Goal" && formData.cardioManual);
  const isCardioAutoConfigured = formData.type === "Cardio Goal" && !formData.cardioManual;
  const composedPeriod = isCardioAutoConfigured
    ? composePeriod(formData.goalStyle, formData.dailyTrackOver)
    : null;
  const targetIsAutoComputed =
    composedPeriod === GOAL_PERIODS.DAILY_WEEKLY || composedPeriod === GOAL_PERIODS.DAILY_MONTHLY;

  const handleAddGoal = () => {
    setEditingGoal(null);
    setSelectedCategory(DEFAULT_CATEGORY_KEY);
    setFormData(getInitialFormData(DEFAULT_TYPE));
    setModalError("");
    setShowModal(true);
  };

  const handleEditGoal = (goal) => {
    setModalError("");
    setEditingGoal(goal);
    setSelectedCategory(getCategoryKeyForType(goal.type));
    const isConfiguredCardio =
      goal.type === "Cardio Goal" && !!goal.activityType && !!goal.metric && !!goal.period;
    const { style, trackOver } = isConfiguredCardio
      ? decomposePeriod(goal.period)
      : { style: "", trackOver: "" };
    setFormData({
      title: goal.title,
      type: goal.type,
      target: goal.target,
      exercise: goal.exercise?._id || "",
      weightUnit: goal.type === "Strength PR" ? goal.unit || "kg" : "kg",
      cardioUnit: goal.type === "Cardio Goal" ? goal.unit || "Minutes" : "Minutes",
      current: MANUAL_TYPES.includes(goal.type) ? goal.current : "",
      deadline: toDateInputValue(goal.deadline),
      cardioManual: !isConfiguredCardio,
      activityType: goal.activityType || "",
      metric: goal.metric || "",
      goalStyle: style,
      dailyTrackOver: trackOver || "",
      dailyTarget: goal.dailyTarget != null ? String(goal.dailyTarget) : "",
    });
    setShowModal(true);
  };

  const [goalPendingDelete, setGoalPendingDelete] = useState(null);

  const handleDeleteGoal = (goal) => {
    setGoalPendingDelete(goal);
  };

  const handleCancelDeleteGoal = () => setGoalPendingDelete(null);

  const handleConfirmDeleteGoal = async () => {
    const goal = goalPendingDelete;
    if (!goal) return;
    setGoalPendingDelete(null);

    try {
      await deleteGoal(goal._id);
      setGoals((prev) => prev.filter((g) => g._id !== goal._id));
    } catch (error) {
      console.log(error);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleCategoryChange = (e) => {
    const newCategoryKey = e.target.value;
    const newTypes = getTypesForCategory(newCategoryKey);
    const newType = newTypes[0];

    setSelectedCategory(newCategoryKey);
    setFormData((prev) => ({
      ...getInitialFormData(newType),
      title: prev.title,
      deadline: prev.deadline,
    }));
  };

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    setFormData((prev) => ({
      ...getInitialFormData(newType),
      title: prev.title,
      deadline: prev.deadline,
    }));
  };

  const applyMilestonePreset = (preset) => {
    setFormData((prev) => ({
      ...prev,
      title: prev.title || preset.label,
      cardioManual: false,
      activityType: preset.activityType,
      metric: preset.metric,
      goalStyle: GOAL_STYLES.MILESTONE,
      dailyTrackOver: "",
      target: String(preset.target),
    }));
  };

  const getAutoDailyTargetDaysForDisplay = (trackOver) => {
    if (trackOver === DAILY_TRACK_OVER.MONTH) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    }
    return 7;
  };

  const handleGoalStyleChange = (e) => {
    const newStyle = e.target.value;
    setFormData((prev) => {
      const nextTrackOver = newStyle === GOAL_STYLES.DAILY ? prev.dailyTrackOver || DAILY_TRACK_OVER.WEEK : "";
      const autoTarget =
        newStyle === GOAL_STYLES.DAILY && nextTrackOver !== DAILY_TRACK_OVER.LIFETIME;
      return {
        ...prev,
        goalStyle: newStyle,
        dailyTrackOver: nextTrackOver,
        metric: newStyle === GOAL_STYLES.NEXT_SESSION && prev.metric === CARDIO_SESSION_METRIC ? "" : prev.metric,
        target: autoTarget ? String(getAutoDailyTargetDaysForDisplay(nextTrackOver)) : prev.target,
      };
    });
  };

  const handleDailyTrackOverChange = (e) => {
    const newTrackOver = e.target.value;
    setFormData((prev) => ({
      ...prev,
      dailyTrackOver: newTrackOver,
      target:
        newTrackOver === DAILY_TRACK_OVER.LIFETIME
          ? prev.target
          : String(getAutoDailyTargetDaysForDisplay(newTrackOver)),
    }));
  };

  const buildPayload = () => {
    let unit;
    if (formData.type === "Strength PR") unit = formData.weightUnit;
    else if (isCardioAutoConfigured) {
      unit = CARDIO_GOAL_METRIC_UNITS[formData.metric] || formData.cardioUnit;
    } else if (formData.type === "Cardio Goal") unit = formData.cardioUnit;
    else unit = FIXED_UNIT[formData.type];

    const payload = {
      title: formData.title,
      type: formData.type,
      target: formData.target,
      unit,
      deadline: formData.deadline || null,
    };

    if (formData.type === "Strength PR") {
      payload.exercise = formData.exercise;
    }

    if (isCardioAutoConfigured) {
      payload.activityType = formData.activityType;
      payload.metric = formData.metric;
      payload.period = composePeriod(formData.goalStyle, formData.dailyTrackOver);
      if (formData.goalStyle === GOAL_STYLES.DAILY) {
        payload.dailyTarget = formData.dailyTarget;
      }
    }

    if (isManual && formData.current !== "") {
      payload.current = formData.current;
    }

    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setModalError("");

    if (formData.type === "Strength PR" && !formData.exercise) {
      setModalError("Please select an exercise for a Strength PR goal");
      return;
    }

    if (
      isCardioAutoConfigured &&
      (!formData.activityType || !formData.metric || !formData.goalStyle)
    ) {
      setModalError("Please select an activity, metric, and goal style for an auto-tracked Cardio Goal");
      return;
    }

    if (isCardioAutoConfigured && formData.goalStyle === GOAL_STYLES.DAILY) {
      if (!formData.dailyTrackOver) {
        setModalError("Please select what to track the daily goal over (Week, Month, or Lifetime)");
        return;
      }
      if (!formData.dailyTarget || Number(formData.dailyTarget) <= 0) {
        setModalError("Please enter a daily target greater than 0");
        return;
      }
    }

    const payload = buildPayload();

    setSaving(true);
    try {
      if (editingGoal) {
        const res = await updateGoal(editingGoal._id, payload);

        setGoals((prev) =>
          prev.map((g) => (g._id === editingGoal._id ? res.data : g))
        );

        setEditingGoal(null);
      } else {
        const res = await createGoal(payload);

        setGoals((prev) => [
          res.data,
          ...prev,
        ]);
      }

      setFormData(getInitialFormData(DEFAULT_TYPE));
      setSelectedCategory(DEFAULT_CATEGORY_KEY);

      setShowModal(false);
    } catch (error) {
      console.log(error);
      setModalError(error.response?.data?.message || "Failed to save goal");
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter("All");
    setSortKey(DEFAULT_SORT_KEY);
  };

  return (
    <div className="goals-page">
      <main className="goals-main">
        {loadError && (
          <LoadErrorBanner
            message="Couldn't load your goals. Check your connection and try again."
            onRetry={fetchGoals}
          />
        )}

        <section className="goals-header">
          <div>
            <h1 className="goals-header__title">Fitness Goals</h1>
            <p className="goals-header__sub">Track your progress and stay accountable.</p>
          </div>
          <button className="cta-btn" onClick={handleAddGoal}>
            <Plus size={16} strokeWidth={2.5} />
            Add Goal
          </button>
        </section>

        {!loading && goals.length > 0 && <GoalStatsHeader stats={goalStats} />}

        {!loading && goals.length > 0 && (
          <div className="goal-filters-bar">
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "All" ? "All Statuses" : s}
                </option>
              ))}
            </select>

            <select
              aria-label="Sort goals"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>

            {isFilterOrSortActive && (
              <button type="button" className="goal-filters-clear-btn" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <p className="goals-empty__sub">Loading goals...</p>
        ) : goals.length === 0 ? (
          <EmptyState onAdd={handleAddGoal} />
        ) : isFilterOrSortActive ? (
          filteredSortedEntries.length === 0 ? (
            <FilteredEmptyState onClear={clearFilters} />
          ) : (
            <section className="section">
              <p className="section__label">Goals ({filteredSortedEntries.length})</p>
              <div className="goals-grid">
                {filteredSortedEntries.map(({ goal, analytics }) => (
                  <GoalCard
                    key={goal._id}
                    goal={goal}
                    analytics={analytics}
                    hasReminder={goalReminderIds.has(goal._id)}
                    cardRef={(el) => { goalCardRefs.current[goal._id] = el; }}
                    isHighlighted={highlightedGoalId === goal._id}
                    onEdit={handleEditGoal}
                    onDelete={handleDeleteGoal}
                  />
                ))}
              </div>
            </section>
          )
        ) : (
          categorizedGoals.map((cat) => (
            <GoalCategorySection
              key={cat.key}
              label={cat.label}
              goals={cat.goals}
              analyticsById={analyticsById}
              goalReminderIds={goalReminderIds}
              onEdit={handleEditGoal}
              onDelete={handleDeleteGoal}
              cardRef={(id, el) => { goalCardRefs.current[id] = el; }}
              highlightedGoalId={highlightedGoalId}
            />
          ))
        )}

      </main>

      {showModal && (
        <div className="goal-modal-overlay">
          <div className="goal-modal" role="dialog" aria-modal="true" aria-labelledby="goal-modal-title">
            <h2 id="goal-modal-title">{editingGoal ? "Edit Goal" : "Create Goal"}</h2>
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                name="title"
                placeholder="Goal Title"
                value={formData.title}
                onChange={handleChange}
                required
              />

              <select
                name="category"
                value={selectedCategory}
                onChange={handleCategoryChange}
              >
                {SELECTABLE_CATEGORIES.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {cat.shortLabel}
                  </option>
                ))}
              </select>

              <select
                name="type"
                value={formData.type}
                onChange={handleTypeChange}
              >
                {availableTypes.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>

              {formData.type === "Strength PR" && (
                <select
                  name="exercise"
                  value={formData.exercise}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select Exercise</option>
                  {uniqueExercises.map((ex) => (
                    <option key={ex._id} value={ex._id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              )}

              {targetIsAutoComputed ? (
                <p className="goal-field-hint">
                  Target is automatically set to {formData.target} days — the number of days in
                  the selected {formData.dailyTrackOver === DAILY_TRACK_OVER.MONTH ? "month" : "week"}.
                </p>
              ) : (
                <input
                  type="number"
                  name="target"
                  placeholder={
                    isCardioAutoConfigured && formData.goalStyle === GOAL_STYLES.DAILY
                      ? "Target Streak (days)"
                      : isCardioAutoConfigured && formData.metric
                      ? `Target (${CARDIO_GOAL_METRIC_UNITS[formData.metric] || ""})`
                      : TARGET_LABEL[formData.type] || "Target"
                  }
                  value={formData.target}
                  onChange={handleChange}
                  required
                />
              )}

              {formData.type === "Strength PR" && (
                <select
                  name="weightUnit"
                  value={formData.weightUnit}
                  onChange={handleChange}
                >
                  {WEIGHT_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              )}

              {formData.type === "Cardio Goal" && (
                <>
                  <label className="goal-field-label goal-field-label--checkbox">
                    <input
                      type="checkbox"
                      checked={formData.cardioManual}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, cardioManual: e.target.checked }))
                      }
                    />
                    Track manually instead of auto-calculating from logged cardio workouts
                  </label>

                  {formData.cardioManual ? (
                    <select name="cardioUnit" value={formData.cardioUnit} onChange={handleChange}>
                      {CARDIO_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select
                        name="activityType"
                        value={formData.activityType}
                        onChange={handleChange}
                        required
                      >
                        <option value="">Select Activity</option>
                        {CARDIO_ACTIVITY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>

                      <select name="metric" value={formData.metric} onChange={handleChange} required>
                        <option value="">Select Metric</option>
                        {CARDIO_GOAL_METRICS.filter(
                          (m) =>
                            !(formData.goalStyle === GOAL_STYLES.NEXT_SESSION && m === CARDIO_SESSION_METRIC)
                        ).map((m) => (
                          <option key={m} value={m}>
                            {CARDIO_GOAL_METRIC_LABELS[m]}
                          </option>
                        ))}
                      </select>

                      <select
                        name="goalStyle"
                        value={formData.goalStyle}
                        onChange={handleGoalStyleChange}
                        required
                      >
                        <option value="">Select Goal Style</option>
                        {GOAL_STYLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {formData.goalStyle === GOAL_STYLES.DAILY && (
                        <>
                          <select
                            name="dailyTrackOver"
                            value={formData.dailyTrackOver}
                            onChange={handleDailyTrackOverChange}
                            required
                          >
                            <option value="">Track over...</option>
                            {DAILY_TRACK_OVER_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            name="dailyTarget"
                            placeholder={
                              formData.metric
                                ? `Daily target (${CARDIO_GOAL_METRIC_UNITS[formData.metric] || ""}/day)`
                                : "Daily target"
                            }
                            value={formData.dailyTarget}
                            onChange={handleChange}
                            required
                          />
                        </>
                      )}

                      {formData.goalStyle === GOAL_STYLES.MILESTONE && (
                        <div className="goal-milestone-presets">
                          {CARDIO_MILESTONE_PRESETS.map((preset) => (
                            <button
                              type="button"
                              key={preset.label}
                              className="goal-milestone-preset-btn"
                              onClick={() => applyMilestonePreset(preset)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {isManual && (
                <input
                  type="number"
                  name="current"
                  placeholder={
                    formData.type === "Weight Goal"
                      ? "Current Weight (kg)"
                      : "Current Progress"
                  }
                  value={formData.current}
                  onChange={handleChange}
                />
              )}

              <label className="goal-field-label">
                Deadline (optional)
                <input
                  type="date"
                  name="deadline"
                  min={toDateInputValue(new Date())}
                  value={formData.deadline}
                  onChange={handleChange}
                />
              </label>

              {modalError && <p className="modal-error">{modalError}</p>}

              <div className="modal-buttons">
                <button
                  type="button"
                  className="modal-btn modal-btn--cancel"
                  onClick={closeGoalModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn modal-btn--submit"
                  disabled={saving}
                >
                  {saving ? "Saving..." : editingGoal ? "Update Goal" : "Create Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={goalPendingDelete !== null}
        title="Delete Goal?"
        body={goalPendingDelete ? `"${goalPendingDelete.title}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={handleConfirmDeleteGoal}
        onCancel={handleCancelDeleteGoal}
      />
    </div>
  );
}

export default Goals;