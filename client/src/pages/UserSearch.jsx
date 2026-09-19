import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Search as SearchIcon, UserPlus, UserMinus, Clock } from "lucide-react";
import { searchUsers, followUser, unfollowUser } from "../services/socialService";
import Avatar from "../components/Avatar";
import "./userSearch.css";

const MIN_QUERY_LENGTH = 3;

function UserSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState(false);
  const [pendingUsername, setPendingUsername] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestId.current += 1;
      setResults([]);
      setHasSearched(false);
      setError(false);
      setSearching(false);
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError(false);
    const handle = setTimeout(async () => {
      try {
        const res = await searchUsers(trimmed);
        if (id !== requestId.current) return;
        setResults(res.data.users || []);
        setHasSearched(true);
      } catch {
        if (id !== requestId.current) return;
        setError(true);
        setHasSearched(true);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const handleFollowToggle = async (user) => {
    setPendingUsername(user.username);
    try {
      if (user.viewerIsFollowing || user.viewerFollowRequestPending) {
        await unfollowUser(user.username);
        setResults((prev) =>
          prev.map((u) =>
            u.username === user.username
              ? { ...u, viewerIsFollowing: false, viewerFollowRequestPending: false }
              : u
          )
        );
      } else {
        const res = await followUser(user.username);
        setResults((prev) =>
          prev.map((u) =>
            u.username === user.username
              ? {
                  ...u,
                  viewerIsFollowing: res.data.status === "following",
                  viewerFollowRequestPending: res.data.status === "requested",
                }
              : u
          )
        );
      }
    } catch {
      /* empty */
    } finally {
      setPendingUsername(null);
    }
  };

  return (
    <div className="user-search-page">
      <h1 className="user-search-title">Find people on Repvyn</h1>

      <div className="user-search-box">
        <SearchIcon size={18} className="user-search-icon" />
        <input
          className="user-search-input"
          type="text"
          placeholder="Search by username or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
        <p className="user-search-hint">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
      )}

      {searching && <p className="user-search-hint">Searching...</p>}

      {!searching && error && (
        <p className="user-search-hint">Something went wrong. Try searching again.</p>
      )}

      {!searching && !error && hasSearched && results.length === 0 && (
        <p className="user-search-hint">No users found for "{query.trim()}".</p>
      )}

      {!searching && !error && results.length > 0 && (
        <ul className="user-search-results">
          {results.map((u) => (
            <li key={u.username} className="user-search-result">
              <Link to={`/u/${u.username}`} className="user-search-result-link">
                <span className="user-search-avatar">
                  <Avatar src={u.picture} name={u.name} />
                </span>
                <span>
                  <span className="user-search-result-name">
                    {u.name}
                    {u.followsViewer && (
                      <span className="user-search-follows-you">Follows you</span>
                    )}
                  </span>
                  <span className="user-search-result-handle">@{u.username}</span>
                </span>
              </Link>
              {!u.viewerIsSelf && u.viewerIsFollowing !== undefined && (
                <button
                  type="button"
                  className={`user-search-follow-btn ${u.viewerIsFollowing || u.viewerFollowRequestPending ? "user-search-follow-btn-outline" : "user-search-follow-btn-primary"}`}
                  onClick={() => handleFollowToggle(u)}
                  disabled={pendingUsername === u.username}
                >
                  {u.viewerFollowRequestPending ? (
                    <Clock size={14} />
                  ) : u.viewerIsFollowing ? (
                    <UserMinus size={14} />
                  ) : (
                    <UserPlus size={14} />
                  )}
                  {u.viewerFollowRequestPending ? "Requested" : u.viewerIsFollowing ? "Unfollow" : "Follow"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default UserSearch;
