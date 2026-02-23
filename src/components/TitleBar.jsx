/**
 * TitleBar
 *
 * A navbar inspired title bar, where the typical
 * page controls are the map controls instead
 *
 * Props:
 * - title: main heading displayed on the left
 * - controls: buttons displayed on the right
 */
export default function TitleBar({ title, controls }) {
  return (
    // Fixed top bar with subtle blur and border for separation from the map
    <header className="absolute top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/45 text-white backdrop-blur">
      
      {/* Container keeps spacing consistent across screen sizes */}
      <div className="mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        
        {/* Title is truncated to prevent layout breaking on small screens */}
        <h3 className="min-w-0 truncate text-lg font-bold italic">
          {title}
        </h3>

        {/* Controls are injected from App.jsx to keep this component reusable */}
        <div className="flex shrink-0 items-center gap-2">
          {controls}
        </div>
      </div>
    </header>
  );
}

