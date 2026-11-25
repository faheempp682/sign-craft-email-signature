// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/presets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/request-polish", () => ({ RequestPolish: () => null }));

import { MySignatures, type MySignature } from "./my-signatures";

afterEach(cleanup);
const some = (n: number): MySignature[] => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `Sig ${i}`, updatedAt: "2026-01-01T00:00:00Z", doc: PRESETS[0].doc }));

describe("My signatures: creating another", () => {
  it("shows the count against the limit and a New signature button that starts the create flow", () => {
    render(<MySignatures items={some(3)} limit={5} />);
    expect(screen.getByText("(3 of 5)")).toBeTruthy();
    expect((screen.getByRole("link", { name: "New signature" }) as HTMLAnchorElement).getAttribute("href")).toBe("/create");
  });

  it("at the limit, replaces the button with an explanation", () => {
    render(<MySignatures items={some(5)} limit={5} />);
    expect(screen.queryByRole("link", { name: "New signature" })).toBeNull();
    expect(screen.getByText(/reached the limit. Delete one/)).toBeTruthy();
  });

  it("an empty list points at the New signature button", () => {
    render(<MySignatures items={[]} limit={5} />);
    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "New signature" })).toBeTruthy();
  });

  it("without a limit (limit unknown) it still offers New signature", () => {
    render(<MySignatures items={some(2)} />);
    expect(screen.getByText("(2)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New signature" })).toBeTruthy();
  });
});
