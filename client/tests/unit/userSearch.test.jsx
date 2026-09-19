import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/services/socialService", () => ({
  searchUsers: vi.fn(),
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
}));

import UserSearch from "../../src/pages/UserSearch";
import { searchUsers } from "../../src/services/socialService";

const SEARCH_INPUT = "Search by username or name";

function renderPage() {
  render(
    <MemoryRouter>
      <UserSearch />
    </MemoryRouter>
  );
  return screen.getByPlaceholderText(SEARCH_INPUT);
}

function type(input, value) {
  fireEvent.change(input, { target: { value } });
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchUsers.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UserSearch", () => {
  it("does not call the API for fewer than 3 characters and tells the user why", async () => {
    const input = renderPage();
    type(input, "ab");
    await advance(1000);

    expect(searchUsers).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
  });

  it("does not stay stuck on Searching when the query is shortened before the request fires", async () => {
    const input = renderPage();
    type(input, "abc");
    expect(screen.getByText("Searching...")).toBeInTheDocument();

    type(input, "ab");
    await advance(1000);

    expect(searchUsers).not.toHaveBeenCalled();
    expect(screen.queryByText("Searching...")).not.toBeInTheDocument();
  });

  it("ignores a response that arrives after the query was shortened below the minimum", async () => {
    let resolveSearch;
    searchUsers.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );

    const input = renderPage();
    type(input, "abc");
    await advance(400);
    expect(searchUsers).toHaveBeenCalledWith("abc");

    type(input, "ab");
    await act(async () => {
      resolveSearch({ data: { users: [{ username: "abcuser", name: "Abc User", picture: "" }] } });
    });

    expect(screen.queryByText("Abc User")).not.toBeInTheDocument();
    expect(screen.queryByText("Searching...")).not.toBeInTheDocument();
  });

  it("shows results for a query of 3 or more characters", async () => {
    searchUsers.mockResolvedValue({
      data: { users: [{ username: "abcuser", name: "Abc User", picture: "" }] },
    });

    const input = renderPage();
    type(input, "abc");
    await advance(400);

    expect(searchUsers).toHaveBeenCalledWith("abc");
    expect(screen.getByText("Abc User")).toBeInTheDocument();
    expect(screen.getByText("@abcuser")).toBeInTheDocument();
  });
});
