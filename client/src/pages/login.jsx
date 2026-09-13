import { useState, useEffect, useRef } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Link, useNavigate } from "react-router-dom";
import "../styles/auth.css";
import BrandMark from "../components/BrandMark";
import api from "../services/api";

export default function Login() {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleBtnWidth, setGoogleBtnWidth] = useState(320);
  const googleWrapperRef = useRef(null);

  useEffect(() => {
    const updateWidth = () => {
      if (googleWrapperRef.current) {
        setGoogleBtnWidth(googleWrapperRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const res = await api.post("/auth/google", {
        token: credentialResponse.credential,
      });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));

      navigate("/dashboard");
    } catch (error) {
      console.log(error);
      setError("Google Login Failed");
    }
  };

  const handleGoogleError = () => {
    setError("Google Login Failed");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(formData.email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!formData.password.trim()) {
      setError("Password is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.post("/auth/login", {
        email: formData.email.trim(),
        password: formData.password,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));

      setError("");
      navigate("/dashboard");
    } catch (error) {
      console.log(error);
      setError(error.response?.data?.message || "Login Failed");
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
          <h1 className="auth-heading">Welcome back</h1>
          <p className="auth-sub">Sign in to continue your training journey.</p>

          <div className="auth-google-wrap" ref={googleWrapperRef}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              width={googleBtnWidth}
              size="large"
              shape="pill"
              theme="filled_black"
              text="continue_with"
              logo_alignment="center"
            />
          </div>

          <div className="auth-divider">
            <div className="auth-divider-line" />
            <span className="auth-divider-text">or sign in with email</span>
            <div className="auth-divider-line" />
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">
                Email address
              </label>
              <input
                className="auth-input"
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="auth-field">
              <div className="auth-label-row">
                <label className="auth-label" htmlFor="password">
                  Password
                </label>
                <Link to="/forgot-password" className="auth-forgot">
                  Forgot password?
                </Link>
              </div>
              <input
                className="auth-input"
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button className="auth-btn" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <p className="auth-switch">
            Don't have an account?{" "}
            <Link to="/register" className="auth-switch-link">
              Register
            </Link>
          </p>
        </div>
      </main>

      <p className="auth-footnote">Track Workouts &bull; Build Strength &bull; Visualize Progress</p>
    </div>
  );
}
