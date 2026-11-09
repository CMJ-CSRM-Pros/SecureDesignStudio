import { HoverTooltip } from "./HoverTooltip";
import { RichText } from "./RichText";
import type { CSSProperties } from "react";

// Renders a catalog label. If `description` is non-empty, the label becomes
// a hoverable trigger that reveals the description (with rich link rendering)
// on mouse hover or keyboard focus.
//
// When no description is provided, no extra DOM is added — the label renders
// as a plain <span>.
export function LabelWithTooltip({
  label,
  description,
  className,
  style,
}: {
  label: string;
  description?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const span = (
    <span
      className={
        description
          ? `ps-label-with-tooltip${className ? ` ${className}` : ""}`
          : className
      }
      style={style}
    >
      {label}
    </span>
  );
  if (!description || !description.trim()) return span;
  return (
    <HoverTooltip content={<RichText text={description} />}>{span}</HoverTooltip>
  );
}
