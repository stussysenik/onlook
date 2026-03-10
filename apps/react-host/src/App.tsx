export default function App() {
  return (
    <div className="frame">
      <aside className="sidebar">
        <p className="eyebrow">Onlook Target</p>
        <h1>React Product Surface</h1>
        <p className="lede">This running app is the live attachment target for the new studio shell.</p>
        <div className="panel-list">
          <section className="side-card">
            <h2>Launch faster</h2>
            <p>Source-aware visual changes should land here, not in a synthetic preview pane.</p>
          </section>
          <section className="side-card">
            <h2>Customer signal</h2>
            <p>Track what needs polish, then push the UI directly through local file edits.</p>
          </section>
        </div>
      </aside>

      <main className="canvas">
        <header className="hero">
          <div>
            <p className="eyebrow">Shipping workspace</p>
            <h2>Product cockpit</h2>
            <p className="lede">A React surface the Onlook studio can attach to and mutate in place.</p>
          </div>
          <button className="primary-action">Review launch state</button>
        </header>

        <section className="metrics">
          <article className="metric-card">
            <span className="metric-label">Activation</span>
            <strong>62%</strong>
            <p>Users reaching their first polished screen in one session.</p>
          </article>
          <article className="metric-card">
            <span className="metric-label">Build confidence</span>
            <strong>7.8/10</strong>
            <p>Editor trust after direct file-write sessions.</p>
          </article>
          <article className="metric-card">
            <span className="metric-label">Iteration speed</span>
            <strong>3.4x</strong>
            <p>Compared with bouncing between devtools and code manually.</p>
          </article>
        </section>

        <section className="board">
          <article className="board-card">
            <span className="badge">Live canvas</span>
            <h3>Overlay selection</h3>
            <p>Hover and click these DOM nodes from the studio to test the first real bridge.</p>
            <button className="secondary-action">Inspect bounds</button>
          </article>

          <article className="board-card accent-card">
            <span className="badge">Immediate write</span>
            <h3>Direct source mutation</h3>
            <p>Text and className updates should rewrite this React file and hot reload immediately.</p>
            <button className="secondary-action">Apply polish</button>
          </article>
        </section>
      </main>
    </div>);

}
