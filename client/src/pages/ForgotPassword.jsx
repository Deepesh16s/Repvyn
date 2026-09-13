import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/auth.css";
import BrandMark from "../components/BrandMark";
import api from "../services/api";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSubmitted(true);
    } catch (error) {
      console.log(error);
      setError("Something went wrong. Please try again.");
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
          <h1 className="auth-heading">Forgot password?</h1>
          <p className="auth-sub">Enter your email and we'll send you a reset link.</p>

          {submitted ? (
            <p className="auth-success">
              If an account with that email exists, a reset link has been sent. Check your inbox.
            </p>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div className="auth-field">
                <label className="auth-label" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  className="auth-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              {error && <p className="auth-error" role="alert">{error}</p>}

              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link"}
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

export default ForgotPassword;
