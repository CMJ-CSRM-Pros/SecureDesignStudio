export function IssueBadges({
  active,
  resolved,
}: {
  active: number;
  resolved: number;
}) {
  if (active === 0 && resolved === 0) return null;
  return (
    <span className="ps-issue-badges">
      {active > 0 && (
        <span
          className="ps-issue-badge ps-issue-badge-active"
          title={`${active} active issue${active === 1 ? "" : "s"}`}
        >
          ⚠ {active}
        </span>
      )}
      {resolved > 0 && (
        <span
          className="ps-issue-badge ps-issue-badge-resolved"
          title={`${resolved} resolved issue${resolved === 1 ? "" : "s"}`}
        >
          ✓ {resolved}
        </span>
      )}
    </span>
  );
}
