function TitleBar({ title }) {
  return (
    <header className="absolute top-0 left-0 right-0 z-30 bg-white/90 backdrop-blur">
      <div className="mx-auto h-16 pt-4 px-4 sm:px-6 lg:px-8">
        <h3 className="text-center text-lg font-bold italic text-black">
          {title}
        </h3>
      </div>
    </header>
  );
}

export default TitleBar;
