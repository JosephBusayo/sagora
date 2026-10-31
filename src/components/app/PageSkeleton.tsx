/** Shaped like the screen it stands in for, so nothing jumps when the content arrives. */
export function PageSkeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading">
      <div className="nav skeleton-nav" aria-hidden="true">
        <span className="skeleton skeleton--brand" />
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton skeleton--nav" />)}
      </div>
      <div className="app__panel" aria-hidden="true">
        <div className="topbar"><span className="skeleton skeleton--crumb" /></div>
        <div className="app__content">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--sub" />
          <div className="skeleton-cards">
            {Array.from({ length: 3 }, (_, i) => <span key={i} className="skeleton skeleton--card" />)}
          </div>
          {Array.from({ length: 5 }, (_, i) => <span key={i} className="skeleton skeleton--row" />)}
        </div>
      </div>
    </div>
  );
}
