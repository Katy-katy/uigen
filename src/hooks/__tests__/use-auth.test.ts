import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";
import { signIn as signInAction, signUp as signUpAction } from "@/actions";
import { getAnonWorkData, clearAnonWork } from "@/lib/anon-work-tracker";
import { getProjects } from "@/actions/get-projects";
import { createProject } from "@/actions/create-project";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults: no anon work, no existing projects.
  (getAnonWorkData as any).mockReturnValue(null);
  (getProjects as any).mockResolvedValue([]);
  (createProject as any).mockResolvedValue({ id: "new-project" });
});

describe("useAuth", () => {
  test("initial state exposes signIn, signUp, and isLoading=false", () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
  });

  describe("signIn", () => {
    test("returns the action result on success", async () => {
      (signInAction as any).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAuth());

      let returned: any;
      await act(async () => {
        returned = await result.current.signIn("a@b.com", "password123");
      });

      expect(signInAction).toHaveBeenCalledWith("a@b.com", "password123");
      expect(returned).toEqual({ success: true });
    });

    test("returns the failure result and does not navigate", async () => {
      (signInAction as any).mockResolvedValue({
        success: false,
        error: "Invalid credentials",
      });

      const { result } = renderHook(() => useAuth());

      let returned: any;
      await act(async () => {
        returned = await result.current.signIn("a@b.com", "wrong");
      });

      expect(returned).toEqual({
        success: false,
        error: "Invalid credentials",
      });
      expect(mockPush).not.toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
      expect(getProjects).not.toHaveBeenCalled();
    });

    test("creates a project from anonymous work when it exists", async () => {
      (signInAction as any).mockResolvedValue({ success: true });
      (getAnonWorkData as any).mockReturnValue({
        messages: [{ role: "user", content: "hi" }],
        fileSystemData: { "/App.jsx": { type: "file", content: "x" } },
      });
      (createProject as any).mockResolvedValue({ id: "anon-project" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "hi" }],
          data: { "/App.jsx": { type: "file", content: "x" } },
        })
      );
      expect(clearAnonWork).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/anon-project");
      // Should not fall through to the projects lookup.
      expect(getProjects).not.toHaveBeenCalled();
    });

    test("navigates to the most recent project when anon work is empty", async () => {
      (signInAction as any).mockResolvedValue({ success: true });
      (getAnonWorkData as any).mockReturnValue({
        messages: [],
        fileSystemData: {},
      });
      (getProjects as any).mockResolvedValue([
        { id: "recent" },
        { id: "older" },
      ]);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(createProject).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/recent");
    });

    test("navigates to most recent project when no anon work", async () => {
      (signInAction as any).mockResolvedValue({ success: true });
      (getProjects as any).mockResolvedValue([{ id: "existing" }]);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/existing");
      expect(createProject).not.toHaveBeenCalled();
    });

    test("creates a new project when none exist", async () => {
      (signInAction as any).mockResolvedValue({ success: true });
      (getProjects as any).mockResolvedValue([]);
      (createProject as any).mockResolvedValue({ id: "fresh" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [], data: {} })
      );
      expect(mockPush).toHaveBeenCalledWith("/fresh");
    });

    test("toggles isLoading around the call and resets it after", async () => {
      let resolveAction: (v: any) => void;
      (signInAction as any).mockReturnValue(
        new Promise((resolve) => {
          resolveAction = resolve;
        })
      );

      const { result } = renderHook(() => useAuth());

      let pending: Promise<any>;
      act(() => {
        pending = result.current.signIn("a@b.com", "password123");
      });

      await waitFor(() => expect(result.current.isLoading).toBe(true));

      await act(async () => {
        resolveAction!({ success: false });
        await pending;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("resets isLoading even when the action throws", async () => {
      (signInAction as any).mockRejectedValue(new Error("network"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await expect(
          result.current.signIn("a@b.com", "password123")
        ).rejects.toThrow("network");
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("signUp", () => {
    test("returns the action result and runs post-sign-in on success", async () => {
      (signUpAction as any).mockResolvedValue({ success: true });
      (getProjects as any).mockResolvedValue([{ id: "existing" }]);

      const { result } = renderHook(() => useAuth());

      let returned: any;
      await act(async () => {
        returned = await result.current.signUp("a@b.com", "password123");
      });

      expect(signUpAction).toHaveBeenCalledWith("a@b.com", "password123");
      expect(returned).toEqual({ success: true });
      expect(mockPush).toHaveBeenCalledWith("/existing");
    });

    test("returns failure result and does not navigate", async () => {
      (signUpAction as any).mockResolvedValue({
        success: false,
        error: "Email already registered",
      });

      const { result } = renderHook(() => useAuth());

      let returned: any;
      await act(async () => {
        returned = await result.current.signUp("a@b.com", "password123");
      });

      expect(returned).toEqual({
        success: false,
        error: "Email already registered",
      });
      expect(mockPush).not.toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
    });

    test("resets isLoading even when the action throws", async () => {
      (signUpAction as any).mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await expect(
          result.current.signUp("a@b.com", "password123")
        ).rejects.toThrow("boom");
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
