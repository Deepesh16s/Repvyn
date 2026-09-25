const Workout = require("../models/workout");
const { getAdvancedProgressionAnalytics } = require("../utils/progressionAnalytics");

const LOOKBACK_DAYS = 365;
const MAX_WORKOUTS_SCANNED = 4000;

exports.getAdvancedProgression = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

    const workouts = await Workout.find({
      user: req.user._id,
      entryType: "strength",
      date: { $gte: cutoff },
    })
      .select("date workoutSets exercise sessionId")
      .populate("exercise", "name muscleGroup")
      .sort({ date: -1 })
      .limit(MAX_WORKOUTS_SCANNED);

    const analytics = getAdvancedProgressionAnalytics(workouts.reverse());

    res.status(200).json(analytics);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};
