const mongoose = require("mongoose");
const User = require("../models/User");
const Follow = require("../models/Follow");
const FollowRequest = require("../models/FollowRequest");
const Block = require("../models/Block");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Badge = require("../models/Badge");
const Activity = require("../models/Activity");
const PhysiquePost = require("../models/PhysiquePost");
const PhysiqueLike = require("../models/PhysiqueLike");
const PhysiqueComment = require("../models/PhysiqueComment");
const Report = require("../models/Report");
const Reaction = require("../models/Reaction");
const Subscription = require("../models/Subscription");
const Notification = require("../models/Notification");
const Workout = require("../models/workout");
const PlannedWorkout = require("../models/PlannedWorkout");
const Goal = require("../models/Goal");
const PushSubscription = require("../models/PushSubscription");
const PushPreferences = require("../models/PushPreferences");
const HealthConnection = require("../models/HealthConnection");
const HealthSyncState = require("../models/HealthSyncState");
const HealthSample = require("../models/HealthSample");
const HealthSleepSession = require("../models/HealthSleepSession");
const DailySteps = require("../models/DailySteps");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const Exercise = require("../models/Exercise");
const defaultExercises = require("../data/defaultExercises");
const sendEmail = require("../utils/sendEmail");
const { NAME_MAX_LENGTH, EMAIL_MAX_LENGTH } = require("../constants/userLimits");
const { isString, normalizeEmail, findUserByEmail } = require("../utils/userInput");
const { signAuthToken } = require("../utils/authToken");
const { disconnectUser } = require("../realtime/chatSocket");
const { uploadBufferToCloudinary, destroyCloudinaryAsset } = require("../utils/cloudinary");
const {
  normalize: normalizeUsername,
  validateFormat: validateUsernameFormat,
  isAvailable: isUsernameAvailable,
  assignGeneratedUsername,
} = require("../utils/username");

const publicUsernameFields = (user) => ({
  username: user.username,
  usernameChosenByUser: user.usernameChosenByUser,
  usernamePromptDismissedAt: user.usernamePromptDismissedAt,
});

const seedDefaultExercisesForUser = async (userId) => {
  const alreadySeeded = await Exercise.exists({
    createdBy: userId,
    isDefault: true,
  });

  if (alreadySeeded) return;

  try {
    await Exercise.insertMany(
      defaultExercises.map((exercise) => ({
        ...exercise,
        createdBy: userId,
        isDefault: true,
      })),
      { ordered: false }
    );
  } catch (error) {
    if (error.code !== 11000 && error.code !== "E11000") {
      throw error;
    }
    console.log("Default exercise seeding skipped duplicates:", error.message);
  }
};

exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, username } = req.body;

    if (
      ![name, email, password, username].every(isString) ||
      !name.trim() ||
      !email.trim() ||
      !password ||
      !username
    ) {
      return res.status(400).json({
        message: "Name, email, password, and username are required",
      });
    }

    if (name.trim().length > NAME_MAX_LENGTH) {
      return res.status(400).json({
        message: `Name must be ${NAME_MAX_LENGTH} characters or fewer`,
      });
    }

    const normalizedEmail = normalizeEmail(email);

    if (
      normalizedEmail.length > EMAIL_MAX_LENGTH ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({
        message: "Please enter a valid email address",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedUsername = normalizeUsername(username);
    const usernameFormatError = validateUsernameFormat(normalizedUsername);
    if (usernameFormatError) {
      return res.status(400).json({ message: usernameFormatError });
    }

    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    if (!(await isUsernameAvailable(normalizedUsername))) {
      return res.status(400).json({ message: "Username is already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        username: normalizedUsername,
        usernameChosenByUser: true,
        emailVerified: false,
      });
    } catch (error) {
      if (error.code === 11000 || error.code === "E11000") {
        return res.status(400).json({
          message: error.keyPattern?.email ? "User already exists" : "Username is already taken",
        });
      }
      throw error;
    }

    await seedDefaultExercisesForUser(user._id);

    res.status(201).json({
      message: "User Registered Successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        ...publicUsernameFields(user),
      },
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isString(email) || !isString(password) || !email.trim() || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(400).json({
        message: "Invalid Email or Password",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        message: "Invalid Email or Password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid Email or Password",
      });
    }

    if (!user.username) {
      await assignGeneratedUsername(user);
    }

    const token = signAuthToken(user);

    res.status(200).json({
      message: "Login Successful",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        ...publicUsernameFields(user),
      },
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

exports.getMe = async (req, res) => {
  const account = await User.findById(req.user._id).select("password");
  res.status(200).json({
    ...req.user.toJSON(),
    hasPassword: !!account?.password,
    emailVerified: req.user.emailVerified !== false,
  });
};

exports.updateProfile = async (req, res) => {
  try {
    const { name } = req.body;

    if (!isString(name) || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    if (name.trim().length > NAME_MAX_LENGTH) {
      return res.status(400).json({
        message: `Name must be ${NAME_MAX_LENGTH} characters or fewer`,
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name: name.trim() },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json({ message: "Profile updated successfully", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "repvyn/profile-pictures",
      public_id: String(req.user._id),
      overwrite: true,
      resource_type: "image",
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { picture: result.secure_url, pictureAssetId: result.public_id },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json({ message: "Profile picture updated", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Could not upload profile picture" });
  }
};

exports.deleteProfilePicture = async (req, res) => {
  try {
    if (req.user.pictureAssetId) {
      await destroyCloudinaryAsset(req.user.pictureAssetId).catch((err) => console.log(err));
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { picture: "", pictureAssetId: null },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json({ message: "Profile picture removed", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!isString(oldPassword) || !isString(newPassword) || !oldPassword || !newPassword) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        message: "This account signs in with Google and has no password. Use Forgot password to create one.",
      });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();
    disconnectUser(user._id);

    res.status(200).json({
      message: "Password changed successfully",
      token: signAuthToken(user),
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

const FRESH_GOOGLE_CREDENTIAL_SECONDS = 300;

async function confirmAccountOwnership(userId, { password, googleToken }) {
  const account = await User.findById(userId).select("password email googleId");
  if (!account) return { status: 401, message: "Not authorized" };

  if (account.password) {
    if (!isString(password) || !password) {
      return { status: 400, message: "Enter your password to delete your account" };
    }
    if (!(await bcrypt.compare(password, account.password))) {
      return { status: 400, message: "Password is incorrect" };
    }
    return null;
  }

  if (!isString(googleToken) || !googleToken) {
    return { status: 400, message: "Confirm with Google to delete your account" };
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return { status: 400, message: "Invalid or expired Google credential" };
  }

  const isFresh = !!payload && Date.now() / 1000 - payload.iat <= FRESH_GOOGLE_CREDENTIAL_SECONDS;
  const isSameAccount =
    !!payload &&
    ((account.googleId && payload.sub === account.googleId) ||
      (payload.email_verified && normalizeEmail(payload.email) === normalizeEmail(account.email)));

  if (!isFresh || !isSameAccount) {
    return { status: 400, message: "Confirm with Google again to delete your account" };
  }
  return null;
}

exports.deleteAccount = async (req, res) => {
  const userId = req.user._id;

  const ownershipError = await confirmAccountOwnership(userId, req.body);
  if (ownershipError) {
    return res.status(ownershipError.status).json({ message: ownershipError.message });
  }

  const session = await mongoose.startSession();

  let cloudinaryAssetIds = [];

  try {
    await session.withTransaction(async () => {
      await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] }, { session });
      await FollowRequest.deleteMany({ $or: [{ requester: userId }, { target: userId }] }, { session });
      await Block.deleteMany({ $or: [{ blocker: userId }, { blocked: userId }] }, { session });
      await Badge.deleteMany({ user: userId }, { session });
      await Activity.deleteMany({ user: userId }, { session });
      await Subscription.deleteOne({ user: userId }, { session });

      await Workout.deleteMany({ user: userId }, { session });
      await PlannedWorkout.deleteMany({ user: userId }, { session });
      await Goal.deleteMany({ user: userId }, { session });
      await Exercise.deleteMany({ createdBy: userId }, { session });

      await PushSubscription.deleteMany({ user: userId }, { session });
      await PushPreferences.deleteOne({ user: userId }, { session });
      await HealthConnection.deleteOne({ user: userId }, { session });
      await HealthSyncState.deleteOne({ user: userId }, { session });
      await HealthSample.deleteMany({ user: userId }, { session });
      await HealthSleepSession.deleteMany({ user: userId }, { session });
      await DailySteps.deleteMany({ user: userId }, { session });

      const physiquePosts = await PhysiquePost.find({ user: userId })
        .select("_id imageAssetId")
        .session(session);
      const physiquePostIds = physiquePosts.map((p) => p._id);

      const affectedComments = await PhysiqueComment.find({
        $or: [{ user: userId }, { post: { $in: physiquePostIds } }],
      })
        .select("_id")
        .session(session);
      const affectedCommentIds = affectedComments.map((c) => c._id);

      await PhysiqueLike.deleteMany({ $or: [{ user: userId }, { post: { $in: physiquePostIds } }] }, { session });
      await PhysiqueComment.deleteMany({ $or: [{ user: userId }, { post: { $in: physiquePostIds } }] }, { session });
      await Reaction.deleteMany(
        { $or: [{ user: userId }, { targetType: "physiquePost", targetId: { $in: physiquePostIds } }] },
        { session }
      );
      await Notification.deleteMany({ user: userId }, { session });
      await PhysiquePost.deleteMany({ user: userId }, { session });

      await Report.deleteMany(
        {
          $or: [
            { reporter: userId },
            { targetType: "user", targetId: userId },
            { targetType: "physiquePost", targetId: { $in: physiquePostIds } },
            { targetType: "comment", targetId: { $in: affectedCommentIds } },
          ],
        },
        { session }
      );

      const ownedConversations = await Conversation.find({ participants: userId })
        .select("_id")
        .session(session);
      const conversationIds = ownedConversations.map((c) => c._id);
      if (conversationIds.length) {
        await Message.deleteMany({ conversation: { $in: conversationIds } }, { session });
        await Conversation.deleteMany({ _id: { $in: conversationIds } }, { session });
      }

      await User.findByIdAndDelete(userId, { session });

      cloudinaryAssetIds = physiquePosts.map((p) => p.imageAssetId).filter(Boolean);
      if (req.user.pictureAssetId) cloudinaryAssetIds.push(req.user.pictureAssetId);
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Server Error" });
  } finally {
    await session.endSession();
  }

  await Promise.all(
    cloudinaryAssetIds.map((assetId) => destroyCloudinaryAsset(assetId).catch((err) => console.log(err)))
  );

  res.status(200).json({ message: "Account deleted successfully" });
};

exports.checkUsernameAvailable = async (req, res) => {
  try {
    const { username } = req.query;
    const value = normalizeUsername(username);

    const formatError = validateUsernameFormat(value);
    if (formatError) {
      return res.status(200).json({ available: false, message: formatError });
    }

    const available = await isUsernameAvailable(value);
    res.status(200).json({ available });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.updateUsername = async (req, res) => {
  try {
    const { username } = req.body;
    if (!isString(username) || !username) {
      return res.status(400).json({ message: "Username is required" });
    }

    const value = normalizeUsername(username);
    const formatError = validateUsernameFormat(value);
    if (formatError) {
      return res.status(400).json({ message: formatError });
    }

    if (!(await isUsernameAvailable(value, { excludeUserId: req.user._id }))) {
      return res.status(400).json({ message: "Username is already taken" });
    }

    let user;
    try {
      user = await User.findByIdAndUpdate(
        req.user._id,
        { username: value, usernameChosenByUser: true },
        { new: true, runValidators: true }
      ).select("-password");
    } catch (error) {
      if (error.code === 11000 || error.code === "E11000") {
        return res.status(400).json({ message: "Username is already taken" });
      }
      throw error;
    }

    res.status(200).json({ message: "Username updated successfully", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.dismissUsernamePrompt = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { usernamePromptDismissedAt: new Date() },
      { new: true }
    ).select("-password");

    res.status(200).json({ message: "Prompt dismissed", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.updateProfileVisibility = async (req, res) => {
  try {
    const { profileVisibility, showTrainingActivity, discoverableByName } = req.body;
    const update = {};

    if (profileVisibility !== undefined) {
      if (!["public", "private"].includes(profileVisibility)) {
        return res.status(400).json({ message: "profileVisibility must be 'public' or 'private'" });
      }
      update.profileVisibility = profileVisibility;
    }

    if (showTrainingActivity !== undefined) {
      update.showTrainingActivity = !!showTrainingActivity;
    }

    if (discoverableByName !== undefined) {
      update.discoverableByName = !!discoverableByName;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No changes provided" });
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (update.profileVisibility === "public") {
      const pending = await FollowRequest.find({ target: req.user._id });
      if (pending.length) {
        await Follow.bulkWrite(
          pending.map((r) => ({
            updateOne: {
              filter: { follower: r.requester, following: req.user._id },
              update: { $setOnInsert: { follower: r.requester, following: req.user._id } },
              upsert: true,
            },
          }))
        );
        await FollowRequest.deleteMany({ target: req.user._id });
      }
    }

    res.status(200).json({ message: "Profile settings updated", user });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.googleLogin = async (req, res) => {
  const { token: googleToken } = req.body;

  if (!googleToken || typeof googleToken !== "string") {
    return res.status(400).json({ message: "Google credential is required" });
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ message: "Invalid or expired Google credential" });
  }

  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired Google credential" });
  }

  try {
    const { sub, email, email_verified: emailVerified, name, picture } = payload;

    if (!emailVerified) {
      return res.status(401).json({ message: "Google account email is not verified" });
    }

    const normalizedEmail = normalizeEmail(email);
    let user = await findUserByEmail(normalizedEmail);

    if (!user) {
      user = await User.create({
        name: (String(name || "").trim() || normalizedEmail.split("@")[0]).slice(0, NAME_MAX_LENGTH),
        email: normalizedEmail,
        googleId: sub,
        picture,
        emailVerified: true,
      });

      await seedDefaultExercisesForUser(user._id);
    } else if (user.emailVerified === false) {
      user.emailVerified = true;
      if (!user.googleId) user.googleId = sub;
      const hadPassword = !!user.password;
      if (hadPassword) {
        user.password = null;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
      }
      await user.save();
      if (hadPassword) disconnectUser(user._id);
    }

    if (!user.username) {
      await assignGeneratedUsername(user);
    }

    const token = signAuthToken(user);

    res.status(200).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        ...publicUsernameFields(user),
      },
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Google Login Failed",
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!isString(email) || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await findUserByEmail(email);

    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
      await user.save();

      const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;

      try {
        await sendEmail({
          to: user.email,
          subject: "Reset your Repvyn password",
          html: `<p>Click the link below to reset your password. This link expires in 15 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        });
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
      }
    }

    res.status(200).json({
      message: "If an account with that email exists, a reset link has been sent.",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!isString(newPassword) || newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.emailVerified = true;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();
    disconnectUser(user._id);

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};