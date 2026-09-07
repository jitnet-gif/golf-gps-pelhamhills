export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold">Golf GPS</h1>
      <p className="text-lg text-muted-foreground">
        GPS-based golf course navigation and scoring
      </p>
      <div className="grid grid-cols-2 gap-4 mt-8">
        <button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition">
          Find Courses
        </button>
        <button className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-semibold hover:opacity-90 transition">
          Start Game
        </button>
      </div>
    </main>
  );
}
