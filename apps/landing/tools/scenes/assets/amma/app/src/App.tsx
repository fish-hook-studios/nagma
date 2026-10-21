import { useState } from "react";
import { ART, DECOR, ICON } from "./assets";

type Tab = "search" | "places" | "names" | "journal";
type Place = { id: string; n: number; label: string; title: string; note: string; art: string; x: number; y: number; status: "remembered" | "revisit" };

const PLACES: Place[] = [
  { id: "tea-shop", n: 1, label: "Tea shop", title: "The tea shop", note: "Where she bought me sweets before the bus.", art: ART.teaShop, x: 22.5, y: 80, status: "remembered" },
  { id: "old-house", n: 2, label: "Old house", title: "The old house", note: "A place from before we were separated.", art: ART.oldHouse, x: 72.5, y: 55, status: "revisit" },
  { id: "school", n: 3, label: "School", title: "The school", note: "The courtyard with the big tree.", art: ART.school, x: 25, y: 25, status: "remembered" },
];
const NAMES = [
  { n: "01", tone: "rust", where: "At the tea shop", sub: "Name she used", art: ART.teaShop, value: "" },
  { n: "02", tone: "petrol", where: "At school", sub: "What I told my teacher.", art: ART.school, value: "memory" },
  { n: "03", tone: "mustard", where: "At the old house", sub: "Connect a name to this place.", art: ART.oldHouse, value: "detail" },
];
const JOURNAL = [
  { when: "Last week", title: "The smell of the kettle", body: "Cardamom. She always added one more pod than needed.", art: ART.teaShop },
  { when: "Two weeks ago", title: "The blue gate", body: "I remember it being taller than me. It may not be any more.", art: ART.oldHouse },
];

const Icon = ({ name, size = 22 }: { name: keyof typeof ICON; size?: number }) => <span className="icon" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: ICON[name] }} aria-hidden />;
const Torn = ({ diagonal = false, color }: { diagonal?: boolean; color: string }) => <div className={"torn" + (diagonal ? " diag" : "")} style={{ color }} dangerouslySetInnerHTML={{ __html: diagonal ? DECOR.tornDiagonal : DECOR.torn }} aria-hidden />;
const Sprig = ({ flip = false, where }: { flip?: boolean; where: string }) => <img className={"sprig " + where + (flip ? " flip" : "")} src={ART.sprig} alt="" aria-hidden />;

export function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [filter, setFilter] = useState<"all" | "remembered" | "revisit">("all");
  const [picked, setPicked] = useState<Place>(PLACES[1]);
  const shown = PLACES.filter((p) => filter === "all" || p.status === filter);
  return (
    <div className="app">
      <main className="screen">
        {tab === "search" && (
          <>
            <header className="head rust">
              <Sprig where="tr" />
              <div className="bar"><b className="wordmark">amma.</b><span className="avatar">B</span></div>
              <p className="eyebrow light">Balan's search journal</p>
              <h1 className="display">every memory brings me closer.</h1>
            </header>
            <div className="still"><img src={ART.motherAndSon} alt="Amma holding Balan's hand on the path by the old house" /><Torn color="#F5E7C8" /></div>
            <section className="paper">
              <p className="eyebrow rust-text">Continue the search</p>
              <div className="row-head">
                <h2 className="memory-title">The house we stayed in</h2>
                <span className="chip">To revisit</span>
              </div>
              <div className="row-sub"><span>Start with what you remember.</span><button className="link" onClick={() => setTab("places")} aria-label="Open the house"><Icon name="arrowRight" /></button></div>
              <div className="tiles">
                <button className="tile" onClick={() => setTab("places")}><img src={ART.oldHouse} alt="" /><span><b className="memory-title">Places we lived</b><Icon name="arrowRight" size={20} /></span></button>
                <button className="tile" onClick={() => setTab("names")}><img src={ART.teaShop} alt="" /><span><b className="memory-title">Names we used</b><Icon name="arrowRight" size={20} /></span></button>
              </div>
              <button className="primary"><Icon name="plus" size={20} /> Add a memory</button>
            </section>
          </>
        )}
        {tab === "places" && (
          <>
            <header className="head petrol">
              <Sprig where="tr" flip />
              <h1 className="display">the places we left behind.</h1>
              <p className="lede light">Memories first. Leads to follow.</p>
              <div className="tabs" role="tablist">
                {(["all", "remembered", "revisit"] as const).map((f) => (
                  <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "remembered" ? "Remembered" : "To revisit"}</button>
                ))}
              </div>
            </header>
            <div className="map-stage">
              <div className="map-layer" dangerouslySetInnerHTML={{ __html: DECOR.mapBase }} aria-hidden />
              <div className="map-layer" dangerouslySetInnerHTML={{ __html: DECOR.mapRoute }} aria-hidden />
              {shown.map((p) => (
                <button key={p.id} className={"map-pin" + (picked.id === p.id ? " on" : "")} style={{ left: p.x + "%", top: p.y + "%" }} onClick={() => setPicked(p)} aria-label={p.label}>
                  <img src={p.art} alt="" />
                  <span><i>{p.n}</i>{p.label}</span>
                </button>
              ))}
              <small className="map-note">Memory map · locations approximate</small>
              <Torn color="#F5E7C8" />
            </div>
            <section className="paper">
              <p className="eyebrow rust-text">{picked.status === "remembered" ? "Remembered place" : "To revisit"}</p>
              <div className="detail">
                <div>
                  <h2 className="display small">{picked.title}</h2>
                  <p className="muted">{picked.note}</p>
                  <button className="primary inline" onClick={() => setTab("journal")}>Open memory <Icon name="arrowRight" size={18} /></button>
                </div>
                <img className="photo" src={picked.art} alt={picked.title} />
              </div>
            </section>
          </>
        )}
        {tab === "names" && (
          <>
            <header className="head cream">
              <Sprig where="tr" />
              <div className="bar"><button className="link" onClick={() => setTab("search")} aria-label="Back"><Icon name="arrowLeft" /></button><span className="eyebrow rust-text">My journal</span><span /></div>
              <h1 className="display ox">the names we carried.</h1>
              <p className="lede">Different places. Different names. The same Amma.</p>
            </header>
            <section className="paper">
              <ol className="names">
                {NAMES.map((e) => (
                  <li key={e.n} className={"entry " + e.tone}>
                    <b className="num">{e.n}</b>
                    <div className="body">
                      <h2 className="memory-title">{e.where}</h2>
                      {e.value === "" && (<><p className="eyebrow">{e.sub}</p><input className="field" placeholder="Add the name I remember" aria-label={"Name used " + e.where.toLowerCase()} /></>)}
                      {e.value === "memory" && (<><p className="muted">{e.sub}</p><span className="chip">Memory</span></>)}
                      {e.value === "detail" && (<><p className="muted">{e.sub}</p><button className="link text">Add a detail <Icon name="arrowRight" size={16} /></button></>)}
                    </div>
                    <img src={e.art} alt="" />
                  </li>
                ))}
              </ol>
              <div className="note"><Icon name="pencil" size={20} /><div><b>Not every memory is clear yet.</b><small>Some names, places and details may be incomplete. That's part of the journey.</small></div></div>
              <div className="actions"><button className="ghost"><Icon name="microphone" size={20} /> Record a note</button><button className="ghost"><Icon name="camera" size={20} /> Attach a photo</button></div>
              <button className="primary"><Icon name="plus" size={20} /> Add a name or memory</button>
            </section>
          </>
        )}
        {tab === "journal" && (
          <>
            <header className="head cream">
              <Sprig where="tr" flip />
              <span className="eyebrow rust-text">My journal</span>
              <h1 className="display ox">what I wrote down.</h1>
              <p className="lede">Every saved memory, newest first.</p>
            </header>
            <section className="paper">
              {JOURNAL.map((j) => (
                <article key={j.title} className="entry mustard journal">
                  <img src={j.art} alt="" />
                  <div className="body"><p className="eyebrow">{j.when}</p><h2 className="memory-title">{j.title}</h2><p className="muted">{j.body}</p></div>
                </article>
              ))}
              <button className="primary"><Icon name="plus" size={20} /> Add a memory</button>
            </section>
          </>
        )}
      </main>
      <nav className="tabsbar" aria-label="Sections">
        {([["search", "Search", "search"], ["places", "Places", "pin"], ["names", "Names", "names"], ["journal", "Journal", "journal"]] as const).map(([id, label, icon]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}><Icon name={icon} /><span>{label}</span></button>
        ))}
      </nav>
    </div>
  );
}
