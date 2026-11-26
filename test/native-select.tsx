import * as React from "react";
import type { SelectProps } from "../components/ui/select";

// Vitest-only stand-in for components/ui/select (Radix needs real pointer/layout APIs that jsdom lacks).
// Renders a native <select> so UI-logic tests can keep using fireEvent.change / getByLabelText.
export function Select({ onChange, children, className, placeholder: _p, ...rest }: SelectProps) {
  return (
    <select className={className} onChange={(e) => onChange?.(e)} {...rest}>
      {children}
    </select>
  );
}
