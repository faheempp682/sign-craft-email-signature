// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ authenticate: vi.fn(async () => ({})) }));
import { LoginForm } from "./login-form";

afterEach(cleanup);
const mode = (c: HTMLElement) => (c.querySelector('input[name="mode"]') as HTMLInputElement).value;

describe("LoginForm", () => {
  it("submits the mode it is showing, however many times the person toggled", () => {
    const { container } = render(<LoginForm next="/create" />);
    expect(mode(container)).toBe("in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Invited? Create your account" }));
    expect(mode(container)).toBe("up");
    expect(screen.getByRole("button", { name: "Create my account" })).toBeTruthy();
    expect(screen.getByText(/invitation was sent to/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Already have an account? Sign in" }));
    expect(mode(container)).toBe("in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("carries the safe next path", () => {
    const { container } = render(<LoginForm next="/editor" />);
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/editor");
  });
});
