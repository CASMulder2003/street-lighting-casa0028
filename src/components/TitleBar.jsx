export default function TitleBar({ title, controls }) {
  return (
    <header className="absolute top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/45 text-white backdrop-blur">
      <div className="mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <h3 className="min-w-0 truncate text-lg font-bold italic">
          {title}
        </h3>

        <div className="flex shrink-0 items-center gap-2">
          {controls}
        </div>
      </div>
    </header>
  );
}

