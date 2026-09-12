import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHeatmapDay } from "../services/socialService";
import useModalEscapeAndFocus from "../hooks/useModalEscapeAndFocus";
import { ACTIVITY_STATE, classifyActivityDays, summarizeActivity } from "../utils/activityStates";
import "./progression/progression-charts.css";

const STATE_LABEL = {
  [ACTIVITY_STATE.TRAINED]: "Trained",
  [ACTIVITY_STATE.REST]: "Rest",
  [ACTIVITY_STATE.MISSED]: "Missed",
};

function cellStateClass(state, tier) {
  if (state === ACTIVITY_STATE.REST) return "training-heatmap__cell--rest";
  if (state === ACTIVITY_STATE.MISSED) return "training-heatmap__cell--missed";
  return `training-heatmap__cell--t${tier}`;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_GAP = 6;
const COL_PITCH = 12;
const LABELS_OFFSET = 32;

function PublicHeatmap({ days, totalDays, year, rolling, username, canViewDetail }) {
  const containerRef = useRef(null);
  const [activeDay, setActiveDay] = useState(null);
  const [dayDetail, setDayDetail] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);

  const monthGroups = useMemo(() => {
    const groups = [];
    let currentMonth = null;
    let group = null;
    let col = null;

    days.forEach((day) => {
      const d = new Date(day.date);
      const month = d.getMonth();
      const row = (d.getDay() + 6) % 7;

      if (month !== currentMonth) {
        currentMonth = month;
        group = { label: MONTH_LABELS[month].slice(0, 3), cols: [] };
        groups.push(group);
        col = null;
      }
      if (!col || row === 0) {
        col = new Array(7).fill(null);
        group.cols.push(col);
      }
      col[row] = day;
    });

    return groups;
  }, [days]);

  const dayStates = useMemo(
    () => classifyActivityDays(days.map((d) => ({ key: d.date, date: d.date, trained: d.tier > 0 }))),
    [days]
  );

  const counts = useMemo(() => summarizeActivity(dayStates), [dayStates]);

  const window = rolling === false && year ? `in ${year}` : `in the last ${totalDays} days`;
  const summary = `${counts.trained} trained · ${counts.rest} rest · ${counts.missed} missed ${window}`;

  const closeDayPopover = useCallback(() => setActiveDay(null), []);
  useModalEscapeAndFocus(!!activeDay, closeDayPopover);

  useEffect(() => {
    if (!activeDay) return undefined;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setActiveDay(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeDay]);

  useEffect(() => {
    if (!activeDay) return;
    let cancelled = false;
    setDayLoading(true);
    setDayDetail(null);
    getHeatmapDay(username, activeDay.date)
      .then((res) => {
        if (!cancelled) setDayDetail(res.data);
      })
      .catch(() => {
        if (!cancelled) setDayDetail({ sessions: [] });
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDay, username]);

  const handleCellClick = (day, e) => {
    if (!canViewDetail) return;
    if (activeDay?.date === day.date) {
      setActiveDay(null);
      return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    const cellRect = e.currentTarget.getBoundingClientRect();
    const x = cellRect.left - containerRect.left + cellRect.width / 2;
    const spaceBelow = containerRect.bottom - cellRect.bottom;
    const placeAbove = spaceBelow < 140;
    const anchor = placeAbove
      ? { placeAbove: true, offset: containerRect.bottom - cellRect.top + 8 }
      : { placeAbove: false, offset: cellRect.bottom - containerRect.top + 8 };
    setActiveDay({ date: day.date, x, ...anchor });
  };

  let cumulativeCols = 0;

  return (
    <div className="training-heatmap" ref={containerRef}>
      <div className="training-heatmap__scroll">
        <div className="training-heatmap__months" aria-hidden="true">
          <div className="training-heatmap__months-spacer" />
          {monthGroups.map((group, k) => {
            const left = LABELS_OFFSET + cumulativeCols * COL_PITCH + k * MONTH_GAP;
            cumulativeCols += group.cols.length;
            return (
              <span key={`${group.label}-${k}`} className="training-heatmap__month" style={{ left: `${left}px` }}>
                {group.label}
              </span>
            );
          })}
        </div>
        <div className="training-heatmap__body">
          <div className="training-heatmap__day-labels" aria-hidden="true">
            {DAY_ROW_LABELS.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="training-heatmap__grid" role="img" aria-label={summary}>
            {monthGroups.map((group, groupIndex) =>
              group.cols.map((col, colIndex) => (
                <div
                  className={`training-heatmap__col${
                    colIndex === 0 && groupIndex > 0 ? " training-heatmap__col--month-start" : ""
                  }`}
                  key={`${group.label}-${groupIndex}-${colIndex}`}
                >
                  {col.map((day, rowIndex) => {
                    if (!day) {
                      return (
                        <div
                          key={`blank-${group.label}-${groupIndex}-${colIndex}-${rowIndex}`}
                          className="training-heatmap__cell training-heatmap__cell--blank"
                        />
                      );
                    }

                    const state = dayStates.get(day.date);
                    const dateLabel = new Date(day.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });
                    const stateLabel = STATE_LABEL[state];
                    const fullLabel = stateLabel ? `${dateLabel} — ${stateLabel}` : dateLabel;

                    return (
                      <button
                        type="button"
                        key={day.date}
                        className={`training-heatmap__cell ${cellStateClass(state, day.tier)}${
                          canViewDetail ? " training-heatmap__cell--clickable" : ""
                        }`}
                        title={fullLabel}
                        onClick={canViewDetail ? (e) => handleCellClick(day, e) : undefined}
                        tabIndex={canViewDetail ? 0 : -1}
                        aria-label={fullLabel}
                      />
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {activeDay && (
        <div
          className="training-heatmap__day-popover"
          style={{
            left: `${activeDay.x}px`,
            ...(activeDay.placeAbove
              ? { bottom: `${activeDay.offset}px` }
              : { top: `${activeDay.offset}px` }),
          }}
        >
          <strong>
            {new Date(activeDay.date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </strong>
          {dayLoading ? (
            <span className="training-heatmap__day-popover-empty">Loading…</span>
          ) : dayDetail?.sessions?.length ? (
            dayDetail.sessions.map((s, i) => (
              <div className="training-heatmap__day-popover-session" key={i}>
                <span className="training-heatmap__day-popover-name">{s.name}</span>
                {s.muscleGroups?.length > 0 && (
                  <span className="training-heatmap__day-popover-muscles">{s.muscleGroups.join(", ")}</span>
                )}
                <span className="training-heatmap__day-popover-meta">
                  {s.exerciseCount} exercise{s.exerciseCount === 1 ? "" : "s"} · {s.setCount} set
                  {s.setCount === 1 ? "" : "s"}
                </span>
              </div>
            ))
          ) : (
            <span className="training-heatmap__day-popover-empty">No workout logged</span>
          )}
        </div>
      )}

      <div className="training-heatmap__footer">
        <span className="training-heatmap__footer-hint">{summary}</span>
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

export default PublicHeatmap;
