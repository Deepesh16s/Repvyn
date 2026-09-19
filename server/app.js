const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rejectOperatorKeys = require("./middleware/rejectOperatorKeys");

const isProduction = process.env.NODE_ENV === "production";

const authRoutes = require("./routes/authRoutes");
const exerciseRoutes = require("./routes/exerciseRoutes");
const workoutRoutes = require("./routes/workoutRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const goalRoutes = require("./routes/goalRoutes");
const dailyStepsRoutes = require("./routes/dailyStepsRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const plannedWorkoutRoutes = require("./routes/plannedWorkoutRoutes");
const pushRoutes = require("./routes/pushRoutes");
const healthRoutes = require("./routes/healthRoutes");
const userRoutes = require("./routes/userRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const physiqueRoutes = require("./routes/physiqueRoutes");
const activityRoutes = require("./routes/activityRoutes");
const reportRoutes = require("./routes/reportRoutes");
const progressionRoutes = require("./routes/progressionRoutes");

const app = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

app.use(cors(isProduction ? { origin: process.env.CLIENT_URL } : {}));
app.use(express.json());
app.use(rejectOperatorKeys);

if (!isProduction && process.env.NODE_ENV !== "test") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

app.get("/", (req, res) => {
  res.send("Repvyn Backend Running...");
});

app.use("/api/auth", authRoutes);
app.use("/api/exercises", exerciseRoutes);
app.use("/api/workouts", workoutRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/goals", goalRoutes);
app.use("/api/daily-steps", dailyStepsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/planned-workouts", plannedWorkoutRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/physique", physiqueRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/progression", progressionRoutes);
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (process.env.NODE_ENV !== "test") console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: status === 400 ? "Malformed request body" : "Server Error",
  });
});

module.exports = app;
