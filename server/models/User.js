const mongoose = require("mongoose");
const { NAME_MAX_LENGTH } = require("../constants/userLimits");
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        maxlength: NAME_MAX_LENGTH
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        default: null
    },
    googleId: {
        type: String,
        default: null
    },
    username: {
        type: String,
        unique: true,
        sparse: true,
        minlength: 3,
        maxlength: 20,
        match: /^[a-z0-9_]+$/,
        default: undefined,
    },
    usernameChosenByUser: {
        type: Boolean,
        default: false
    },
    usernamePromptDismissedAt: {
        type: Date,
        default: null
    },
    profileVisibility: {
        type: String,
        enum: ["public", "private"],
        default: "private"
    },
    showTrainingActivity: {
        type: Boolean,
        default: false
    },
    discoverableByName: {
        type: Boolean,
        default: false
    },
    premiumTier: {
        type: String,
        enum: ["free", "premium"],
        default: "free"
    },
    picture: {
        type: String,
        default: ""
    },
    pictureAssetId: {
        type: String,
        default: null
    },
    resetPasswordToken: {
        type: String,
        default: null
    },
    resetPasswordExpires: {
        type: Date,
        default: null
    }
}, { timestamps: true });
userSchema.index(
    { name: 1 },
    { partialFilterExpression: { profileVisibility: "public", discoverableByName: true } }
);
module.exports = mongoose.model("User", userSchema);