export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-surface rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 bg-surface rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-surface rounded-lg" />
      <div className="h-48 bg-surface rounded-lg" />
    </div>
  )
}
