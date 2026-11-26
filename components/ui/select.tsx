"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/utils";

/* shadcn/ui Select primitives, themed to the app tokens. */

const SelectRoot = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const Chevron = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "field flex w-fit cursor-pointer items-center justify-between gap-2 whitespace-nowrap text-left outline-none transition-colors",
        "hover:border-ring focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:border-ring",
        "disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "relative z-[70] max-h-(--radix-select-content-available-height) min-w-[max(8rem,var(--radix-select-trigger-width))] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <Chevron className="size-4 rotate-180" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="max-h-[min(22rem,var(--radix-select-content-available-height))] p-1.5">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <Chevron className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2.5 pr-8 text-sm outline-none",
        "focus:bg-accent-soft data-[highlighted]:bg-accent-soft data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

/* ---- Drop-in replacement for a native select with <option>/<optgroup> children. ---- */

// Radix forbids an empty-string item value, so "" is mapped to a sentinel.
const EMPTY = "__empty__";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

type Entry =
  | { kind: "option"; value: string; label: React.ReactNode; disabled?: boolean; key: string }
  | { kind: "group"; label: string; key: string; items: Entry[] };

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

function collect(children: React.ReactNode, out: Entry[] = []): Entry[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p = child.props as { value?: unknown; label?: string; disabled?: boolean; children?: React.ReactNode };
    if (child.type === React.Fragment) {
      collect(p.children, out);
    } else if (child.type === "optgroup") {
      out.push({ kind: "group", label: p.label ?? "", key: `g${out.length}`, items: collect(p.children) });
    } else if (child.type === "option") {
      const label = p.children;
      out.push({ kind: "option", value: p.value != null ? String(p.value) : textOf(label), label, disabled: p.disabled, key: `o${out.length}` });
    }
  });
  return out;
}

function flat(entries: Entry[]): Extract<Entry, { kind: "option" }>[] {
  return entries.flatMap((e) => (e.kind === "group" ? flat(e.items) : [e]));
}

export type SelectChangeEvent = { target: { value: string }; currentTarget: { value: string } };

export type SelectProps = {
  id?: string;
  name?: string;
  className?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: SelectChangeEvent) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  children?: React.ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
};

function Select({ onChange, value, defaultValue, children, placeholder, className, disabled, required, name, ...aria }: SelectProps) {
  const entries = collect(children);
  const options = flat(entries);
  const selected = value !== undefined ? String(value) : undefined;
  // Show the matching option's label (or the placeholder); never render a stale blank.
  const current = options.find((o) => o.value === (selected ?? (defaultValue != null ? String(defaultValue) : undefined)));

  const renderEntry = (e: Entry): React.ReactNode =>
    e.kind === "group" ? (
      <SelectGroup key={e.key}>
        <SelectLabel>{e.label}</SelectLabel>
        {e.items.map(renderEntry)}
      </SelectGroup>
    ) : (
      <SelectItem key={e.key} value={enc(e.value)} disabled={e.disabled}>
        {e.label}
      </SelectItem>
    );

  return (
    <SelectRoot
      value={selected !== undefined ? enc(selected) : undefined}
      defaultValue={defaultValue != null ? enc(String(defaultValue)) : undefined}
      onValueChange={(v) => {
        const next = dec(v);
        onChange?.({ target: { value: next }, currentTarget: { value: next } });
      }}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectTrigger className={className} {...aria}>
        <span data-slot="select-value" className={cn("min-w-0 truncate", !current?.value && placeholder && "text-muted-foreground")}>
          {current ? (current.value === "" && placeholder ? placeholder : current.label) : placeholder ?? ""}
        </span>
      </SelectTrigger>
      <SelectContent>{entries.map(renderEntry)}</SelectContent>
    </SelectRoot>
  );
}

export { Select, SelectRoot, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator };
