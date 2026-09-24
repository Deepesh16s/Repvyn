const User = require("../models/User");
const Follow = require("../models/Follow");
const FollowRequest = require("../models/FollowRequest");
const Block = require("../models/Block");
const Workout = require("../models/workout");
const Badge = require("../models/Badge");
const Activity = require("../models/Activity");
const PhysiquePost = require("../models/PhysiquePost");
const { normalize: normalizeUsername, validateFormat: validateUsernameFormat } = require("../utils/username");
const { escapeRegExp } = require("../utils/userInput");
const { toPublicUser: basePublicUser } = require("../utils/publicUser");
const { isBlockedEitherWay, getViewerBlockSet } = require("../utils/blocking");
const { canViewContent } = require("../utils/contentVisibility");
const {
  dateKey,
  groupWorkoutsIntoSessions,
  getSessionVolume,
  isCardioEntry,
  tierFor,
  getSessionTypeLabel,
  countAllSessions,
} = require("../utils/workoutSessions");
const { prHistory } = require("../utils/strengthMetrics");
const { computeCurrentStreak } = require("../utils/goalMetrics");
const { MAIN_LIFTS } = require("../constants/mainLifts");
const { describeBadge } = require("../utils/badges");
const { BADGE_CATALOG } = require("../constants/badges");
const { createNotificationIfNew } = require("../utils/notificationService");
const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const MAX_SEARCH_RESULTS = 20;
const MIN_NAME_SEARCH_LENGTH = 3;
const MAX_NAME_SEARCH_LENGTH = 50;
const MAX_LIST_RESULTS = 50;
const MAX_SESSION_PAGE_SIZE = 30;
const MAX_ACTIVITY_PAGE_SIZE = 30;
const MAX_WORKOUTS_SCANNED = 2000;
const MAX_PR_CARDS = 5;
const HEATMAP_DAYS = 365;

async function canViewHeatmap(profileUser, viewerId) {
  if (viewerId && String(viewerId) === String(profileUser._id)) return true;
  if (profileUser.profileVisibility === "public") return true;
  if (!profileUser.showTrainingActivity) return false;
  if (!viewerId) return false;
  return !!(await Follow.exists({ follower: viewerId, following: profileUser._id }));
}

function toPublicUser(user, viewerContext) {
  const result = basePublicUser(user);

  if (viewerContext) {
    const { viewerId, followingSet, followedBySet, pendingRequestSet } = viewerContext;
    result.viewerIsSelf = String(viewerId) === String(user._id);
    result.viewerIsFollowing = followingSet.has(String(user._id));
    if (followedBySet) result.followsViewer = followedBySet.has(String(user._id));
    if (pendingRequestSet) result.viewerFollowRequestPending = pendingRequestSet.has(String(user._id));
  }

  return result;
}

async function findByUsername(rawUsername, select) {
  const username = normalizeUsername(rawUsername);
  return User.findOne({ username }).select(select);
}

async function getViewerFollowingSet(viewerId, targetIds) {
  if (!viewerId || targetIds.length === 0) return new Set();
  const follows = await Follow.find({
    follower: viewerId,
    following: { $in: targetIds },
  }).select("following");
  return new Set(follows.map((f) => String(f.following)));
}

async function getViewerFollowedBySet(viewerId, targetIds) {
  if (!viewerId || targetIds.length === 0) return new Set();
  const follows = await Follow.find({
    follower: { $in: targetIds },
    following: viewerId,
  }).select("follower");
  return new Set(follows.map((f) => String(f.follower)));
}

async function getViewerPendingRequestSet(viewerId, targetIds) {
  if (!viewerId || targetIds.length === 0) return new Set();
  const requests = await FollowRequest.find({
    requester: viewerId,
    target: { $in: targetIds },
  }).select("target");
  return new Set(requests.map((r) => String(r.target)));
}

exports.searchUsers = async (req, res) => {
  try {
    const rawQuery = String(req.query.q || "").trim();

    if (!rawQuery) {
      return res.status(200).json({ users: [] });
    }

    const viewerId = req.user?._id;
    const isExactUsernameQuery = validateUsernameFormat(rawQuery) === null;
    const usernameQuery = isExactUsernameQuery ? normalizeUsername(rawQuery) : null;
    const canSearchByName =
      !!viewerId &&
      rawQuery.length >= MIN_NAME_SEARCH_LENGTH &&
      rawQuery.length <= MAX_NAME_SEARCH_LENGTH;

    const [usernameMatch, nameMatches] = await Promise.all([
      isExactUsernameQuery
        ? User.findOne({ username: usernameQuery }).select("username name picture profileVisibility")
        : null,
      canSearchByName
        ? User.find({
            profileVisibility: "public",
            discoverableByName: true,
            name: { $regex: escapeRegExp(rawQuery), $options: "i" },
          })
            .select("username name picture profileVisibility")
            .limit(MAX_SEARCH_RESULTS)
        : [],
    ]);

    const candidates = new Map();
    if (usernameMatch) candidates.set(String(usernameMatch._id), usernameMatch);
    for (const u of nameMatches) {
      if (!candidates.has(String(u._id))) candidates.set(String(u._id), u);
    }

    if (candidates.size === 0) {
      return res.status(200).json({ users: [] });
    }

    const targetIds = [...candidates.values()].map((u) => u._id);
    const [followingSet, followedBySet, pendingRequestSet, blockedSet] = await Promise.all([
      getViewerFollowingSet(viewerId, targetIds),
      getViewerFollowedBySet(viewerId, targetIds),
      getViewerPendingRequestSet(viewerId, targetIds),
      getViewerBlockSet(viewerId, targetIds),
    ]);

    const viewerContext = viewerId
      ? { viewerId, followingSet, followedBySet, pendingRequestSet }
      : undefined;

    const results = [...candidates.values()]
      .filter((u) => !blockedSet.has(String(u._id)))
      .map((u) => toPublicUser(u, viewerContext));

    res.status(200).json({ users: results });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

async function getBadgeSummary(userId, { includeLocked } = {}) {
  const earned = await Badge.find({ user: userId }).sort({ earnedAt: -1 }).select("badgeId earnedAt");
  const earnedIds = new Set(earned.map((b) => b.badgeId));

  const earnedBadges = earned
    .map((b) => {
      const def = describeBadge(b.badgeId);
      if (!def) return null;
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        type: def.type,
        threshold: def.threshold,
        tier: def.tier,
        color: def.color,
        earned: true,
        earnedAt: b.earnedAt,
      };
    })
    .filter(Boolean);

  if (!includeLocked) return earnedBadges;

  const nextLockedByType = new Map();
  for (const badge of BADGE_CATALOG) {
    if (earnedIds.has(badge.id)) continue;
    const current = nextLockedByType.get(badge.type);
    if (!current || badge.threshold < current.threshold) {
      nextLockedByType.set(badge.type, badge);
    }
  }

  const lockedBadges = [...nextLockedByType.values()].map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    type: def.type,
    threshold: def.threshold,
    tier: def.tier,
    color: def.color,
    earned: false,
    earnedAt: null,
  }));

  return [...earnedBadges, ...lockedBadges];
}

async function getFitnessStats(userId) {
  const workouts = await Workout.find({ user: userId })
    .select("sessionId _id date entryType workoutSets exercise")
    .populate("exercise", "name muscleGroup")
    .sort({ date: -1 })
    .limit(MAX_WORKOUTS_SCANNED);

  return {
    sessionCount: countAllSessions(workouts),
    currentStreak: computeCurrentStreak(workouts),
    prCount: prHistory(workouts).length,
  };
}

exports.getPublicProfile = async (req, res) => {
  try {
    const user = await findByUsername(
      req.params.username,
      "username name picture createdAt profileVisibility showTrainingActivity"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const viewerId = req.user?._id;
    const isSelf = viewerId && String(viewerId) === String(user._id);
    const visibility = user.profileVisibility || "private";

    const [followerCount, followingCount, isFollowing, followsViewer, hasBlocked, blockedByOwner, requestPending] =
      await Promise.all([
        Follow.countDocuments({ following: user._id }),
        Follow.countDocuments({ follower: user._id }),
        isSelf || !viewerId ? false : Follow.exists({ follower: viewerId, following: user._id }),
        isSelf || !viewerId ? false : Follow.exists({ follower: user._id, following: viewerId }),
        isSelf || !viewerId ? false : Block.exists({ blocker: viewerId, blocked: user._id }),
        isSelf || !viewerId ? false : Block.exists({ blocker: user._id, blocked: viewerId }),
        isSelf || !viewerId
          ? false
          : FollowRequest.exists({ requester: viewerId, target: user._id }),
      ]);

    const isBlocked = !!hasBlocked || !!blockedByOwner;
    const canSeeContent = isBlocked ? false : isSelf || visibility === "public" || !!isFollowing;
    const heatmapVisible = isBlocked
      ? false
      : isSelf || visibility === "public" || (!!user.showTrainingActivity && !!isFollowing);

    const [badges, fitnessStats] = await Promise.all([
      isBlocked ? [] : getBadgeSummary(user._id, { includeLocked: !!isSelf }),
      canSeeContent ? getFitnessStats(user._id) : null,
    ]);

    res.status(200).json({
      _id: user._id,
      ...toPublicUser(user),
      createdAt: user.createdAt,
      followerCount,
      followingCount,
      viewerIsSelf: !!isSelf,
      viewerIsFollowing: !!isFollowing,
      followsViewer: !!followsViewer,
      viewerHasBlocked: !!hasBlocked,
      viewerFollowRequestPending: !!requestPending,
      profileVisibility: visibility,
      viewerCanSeeContent: canSeeContent,
      heatmapVisible: !!heatmapVisible,
      badges,
      fitnessStats,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

async function loadContentTarget(rawUsername, viewerId) {
  const target = await findByUsername(rawUsername, "_id profileVisibility showTrainingActivity");
  if (!target) return { error: 404, message: "User not found" };

  if (viewerId && (await isBlockedEitherWay(viewerId, target._id))) {
    return { error: 403, message: "Not authorized" };
  }

  return { target };
}

exports.getHeatmap = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewHeatmap(target, viewerId))) {
      return res.status(403).json({ message: "This account's training activity is not shared" });
    }

    const currentYear = new Date().getFullYear();
    const requestedYear = req.query.year
      ? Math.min(Math.max(Number(req.query.year), 2000), currentYear)
      : null;
    const isRolling = !requestedYear || requestedYear === currentYear;

    let rangeStart;
    let rangeEnd;
    if (isRolling) {
      rangeEnd = new Date();
      rangeEnd.setHours(23, 59, 59, 999);
      rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeStart.getDate() - (HEATMAP_DAYS - 1));
      rangeStart.setHours(0, 0, 0, 0);
    } else {
      rangeStart = new Date(requestedYear, 0, 1);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(requestedYear, 11, 31);
      rangeEnd.setHours(23, 59, 59, 999);
    }

    const workouts = await Workout.find({
      user: target._id,
      date: { $gte: rangeStart, $lte: rangeEnd },
    }).select("date workoutSets entryType sessionId");

    const sessions = groupWorkoutsIntoSessions(workouts);
    const volumeByDay = new Map();
    sessions.forEach((s) => {
      const key = dateKey(s.date);
      volumeByDay.set(key, (volumeByDay.get(key) || 0) + getSessionVolume(s));
    });

    const days = [];
    let max = 0;
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const key = dateKey(cursor);
      const volume = volumeByDay.get(key) || 0;
      if (volume > max) max = volume;
      days.push({ date: key, volume });
      cursor.setDate(cursor.getDate() + 1);
    }

    const leadingBlanks = (rangeStart.getDay() + 6) % 7;
    const trainedDays = days.filter((d) => d.volume > 0).length;

    res.status(200).json({
      year: isRolling ? null : requestedYear,
      rolling: isRolling,
      leadingBlanks,
      days: days.map((d) => ({ date: d.date, tier: tierFor(d.volume, max) })),
      trainedDays,
      totalDays: days.length,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getHeatmapDay = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewHeatmap(target, viewerId))) {
      return res.status(403).json({ message: "This account's training activity is not shared" });
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.params.date || "");
    if (!match) return res.status(400).json({ message: "Invalid date" });
    const [, y, m, d] = match;
    const dayStart = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    const dayEnd = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);

    const workouts = await Workout.find({
      user: target._id,
      date: { $gte: dayStart, $lte: dayEnd },
    })
      .select(
        "date sessionId sessionDuration sessionType customSessionType startedAt endedAt timingMode workoutSets entryType exercise"
      )
      .populate("exercise", "name muscleGroup");

    const sessions = groupWorkoutsIntoSessions(workouts);

    res.status(200).json({
      date: req.params.date,
      sessions: sessions.map((s) => {
        const exercises = [
          ...new Set(
            s.workouts.filter((w) => !isCardioEntry(w) && w.exercise?.name).map((w) => w.exercise.name)
          ),
        ];
        const muscleGroups = [
          ...new Set(
            s.workouts
              .filter((w) => !isCardioEntry(w) && w.exercise?.muscleGroup)
              .map((w) => w.exercise.muscleGroup)
          ),
        ];
        const setCount = s.workouts.reduce(
          (sum, w) => sum + (isCardioEntry(w) ? 0 : (w.workoutSets || []).length),
          0
        );

        return {
          name: getSessionTypeLabel(s),
          durationMinutes: s.sessionDuration,
          exerciseCount: exercises.length,
          setCount,
          exercises,
          muscleGroups,
        };
      }),
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getSessions = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewContent(target, viewerId))) {
      return res.status(403).json({ message: "This account is private" });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 10, MAX_SESSION_PAGE_SIZE);

    const workouts = await Workout.find({ user: target._id })
      .select(
        "date sessionId sessionDuration sessionType customSessionType startedAt endedAt timingMode workoutSets entryType exercise"
      )
      .populate("exercise", "name")
      .sort({ date: -1 })
      .limit(MAX_WORKOUTS_SCANNED);

    const sessions = groupWorkoutsIntoSessions(workouts).sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    const pageSessions = sessions.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      sessions: pageSessions.map((s) => {
        const exercises = [
          ...new Set(
            s.workouts.filter((w) => !isCardioEntry(w) && w.exercise?.name).map((w) => w.exercise.name)
          ),
        ];
        const setCount = s.workouts.reduce(
          (sum, w) => sum + (isCardioEntry(w) ? 0 : (w.workoutSets || []).length),
          0
        );

        return {
          date: s.date,
          name: getSessionTypeLabel(s),
          durationMinutes: s.sessionDuration,
          exerciseCount: exercises.length,
          setCount,
          exercises,
        };
      }),
      page,
      limit,
      hasMore: page * limit < sessions.length,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getPRs = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewContent(target, viewerId))) {
      return res.status(403).json({ message: "This account is private" });
    }

    const workouts = await Workout.find({ user: target._id, entryType: "strength" })
      .select("date createdAt workoutSets exercise")
      .populate("exercise", "name muscleGroup normalizedName")
      .limit(MAX_WORKOUTS_SCANNED);

    const events = prHistory(workouts);
    const currentByExercise = new Map();
    events.forEach((ev) => currentByExercise.set(ev.exercise, ev));

    const nameToNormalized = new Map();
    workouts.forEach((w) => {
      if (w.exercise?.name && w.exercise?.normalizedName) {
        nameToNormalized.set(w.exercise.name, w.exercise.normalizedName);
      }
    });

    const mainLiftEvents = [];
    MAIN_LIFTS.forEach((lift) => {
      for (const [exerciseName, ev] of currentByExercise) {
        const normalized = nameToNormalized.get(exerciseName);
        if (normalized && lift.names.includes(normalized)) {
          mainLiftEvents.push({ slot: lift.slot, ...ev });
          break;
        }
      }
    });

    const usedNames = new Set(mainLiftEvents.map((l) => l.exercise));
    const remainingSlots = MAX_PR_CARDS - mainLiftEvents.length;

    let lifts = mainLiftEvents;
    if (remainingSlots > 0) {
      const otherEvents = [...currentByExercise.values()]
        .filter((ev) => !usedNames.has(ev.exercise))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, remainingSlots)
        .map((ev) => ({ slot: ev.exercise, ...ev }));
      lifts = [...mainLiftEvents, ...otherEvents];
    }

    res.status(200).json({ lifts, isFallback: mainLiftEvents.length < MAIN_LIFTS.length });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getActivity = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 15, MAX_ACTIVITY_PAGE_SIZE);

    if (!(await canViewContent(target, viewerId))) {
      return res.status(403).json({ message: "This account is private" });
    }

    const query = { user: target._id };
    const isSelf = viewerId && String(viewerId) === String(target._id);
    const isFollower =
      !isSelf && viewerId && !!(await Follow.exists({ follower: viewerId, following: target._id }));
    if (!isSelf && !isFollower) {
      const hiddenPosts = await PhysiquePost.find({
        user: target._id,
        visibility: { $ne: "public" },
      }).select("_id");
      if (hiddenPosts.length) {
        query.$nor = [{ type: "physiquePost", refId: { $in: hiddenPosts.map((p) => p._id) } }];
      }
    }

    const activity = await Activity.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      activity: activity.map((a) => ({
        _id: a._id,
        type: a.type,
        title: a.title,
        subtitle: a.subtitle,
        createdAt: a.createdAt,
      })),
      page,
      limit,
      hasMore: activity.length === limit,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getFollowers = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target: user, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewContent(user, viewerId))) {
      return res.status(403).json({ message: "This account is private" });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, MAX_LIST_RESULTS);

    const follows = await Follow.find({ following: user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("follower", "username name picture");

    const entries = follows.filter((f) => f.follower);
    const entryIds = entries.map((f) => f.follower._id);
    const [followingSet, followedBySet, pendingRequestSet] = await Promise.all([
      getViewerFollowingSet(viewerId, entryIds),
      getViewerFollowedBySet(viewerId, entryIds),
      getViewerPendingRequestSet(viewerId, entryIds),
    ]);
    const viewerContext = viewerId
      ? { viewerId, followingSet, followedBySet, pendingRequestSet }
      : undefined;

    res.status(200).json({
      users: entries.map((f) => toPublicUser(f.follower, viewerContext)),
      page,
      limit,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getFollowing = async (req, res) => {
  try {
    const viewerId = req.user?._id;
    const { target: user, error, message } = await loadContentTarget(req.params.username, viewerId);
    if (error) return res.status(error).json({ message });

    if (!(await canViewContent(user, viewerId))) {
      return res.status(403).json({ message: "This account is private" });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, MAX_LIST_RESULTS);

    const follows = await Follow.find({ follower: user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("following", "username name picture");

    const entries = follows.filter((f) => f.following);
    const entryIds = entries.map((f) => f.following._id);
    const [followingSet, followedBySet, pendingRequestSet] = await Promise.all([
      getViewerFollowingSet(viewerId, entryIds),
      getViewerFollowedBySet(viewerId, entryIds),
      getViewerPendingRequestSet(viewerId, entryIds),
    ]);
    const viewerContext = viewerId
      ? { viewerId, followingSet, followedBySet, pendingRequestSet }
      : undefined;

    res.status(200).json({
      users: entries.map((f) => toPublicUser(f.following, viewerContext)),
      page,
      limit,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.followUser = async (req, res) => {
  try {
    const target = await findByUsername(req.params.username, "_id username profileVisibility");
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    const followerId = req.user._id;
    const followingId = target._id;

    if (String(followerId) === String(followingId)) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    if (await isBlockedEitherWay(followerId, followingId)) {
      return res.status(403).json({ message: "Unable to follow this user" });
    }

    const alreadyFollowing = await Follow.exists({ follower: followerId, following: followingId });
    if (alreadyFollowing) {
      return res.status(200).json({ message: "Followed", status: "following" });
    }

    if (target.profileVisibility === "private") {
      let created = false;
      try {
        await FollowRequest.create({ requester: followerId, target: followingId });
        created = true;
      } catch (error) {
        if (error.code !== 11000 && error.code !== "E11000") throw error;
      }

      if (created) {
        createNotificationIfNew(followingId, {
          type: NOTIFICATION_TYPES.NEW_FOLLOWER,
          category: "social",
          icon: "UserPlus",
          title: `@${req.user.username} wants to follow you`,
          navigationTarget: "/follow-requests",
          dedupeKey: `follow-request:${followerId}`,
        }).catch((error) => console.error("Follow request notification failed:", error));
      }

      return res.status(200).json({ message: "Follow request sent", status: "requested" });
    }

    try {
      await Follow.create({ follower: followerId, following: followingId });
    } catch (error) {
      if (error.code !== 11000 && error.code !== "E11000") throw error;
    }

    createNotificationIfNew(followingId, {
      type: NOTIFICATION_TYPES.NEW_FOLLOWER,
      category: "social",
      icon: "UserPlus",
      title: `@${req.user.username} started following you`,
      navigationTarget: `/u/${req.user.username}`,
      dedupeKey: `follow:${followerId}`,
    }).catch((error) => console.error("Follow notification failed:", error));

    res.status(200).json({ message: "Followed", status: "following" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.unfollowUser = async (req, res) => {
  try {
    const target = await findByUsername(req.params.username, "_id");
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    await Follow.deleteOne({ follower: req.user._id, following: target._id });
    await FollowRequest.deleteOne({ requester: req.user._id, target: target._id });
    res.status(200).json({ message: "Unfollowed" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getFollowRequests = async (req, res) => {
  try {
    const requests = await FollowRequest.find({ target: req.user._id })
      .sort({ createdAt: -1 })
      .populate("requester", "username name picture");

    res.status(200).json({
      requests: requests
        .filter((r) => r.requester)
        .map((r) => ({ _id: r._id, user: toPublicUser(r.requester), createdAt: r.createdAt })),
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.acceptFollowRequest = async (req, res) => {
  try {
    const requester = await findByUsername(req.params.username, "_id username");
    if (!requester) {
      return res.status(404).json({ message: "User not found" });
    }

    const request = await FollowRequest.findOneAndDelete({
      requester: requester._id,
      target: req.user._id,
    });
    if (!request) {
      return res.status(404).json({ message: "Follow request not found" });
    }

    try {
      await Follow.create({ follower: requester._id, following: req.user._id });
    } catch (error) {
      if (error.code !== 11000 && error.code !== "E11000") throw error;
    }

    createNotificationIfNew(requester._id, {
      type: NOTIFICATION_TYPES.NEW_FOLLOWER,
      category: "social",
      icon: "UserCheck",
      title: `@${req.user.username} accepted your follow request`,
      navigationTarget: `/u/${req.user.username}`,
      dedupeKey: `follow-accepted:${req.user._id}:${requester._id}`,
    }).catch((error) => console.error("Follow-accept notification failed:", error));

    res.status(200).json({ message: "Follow request accepted" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.declineFollowRequest = async (req, res) => {
  try {
    const requester = await findByUsername(req.params.username, "_id");
    if (!requester) {
      return res.status(404).json({ message: "User not found" });
    }

    await FollowRequest.deleteOne({ requester: requester._id, target: req.user._id });
    res.status(200).json({ message: "Follow request declined" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const target = await findByUsername(req.params.username, "_id");
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    const blockerId = req.user._id;
    const blockedId = target._id;

    if (String(blockerId) === String(blockedId)) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    try {
      await Block.create({ blocker: blockerId, blocked: blockedId });    } catch (error) {
      if (error.code !== 11000 && error.code !== "E11000") throw error;
    }

    await Follow.deleteMany({
      $or: [
        { follower: blockerId, following: blockedId },
        { follower: blockedId, following: blockerId },
      ],
    });
    await FollowRequest.deleteMany({
      $or: [
        { requester: blockerId, target: blockedId },
        { requester: blockedId, target: blockerId },
      ],
    });

    res.status(200).json({ message: "Blocked" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const target = await findByUsername(req.params.username, "_id");
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    await Block.deleteOne({ blocker: req.user._id, blocked: target._id });
    res.status(200).json({ message: "Unblocked" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};
