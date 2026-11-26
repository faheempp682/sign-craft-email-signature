// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@/lib/schema/document";
import { BlockFields } from "./editor";

afterEach(cleanup);

const setup = (block: Block, errors: Record<string, string> = {}) => {
  const onPatch = vi.fn();
  render(<BlockFields id="b1" index={0} block={block} errors={errors} canUpload={false} gifEnabled={false} onAsset={() => {}} onPatch={onPatch} />);
  return onPatch;
};

describe("Contact block content panel", () => {
  it("shows the link fields next to Website and Address", () => {
    setup({ type: "contact", website: "example.com" });
    for (const label of ["Phone", "Email", "Website", "Website link text (optional)", "Address", "Address link (optional)"]) expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("patches the friendly text and address link; blank values clear the field", () => {
    const onPatch = setup({ type: "contact", website: "example.com", websiteLabel: "Visit us" });
    fireEvent.change(screen.getByLabelText("Website link text (optional)"), { target: { value: "" } });
    expect(onPatch).toHaveBeenLastCalledWith({ websiteLabel: undefined });
    fireEvent.change(screen.getByLabelText("Address link (optional)"), { target: { value: "https://maps.google.com/?q=x" } });
    expect(onPatch).toHaveBeenLastCalledWith({ addressHref: "https://maps.google.com/?q=x" });
  });

  it("shows the website validation error on the field", () => {
    setup({ type: "contact", website: "www.@modernhome.co.uk" }, { "blocks.0.website": "Enter a valid website, like example.com or https://example.com/page" });
    expect(screen.getByText(/Enter a valid website/)).toBeTruthy();
  });

  it("adds, edits and removes social links on the contact block", () => {
    const onPatch = setup({ type: "contact", email: "a@b.co", social: [{ network: "linkedin", url: "https://linkedin.com/in/j" }] });
    fireEvent.click(screen.getByText("Add link"));
    expect(onPatch).toHaveBeenLastCalledWith({ social: [{ network: "linkedin", url: "https://linkedin.com/in/j" }, { network: "twitter", url: "https://" }] });
    fireEvent.change(screen.getByDisplayValue("https://linkedin.com/in/j"), { target: { value: "https://linkedin.com/in/jane" } });
    expect(onPatch).toHaveBeenLastCalledWith({ social: [{ network: "linkedin", url: "https://linkedin.com/in/jane" }] });
    fireEvent.click(screen.getByLabelText("Remove linkedin link"));
    expect(onPatch).toHaveBeenLastCalledWith({ social: undefined });
  });

  it("maps social link errors from the contact block onto the inputs", () => {
    setup({ type: "contact", social: [{ network: "github", url: "http://x" }] }, { "blocks.0.social.0.url": "Must be an https:// URL" });
    expect(screen.getByText("Must be an https:// URL")).toBeTruthy();
  });

  it("does not add social controls to other blocks, and the Social block keeps its own editor", () => {
    setup({ type: "text", text: "hi", variant: "body" });
    expect(screen.queryByText("Social links")).toBeNull();
    cleanup();
    setup({ type: "social", links: [{ network: "github", url: "https://github.com/x" }] });
    expect(screen.queryByText("Social links")).toBeNull();
    expect(screen.getByText("Add link")).toBeTruthy();
  });
});
