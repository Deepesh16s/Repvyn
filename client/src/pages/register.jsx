import "../styles/auth.css";

import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark";
import api from "../services/api";

function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
  });

  const { name, email, username, password, confirmPassword } = formData;

  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState("idle");
  const [usernameMsg, setUsernameMsg] = useState("");
  const usernameCheckId = useRef(0);

  const handleChange = (e) => {
    const { name: field, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [field]: field === "username" ? value.toLowerCase() : value,
    }));
  };

  useEffect(() => {
    if (!username) {
      setUsernameStatus("idle");
      setUsernameMsg("");
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
  }, [username]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError("");

    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }

    if (usernameStatus === "taken") {
      setFormError("Please choose an available username.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/auth/register", { name, email, username, password });

      navigate("/login");
    } catch (error) {
      console.log(error);

      setFormError(error.response?.data?.message || "Registration failed. Please try again.");
      setIsSubmitting(false);
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
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-sub">Start logging your training today.</p>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor="register-name">
                Full name
              </label>
              <input
                className="auth-input"
                id="register-name"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Enter your full name"
                value={name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="register-email">
                Email address
              </label>
              <input
                className="auth-input"
                id="register-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="register-username">
                Username
              </label>
              <input
                className="auth-input"
                id="register-username"
                type="text"
                name="username"
                autoComplete="off"
                placeholder="how people will find you"
                value={username}
                onChange={handleChange}
                minLength={3}
                maxLength={20}
                pattern="[a-z0-9_]+"
                required
              />
              {usernameStatus === "checking" && (
                <p className="auth-hint">Checking availability...</p>
              )}
              {usernameStatus === "available" && (
                <p className="auth-hint auth-hint-success">@{username} is available</p>
              )}
              {usernameStatus === "taken" && <p className="auth-error" role="alert">{usernameMsg}</p>}
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="register-password">
                Password
              </label>
              <input
                className="auth-input"
                id="register-password"
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="Create a password"
                value={password}
                onChange={handleChange}
                required
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="register-confirm-password">
                Confirm password
              </label>
              <input
                className="auth-input"
                id="register-confirm-password"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={handleChange}
                required
              />
            </div>

            {formError && <p className="auth-error" role="alert">{formError}</p>}

            <button type="submit" className="auth-btn" disabled={isSubmitting}>
              {isSubmitting ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account?{" "}
            <Link to="/login" className="auth-switch-link">
              Login
            </Link>
          </p>
        </div>
      </main>

      <p className="auth-footnote">Track Workouts &bull; Build Strength &bull; Visualize Progress</p>
    </div>
  );
}

export default Register;
