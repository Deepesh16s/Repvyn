const PlannedWorkout = require("../models/PlannedWorkout");
const Exercise = require("../models/Exercise");
const { validatePlannedWorkoutPayload } = require("../utils/validatePlannedWorkoutPayload");
const {
  flipOverdueToMissed,
  createPlannedWorkout: createPlannedWorkoutDocs,
  updatePlannedWorkoutScoped,
} = require("../utils/plannedWorkoutService");
const { selectEditTargets } = require("../utils/plannedWorkoutRecurrence");
const {
  buildWorkoutScheduledPayload,
  buildRecurringScheduleCreatedPayload,
  buildWorkoutRescheduledPayload,
  buildWorkoutCancelledPayload,
} = require("../utils/plannedWorkoutNotifications");
const { createNotificationIfNew } = require("../utils/notificationService");

const assertExercisesOwned = async (userId, exercises) => {
  if (!exercises || !exercises.length) return;
  const ids = [...new Set(exercises.map((e) => String(e.exercise)))];
  const owned = await Exercise.find({ _id: { $in: ids }, createdBy: userId }).select("_id");
  const ownedIds = new Set(owned.map((e) => String(e._id)));
  const missing = ids.filter((id) => !ownedIds.has(id));
  if (missing.length) {
    const err = new Error("One or more selected exercises were not found");
    err.status = 400;
    throw err;
  }
};

const findOwnedOr404 = async (userId, id, res) => {
  const doc = await PlannedWorkout.findById(id);
  if (!doc) {
    res.status(404).json({ message: "Planned workout not found" });
    return null;
  }
  if (doc.user.toString() !== userId.toString()) {
    res.status(404).json({ message: "Planned workout not found" });
    return null;
  }
  return doc;
};

exports.createPlannedWorkout = async (req, res) => {
  try {
    const clean = validatePlannedWorkoutPayload(req.body, { partial: false });
    await assertExercisesOwned(req.user._id, clean.exercises);

    const created = await createPlannedWorkoutDocs(req.user._id, clean);
    const isRecurring = created.length > 1;

    try {
      const payload = isRecurring
        ? buildRecurringScheduleCreatedPayload(created[0], created.length)
        : buildWorkoutScheduledPayload(created[0]);
      await createNotificationIfNew(req.user._id, payload);
    } catch (notificationError) {
      console.error("Notification generation failed:", notificationError);
    }

    res.status(201).json({ plannedWorkouts: created });
  } catch (error) {
    console.log(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create planned workout.",
    });
  }
};

exports.getPlannedWorkouts = async (req, res) => {
  try {
    await flipOverdueToMissed(req.user._id);

    const plannedWorkouts = await PlannedWorkout.find({ user: req.user._id })
      .populate("exercises.exercise", "name muscleGroup")
      .sort({ scheduledDate: 1 });

    res.status(200).json(plannedWorkouts);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to load planned workouts." });
  }
};

exports.updatePlannedWorkout = async (req, res) => {
  try {
    const instance = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!instance) return;

    const editScope = ["only", "future", "series"].includes(req.query.editScope)
      ? req.query.editScope
      : "only";

    const clean = validatePlannedWorkoutPayload(req.body, { partial: true });
    await assertExercisesOwned(req.user._id, clean.exercises);

    const updated = await updatePlannedWorkoutScoped(req.user._id, instance, clean, editScope);
    res.status(200).json({ plannedWorkouts: updated });
  } catch (error) {
    console.log(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to update planned workout.",
    });
  }
};

exports.reschedulePlannedWorkout = async (req, res) => {
  try {
    const instance = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!instance) return;

    const parsedDate = new Date(req.body.scheduledDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "scheduledDate is not a valid date" });
    }

    instance.scheduledDate = parsedDate;
    if (req.body.scheduledTime !== undefined) instance.scheduledTime = req.body.scheduledTime || null;
    if (instance.status === "Missed" || instance.status === "Cancelled") {
      instance.status = "Planned";
    }
    instance.rescheduleCount = (instance.rescheduleCount || 0) + 1;
    await instance.save();

    try {
      await createNotificationIfNew(req.user._id, buildWorkoutRescheduledPayload(instance));
    } catch (notificationError) {
      console.error("Notification generation failed:", notificationError);
    }

    res.status(200).json(instance);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to reschedule planned workout." });
  }
};

exports.markPlannedWorkoutComplete = async (req, res) => {
  try {
    const instance = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!instance) return;

    instance.status = "Completed";
    await instance.save();
    res.status(200).json(instance);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to mark planned workout complete." });
  }
};

exports.duplicatePlannedWorkout = async (req, res) => {
  try {
    const source = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!source) return;

    const parsedDate = new Date(req.body.scheduledDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "scheduledDate is not a valid date" });
    }

    const duplicate = await PlannedWorkout.create({
      user: req.user._id,
      title: source.title,
      workoutType: source.workoutType,
      cardioActivityType: source.cardioActivityType,
      scheduledDate: parsedDate,
      scheduledTime: req.body.scheduledTime !== undefined ? req.body.scheduledTime || null : source.scheduledTime,
      exercises: source.exercises,
      estimatedDuration: source.estimatedDuration,
      notes: source.notes,
      priority: source.priority,
      recurrence: { type: "none" },
      recurrenceGroupId: null,
      status: "Planned",
    });

    res.status(201).json(duplicate);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to duplicate planned workout." });
  }
};

exports.cancelPlannedWorkout = async (req, res) => {
  try {
    const instance = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!instance) return;

    const editScope = ["only", "future", "series"].includes(req.query.editScope)
      ? req.query.editScope
      : "only";

    await updatePlannedWorkoutScoped(req.user._id, instance, { status: "Cancelled" }, editScope);

    try {
      await createNotificationIfNew(req.user._id, buildWorkoutCancelledPayload(instance));
    } catch (notificationError) {
      console.error("Notification generation failed:", notificationError);
    }

    res.status(200).json({ message: "Planned workout cancelled." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to cancel planned workout." });
  }
};

exports.deletePlannedWorkout = async (req, res) => {
  try {
    const instance = await findOwnedOr404(req.user._id, req.params.id, res);
    if (!instance) return;

    const editScope = ["only", "future", "series"].includes(req.query.editScope)
      ? req.query.editScope
      : "only";

    let targets = [instance];
    if (editScope !== "only" && instance.recurrenceGroupId) {
      const siblings = await PlannedWorkout.find({
        user: req.user._id,
        recurrenceGroupId: instance.recurrenceGroupId,
      });
      targets = selectEditTargets(editScope, instance, siblings);
    }

    await PlannedWorkout.deleteMany({ _id: { $in: targets.map((t) => t._id) } });
    res.status(200).json({ message: "Planned workout deleted.", deletedCount: targets.length });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to delete planned workout." });
  }
};

