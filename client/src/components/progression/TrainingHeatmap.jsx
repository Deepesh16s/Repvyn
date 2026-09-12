import { useMemo, useState } from "react";
import { dateKey, startOfWeek, MONTH_LABELS } from "../../utils/dateUtils";
import { ACTIVITY_STATE, classifyActivityDays, summarizeActivity } from "../../utils/activityStates";
import "./progression-charts.css";

const WEEKS = 53;
const DAY_ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

const STATE_LABEL = {
  [ACTIVITY_STATE.TRAINED]: "Trained",
  [ACTIVITY_STATE.REST]: "Rest",
  [ACTIVITY_STATE.MISSED]: "Missed",
};

function cellStateClass(state, volume, max) {
  if (state === ACTIVITY_STATE.REST) return "training-heatmap__cell--rest";
  if (state === ACTIVITY_STATE.MISSED) return "training-heatmap__cell--missed";
  return `training-heatmap__cell--t${tierFor(volume, max)}`;
}

function tierFor(volume, max) {
  if (!volume || !max) return 0;
  const ratio = volume / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function TrainingHeatmap({ sessions = [] }) {
  const [hovered, setHovered] = useState(null);

  const { weeks, maxVolume, flatDays, totalDays } = useMemo(() => {
    const volumeByDay = new Map();
    sessions.forEach((s) => {
      const key = dateKey(s.date);
      volumeByDay.set(key, (volumeByDay.get(key) || 0) + (s.stats?.volume || 0));
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gridStart = startOfWeek(today);
    gridStart.setDate(gridStart.getDate() - (WEEKS - 1) * 7);

    const days = [];
    let max = 0;
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const key = dateKey(d);
      const volume = volumeByDay.get(key) || 0;
      if (volume > max) max = volume;
      days.push({ date: d, key, volume });
    }

    const cols = [];
    for (let w = 0; w < WEEKS; w++) {
      cols.push(days.slice(w * 7, w * 7 + 7));
    }

    return {
      weeks: cols,
      maxVolume: max,
      flatDays: days,
      totalDays: days.length,
    };
  }, [sessions]);

  const dayStates = useMemo(
    () => classifyActivityDays(flatDays.map((d) => ({ key: d.key, date: d.date, trained: d.volume > 0 }))),
    [flatDays]
  );

  const counts = useMemo(() => summarizeActivity(dayStates), [dayStates]);

  const monthMarkers = useMemo(() => {
    const markers = [];
    let lastMonth = null;
    weeks.forEach((col, i) => {
      const month = col[0].date.getMonth();
      if (month !== lastMonth) {
        markers.push({ index: i, label: MONTH_LABELS[month].slice(0, 3) });
        lastMonth = month;
      }
    });
    return markers;
  }, [weeks]);

  const summary = `${counts.trained} trained · ${counts.rest} rest · ${counts.missed} missed in the last ${totalDays} days`;

  return (
    <div className="training-heatmap">
      <div className="training-heatmap__scroll">
        <div className="training-heatmap__months" aria-hidden="true">
          <div className="training-heatmap__months-spacer" />
          {monthMarkers.map((m) => (
            <span
              key={m.index}
              className="training-heatmap__month"
              style={{ left: `${m.index * 14}px` }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div className="training-heatmap__body">
          <div className="training-heatmap__day-labels" aria-hidden="true">
            {DAY_ROW_LABELS.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="training-heatmap__grid" role="img" aria-label={summary}>
            {weeks.map((col, colIndex) => (
              <div className="training-heatmap__col" key={colIndex}>
                {col.map((day) => {
                  const state = dayStates.get(day.key);
                  const detail = day.volume
                    ? `${Math.round(day.volume).toLocaleString()} kg`
                    : STATE_LABEL[state] || "No training";
                  return (
                    <div
                      key={day.key}
                      className={`training-heatmap__cell ${cellStateClass(state, day.volume, maxVolume)}`}
                      title={`${day.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} — ${detail}`}
                      onMouseEnter={() => setHovered(day)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="training-heatmap__footer">
        <span className="training-heatmap__footer-hint">
          {hovered
            ? `${hovered.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${
                hovered.volume ? `${Math.round(hovered.volume).toLocaleString()} kg` : "No training"
              }`
            : summary}
        </span>
        <div className="training-heatmap__legend" aria-hidden="true">
          <span className="training-heatmap__legend-item">
            <span className="training-heatmap__legend-swatch training-heatmap__cell--t3" />
            Trained
          </span>
          <span className="training-heatmap__legend-item">
            <span className="training-heatmap__legend-swatch training-heatmap__cell--rest" />
            Rest
          </span>
          <span className="training-heatmap__legend-item">
            <span className="training-heatmap__legend-swatch training-heatmap__cell--missed" />
            Missed
          </span>
        </div>
      </div>
    </div>
  );
}

export default TrainingHeatmap;
