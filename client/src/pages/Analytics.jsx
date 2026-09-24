import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dumbbell,
  TrendingUp,
  Flame,
  Activity,
  ChevronRight,
  Rocket,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trophy,
  HeartPulse,
  Zap,
  Target,
  Award,
  Gauge,
} from "lucide-react";
import "./progression.css";
import "./analytics.css";

import { getWorkouts } from "../services/workoutService";
import { formatDate, dateKey } from "../utils/dateUtils";
import {
  buildSessionSummaries,
  computeMuscleBreakdown,
  isCardioEntry,
} from "../utils/workoutUtils";
import { computeRestAwareStreak, trainedDayKeys } from "../utils/activityStates";
import { prHistory, estimate1RM } from "../utils/strengthUtils";
import {
  summarizeMuscleGroupSplit,
  getTrainingBalance,
  getUpperLowerSplit,
  getStrengthCardioSplit,
} from "../intelligence/balanceEngine";
import { getMusclePlateaus } from "../intelligence/plateauEngine";
import { getFatigueLevel } from "../intelligence/fatigueEngine";
import { getDeloadRecommendation } from "../intelligence/deloadEngine";
import { getWeeklyGrade } from "../intelligence/weeklyGradeEngine";
import { getAllVolumeLandmarks } from "../intelligence/volumeLandmarkEngine";
import { getExerciseInsights } from "../intelligence/exerciseIntelligence";
import { getMusclePriorities } from "../intelligence/musclePriorityEngine";
import {
  cardioPrHistory,
  getAvailableCardioActivities,
  getCardioActivityProgression,
  getCardioOverview,
  getCardioDistribution,
  getCardioVariantDistribution,
  CARDIO_METRICS_REGISTRY,
  CARDIO_DEFAULT_METRIC,
  getCardioMetricDef,
} from "../progression/cardioProgressionEngine";
import CardioSessionChart from "../components/progression/CardioSessionChart";
import { getGoals } from "../services/goalService";
import MetricCard from "../components/progression/MetricCard";
import StatGroupCard from "../components/progression/StatGroupCard";
import { TrendBadge } from "../components/progression/TrendChart";
import BarTrendChart from "../components/progression/BarTrendChart";
import TimelineChart from "../components/progression/TimelineChart";
import InsightCard from "../components/progression/InsightCard";
import DistributionRow from "../components/progression/DistributionRow";
import PersonalRecordRow from "../components/progression/PersonalRecordRow";
import PanelEmptyState from "../components/progression/PanelEmptyState";
import TrainingHeatmap from "../components/progression/TrainingHeatmap";
import ConfidenceBadge from "../components/ConfidenceBadge";
import EvidenceBadge from "../components/EvidenceBadge";
import LoadErrorBanner from "../components/LoadErrorBanner";
import {
  TIME_RANGE_OPTIONS,
  DEFAULT_TIME_RANGE,
  getMetricDef,
  getAvailableMuscles,
  getOverallProgression,
  getExerciseProgression,
  getExerciseDistribution,
  getConsistency,
  buildProgressionSeries,
  buildRecordTimeline,
  describeTrend,
  filterWorkoutsByTimeRange,
  filterWorkoutsByMuscle,
  compareRecentPeriods,
  compareSessionHalves,
  projectMilestone,
  getInsights,
} from "../progression";

const CHART_GRANULARITY_OPTIONS = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

const ANALYTICS_TABS = [
  { key: "overview", label: "Overview" },
  { key: "strength", label: "Strength" },
  { key: "muscles", label: "Muscles" },
  { key: "cardio", label: "Cardio" },
  { key: "intelligence", label: "Training Intelligence" },
  { key: "records", label: "Personal Records" },
  { key: "advanced", label: "Advanced" },
];

function formatRelativeDays(days) {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

function pplBadge(pct) {
  if (pct >= 45) return { label: "Dominant Share", tone: "danger" };
  if (pct <= 10) return { label: "Low Share", tone: "warning" };
  return { label: "Balanced", tone: "balanced" };
}

function Analytics() {
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await getWorkouts(5000);
        if (!cancelled) setWorkouts(res.data);
      } catch (err) {
        console.error("Analytics fetch error:", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTrigger]);

  const allSessions = useMemo(() => buildSessionSummaries(workouts), [workouts]);
  const strengthSessions = useMemo(
    () => allSessions.filter((s) => s.stats.exerciseCount > 0),
    [allSessions]
  );
  const recordEvents = useMemo(() => prHistory(workouts), [workouts]);
  const cardioRecordEvents = useMemo(() => cardioPrHistory(workouts), [workouts]);

  const overall = useMemo(() => getOverallProgression(workouts), [workouts]);
  const availableMuscles = useMemo(() => getAvailableMuscles(workouts), [workouts]);
  const insightsData = useMemo(() => getInsights(workouts), [workouts]);
  const currentStreak = useMemo(() => computeRestAwareStreak(trainedDayKeys(workouts)), [workouts]);

  const consistency = useMemo(
    () => getConsistency(strengthSessions, overall.summary.firstWorkoutDate, overall.summary.latestWorkoutDate),
    [strengthSessions, overall]
  );

  const weeklySeries = useMemo(
    () => buildProgressionSeries(workouts, { granularity: "week" }),
    [workouts]
  );
  const weeklyAvgVolume = useMemo(() => {
    const trained = weeklySeries.filter((p) => p.hasData);
    if (!trained.length) return 0;
    return Math.round(trained.reduce((s, p) => s + p.volume, 0) / trained.length);
  }, [weeklySeries]);

  const avgSessionDuration = useMemo(() => {
    const withDuration = allSessions.filter((s) => s.sessionDuration != null);
    if (!withDuration.length) return null;
    return Math.round(withDuration.reduce((s, sess) => s + sess.sessionDuration, 0) / withDuration.length);
  }, [allSessions]);

  const recordsThisMonth = useMemo(() => {
    const now = new Date();
    return recordEvents.filter((ev) => {
      const d = new Date(ev.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [recordEvents]);

  const volumeVsLastPeriod = useMemo(
    () => compareRecentPeriods(overall.series, "volume", 4),
    [overall]
  );
  const strengthVsLastPeriod = useMemo(
    () => compareRecentPeriods(overall.series, "estOneRM", 4),
    [overall]
  );
  const consistencyVsLastPeriod = useMemo(
    () => compareRecentPeriods(overall.series, "frequency", 4),
    [overall]
  );
  const prRateVsLastPeriod = useMemo(
    () => compareRecentPeriods(overall.series, "prCount", 4),
    [overall]
  );

  const chronoSessions = useMemo(
    () =>
      [...allSessions]
        .filter((s) => s.stats.exerciseCount > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date)),
    [allSessions]
  );
  const sessionVolumes = useMemo(() => chronoSessions.map((s) => s.stats.volume), [chronoSessions]);
  const sessionBestEstOneRM = useMemo(
    () =>
      chronoSessions.map((s) => {
        let best = 0;
        s.workouts.forEach((w) => {
          if (isCardioEntry(w)) return;
          (w.workoutSets || []).forEach((set) => {
            const est = estimate1RM(set.weight, set.reps);
            if (est > best) best = est;
          });
        });
        return best;
      }),
    [chronoSessions]
  );
  const sessionGapsInverted = useMemo(
    () =>
      chronoSessions.slice(1).map((s, i) => -((new Date(s.date) - new Date(chronoSessions[i].date)) / 86400000)),
    [chronoSessions]
  );
  const sessionPrCounts = useMemo(() => {
    const countsByDay = new Map();
    recordEvents.forEach((ev) => {
      const key = dateKey(ev.date);
      countsByDay.set(key, (countsByDay.get(key) || 0) + 1);
    });
    return chronoSessions.map((s) => countsByDay.get(dateKey(s.date)) || 0);
  }, [chronoSessions, recordEvents]);

  const volumeTrend = volumeVsLastPeriod || compareSessionHalves(sessionVolumes, 7);
  const strengthTrend = strengthVsLastPeriod || compareSessionHalves(sessionBestEstOneRM, 7);
  const consistencyTrend = consistencyVsLastPeriod || compareSessionHalves(sessionGapsInverted, 6);
  const prRateTrend = prRateVsLastPeriod || compareSessionHalves(sessionPrCounts, 7);

  const verdictText = useMemo(() => {
    if (!volumeTrend) return "Log more workouts to unlock a month-over-month comparison.";
    if (volumeTrend.direction === "up") return "You trained harder than last month.";
    if (volumeTrend.direction === "down") return "Your training volume dipped compared to last month.";
    return "You're holding a steady pace compared to last month.";
  }, [volumeTrend]);

  const sessionsUntilProgressUnlocks = Math.max(0, 7 - chronoSessions.length);

  const muscleBreakdown = useMemo(() => computeMuscleBreakdown(workouts), [workouts]);
  const muscleBySets = useMemo(
    () => [...muscleBreakdown].sort((a, b) => b.sets - a.sets),
    [muscleBreakdown]
  );
  const leastTrainedMuscle = muscleBySets.length > 1 ? muscleBySets[muscleBySets.length - 1] : null;
  const lifetimePplPct = useMemo(
    () => summarizeMuscleGroupSplit(muscleBySets, { metric: "sets" }).pct,
    [muscleBySets]
  );

  const weeklyGrade = useMemo(() => getWeeklyGrade(workouts), [workouts]);
  const previousWeeklyGrade = useMemo(
    () => getWeeklyGrade(workouts, { now: new Date(Date.now() - 7 * 86400000) }),
    [workouts]
  );
  const weeklyGradeTrend = useMemo(() => {
    if (weeklyGrade.score == null || previousWeeklyGrade.score == null) return null;
    const changePct = weeklyGrade.score - previousWeeklyGrade.score;
    const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";
    return { direction, changePct };
  }, [weeklyGrade, previousWeeklyGrade]);

  const mostImprovedInsight = insightsData.available
    ? insightsData.insights.find((i) => i.key === "mostImprovedMuscle")
    : null;

  const [chartGranularity, setChartGranularity] = useState("week");
  const chartSeries = useMemo(
    () => buildProgressionSeries(workouts, { granularity: chartGranularity }),
    [workouts, chartGranularity]
  );
  const chartVolumeTrend = useMemo(() => describeTrend(chartSeries, "volume"), [chartSeries]);
  const chartFrequencyTrend = useMemo(() => describeTrend(chartSeries, "frequency"), [chartSeries]);

  const [overviewRange, setOverviewRange] = useState(DEFAULT_TIME_RANGE);
  const overviewWorkouts = useMemo(
    () => filterWorkoutsByTimeRange(workouts, overviewRange),
    [workouts, overviewRange]
  );
  const overviewMuscleBreakdown = useMemo(
    () => computeMuscleBreakdown(overviewWorkouts),
    [overviewWorkouts]
  );
  const overviewMuscleBySets = useMemo(
    () => [...overviewMuscleBreakdown].sort((a, b) => b.sets - a.sets),
    [overviewMuscleBreakdown]
  );
  const overviewTotalMuscleSets = useMemo(
    () => overviewMuscleBySets.reduce((s, m) => s + m.sets, 0) || 1,
    [overviewMuscleBySets]
  );
  const overviewPplPct = useMemo(
    () => summarizeMuscleGroupSplit(overviewMuscleBySets, { metric: "sets" }).pct,
    [overviewMuscleBySets]
  );
  const topMuscles = overviewMuscleBySets.slice(0, 2);
  const neglectedMuscles = overviewMuscleBySets.length > 4 ? overviewMuscleBySets.slice(-2).reverse() : [];

  const [expandedBreakdownMuscle, setExpandedBreakdownMuscle] = useState(null);
  const expandedBreakdownExercises = useMemo(() => {
    if (!expandedBreakdownMuscle) return [];
    return getExerciseDistribution(filterWorkoutsByMuscle(overviewWorkouts, expandedBreakdownMuscle));
  }, [expandedBreakdownMuscle, overviewWorkouts]);

  const [exerciseMuscleFilter, setExerciseMuscleFilter] = useState("");
  useEffect(() => {
    if (!exerciseMuscleFilter && overviewMuscleBySets.length) {
      setExerciseMuscleFilter(overviewMuscleBySets[0].muscle);
    }
  }, [overviewMuscleBySets, exerciseMuscleFilter]);
  const exerciseDistribution = useMemo(
    () => getExerciseDistribution(filterWorkoutsByMuscle(overviewWorkouts, exerciseMuscleFilter)),
    [overviewWorkouts, exerciseMuscleFilter]
  );

  const [advancedRange, setAdvancedRange] = useState(DEFAULT_TIME_RANGE);
  const [activeTab, setActiveTab] = useState("overview");
  const advancedWorkouts = useMemo(
    () => filterWorkoutsByTimeRange(workouts, advancedRange),
    [workouts, advancedRange]
  );
  const advancedMuscleBreakdown = useMemo(
    () => computeMuscleBreakdown(advancedWorkouts),
    [advancedWorkouts]
  );
  const muscleByVolume = useMemo(() => {
    const total = advancedMuscleBreakdown.reduce((s, m) => s + m.volume, 0) || 1;
    return [...advancedMuscleBreakdown]
      .sort((a, b) => b.volume - a.volume)
      .map((m) => ({ ...m, volumePct: (m.volume / total) * 100 }));
  }, [advancedMuscleBreakdown]);

  const advancedExerciseDistribution = useMemo(
    () => getExerciseDistribution(advancedWorkouts),
    [advancedWorkouts]
  );
  const exerciseByVolume = useMemo(() => {
    const total = advancedExerciseDistribution.reduce((s, e) => s + e.volume, 0) || 1;
    return [...advancedExerciseDistribution]
      .sort((a, b) => b.volume - a.volume)
      .map((e) => ({ ...e, volumePct: (e.volume / total) * 100 }));
  }, [advancedExerciseDistribution]);

  const [intelligenceExercise, setIntelligenceExercise] = useState("");

  useEffect(() => {
    if (!intelligenceExercise && advancedExerciseDistribution.length) {
      setIntelligenceExercise(advancedExerciseDistribution[0].exercise);
    }
  }, [advancedExerciseDistribution, intelligenceExercise]);

  const [cardioRange, setCardioRange] = useState(DEFAULT_TIME_RANGE);
  const availableCardioActivities = useMemo(() => getAvailableCardioActivities(workouts), [workouts]);
  const [selectedCardioActivity, setSelectedCardioActivity] = useState("");

  useEffect(() => {
    if (!selectedCardioActivity && availableCardioActivities.length) {
      setSelectedCardioActivity(availableCardioActivities[0]);
    }
  }, [availableCardioActivities, selectedCardioActivity]);

  const [cardioMetric, setCardioMetric] = useState(CARDIO_DEFAULT_METRIC);
  const cardioMetricDef = getCardioMetricDef(cardioMetric);

  const cardioActivityProgression = useMemo(
    () =>
      selectedCardioActivity
        ? getCardioActivityProgression(workouts, selectedCardioActivity, { rangeKey: cardioRange })
        : { series: [], stats: null, prEvents: [] },
    [workouts, selectedCardioActivity, cardioRange]
  );

  const cardioWeekOverview = useMemo(() => getCardioOverview(workouts, { period: "week" }), [workouts]);
  const cardioMonthOverview = useMemo(() => getCardioOverview(workouts, { period: "month" }), [workouts]);
  const cardioDistribution = useMemo(() => getCardioDistribution(workouts), [workouts]);
  const cardioVariantDistribution = useMemo(
    () => (selectedCardioActivity ? getCardioVariantDistribution(workouts, selectedCardioActivity) : []),
    [workouts, selectedCardioActivity]
  );

  const cardioSessionsOnly = useMemo(
    () => allSessions.filter((s) => s.stats.cardioCount > 0),
    [allSessions]
  );
  const cardioConsistency = useMemo(() => {
    if (!cardioSessionsOnly.length) return getConsistency(cardioSessionsOnly, null, null);
    const times = cardioSessionsOnly.map((s) => new Date(s.date).getTime());
    return getConsistency(cardioSessionsOnly, new Date(Math.min(...times)), new Date(Math.max(...times)));
  }, [cardioSessionsOnly]);

  const [goals, setGoals] = useState([]);
  useEffect(() => {
    getGoals()
      .then((res) => setGoals(res.data))
      .catch((err) => console.log(err));
  }, []);
  const cardioGoalCompletionRate = useMemo(() => {
    const cardioGoals = goals.filter((g) => g.type === "Cardio Goal");
    if (!cardioGoals.length) return null;
    const completed = cardioGoals.filter((g) => g.status === "Completed").length;
    return Math.round((completed / cardioGoals.length) * 100);
  }, [goals]);

  const hasCardioData = cardioWeekOverview.hasCardioData;

  const strengthLeaderboard = useMemo(() => {
    const withTrend = exerciseByVolume.slice(0, 8).map((e) => ({
      exercise: e.exercise,
      progression: getExerciseProgression(workouts, e.exercise, { rangeKey: advancedRange }),
    }));
    return withTrend
      .sort((a, b) => {
        const av = a.progression.trend.estOneRM?.changePct ?? -Infinity;
        const bv = b.progression.trend.estOneRM?.changePct ?? -Infinity;
        return bv - av;
      })
      .slice(0, 5);
  }, [exerciseByVolume, workouts, advancedRange]);

  const topProjectedMilestone = useMemo(() => {
    const projections = exerciseByVolume
      .slice(0, 8)
      .map((e) => ({
        exercise: e.exercise,
        projection: projectMilestone(getExerciseProgression(workouts, e.exercise).series, "estOneRM"),
      }))
      .filter((e) => e.projection);
    if (!projections.length) return null;
    return projections.sort((a, b) => a.projection.daysAhead - b.projection.daysAhead)[0];
  }, [exerciseByVolume, workouts]);

  const plateauedMuscles = useMemo(
    () => getMusclePlateaus(workouts, availableMuscles, { rangeKey: advancedRange }),
    [workouts, availableMuscles, advancedRange]
  );

  const fatigueLevel = useMemo(() => getFatigueLevel(workouts), [workouts]);
  const deloadRecommendation = useMemo(() => getDeloadRecommendation(workouts), [workouts]);
  const trainingBalanceReport = useMemo(() => getTrainingBalance(workouts), [workouts]);
  const upperLowerSplit = useMemo(() => getUpperLowerSplit(workouts), [workouts]);
  const strengthCardioSplitReport = useMemo(() => getStrengthCardioSplit(workouts), [workouts]);
  const volumeLandmarks = useMemo(
    () =>
      getAllVolumeLandmarks(workouts, availableMuscles, { rangeKey: advancedRange }).filter(
        (l) => l.available
      ),
    [workouts, availableMuscles, advancedRange]
  );
  const musclePriorities = useMemo(() => getMusclePriorities(workouts), [workouts]);

  const exerciseIntelligence = useMemo(
    () =>
      intelligenceExercise
        ? getExerciseInsights(workouts, intelligenceExercise, { rangeKey: advancedRange })
        : null,
    [workouts, intelligenceExercise, advancedRange]
  );

  const personalRecordsLatest = useMemo(() => {
    const latestByExercise = new Map();
    recordEvents.forEach((ev) => latestByExercise.set(ev.exercise, ev));
    return Array.from(latestByExercise.values()).sort((a, b) => b.weight - a.weight);
  }, [recordEvents]);

  const personalCardioRecordsLatest = useMemo(() => {
    const latestByActivity = new Map();
    cardioRecordEvents.forEach((ev) => latestByActivity.set(ev.activityType, { ...ev, isCardio: true }));
    return Array.from(latestByActivity.values());
  }, [cardioRecordEvents]);

  const currentRecordsByMuscle = useMemo(() => {
    const groups = new Map();
    personalRecordsLatest.forEach((r) => {
      const muscle = r.muscle || "Other";
      if (!groups.has(muscle)) groups.set(muscle, []);
      groups.get(muscle).push(r);
    });
    const strengthGroups = Array.from(groups.entries())
      .map(([muscle, records]) => ({ muscle, records }))
      .sort((a, b) => b.records[0].weight - a.records[0].weight);

    return personalCardioRecordsLatest.length
      ? [...strengthGroups, { muscle: "Cardio", records: personalCardioRecordsLatest }]
      : strengthGroups;
  }, [personalRecordsLatest, personalCardioRecordsLatest]);

  const [prSearch, setPrSearch] = useState("");
  const filteredCurrentRecordsByMuscle = useMemo(() => {
    const term = prSearch.trim().toLowerCase();
    if (!term) return currentRecordsByMuscle;
    return currentRecordsByMuscle
      .map(({ muscle, records }) => ({
        muscle,
        records: records.filter((r) =>
          (r.isCardio ? r.activityType : r.exercise).toLowerCase().includes(term)
        ),
      }))
      .filter(({ records }) => records.length > 0);
  }, [currentRecordsByMuscle, prSearch]);

  const recentRecords = useMemo(() => {
    const cardioEvents = cardioRecordEvents.map((ev) => ({ ...ev, isCardio: true }));
    const merged = [...recordEvents, ...cardioEvents].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    return merged.reverse().slice(0, 10);
  }, [recordEvents, cardioRecordEvents]);
  const recordTimeline = useMemo(() => buildRecordTimeline(workouts), [workouts]);
  const mostRecentPr = recordEvents.length ? recordEvents[recordEvents.length - 1] : null;

  const latestPrPrevious = useMemo(() => {
    if (!mostRecentPr) return null;
    for (let i = recordEvents.length - 2; i >= 0; i--) {
      if (recordEvents[i].exercise === mostRecentPr.exercise) return recordEvents[i];
    }
    return null;
  }, [recordEvents, mostRecentPr]);

  const heaviestLiftEver = personalRecordsLatest.length
    ? [...personalRecordsLatest].sort((a, b) => b.weight - a.weight)[0]
    : null;

  const isLifetimePr =
    !!mostRecentPr && !!heaviestLiftEver && heaviestLiftEver.exercise === mostRecentPr.exercise;

  const improvedInsight = insightsData.available
    ? insightsData.insights.find((i) => i.key === "mostImprovedMuscle")
    : null;
  const fastestInsight = insightsData.available
    ? insightsData.insights.find((i) => i.key === "fastestImprovingExercise")
    : null;
  const consistencyInsight = insightsData.available
    ? insightsData.insights.find((i) => i.key === "highestConsistency")
    : null;
  const imbalanceInsight = insightsData.available
    ? insightsData.insights.find((i) => i.key === "trainingImbalance")
    : null;

  const biggestWinInsight = useMemo(() => {
    const candidates = [improvedInsight, fastestInsight].filter((i) => i?.available);
    if (!candidates.length) return null;
    return candidates.reduce((best, c) => (!best || c.changePct > best.changePct ? c : best), null);
  }, [improvedInsight, fastestInsight]);

  const attentionInsight = imbalanceInsight?.available && !imbalanceInsight.balanced ? imbalanceInsight : null;

  const remainingInsights = useMemo(() => {
    if (!insightsData.available) return [];
    const featuredKeys = new Set(
      [biggestWinInsight?.key, attentionInsight?.key, consistencyInsight?.key].filter(Boolean)
    );
    return insightsData.insights.filter((i) => !featuredKeys.has(i.key));
  }, [insightsData, biggestWinInsight, attentionInsight, consistencyInsight]);

  if (loading) {
    return (
      <div className="progression-page analytics-page">
        <main className="progression-main">
          <div className="progression-empty-page">
            <div className="progression-empty-page__icon">
              <Activity size={28} strokeWidth={1.6} />
            </div>
            <h1>Progress Analytics</h1>
            <p>Crunching your training history...</p>
          </div>
        </main>
      </div>
    );
  }

  if (workouts.length === 0) {
    return (
      <div className="progression-page analytics-page">
        <main className="progression-main">
          <div className="progression-empty-page">
            <div className="progression-empty-page__icon">
              <Activity size={28} strokeWidth={1.6} />
            </div>
            <h1>Progress Analytics</h1>
            <p>Log a few workouts and your complete training story will show up here.</p>
            <button type="button" className="progression-empty-page__btn" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="progression-page analytics-page">
      <main className="progression-main">
        {loadError && (
          <LoadErrorBanner
            message="Couldn't load your analytics. Check your connection and try again."
            onRetry={() => setRetryTrigger((t) => t + 1)}
          />
        )}

        <section className="progression-hero analytics-hero--split">
          <div className="analytics-hero__top">
            <div>
              <span className="progression-hero__eyebrow">
                <span className="progression-hero__dot" />
                Analytics
                {currentStreak >= 3 && (
                  <span className="analytics-celebrate-badge analytics-celebrate-badge--inline">
                    🔥 {currentStreak} day streak
                  </span>
                )}
              </span>
              <h1 className="progression-hero__title">Your Training Summary</h1>
              <p className="progression-hero__sub">{verdictText}</p>
            </div>

            <div className="analytics-score">
              <span className="analytics-score__label">
                Repvyn Training Score
                <EvidenceBadge
                  strength={weeklyGrade.evidenceStrength}
                  explanation={weeklyGrade.evidenceDisclaimer}
                  metricKey="weeklyGrade"
                />
              </span>
              {weeklyGrade.score != null ? (
                <>
                  <span className="analytics-score__value">{weeklyGrade.score}</span>
                  <span className="analytics-score__tag">{weeklyGrade.grade}</span>
                  <ConfidenceBadge level={weeklyGrade.confidence} reason={weeklyGrade.confidenceReason} label="Data confidence" />
                  {weeklyGradeTrend && (
                    <div className="analytics-score__trend">
                      <TrendBadge trend={weeklyGradeTrend} />
                      <span>vs last week</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span className="analytics-score__value analytics-score__value--empty">—</span>
                  <span className="analytics-score__tag analytics-score__tag--muted">
                    Log more workouts to unlock this
                  </span>
                </>
              )}
              <p className="analytics-score__formula">
                From consistency, progressive overload, muscle balance &amp; PR frequency — a Repvyn heuristic, not a
                validated training-quality measurement
              </p>
            </div>

            <div className="analytics-score-breakdown">
              <p className="analytics-score-breakdown__title">The maths behind your Repvyn score</p>
              <div className="analytics-score-breakdown__list">
                {weeklyGrade.factors.map((part) => (
                  <div className="analytics-score-breakdown__row" key={part.key}>
                    <div className="analytics-score-breakdown__row-head">
                      <span className="analytics-score-breakdown__row-label">{part.label}</span>
                      <span className="analytics-score-breakdown__row-value">
                        {part.value != null ? Math.round(part.value) : "—"}
                      </span>
                    </div>
                    <div className="analytics-score-breakdown__bar">
                      <div
                        className="analytics-score-breakdown__bar-fill"
                        style={{ width: `${part.value != null ? part.value : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="analytics-hero__progress analytics-hero__progress--standalone">
          <p className="progression-panel__label">Overall Progress</p>
          <div className="analytics-progress-grid">
            {[
              { label: "Strength", basis: "Estimated 1RM, recent vs. prior sessions", trend: strengthTrend },
              { label: "Volume", basis: "Total kg lifted, recent vs. prior sessions", trend: volumeTrend },
              {
                label: "Consistency",
                basis: "Days between sessions, recent vs. prior",
                trend: consistencyTrend,
              },
              { label: "PR Rate", basis: "New records set, recent vs. prior sessions", trend: prRateTrend },
            ].map(({ label, basis, trend }) => (
              <div className="analytics-progress-tile" key={label}>
                <span className="analytics-progress-tile__label">{label}</span>
                <span className="analytics-progress-tile__basis">{basis}</span>
                {trend ? (
                  <div className="analytics-progress-tile__trend-row">
                    <TrendBadge trend={trend} />
                    {trend.direction === "up" && trend.changePct >= 50 && (
                      <span className="analytics-celebrate-badge analytics-celebrate-badge--inline">⬆ Big jump</span>
                    )}
                  </div>
                ) : (
                  <div className="analytics-progress-tile__na">
                    <span className="analytics-progress-tile__na-dash">—</span>
                    <span className="analytics-progress-tile__na-caption">
                      {sessionsUntilProgressUnlocks > 0
                        ? `Available after ${sessionsUntilProgressUnlocks} more session${
                            sessionsUntilProgressUnlocks === 1 ? "" : "s"
                          }`
                        : "Waiting for enough data"}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <div className="analytics-tabs" role="tablist" aria-label="Analytics sections">
          {ANALYTICS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`analytics-tab ${activeTab === tab.key ? "analytics-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
        <>
        <div className="analytics-hero__grid">
          <StatGroupCard
            title="Training"
            icon={Dumbbell}
            rows={[
              { label: "Sessions", value: allSessions.length },
              {
                label: "Consistency",
                value: consistency ? `${consistency.percent}%` : "—",
              },
              { label: "Current streak", value: `${currentStreak} day${currentStreak === 1 ? "" : "s"}` },
              {
                label: "Avg duration",
                value: avgSessionDuration != null ? `${avgSessionDuration} min` : "—",
              },
            ]}
          />
          <StatGroupCard
            title="Strength"
            icon={TrendingUp}
            rows={[
              {
                label: "Volume lifted",
                value: `${overall.summary.totalVolume.toLocaleString()} kg`,
                trend: overall.trend.volume,
              },
              { label: "Total PRs", value: recordEvents.length },
              { label: "PRs this month", value: recordsThisMonth },
              { label: "Weekly avg volume", value: `${weeklyAvgVolume.toLocaleString()} kg` },
            ]}
          />
          <StatGroupCard
            title="Training Balance"
            icon={Activity}
            rows={[
              { label: "Most trained", value: muscleBySets[0]?.muscle || "—" },
              { label: "Least trained", value: leastTrainedMuscle?.muscle || "—" },
              { label: "Push / Pull", value: `${lifetimePplPct.Push}% / ${lifetimePplPct.Pull}%` },
              {
                label: "Most improved",
                value: mostImprovedInsight?.available ? mostImprovedInsight.value : "Log more workouts to unlock this",
              },
            ]}
          />
        </div>

        <section className="analytics-section">
          <p className="analytics-section__label">Training Activity</p>
          <div className="progression-panel">
            <TrainingHeatmap sessions={allSessions} />
          </div>
        </section>

        <section className="analytics-section">
          <p className="analytics-section__label">Insights</p>
          {!insightsData.available ? (
            <div className="progression-panel">
              <PanelEmptyState icon={Sparkles} message={insightsData.reason} />
            </div>
          ) : (
            <>
              <div className="analytics-featured-insights">
                {attentionInsight && (
                  <div className="analytics-featured-insight analytics-featured-insight--warning analytics-featured-insight--large">
                    <div className="analytics-featured-insight__icon">
                      <AlertTriangle size={18} strokeWidth={2} />
                    </div>
                    <div>
                      <p className="analytics-featured-insight__label">Attention</p>
                      <p className="analytics-featured-insight__value">{attentionInsight.value}</p>
                      <p className="analytics-featured-insight__detail">{attentionInsight.detail}</p>
                    </div>
                  </div>
                )}
                <div className="analytics-featured-insights__row">
                  {biggestWinInsight && (
                    <div className="analytics-featured-insight analytics-featured-insight--win">
                      <div className="analytics-featured-insight__icon">
                        <Sparkles size={16} strokeWidth={2} />
                      </div>
                      <div>
                        <p className="analytics-featured-insight__label">Biggest Win</p>
                        <p className="analytics-featured-insight__value">{biggestWinInsight.value}</p>
                        <p className="analytics-featured-insight__detail">{biggestWinInsight.detail}</p>
                      </div>
                    </div>
                  )}
                  {consistencyInsight?.available && (
                    <div className="analytics-featured-insight analytics-featured-insight--neutral">
                      <div className="analytics-featured-insight__icon">
                        <Flame size={16} strokeWidth={2} />
                      </div>
                      <div>
                        <p className="analytics-featured-insight__label">Consistency</p>
                        <p className="analytics-featured-insight__value">{consistencyInsight.value}</p>
                        <p className="analytics-featured-insight__detail">{consistencyInsight.detail}</p>
                      </div>
                    </div>
                  )}
                </div>
                {!biggestWinInsight && !attentionInsight && !consistencyInsight?.available && (
                  <p className="prog-exdist__hint">Log more sessions to unlock featured insights.</p>
                )}
              </div>

              {remainingInsights.length > 0 && (
                <div className="progression-insights-grid analytics-insights-secondary">
                  {remainingInsights.map((insight) => (
                    <InsightCard key={insight.key} insight={insight} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        </>
        )}

        {activeTab === "strength" && (
        <>
        <section className="analytics-section">
          <p className="analytics-section__label">Strength Overview</p>

          <div className="analytics-panels-grid-2">
            <BarTrendChart
              title="Volume Trend"
              subtitle={`Training volume per ${chartGranularity}`}
              series={chartSeries}
              metricKey="volume"
              metricDef={getMetricDef("volume")}
              trend={chartVolumeTrend}
              height={220}
              emptyTitle="No volume logged yet"
              emptyMessage="Log a few sessions to see your volume trend."
            />
            <BarTrendChart
              title="Session Frequency"
              subtitle={`Sessions logged per ${chartGranularity}`}
              series={chartSeries}
              metricKey="frequency"
              metricDef={getMetricDef("frequency")}
              trend={chartFrequencyTrend}
              height={220}
              emptyTitle="No sessions logged yet"
              emptyMessage="Log a few sessions to see your frequency trend."
            />
          </div>

          <div className="analytics-chart-chips">
            {CHART_GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`analytics-chip ${chartGranularity === opt.key ? "analytics-chip--active" : ""}`}
                onClick={() => setChartGranularity(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="analytics-section">
          <div className="analytics-section__head">
            <p className="analytics-section__label">What's Getting Stronger</p>
            <select
              className="progression-filterbar__select"
              value={advancedRange}
              onChange={(e) => setAdvancedRange(e.target.value)}
              aria-label="Select time range for strength leaderboard"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="progression-panel">
            {strengthLeaderboard.length === 0 ? (
              <PanelEmptyState icon={Flame} message="Log a few exercises to see performance trends." />
            ) : (
              <div className="progression-stats-rail">
                {strengthLeaderboard.map((e) => (
                  <MetricCard
                    key={e.exercise}
                    label={e.exercise}
                    icon={Flame}
                    value={e.progression.stats.bestSet ? `${e.progression.stats.bestSet.estOneRM} kg` : "—"}
                    trend={e.progression.trend.estOneRM}
                    sub={!e.progression.trend.estOneRM ? "Log more workouts to unlock this" : null}
                  />
                ))}
              </div>
            )}
          </div>

          {topProjectedMilestone && (
            <div className="progression-panel">
              <p className="progression-panel__label">Projected Milestone</p>
              <div className="analytics-projection-row">
                <div className="analytics-projection-row__icon">
                  <Rocket size={14} strokeWidth={2} />
                </div>
                <div className="analytics-projection-row__body">
                  <p className="analytics-projection-row__title">
                    You're on track for {topProjectedMilestone.exercise} {topProjectedMilestone.projection.target} kg
                  </p>
                  <p className="analytics-projection-row__detail">
                    Estimated in ~{formatRelativeDays(topProjectedMilestone.projection.daysAhead)}, based on your
                    recent estimated-1RM trend — a projection, not a guarantee.
                  </p>
                </div>
              </div>
            </div>
          )}

          {plateauedMuscles.length > 0 && (
            <div className="progression-panel">
              <p className="progression-panel__label">Plateau Detection</p>
              <div className="analytics-plateau-list">
                {plateauedMuscles.map(({ muscle, trend }) => (
                  <div className="analytics-plateau-row" key={muscle}>
                    <div>
                      <p className="analytics-plateau-row__name">{muscle}</p>
                      <p className="analytics-plateau-row__detail">
                        {trend.direction === "flat"
                          ? "Volume has held steady — consider progressive overload."
                          : "Volume is trending down over its logged history."}
                      </p>
                    </div>
                    <TrendBadge trend={trend} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        </>
        )}

        {activeTab === "muscles" && (
        <>
        <section className="analytics-section">
          <div className="analytics-section__head">
            <p className="analytics-section__label">Muscle Balance</p>
            <select
              className="progression-filterbar__select"
              value={overviewRange}
              onChange={(e) => setOverviewRange(e.target.value)}
              aria-label="Select time range for Muscle Balance"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {overviewMuscleBySets.length === 0 ? (
            <div className="progression-panel">
              <PanelEmptyState message="No muscle groups logged in this range." />
            </div>
          ) : (
            <>
              <div className="progression-panel">
                <p className="progression-panel__label">Push / Pull / Legs / Core</p>
                <div className="prog-exdist">
                  {["Push", "Pull", "Legs", "Core"].map((cat) => (
                    <DistributionRow
                      key={cat}
                      label={cat}
                      sub={`${overviewPplPct[cat]}%`}
                      pct={overviewPplPct[cat]}
                      badge={pplBadge(overviewPplPct[cat])}
                    />
                  ))}
                </div>
              </div>

              <div className="analytics-panels-grid-2">
                <div className="progression-panel">
                  <p className="progression-panel__label">Top Muscles</p>
                  <div className="analytics-mini-cards">
                    {topMuscles.map((m) => (
                      <button
                        type="button"
                        key={m.muscle}
                        className="analytics-mini-card-btn"
                        onClick={() => navigate(`/progression?muscle=${encodeURIComponent(m.muscle)}`)}
                      >
                        <MetricCard label={m.muscle} value={`${m.sets} sets`} icon={Dumbbell} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="progression-panel">
                  <p className="progression-panel__label">Neglected Muscles</p>
                  {neglectedMuscles.length === 0 ? (
                    <p className="prog-exdist__hint">Nothing stands out as neglected in this range.</p>
                  ) : (
                    <div className="analytics-mini-cards">
                      {neglectedMuscles.map((m) => (
                        <button
                          type="button"
                          key={m.muscle}
                          className="analytics-mini-card-btn"
                          onClick={() => navigate(`/progression?muscle=${encodeURIComponent(m.muscle)}`)}
                        >
                          <MetricCard label={m.muscle} value={`${m.sets} sets`} icon={Activity} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="progression-panel">
                <p className="progression-panel__label">Detailed Breakdown</p>
                <p className="analytics-section__hint" style={{ marginTop: -4, marginBottom: 10 }}>
                  Click a muscle to see its exercises.
                </p>
                <div className="prog-exdist">
                  {overviewMuscleBySets.slice(0, 8).map((m) => (
                    <div key={m.muscle}>
                      <DistributionRow
                        label={m.muscle}
                        sub={`${m.sets} sets`}
                        pct={(m.sets / overviewTotalMuscleSets) * 100}
                        onSelect={() =>
                          setExpandedBreakdownMuscle((prev) => (prev === m.muscle ? null : m.muscle))
                        }
                      />
                      {expandedBreakdownMuscle === m.muscle && (
                        <div className="analytics-breakdown-exercises">
                          {expandedBreakdownExercises.length === 0 ? (
                            <p className="prog-exdist__hint">No exercises logged for {m.muscle} in this range.</p>
                          ) : (
                            expandedBreakdownExercises.map((e) => (
                              <button
                                type="button"
                                key={e.exercise}
                                className="analytics-breakdown-exercise"
                                onClick={() => navigate(`/progression?exercise=${encodeURIComponent(e.exercise)}`)}
                              >
                                <span>{e.exercise}</span>
                                <span className="analytics-breakdown-exercise__sets">
                                  {e.sets} sets <ChevronRight size={12} strokeWidth={2} />
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="analytics-section">
          <div className="analytics-section__head">
            <p className="prog-exdist__hint" style={{ margin: 0 }}>
              Time range for this section
            </p>
            <select
              className="progression-filterbar__select"
              value={advancedRange}
              onChange={(e) => setAdvancedRange(e.target.value)}
              aria-label="Select time range for exercise/muscle volume"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="analytics-section__head">
            <p className="prog-exdist__hint" style={{ margin: 0 }}>
              Muscle filter for Exercise Distribution
            </p>
            <select
              className="progression-filterbar__select"
              value={exerciseMuscleFilter}
              onChange={(e) => setExerciseMuscleFilter(e.target.value)}
              aria-label="Select muscle for Exercise Distribution"
            >
              {overviewMuscleBySets.map((m) => (
                <option key={m.muscle} value={m.muscle}>
                  {m.muscle}
                </option>
              ))}
            </select>
          </div>

          <div className="analytics-panels-grid-2">
            <div className="progression-panel">
              <p className="progression-panel__label">Exercise Distribution</p>
              {exerciseDistribution.length === 0 ? (
                <PanelEmptyState icon={Dumbbell} message="No exercises logged in this range." />
              ) : (
                <div className="prog-exdist">
                  {exerciseDistribution.slice(0, 8).map((e, i) => (
                    <DistributionRow
                      key={e.exercise}
                      rank={i + 1}
                      label={e.exercise}
                      sub={`${e.sets} sets`}
                      pct={e.pct}
                      onSelect={() => navigate(`/progression?exercise=${encodeURIComponent(e.exercise)}`)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="progression-panel">
              <p className="progression-panel__label">Volume per Muscle</p>
              {muscleByVolume.length === 0 ? (
                <PanelEmptyState message="No muscle groups logged yet." />
              ) : (
                <div className="prog-exdist">
                  {muscleByVolume.slice(0, 8).map((m) => (
                    <DistributionRow
                      key={m.muscle}
                      label={m.muscle}
                      sub={`${Math.round(m.volume).toLocaleString()} kg`}
                      pct={m.volumePct}
                      onSelect={() => navigate(`/progression?muscle=${encodeURIComponent(m.muscle)}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
        </>
        )}

        {activeTab === "cardio" && (
        <>
        {!hasCardioData ? (
          <section className="analytics-section">
            <div className="progression-panel">
              <PanelEmptyState icon={HeartPulse} message="No cardio logged yet — add a run, ride, or other activity from a workout session to see trends here." />
            </div>
          </section>
        ) : (
          <>
          <section className="analytics-section">
            <p className="analytics-section__label">Cardio Overview</p>
            <div className="progression-stats-rail">
              <MetricCard label="This Week" value={`${cardioWeekOverview.periodDistance} km`} sub={`${cardioWeekOverview.periodDuration} min · ${cardioWeekOverview.periodSessions} sessions`} icon={HeartPulse} />
              <MetricCard label="This Month" value={`${cardioMonthOverview.periodDistance} km`} sub={`${cardioMonthOverview.periodDuration} min · ${cardioMonthOverview.periodSessions} sessions`} icon={Activity} />
              <MetricCard label="Favorite Activity" value={cardioWeekOverview.favoriteActivity || "—"} icon={Flame} />
              <MetricCard
                label="Longest Activity"
                value={cardioWeekOverview.longestActivity ? `${cardioWeekOverview.longestActivity.duration} min` : "—"}
                sub={cardioWeekOverview.longestActivity?.activityType}
                icon={Award}
              />
              <MetricCard
                label="Fastest Pace"
                value={cardioWeekOverview.fastestPace ? `${cardioWeekOverview.fastestPace.pace} min/km` : "—"}
                sub={cardioWeekOverview.fastestPace?.activityType}
                icon={Zap}
              />
              <MetricCard label="Average Pace" value={cardioWeekOverview.avgPace ? `${cardioWeekOverview.avgPace} min/km` : "—"} icon={Gauge} />
              <MetricCard
                label="Weekly Consistency"
                value={cardioConsistency ? `${cardioConsistency.percent}%` : "—"}
                sub={cardioConsistency ? `${cardioConsistency.weeksTrained}/${cardioConsistency.totalWeeks} weeks` : "Not enough history yet"}
                icon={TrendingUp}
              />
              <MetricCard
                label="Goal Completion"
                value={cardioGoalCompletionRate != null ? `${cardioGoalCompletionRate}%` : "—"}
                sub={cardioGoalCompletionRate == null ? "No Cardio Goals yet" : null}
                icon={Target}
              />
            </div>
          </section>

          <section className="analytics-section">
            <div className="analytics-section__head analytics-section__head--wrap">
              <p className="analytics-section__label">Activity Trend</p>
              <div className="analytics-section__head-controls">
                <select
                  className="progression-filterbar__select"
                  value={selectedCardioActivity}
                  onChange={(e) => setSelectedCardioActivity(e.target.value)}
                  aria-label="Select cardio activity"
                >
                  {availableCardioActivities.map((activity) => (
                    <option key={activity} value={activity}>
                      {activity}
                    </option>
                  ))}
                </select>
                <select
                  className="progression-filterbar__select"
                  value={cardioMetric}
                  onChange={(e) => setCardioMetric(e.target.value)}
                  aria-label="Select cardio metric"
                >
                  {CARDIO_METRICS_REGISTRY.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  className="progression-filterbar__select"
                  value={cardioRange}
                  onChange={(e) => setCardioRange(e.target.value)}
                  aria-label="Select time range for Activity Trend"
                >
                  {TIME_RANGE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="progression-panel">
              <CardioSessionChart
                series={cardioActivityProgression.series}
                metricKey={cardioMetric}
                metricDef={cardioMetricDef}
                height={260}
              />
            </div>
          </section>

          <section className="analytics-section">
            <p className="analytics-section__label">Activity Distribution</p>
            <div className="progression-panel">
              <div className="prog-exdist">
                {cardioDistribution.map((a, i) => (
                  <DistributionRow
                    key={a.activityType}
                    rank={i + 1}
                    label={a.activityType}
                    sub={`${a.sessions} sessions · ${a.distance} km`}
                    pct={a.pct}
                  />
                ))}
              </div>
            </div>
          </section>

          {cardioVariantDistribution.length > 0 && (
            <section className="analytics-section">
              <p className="analytics-section__label">{selectedCardioActivity} by Variant</p>
              <div className="progression-panel">
                <div className="prog-exdist">
                  {cardioVariantDistribution.map((v, i) => (
                    <DistributionRow
                      key={v.variant}
                      rank={i + 1}
                      label={v.variant}
                      sub={`${v.sessions} sessions · ${v.distance} km`}
                      pct={v.pct}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}
          </>
        )}
        </>
        )}

        {activeTab === "intelligence" && (
        <>

        <section className="analytics-section">
          <p className="analytics-section__label">Training Load Trend</p>
          <div className="progression-panel">
            <div className="analytics-latest-pr__head">
              <Flame size={16} strokeWidth={2} />
              <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                {fatigueLevel.band} Training Load
              </p>
              <ConfidenceBadge level={fatigueLevel.confidence} reason={fatigueLevel.confidenceReason} label="Data confidence" />
              <EvidenceBadge
                strength={fatigueLevel.evidenceStrength}
                explanation={fatigueLevel.evidenceDisclaimer}
                metricKey="fatigue"
              />
            </div>
            <div className="progression-stats-rail" style={{ marginTop: 12 }}>
              <MetricCard
                label="Weekly Volume Ratio"
                value={`${Math.round(fatigueLevel.inputs.weeklyVolumeRatio * 100)}%`}
                icon={TrendingUp}
              />
              <MetricCard label="Consecutive Days" value={fatigueLevel.inputs.consecutiveTrainingDays} icon={Flame} />
              <MetricCard label="Long Sessions" value={fatigueLevel.inputs.longSessionCount} icon={Activity} />
              <MetricCard label="Recent PRs" value={fatigueLevel.inputs.recentPrAttempts} icon={Trophy} />
              {fatigueLevel.inputs.avgIntensityPct != null && (
                <MetricCard label="Avg Intensity" value={`${fatigueLevel.inputs.avgIntensityPct}%`} icon={Gauge} />
              )}
            </div>
          </div>
        </section>

        <section className="analytics-section">
          <p className="analytics-section__label">Plateaus</p>
          <div className="progression-panel">
            {plateauedMuscles.length === 0 ? (
              <PanelEmptyState
                icon={AlertTriangle}
                message="No plateaus detected — training is trending up across your muscles."
              />
            ) : (
              <div className="analytics-plateau-list">
                {plateauedMuscles.map(({ muscle, trend, plateauLevel, confidence, evidenceStrength, evidenceDisclaimer }) => (
                  <div className="analytics-plateau-row" key={muscle}>
                    <div>
                      <p className="analytics-plateau-row__name">
                        {muscle} <span className="prog-exdist__hint">— {plateauLevel}</span>
                      </p>
                      <p className="analytics-plateau-row__detail">
                        {trend.direction === "flat"
                          ? "Volume has held steady — consider progressive overload."
                          : "Volume is trending down over its logged history."}
                      </p>
                    </div>
                    <div className="analytics-plateau-row__badges">
                      <TrendBadge trend={trend} />
                      <ConfidenceBadge level={confidence} label="Data confidence" />
                      <EvidenceBadge strength={evidenceStrength} explanation={evidenceDisclaimer} metricKey="plateau" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="analytics-section">
          <div className="analytics-latest-pr__head">
            <p className="analytics-section__label" style={{ marginBottom: 0 }}>
              Deload
            </p>
            <EvidenceBadge
              strength={deloadRecommendation.evidenceStrength}
              explanation={deloadRecommendation.evidenceDisclaimer}
              metricKey="deload"
            />
          </div>
          <div className="progression-panel">
            {!deloadRecommendation.recommended ? (
              <PanelEmptyState
                icon={CheckCircle2}
                message="No combination of signals currently suggests a deload."
              />
            ) : (
              <ul className="prog-exdist__hint" style={{ paddingLeft: 18, margin: 0 }}>
                {deloadRecommendation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="analytics-section">
          <p className="analytics-section__label">Training Balance</p>
          <div className="progression-panel">
            {!trainingBalanceReport.available ? (
              <PanelEmptyState message={trainingBalanceReport.reason} />
            ) : (
              <>
                <div className="analytics-section__head">
                  <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                    Push / Pull / Legs / Core
                  </p>
                  <ConfidenceBadge
                    level={trainingBalanceReport.confidence}
                    reason={trainingBalanceReport.confidenceReason}
                    label="Training balance"
                  />
                  <EvidenceBadge
                    strength={trainingBalanceReport.evidenceStrength}
                    explanation={trainingBalanceReport.evidenceDisclaimer}
                    metricKey="muscleBalance"
                  />
                </div>
                <div className="prog-exdist">
                  {["Push", "Pull", "Legs", "Core"].map((cat) => (
                    <DistributionRow
                      key={cat}
                      label={cat}
                      sub={`${trainingBalanceReport.categoryPct[cat]}%`}
                      pct={trainingBalanceReport.categoryPct[cat]}
                    />
                  ))}
                </div>
                <p className="prog-exdist__hint" style={{ marginTop: 10 }}>
                  {trainingBalanceReport.imbalance.balanced
                    ? "Your training is well balanced across categories."
                    : `${trainingBalanceReport.imbalance.dominant} is dominant over ${trainingBalanceReport.imbalance.least} by ${trainingBalanceReport.imbalance.gap}pt.`}
                </p>
              </>
            )}
          </div>

          <div className="analytics-panels-grid-2">
            <div className="progression-panel">
              <div className="analytics-section__head">
                <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                  Upper / Lower
                </p>
                {upperLowerSplit.available && (
                  <ConfidenceBadge
                    level={upperLowerSplit.confidence}
                    reason={upperLowerSplit.confidenceReason}
                    label="Upper / Lower split"
                  />
                )}
              </div>
              {upperLowerSplit.available ? (
                <div className="prog-exdist">
                  <DistributionRow label="Upper" sub={`${upperLowerSplit.upperPct}%`} pct={upperLowerSplit.upperPct} />
                  <DistributionRow label="Lower" sub={`${upperLowerSplit.lowerPct}%`} pct={upperLowerSplit.lowerPct} />
                </div>
              ) : (
                <PanelEmptyState message={upperLowerSplit.reason} />
              )}
            </div>
            <div className="progression-panel">
              <div className="analytics-section__head">
                <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                  Strength / Cardio
                </p>
                {strengthCardioSplitReport.available && (
                  <ConfidenceBadge
                    level={strengthCardioSplitReport.confidence}
                    reason={strengthCardioSplitReport.confidenceReason}
                    label="Strength / Cardio split"
                  />
                )}
              </div>
              {strengthCardioSplitReport.available ? (
                <div className="prog-exdist">
                  <DistributionRow
                    label="Strength"
                    sub={`${strengthCardioSplitReport.strengthPct}%`}
                    pct={strengthCardioSplitReport.strengthPct}
                  />
                  <DistributionRow
                    label="Cardio"
                    sub={`${strengthCardioSplitReport.cardioPct}%`}
                    pct={strengthCardioSplitReport.cardioPct}
                  />
                </div>
              ) : (
                <PanelEmptyState message={strengthCardioSplitReport.reason} />
              )}
            </div>
          </div>
        </section>

        <section className="analytics-section">
          <p className="analytics-section__label">Weekly Summary</p>
          <div className="progression-panel">
            {weeklyGrade.grade == null ? (
              <PanelEmptyState icon={Trophy} message="Log more workouts this week to unlock a weekly grade." />
            ) : (
              <>
                <div className="analytics-latest-pr__head">
                  <Trophy size={16} strokeWidth={2} />
                  <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                    Grade: {weeklyGrade.grade} ({weeklyGrade.score}/100)
                  </p>
                  <ConfidenceBadge level={weeklyGrade.confidence} reason={weeklyGrade.confidenceReason} label="Data confidence" />
                  <EvidenceBadge
                    strength={weeklyGrade.evidenceStrength}
                    explanation={weeklyGrade.evidenceDisclaimer}
                    metricKey="weeklyGrade"
                  />
                </div>
                <div className="analytics-score-breakdown__list" style={{ marginTop: 10 }}>
                  {weeklyGrade.factors.map((f) => (
                    <div className="analytics-score-breakdown__row" key={f.key}>
                      <div className="analytics-score-breakdown__row-head">
                        <span className="analytics-score-breakdown__row-label">{f.label}</span>
                        <span className="analytics-score-breakdown__row-value">
                          {f.value != null ? Math.round(f.value) : "—"}
                        </span>
                      </div>
                      <div className="analytics-score-breakdown__bar">
                        <div
                          className="analytics-score-breakdown__bar-fill"
                          style={{ width: `${f.value != null ? f.value : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="analytics-section">
          <div className="analytics-section__head">
            <p className="analytics-section__label">Personal Volume Range</p>
            <select
              className="progression-filterbar__select"
              value={advancedRange}
              onChange={(e) => setAdvancedRange(e.target.value)}
              aria-label="Select time range for Personal Volume Range"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="progression-panel">
            {volumeLandmarks.length === 0 ? (
              <PanelEmptyState
                icon={Gauge}
                message="Log at least 4 trained weeks per muscle to see your personal volume range."
              />
            ) : (
              <div className="analytics-pr-groups">
                {volumeLandmarks.map((l) => (
                  <div className="analytics-pr-group" key={l.muscle}>
                    <div className="analytics-section__head">
                      <p className="analytics-pr-group__label" style={{ marginBottom: 0 }}>
                        {l.muscle}
                      </p>
                      <ConfidenceBadge level={l.confidence} reason={l.confidenceReason} label="Data confidence" />
                      <EvidenceBadge
                        strength={l.evidenceStrength}
                        explanation={l.evidenceDisclaimer}
                        metricKey="volumeLandmarks"
                      />
                    </div>
                    <div className="progression-stats-rail">
                      <MetricCard label="Low" value={`${l.low} kg`} icon={Gauge} />
                      <MetricCard label="Typical" value={`${l.typical} kg`} icon={Gauge} />
                      <MetricCard label="Elevated" value={`${l.elevated} kg`} icon={Gauge} />
                      <MetricCard label="Personal High" value={`${l.personalHigh} kg`} icon={Gauge} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="analytics-section">
          <div className="analytics-section__head">
            <p className="analytics-section__label">Exercise Breakdown</p>
            <select
              className="progression-filterbar__select"
              value={intelligenceExercise}
              onChange={(e) => setIntelligenceExercise(e.target.value)}
              aria-label="Select exercise for Exercise Breakdown"
            >
              {advancedExerciseDistribution.map((e) => (
                <option key={e.exercise} value={e.exercise}>
                  {e.exercise}
                </option>
              ))}
            </select>
          </div>
          <div className="progression-panel">
            {!exerciseIntelligence?.available ? (
              <PanelEmptyState
                icon={Dumbbell}
                message={exerciseIntelligence?.reason || "Select an exercise to see its intelligence."}
              />
            ) : (
              <>
                <div className="progression-stats-rail">
                  <MetricCard label="Trend" value={exerciseIntelligence.trend || "—"} icon={TrendingUp} />
                  <MetricCard
                    label="Consistency"
                    value={exerciseIntelligence.consistency != null ? `${exerciseIntelligence.consistency}%` : "—"}
                    icon={Activity}
                  />
                  <MetricCard
                    label="Best Set"
                    value={
                      exerciseIntelligence.bestSet
                        ? `${exerciseIntelligence.bestSet.weight}kg x ${exerciseIntelligence.bestSet.reps}`
                        : "—"
                    }
                    icon={Trophy}
                  />
                  <MetricCard label="Total Sessions" value={exerciseIntelligence.totalSessions} icon={Dumbbell} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <ConfidenceBadge
                    level={exerciseIntelligence.confidence}
                    reason={exerciseIntelligence.confidenceReason}
                    label="Exercise read"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="analytics-section">
          <p className="analytics-section__label">Muscle Focus</p>
          <div className="progression-panel">
            {!musclePriorities.available ? (
              <PanelEmptyState message={musclePriorities.reason} />
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ConfidenceBadge level={musclePriorities.confidence} reason={musclePriorities.confidenceReason} compact />
                  <EvidenceBadge
                    strength={musclePriorities.evidenceStrength}
                    explanation={musclePriorities.evidenceDisclaimer}
                    metricKey="muscleNeglect"
                  />
                </div>
                <div className="progression-stats-rail" style={{ marginTop: 10 }}>
                  <MetricCard
                    label="Most Overdue"
                    value={musclePriorities.mostOverdue?.muscle || "—"}
                    sub={musclePriorities.mostOverdue ? `${musclePriorities.mostOverdue.daysAgo}d ago` : null}
                    icon={Zap}
                  />
                  <MetricCard
                    label="Fastest Growing"
                    value={musclePriorities.fastestGrowing?.muscle || "Log more to unlock"}
                    sub={
                      musclePriorities.fastestGrowing
                        ? `+${Math.round(musclePriorities.fastestGrowing.changePct)}%`
                        : null
                    }
                    icon={TrendingUp}
                  />
                </div>
                {musclePriorities.lowerRecentExposure.length > 0 && (
                  <p className="prog-exdist__hint" style={{ marginTop: 10 }}>
                    Lower recent training exposure: {musclePriorities.lowerRecentExposure.join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
        </>
        )}

        {activeTab === "records" && (
        <>
        <section className="analytics-section">
          <p className="analytics-section__label">Personal Records</p>

          <div className="progression-panel analytics-latest-pr">
            <div className="analytics-latest-pr__head">
              <Trophy size={16} strokeWidth={2} />
              <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                Latest PR
              </p>
            </div>
            {mostRecentPr ? (
              <div className="analytics-latest-pr__body">
                {isLifetimePr && (
                  <span className="analytics-celebrate-badge">🏆 New Lifetime PR</span>
                )}
                <p className="analytics-latest-pr__weight">{mostRecentPr.weight} kg</p>
                <p className="analytics-latest-pr__exercise">{mostRecentPr.exercise}</p>
                <p className="analytics-latest-pr__meta">{formatDate(mostRecentPr.date)}</p>
                <p className="analytics-latest-pr__delta">
                  {latestPrPrevious ? (
                    <>
                      <TrendingUp size={13} strokeWidth={2.2} />+
                      {Math.round((mostRecentPr.weight - latestPrPrevious.weight) * 10) / 10} kg since{" "}
                      {formatDate(latestPrPrevious.date)}
                    </>
                  ) : (
                    "First recorded PR for this exercise"
                  )}
                </p>
                {heaviestLiftEver && heaviestLiftEver.exercise !== mostRecentPr.exercise && (
                  <p className="analytics-latest-pr__footnote">
                    All-time heaviest lift: {heaviestLiftEver.weight} kg ({heaviestLiftEver.exercise})
                  </p>
                )}
              </div>
            ) : (
              <PanelEmptyState icon={Trophy} message="No personal records logged yet." />
            )}
          </div>

          <div className="progression-panel">
            <p className="progression-panel__label">PR Timeline</p>
            <TimelineChart series={recordTimeline} height={300} />
          </div>

          <div className="progression-panel">
            <p className="progression-panel__label">Recent Records</p>
            {recentRecords.length === 0 ? (
              <PanelEmptyState icon={Trophy} message="No personal records logged yet." />
            ) : (
              <div className="prog-pr prog-pr--grid">
                {recentRecords.map((r, i) => (
                  <PersonalRecordRow key={`${r.isCardio ? r.activityType : r.exercise}-${r.date}-${i}`} record={r} />
                ))}
              </div>
            )}
          </div>

          <div className="progression-panel">
            <div className="analytics-section__head analytics-section__head--wrap">
              <p className="progression-panel__label" style={{ marginBottom: 0 }}>
                Current Records
              </p>
              <input
                type="text"
                className="analytics-pr-search"
                placeholder="Search exercise PR..."
                value={prSearch}
                onChange={(e) => setPrSearch(e.target.value)}
                aria-label="Search exercise PR"
              />
            </div>
            {currentRecordsByMuscle.length === 0 ? (
              <PanelEmptyState icon={Trophy} message="No personal records logged yet." />
            ) : filteredCurrentRecordsByMuscle.length === 0 ? (
              <p className="prog-exdist__hint">No exercise PR matches "{prSearch}".</p>
            ) : (
              <div className="analytics-pr-groups">
                {filteredCurrentRecordsByMuscle.map(({ muscle, records }) => (
                  <div className="analytics-pr-group" key={muscle}>
                    <p className="analytics-pr-group__label">{muscle}</p>
                    <div className="prog-pr prog-pr--grid">
                      {records.map((r) => (
                        <PersonalRecordRow key={r.isCardio ? r.activityType : r.exercise} record={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        </>
        )}

        {activeTab === "advanced" && (
        <>
        <section className="analytics-section">
          <p className="analytics-section__label">Exercise Volume Ranking</p>
          <div className="analytics-section__head">
            <p className="prog-exdist__hint" style={{ margin: 0 }}>
              Time range for this section
            </p>
            <select
              className="progression-filterbar__select"
              value={advancedRange}
              onChange={(e) => setAdvancedRange(e.target.value)}
              aria-label="Select time range for Exercise Volume Ranking"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="progression-panel">
            <p className="progression-panel__label">Volume per Exercise</p>
            {exerciseByVolume.length === 0 ? (
              <PanelEmptyState icon={Dumbbell} message="No exercises logged yet." />
            ) : (
              <div className="prog-exdist">
                {exerciseByVolume.slice(0, 8).map((e, i) => (
                  <DistributionRow
                    key={e.exercise}
                    rank={i + 1}
                    label={e.exercise}
                    sub={`${Math.round(e.volume).toLocaleString()} kg`}
                    pct={e.volumePct}
                    onSelect={() => navigate(`/progression?exercise=${encodeURIComponent(e.exercise)}`)}
                  />
                ))}
              </div>
            )}
          </div>

          <button type="button" className="analytics-next-chapter" onClick={() => navigate("/progression")}>
            <div className="analytics-next-chapter__text">
              <span className="analytics-next-chapter__eyebrow">Next up</span>
              <p className="analytics-next-chapter__title">Dive Into Progression</p>
              <p className="analytics-next-chapter__sub">
                See strength curves, PR history, exercise timelines and muscle growth.
              </p>
            </div>
            <span className="analytics-next-chapter__arrow">
              <ChevronRight size={22} strokeWidth={2.4} />
            </span>
          </button>
        </section>
        </>
        )}
      </main>
    </div>
  );
}

export default Analytics;
