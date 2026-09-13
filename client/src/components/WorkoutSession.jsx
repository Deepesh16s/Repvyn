import { useEffect, useState, useMemo, useCallback } from "react";
import { Dumbbell, Plus, Activity, X, CheckCircle2, Loader2, StickyNote, AlertTriangle } from "lucide-react";
import ExerciseSessionCard from "./ExerciseSessionCard";
import CardioEntryCard from "./CardioEntryCard";
import RestTimer from "./RestTimer";
import ExerciseHistoryDrawer from "./ExerciseHistoryDrawer";
import ConfirmDialog from "./ConfirmDialog";
import { calculateVolume } from "../utils/strengthUtils";
import { getDefaultRestSeconds } from "../progression/liveWorkoutEngine";
import useModalEscapeAndFocus from "../hooks/useModalEscapeAndFocus";
import "./WorkoutSession.css";

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatMinutesLabel = (ms) => {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return minutes < 1 ? "<1 min" : `${minutes} min`;
};

const PENDING_ACTION_COPY = {
  deleteSet: {
    title: "Remove Set?",
    body: "Deleting this set will remove the exercise from your workout.",
  },
  deleteExercise: {
    title: "Remove Exercise?",
    body: "This exercise will be removed from the current workout.",
  },
  deleteCardio: {
    title: "Remove Cardio Entry?",
    body: "This cardio entry will be removed from the current workout.",
  },
};

function WorkoutSession({
  startTime,
  entryCount,
  entries,
  historicalWorkouts = [],
  onAddExercise,
  onAddCardio,
  onDiscard,
  onRemoveEntry,
  onAddSet,
  onDeleteSet,
  onUpdateSet,
  onReorderEntry,
  onDuplicateEntry,
  onReplaceEntry,
  sessionNote,
  onSessionNoteChange,
  onUpdateEntryNote,
  onFinishWorkout,
  isSaving,
  saveError,
}) {
  const [now, setNow] = useState(() => Date.now());
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [showNoteField, setShowNoteField] = useState(false);
  const [historyEntryId, setHistoryEntryId] = useState(null);

  const handleCloseHistory = useCallback(() => setHistoryEntryId(null), []);
  const handleUpdateHistoryNote = useCallback(
    (note) => onUpdateEntryNote(historyEntryId, note),
    [historyEntryId, onUpdateEntryNote]
  );

  const [editingEntryIds, setEditingEntryIds] = useState(() => new Set());
  const isEditingActive = editingEntryIds.size > 0;

  const [restTimer, setRestTimer] = useState(null);
  const [prExerciseIds, setPrExerciseIds] = useState(() => new Set());
  const handleSetCompleted = (exercise, pr) => {
    setRestTimer({ seconds: getDefaultRestSeconds(exercise?.name), trigger: Date.now() });
    if (pr && exercise?._id) {
      setPrExerciseIds((prev) => new Set(prev).add(exercise._id));
    }
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = startTime ? now - startTime : 0;
  const hasEntries = entries.length > 0;

  const totalSets = entries.reduce(
    (sum, entry) =>
      sum + (entry.entryType === "cardio" ? 0 : entry.sets.length),
    0
  );

  const totalVolume = useMemo(
    () =>
      entries.reduce(
        (sum, entry) =>
          sum + (entry.entryType === "cardio" ? 0 : calculateVolume(entry.sets)),
        0
      ),
    [entries]
  );

  const handleEntryEditingChange = useCallback((entryId, isEditing) => {
    setEditingEntryIds((prev) => {
      if (prev.has(entryId) === isEditing) return prev;
      const next = new Set(prev);
      if (isEditing) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  }, []);

  const handleDeleteSet = (exerciseId, setId) => {
    if (isSaving) return;

    const entry = entries.find((e) => e.id === exerciseId);
    const isLastSet =
      entry && entry.entryType !== "cardio" && entry.sets.length === 1;

    if (isLastSet) {
      setPendingAction({ type: "deleteSet", exerciseId, setId });
      return;
    }

    onDeleteSet(exerciseId, setId);
  };

  const handleDeleteExercise = (exerciseId) => {
    if (isSaving) return;
    setPendingAction({ type: "deleteExercise", exerciseId });
  };

  const handleDeleteCardioEntry = (entryId) => {
    if (isSaving) return;
    setPendingAction({ type: "deleteCardio", entryId });
  };

  const handleCancelPendingAction = useCallback(() => setPendingAction(null), []);

  const handleConfirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === "deleteSet") onDeleteSet(pendingAction.exerciseId, pendingAction.setId);
    else if (pendingAction.type === "deleteExercise") onRemoveEntry(pendingAction.exerciseId);
    else if (pendingAction.type === "deleteCardio") onRemoveEntry(pendingAction.entryId);
    setPendingAction(null);
  };

  const handleToggleCollapse = (entryId) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleAddExerciseClick = () => {
    if (isSaving || isEditingActive) return;
    onAddExercise();
  };

  const handleAddCardioClick = () => {
    if (isSaving || isEditingActive) return;
    onAddCardio();
  };

  const handleDiscardClick = () => {
    if (isSaving || isEditingActive) return;
    setShowDiscardConfirm(true);
  };

  const handleCancelDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
  }, []);

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    onDiscard();
  };

  useModalEscapeAndFocus(showDiscardConfirm, handleCancelDiscardConfirm);

  const handleFinishClick = () => {
    if (isSaving || !hasEntries || isEditingActive) return;
    setShowConfirm(true);
  };

  const handleCancelConfirm = () => {
    if (isSaving) return;
    setShowConfirm(false);
  };

  const handleConfirmFinish = async () => {
    if (isSaving) return;
    setShowConfirm(false);
    await onFinishWorkout({
      durationMinutes: Math.round(elapsed / 60000),
      totalVolume,
      exerciseCount: entries.length,
      setCount: totalSets,
      prExerciseCount: prExerciseIds.size,
    });
  };

  return (
    <section className="session-card">
      <div className="session-card__top">
        <div className="session-card__info">
          <div className="session-card__icon">
            <Dumbbell size={20} strokeWidth={1.8} />
          </div>
          <div>
            <p className="session-card__title">Workout Session</p>
            <div className="session-card__stats">
              <span>{formatDuration(elapsed)}</span>
              <span className="session-card__dot" />
              <span>
                {entryCount} {entryCount === 1 ? "entry" : "entries"}
              </span>
              <span className="session-card__dot" />
              <span>
                {totalSets} {totalSets === 1 ? "set" : "sets"}
              </span>
              <span className="session-card__dot" />
              <span>{Math.round(totalVolume).toLocaleString()} kg</span>
            </div>
          </div>
        </div>

        <div className="session-card__actions">
          <button
            type="button"
            className="cta-btn"
            onClick={() => setShowNoteField((prev) => !prev)}
            disabled={isSaving}
          >
            <StickyNote size={16} strokeWidth={2.5} />
            {sessionNote ? "Edit Note" : "Add Note"}
          </button>
          <button
            type="button"
            className="cta-btn"
            onClick={handleAddExerciseClick}
            disabled={isSaving || isEditingActive}
          >
            <Plus size={16} strokeWidth={2.5} />
            Add Exercise
          </button>
          <button
            type="button"
            className="cta-btn"
            onClick={handleAddCardioClick}
            disabled={isSaving || isEditingActive}
          >
            <Activity size={16} strokeWidth={2.5} />
            Add Cardio
          </button>
          <button
            type="button"
            className="session-finish-btn"
            onClick={handleFinishClick}
            disabled={isSaving || !hasEntries || isEditingActive}
          >
            {isSaving ? (
              <>
                <Loader2 size={15} strokeWidth={2} className="session-btn-spinner" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} strokeWidth={2} />
                Finish Workout
              </>
            )}
          </button>
          <button
            type="button"
            className="session-discard-btn"
            onClick={handleDiscardClick}
            disabled={isSaving || isEditingActive}
          >
            <X size={15} strokeWidth={2} />
            Discard Session
          </button>
        </div>
      </div>

      {saveError && (
        <p className="session-error" role="alert">
          {saveError}
        </p>
      )}

      {showNoteField && (
        <textarea
          className="session-note-field"
          placeholder="How did this workout feel? (e.g. Felt strong today.)"
          value={sessionNote || ""}
          onChange={(e) => onSessionNoteChange(e.target.value)}
          disabled={isSaving}
          rows={2}
        />
      )}

      {hasEntries && (
        <div className="session-card__exercises">
          {entries.map((entry, index) =>
            entry.entryType === "cardio" ? (
              <CardioEntryCard
                key={entry.id}
                entry={entry}
                disabled={isSaving}
                onDelete={handleDeleteCardioEntry}
              />
            ) : (
              <ExerciseSessionCard
                key={entry.id}
                entry={entry}
                disabled={isSaving}
                historicalWorkouts={historicalWorkouts}
                onAddSet={onAddSet}
                onUpdateSet={onUpdateSet}
                onDeleteSet={handleDeleteSet}
                onDelete={handleDeleteExercise}
                onMoveUp={() => onReorderEntry(entry.id, "up")}
                onMoveDown={() => onReorderEntry(entry.id, "down")}
                isFirst={index === 0}
                isLast={index === entries.length - 1}
                onDuplicateExercise={onDuplicateEntry}
                onReplaceExercise={onReplaceEntry}
                onOpenHistory={(e) => setHistoryEntryId(e.id)}
                isCollapsed={collapsedIds.has(entry.id)}
                onToggleCollapse={() => handleToggleCollapse(entry.id)}
                onEditingChange={handleEntryEditingChange}
                onSetCompleted={handleSetCompleted}
                onUpdateNote={(note) => onUpdateEntryNote(entry.id, note)}
              />
            )
          )}
        </div>
      )}

      {restTimer && (
        <RestTimer initialSeconds={restTimer.seconds} restartTrigger={restTimer.trigger} />
      )}

      {historyEntryId !== null && (
        <ExerciseHistoryDrawer
          open
          onClose={handleCloseHistory}
          entry={entries.find((e) => e.id === historyEntryId) || null}
          historicalWorkouts={historicalWorkouts}
          onUpdateNote={handleUpdateHistoryNote}
        />
      )}

      {showConfirm && (
        <div className="finish-confirm-overlay">
          <div className="finish-confirm-card">
            <div className="finish-confirm-icon">
              <CheckCircle2 size={22} strokeWidth={1.8} />
            </div>
            <p className="finish-confirm-title">Finish Workout?</p>

            <div className="finish-confirm-summary">
              <div className="finish-confirm-summary__row">
                <span>Entries</span>
                <strong>{entries.length}</strong>
              </div>
              <div className="finish-confirm-summary__row">
                <span>Sets</span>
                <strong>{totalSets}</strong>
              </div>
              <div className="finish-confirm-summary__row">
                <span>Volume</span>
                <strong>{Math.round(totalVolume).toLocaleString()} kg</strong>
              </div>
              <div className="finish-confirm-summary__row">
                <span>Duration</span>
                <strong>{formatMinutesLabel(elapsed)}</strong>
              </div>
            </div>

            <div className="finish-confirm-actions">
              <button
                type="button"
                className="finish-confirm-btn finish-confirm-btn--cancel"
                onClick={handleCancelConfirm}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="finish-confirm-btn finish-confirm-btn--confirm"
                onClick={handleConfirmFinish}
                disabled={isSaving}
              >
                Finish Workout
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscardConfirm && (
        <div className="finish-confirm-overlay">
          <div
            className="finish-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-confirm-title"
          >
            <div className="finish-confirm-icon finish-confirm-icon--danger">
              <AlertTriangle size={22} strokeWidth={1.8} />
            </div>
            <p className="finish-confirm-title" id="discard-confirm-title">Discard Workout?</p>
            <p className="finish-confirm-body">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} and {totalSets}{" "}
              {totalSets === 1 ? "set" : "sets"} logged so far will be lost. This can't be undone.
            </p>

            <div className="finish-confirm-actions">
              <button
                type="button"
                className="finish-confirm-btn finish-confirm-btn--cancel"
                onClick={handleCancelDiscardConfirm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="finish-confirm-btn finish-confirm-btn--danger"
                onClick={handleConfirmDiscard}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction ? PENDING_ACTION_COPY[pendingAction.type].title : ""}
        body={pendingAction ? PENDING_ACTION_COPY[pendingAction.type].body : ""}
        confirmLabel="Remove"
        onConfirm={handleConfirmPendingAction}
        onCancel={handleCancelPendingAction}
      />
    </section>
  );
}

export default WorkoutSession;