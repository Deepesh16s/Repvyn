import api from "./api";

export const getSessionSummary = () => api.get("/dashboard/session-summary");

export const getCurrentStreak = () =>
  api.get("/dashboard/current-streak", { params: { tzOffset: new Date().getTimezoneOffset() } });

export const getTopExercise = () => api.get("/dashboard/top-exercise");

export const getTopMuscle = () => api.get("/dashboard/top-muscle");

export const getPersonalRecords = () => api.get("/dashboard/personal-records");

export const getRecentSessions = (limit = 6) =>
  api.get("/dashboard/recent-sessions", { params: { limit } });

export const getDashboardSummaryData = () =>
  Promise.all([
    getSessionSummary(),
    getCurrentStreak(),
    getTopExercise(),
    getTopMuscle(),
    getPersonalRecords(),
    getRecentSessions(6),
  ]);
