import { TopBar } from './ui/TopBar';

export function App() {
  return (
    <div className="app">
      <TopBar round={null} phase="P0 — pipeline" />
      <main className="board-area">
        <p className="placeholder">
          The mist is gathering.
          <br />
          <span className="placeholder-sub">Brumachlys II — build pipeline live.</span>
        </p>
      </main>
    </div>
  );
}
