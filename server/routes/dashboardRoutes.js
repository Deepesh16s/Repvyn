const express = require("express");
const router = express.Router();

const {
  getPersonalRecords,
  getCurrentStreak,
  getTopMuscle,
  getTopExercise,
  getCalendarWorkouts,
  getSessionSummary,
  getRecentSessions,
} = require("../controllers/dashboardController");

const { protect } = require("../middleware/authMiddleware");
const { heavyReadLimiter } = require("../middleware/apiRateLimiters");

router.use(protect, heavyReadLimiter);

router.get("/personal-records", getPersonalRecords);
router.get("/current-streak", getCurrentStreak);
router.get("/top-muscle", getTopMuscle);
router.get("/top-exercise", getTopExercise);
router.get("/calendar-workouts", getCalendarWorkouts);

router.get("/session-summary", getSessionSummary);
router.get("/recent-sessions", getRecentSessions);

module.exports = router;
