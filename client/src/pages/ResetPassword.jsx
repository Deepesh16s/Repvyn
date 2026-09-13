import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import "../styles/auth.css";
import BrandMark from "../components/BrandMark";
import api from "../services/api";

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    try {
      await api.post(`/auth/reset-password/${token}`, { newPassword });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (error) {
      setError(error.response?.data?.message || "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-atmosphere">
        <div className="auth-glow auth-glow--1" />
        <div className="auth-glow auth-glow--2" />
      </div>

      <header className="auth-topbar">
        <Link to="/" className="auth-brand">
          <BrandMark size={22} />
          <span>Rep<span className="auth-brand-accent">vyn</span></span>
        </Link>
      </header>

      <main className="auth-main">
        <div className="auth-card">
          <h1 className="auth-heading">Reset password</h1>
          <p className="auth-sub">Choose a new password for your account.</p>

          {success ? (
            <p className="auth-success">Password reset successfully. Redirecting to login...</p>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div className="auth-field">
                <label className="auth-label" htmlFor="newPassword">
                  New password
                </label>
                <input
                  id="newPassword"
                  className="auth-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="confirmPassword">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  className="auth-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && <p className="auth-error" role="alert">{error}</p>}

              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )}

          <p className="auth-switch">
            <Link to="/login" className="auth-switch-link">
              Back to Login
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default ResetPassword;
