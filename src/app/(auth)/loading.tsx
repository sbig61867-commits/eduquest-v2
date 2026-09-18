export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 animate-pulse" aria-hidden="true">
        <div className="h-10 w-40 bg-surface rounded-lg mx-auto" />
        <div className="h-64 bg-surface rounded-xl" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  )
}
