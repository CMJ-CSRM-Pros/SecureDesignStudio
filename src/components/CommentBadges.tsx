export function CommentBadges({
  active,
  resolved,
}: {
  active: number;
  resolved: number;
}) {
  if (active === 0 && resolved === 0) return null;
  return (
    <span className="ps-comment-badges">
      {active > 0 && (
        <span
          className="ps-comment-badge ps-comment-badge-active"
          title={`${active} open comment${active === 1 ? "" : "s"}`}
        >
          💬 {active}
        </span>
      )}
      {resolved > 0 && (
        <span
          className="ps-comment-badge ps-comment-badge-resolved"
          title={`${resolved} resolved comment${resolved === 1 ? "" : "s"}`}
        >
          ✓ {resolved}
        </span>
      )}
    </span>
  );
}
