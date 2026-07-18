function Block({
  className,
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`sx-shimmer rounded ${className ?? ""}`}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

export function LoadingSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1520px] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Workspace skeleton */}
      <div className="space-y-5">
        {/* Verdict hero placeholder */}
        <Block className="h-64 rounded-xl" delay={0} />

        {/* Signal grid — 4 cards in 2×2 */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Block className="h-36 rounded-xl" delay={120} />
          <Block className="h-36 rounded-xl" delay={240} />
          <Block className="h-36 rounded-xl" delay={360} />
          <Block className="h-36 rounded-xl" delay={480} />
        </div>
      </div>

      {/* History rail skeleton */}
      <div className="space-y-4">
        <Block className="h-12 rounded-lg" delay={160} />
        <Block className="h-96 rounded-xl" delay={280} />
      </div>
    </div>
  );
}
