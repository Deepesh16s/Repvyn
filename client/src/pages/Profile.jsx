import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Mail,
  CalendarDays,
  Pencil,
  Lock,
  Trash2,
  AtSign,
  Globe,
  ShieldOff,
  Camera,
} from "lucide-react";

import { GoogleLogin } from "@react-oauth/google";

import "./profile.css";
import api from "../services/api";
import * as chatSocket from "../services/chatSocket";
import AvatarCropModal from "../components/AvatarCropModal";
import Avatar from "../components/Avatar";

function Profile() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

  const [username, setUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState("");
  const [usernameStatus, setUsernameStatus] = useState("idle");
  const usernameCheckId = useRef(0);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [savingPassword, setSavingPassword] =
    useState(false);
  const [passwordMsg, setPasswordMsg] =
    useState("");

  const [profileVisibility, setProfileVisibility] = useState("private");
  const [showTrainingActivity, setShowTrainingActivity] = useState(false);
  const [discoverableByName, setDiscoverableByName] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityMsg, setVisibilityMsg] = useState("");

  const [savingPicture, setSavingPicture] = useState(false);
  const [pictureMsg, setPictureMsg] = useState("");
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pendingPictureFile, setPendingPictureFile] = useState(null);
  const fileInputRef = useRef(null);

  const [showDeleteConfirm, setShowDeleteConfirm] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [hasPassword, setHasPassword] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get("/auth/me");

        setUser(res.data);
        setName(res.data.name || "");
        setUsername(res.data.username || "");
        setProfileVisibility(res.data.profileVisibility || "private");
        setShowTrainingActivity(!!res.data.showTrainingActivity);
        setDiscoverableByName(!!res.data.discoverableByName);
        setHasPassword(res.data.hasPassword !== false);
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  useEffect(() => {
    if (!username || username === user?.username) {
      setUsernameStatus("idle");
      return;
    }

    const checkId = ++usernameCheckId.current;
    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const res = await api.get("/auth/username-available", { params: { username } });
        if (checkId !== usernameCheckId.current) return;
        setUsernameStatus(res.data.available ? "available" : "taken");
        setUsernameMsg(res.data.available ? "" : res.data.message || "Username is already taken");
      } catch (error) {
        if (checkId !== usernameCheckId.current) return;
        console.log(error);
        setUsernameStatus("idle");
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [username, user?.username]);

  const handleUsernameSave = async (e) => {
    e.preventDefault();
    setUsernameMsg("");

    if (usernameStatus === "taken" || usernameStatus === "checking") return;

    setSavingUsername(true);
    try {
      const res = await api.put("/auth/username", { username });
      setUser(res.data.user);

      const storedUser = JSON.parse(localStorage.getItem("user") || "null");
      if (storedUser) {
        localStorage.setItem("user", JSON.stringify({ ...storedUser, username: res.data.user.username }));
        window.dispatchEvent(new Event("repvyn:user-updated"));
      }

      setUsernameMsg("Username updated successfully.");
    } catch (error) {
      setUsernameMsg(error.response?.data?.message || "Could not update username.");
    } finally {
      setSavingUsername(false);
    }
  };

  const handleVisibilitySave = async (nextVisibility, nextShowTrainingActivity, nextDiscoverableByName) => {
    setSavingVisibility(true);
    setVisibilityMsg("");
    try {
      const res = await api.put("/auth/profile-visibility", {
        profileVisibility: nextVisibility,
        showTrainingActivity: nextShowTrainingActivity,
        discoverableByName: nextDiscoverableByName,
      });
      setProfileVisibility(res.data.user.profileVisibility);
      setShowTrainingActivity(!!res.data.user.showTrainingActivity);
      setDiscoverableByName(!!res.data.user.discoverableByName);
    } catch (error) {
      setVisibilityMsg(error.response?.data?.message || "Could not update privacy settings.");
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleNameSave = async (e) => {
    e.preventDefault();

    setNameMsg("");

    if (!name.trim()) {
      setNameMsg(
        "Name can't be empty."
      );
      return;
    }

    setSavingName(true);

    try {
      const res = await api.put(
        "/auth/profile",
        {
          name: name.trim(),
        }
      );

      setUser(res.data.user);

      localStorage.setItem(
        "user",
        JSON.stringify(
          res.data.user
        )
      );
      window.dispatchEvent(new Event("repvyn:user-updated"));

      setNameMsg(
        "Profile updated successfully."
      );
    } catch (error) {
      setNameMsg(
        error.response?.data
          ?.message ||
        "Could not update name."
      );
    } finally {
      setSavingName(false);
    }
  };

  const handlePictureSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPictureMsg("");

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setPictureMsg("Image must be a JPEG, PNG, or WebP file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPictureMsg("Image must be under 5MB.");
      return;
    }

    setPendingPictureFile(file);
    setCropModalOpen(true);
  };

  const handleCropCancel = () => {
    setCropModalOpen(false);
    setPendingPictureFile(null);
  };

  const handleCropConfirm = async (blob) => {
    setSavingPicture(true);
    try {
      const formData = new FormData();
      formData.append("picture", blob, "avatar.jpg");
      const res = await api.post("/auth/profile-picture", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUser(res.data.user);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      window.dispatchEvent(new Event("repvyn:user-updated"));
      setPictureMsg("Profile picture updated.");
      setCropModalOpen(false);
      setPendingPictureFile(null);
    } catch (error) {
      setPictureMsg(error.response?.data?.message || "Could not upload profile picture.");
    } finally {
      setSavingPicture(false);
    }
  };

  const handleRemovePicture = async () => {
    setPictureMsg("");
    setSavingPicture(true);
    try {
      const res = await api.delete("/auth/profile-picture");
      setUser(res.data.user);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      window.dispatchEvent(new Event("repvyn:user-updated"));
      setPictureMsg("Profile picture removed.");
    } catch (error) {
      setPictureMsg(error.response?.data?.message || "Could not remove profile picture.");
    } finally {
      setSavingPicture(false);
    }
  };

  const handlePasswordChange =
    async (e) => {
      e.preventDefault();

      setPasswordMsg("");
      if (!oldPassword) {
        setPasswordMsg(
          "Please enter your current password."
        );
        return;
      }

      if (
        newPassword.length < 6
      ) {
        setPasswordMsg(
          "Password must be at least 6 characters."
        );
        return;
      }

      if (
        newPassword !==
        confirmPassword
      ) {
        setPasswordMsg(
          "Passwords don't match."
        );
        return;
      }

      setSavingPassword(true);

      try {
        const res = await api.put(
          "/auth/change-password",
          {
            oldPassword,
            newPassword,
          }
        );

        if (res.data.token) {
          localStorage.setItem("token", res.data.token);
          chatSocket.connect();
        }

        setPasswordMsg(
          "Password updated successfully."
        );
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch (error) {
        setPasswordMsg(
          error.response?.data
            ?.message ||
          "Could not change password."
        );
      } finally {
        setSavingPassword(false);
      }
    };

  const handleDeleteAccount =
    async (credentials = {}) => {
      setDeleting(true);
      setDeleteMsg("");

      try {
        await api.delete("/auth/account", { data: credentials });

        localStorage.removeItem(
          "token"
        );

        localStorage.removeItem(
          "user"
        );

        navigate("/");
      } catch (error) {
        setDeleteMsg(error.response?.data?.message || "Could not delete your account.");
        setDeleting(false);
      }
    };

  const joinedDate =
    user?.createdAt
      ? new Date(
        user.createdAt
      ).toLocaleDateString(
        undefined,
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      )
      : null;

  if (loading) {
    return (
      <div className="profile-page">
        <main className="profile-main">
          <div className="profile-placeholder">
            <h1>Profile</h1>
            <p>
              Loading your
              profile...
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <main className="profile-main">
        <div className="profile-grid">

          <section className="profile-card profile-hero-card">
            <div className="profile-avatar-wrap">
              <div className="profile-avatar">
                <Avatar src={user?.picture} name={user?.name} imgClassName="profile-avatar-img" />
              </div>
              <button
                type="button"
                className="profile-avatar-edit-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={savingPicture}
                aria-label="Change profile picture"
              >
                <Camera size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={handlePictureSelect}
              />
            </div>

            {user?.picture && (
              <button
                type="button"
                className="profile-avatar-remove"
                onClick={handleRemovePicture}
                disabled={savingPicture}
              >
                Remove photo
              </button>
            )}

            {pictureMsg && <p className="profile-msg">{pictureMsg}</p>}

            <h1 className="profile-name">
              {user?.name}
            </h1>

            {user?.username && (
              <p className="profile-username">
                <AtSign size={14} />
                {user.username}
              </p>
            )}

            <p className="profile-email">
              <Mail size={16} />
              {user?.email}
            </p>

            {joinedDate && (
              <p className="profile-joined">
                <CalendarDays
                  size={16}
                />
                Joined{" "}
                {joinedDate}
              </p>
            )}

            {user?.username && (
              <Link to={`/u/${user.username}`} className="profile-view-public">
                View public profile
              </Link>
            )}
          </section>

          <section className="profile-card">
            <div className="profile-section-header">
              <AtSign size={20} />

              <h2 className="profile-card-title">
                Username
              </h2>
            </div>

            <form className="profile-form" onSubmit={handleUsernameSave}>
              <label className="profile-label" htmlFor="username">
                Username
              </label>

              <input
                id="username"
                className="profile-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                minLength={3}
                maxLength={20}
                pattern="[a-z0-9_]+"
              />

              {usernameStatus === "checking" && (
                <p className="profile-msg">Checking availability...</p>
              )}
              {usernameStatus === "available" && (
                <p className="profile-msg">@{username} is available</p>
              )}

              <button
                className="profile-btn"
                type="submit"
                disabled={savingUsername || usernameStatus === "taken" || usernameStatus === "checking"}
              >
                {savingUsername ? "Saving..." : "Save Username"}
              </button>

              {usernameMsg && (
                <p className="profile-msg">
                  {usernameMsg}
                </p>
              )}
            </form>
          </section>

          <section className="profile-card">
            <div className="profile-section-header">
              <Globe size={20} />
              <h2 className="profile-card-title">Privacy</h2>
            </div>

            <div className="profile-visibility-toggle">
              <button
                type="button"
                className={`profile-visibility-btn ${profileVisibility === "public" ? "profile-visibility-btn-active" : ""}`}
                onClick={() => handleVisibilitySave("public", showTrainingActivity, discoverableByName)}
                disabled={savingVisibility}
              >
                <Globe size={15} />
                Public
              </button>
              <button
                type="button"
                className={`profile-visibility-btn ${profileVisibility === "private" ? "profile-visibility-btn-active" : ""}`}
                onClick={() => handleVisibilitySave("private", showTrainingActivity, discoverableByName)}
                disabled={savingVisibility}
              >
                <ShieldOff size={15} />
                Private
              </button>
            </div>

            <p className="profile-visibility-hint">
              {profileVisibility === "public"
                ? "Anyone can see your sessions, PRs, and training activity."
                : "Only badges and follower counts are visible to others."}
            </p>

            {profileVisibility === "private" && (
              <label className="profile-visibility-checkbox">
                <input
                  type="checkbox"
                  checked={showTrainingActivity}
                  disabled={savingVisibility}
                  onChange={(e) => handleVisibilitySave(profileVisibility, e.target.checked, discoverableByName)}
                />
                Show training activity on my profile
              </label>
            )}

            {profileVisibility === "public" && (
              <label className="profile-visibility-checkbox">
                <input
                  type="checkbox"
                  checked={discoverableByName}
                  disabled={savingVisibility}
                  onChange={(e) => handleVisibilitySave(profileVisibility, showTrainingActivity, e.target.checked)}
                />
                Do you want to allow someone to discover you with your name?
              </label>
            )}

            {visibilityMsg && <p className="profile-msg">{visibilityMsg}</p>}
          </section>

          <section className="profile-card">
            <div className="profile-section-header">
              <Pencil size={20} />

              <h2 className="profile-card-title">
                Edit Profile
              </h2>
            </div>

            <form
              className="profile-form"
              onSubmit={
                handleNameSave
              }
            >
              <label
                className="profile-label"
                htmlFor="name"
              >
                Name
              </label>

              <input
                id="name"
                className="profile-input"
                type="text"
                maxLength={60}
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value
                  )
                }
              />

              <button
                className="profile-btn"
                type="submit"
                disabled={
                  savingName
                }
              >
                {savingName
                  ? "Saving..."
                  : "Save Changes"}
              </button>

              {nameMsg && (
                <p className="profile-msg">
                  {nameMsg}
                </p>
              )}
            </form>
          </section>


          <section className="profile-card">
            <div className="profile-section-header">
              <Lock size={20} />

              <h2 className="profile-card-title">
                Security
              </h2>
            </div>

            <form
              className="profile-form"
              onSubmit={
                handlePasswordChange
              }
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={user?.email || ""}
                readOnly
                hidden
              />

              <label
                className="profile-label"
                htmlFor="oldPassword"
              >
                Current Password
              </label>

              <input
                id="oldPassword"
                className="profile-input"
                type="password"
                autoComplete="current-password"
                placeholder="Enter current password"
                value={oldPassword}
                onChange={(e) =>
                  setOldPassword(e.target.value)
                }
              />
              <label
                className="profile-label"
                htmlFor="newPassword"
              >
                New Password
              </label>

              <input
                id="newPassword"
                className="profile-input"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={
                  newPassword
                }
                onChange={(e) =>
                  setNewPassword(
                    e.target.value
                  )
                }
              />

              <label
                className="profile-label"
                htmlFor="confirmPassword"
              >
                Confirm Password
              </label>

              <input
                id="confirmPassword"
                className="profile-input"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={
                  confirmPassword
                }
                onChange={(e) =>
                  setConfirmPassword(
                    e.target.value
                  )
                }
              />

              <button
                className="profile-btn"
                type="submit"
                disabled={
                  savingPassword
                }
              >
                {savingPassword
                  ? "Updating..."
                  : "Update Password"}
              </button>

              {passwordMsg && (
                <p className="profile-msg">
                  {passwordMsg}
                </p>
              )}
            </form>
          </section>


          <section className="profile-card profile-danger">
            <div className="profile-section-header">
              <Trash2
                size={20}
              />

              <h2 className="profile-card-title profile-danger-title">
                Danger Zone
              </h2>
            </div>

            <p className="profile-danger-text">
              Deleting your
              account permanently
              removes all your
              workouts, analytics,
              records and history.
            </p>

            {!showDeleteConfirm ? (
              <button
                className="profile-btn profile-btn-danger"
                type="button"
                onClick={() =>
                  setShowDeleteConfirm(
                    true
                  )
                }
              >
                Delete Account
              </button>
            ) : (
              <>
                {hasPassword ? (
                  <>
                    <label className="profile-label" htmlFor="delete-password">
                      Enter your password to confirm
                    </label>
                    <input
                      id="delete-password"
                      className="profile-input"
                      type="password"
                      autoComplete="current-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <p className="profile-danger-text">
                      Confirm with Google to delete your account.
                    </p>
                    <GoogleLogin
                      onSuccess={(credentialResponse) =>
                        handleDeleteAccount({ googleToken: credentialResponse.credential })
                      }
                      onError={() => setDeleteMsg("Google confirmation failed. Try again.")}
                    />
                  </>
                )}

                <div className="profile-confirm-row">
                  {hasPassword && (
                    <button
                      className="profile-btn profile-btn-danger"
                      type="button"
                      onClick={() => handleDeleteAccount({ password: deletePassword })}
                      disabled={deleting || !deletePassword}
                    >
                      {deleting
                        ? "Deleting..."
                        : "Yes, Delete"}
                    </button>
                  )}

                  <button
                    className="profile-btn profile-btn-ghost"
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeletePassword("");
                      setDeleteMsg("");
                    }}
                    disabled={
                      deleting
                    }
                  >
                    Cancel
                  </button>
                </div>

                {deleteMsg && (
                  <p className="profile-msg" role="alert">
                    {deleteMsg}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <AvatarCropModal
        open={cropModalOpen}
        imageFile={pendingPictureFile}
        saving={savingPicture}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
    </div>
  );
}

export default Profile;