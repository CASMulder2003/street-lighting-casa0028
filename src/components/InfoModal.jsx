import { useEffect } from "react";

export default function InfoModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const articleUrl =
    "https://www.euronews.com/2025/08/22/death-of-a-17-year-old-teenager-in-the-netherlands-sparks-outrage-over-violence-against-wo";

  return (
    <div
      className="absolute inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Project information"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/15 bg-black/70 p-6 text-white backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Motivation & Context</h2>
            <p className="mt-1 text-xs text-white/60">
              Amsterdam Night Lighting — project background
            </p>
          </div>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-1 text-sm hover:border-white/30"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <hr className="border-white/10 my-4" />

        {/* Content */}
        <div className="space-y-4 text-sm text-white/85 leading-relaxed">
          <p>
            This project was inspired by discussions about{" "}
            <span className="font-medium">urban safety</span> and{" "}
            <span className="font-medium">night-time travel</span> after a
            widely reported incident near Amsterdam in which a 17-year-old
            girl was violently attacked while cycling home after a night out.
            The case received national and international attention and sparked
            public debate about how women and vulnerable road users experience
            public space after dark, including concerns about{" "}
            <span className="font-medium">
              lighting and perceived safety
            </span>.
          </p>

          <p>
            The goal of this visualization is{" "}
            <span className="font-medium">not</span> to imply that unlit roads{" "}
            <span className="font-medium">cause</span> crime, but to provide
            spatial insight into where roads are tagged as lit or unlit in
            OpenStreetMap, and to encourage reflection on how urban space is
            experienced at night, and how its design can influence feelings of
            safety or exposure.
          </p>

          {/* External Link Box */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase tracking-wide text-white/60">
              Context link
            </div>

            <a
              href={articleUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-2 text-sm text-sky-300 hover:underline"
            >
              Read news article for context ↗
            </a>

            <p className="mt-2 text-xs text-white/55">
              The linked article discusses violence and may be distressing to some readers.
            </p>

            <p className="mt-1 text-xs text-white/40">
              Opens in a new tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}