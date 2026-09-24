const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
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
    tokenVersion: {
        type: Number,
        default: 0
    },
    emailVerified: {
        type: Boolean,
        default: undefined
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
userSchema.set("toJSON", {
    transform: (doc, ret) => {
        delete ret.password;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.tokenVersion;
        return ret;
    }
});
userSchema.index(
    { name: 1 },
    { partialFilterExpression: { profileVisibility: "public", discoverableByName: true } }
);
module.exports = mongoose.model("User", userSchema);