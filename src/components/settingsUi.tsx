/**
 * The bits of chrome every settings pane is built from.
 *
 * Shared rather than local to `SettingsView` so a pane can live in its own file
 * without either duplicating the styling or importing the screen that hosts it.
 */

import type { ReactNode } from "react";

import { Icon, RaveLabel } from "./ui";

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        fontSize: 26,
        letterSpacing: "-0.02em",
        marginBottom: 20,
      }}
    >
      {children}
    </h2>
  );
}

export function Card({
  children,
  tone,
  backdrop,
}: {
  children: ReactNode;
  tone?: "warning";
  /** Something live to fill the card behind its contents, edge to edge. */
  backdrop?: ReactNode;
}) {
  return (
    <div
      style={{
        // Only a card with a backdrop clips: anything else may hold a menu or
        // popover that has to hang over the edge.
        ...(backdrop != null && { position: "relative", overflow: "hidden" }),
        background: "var(--surface-card)",
        border: `1px solid ${tone === "warning" ? "rgba(255,194,77,.35)" : "var(--border-subtle)"}`,
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
      }}
    >
      {backdrop == null ? (
        children
      ) : (
        <>
          {backdrop}
          <div style={{ position: "relative" }}>{children}</div>
        </>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <RaveLabel style={{ marginBottom: 7 }}>{label}</RaveLabel>
      {children}
      {hint && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export const inputStyle = {
  width: "100%",
  background: "var(--surface-inset)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 14,
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontSize: 13.5,
  outline: "none",
} as const;

export function Row({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {icon && <Icon name={icon} size={18} color="var(--text-tertiary)" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>
          {title}
        </div>
        {subtitle && (
          <div
            className="selectable"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
