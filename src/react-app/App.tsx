// src/App.tsx

import { useState } from "react";
import "./App.css";

function App() {
  const [name, setName] = useState("unknown");

  return (
    <>
      <div id="control" className="control">
        <button className="control-bt"
          onClick={() => setSession((count) => count + 1)}
        >
        </button>
        <button className="control-bt"
          onClick={() => {
            fetch("/api/kv/hello")
              .then((res) => res.text() as Promise<string>)
              .then((data) => setName(data));
          }}
        >
          Name from API is: {name}
        </button>
      </div>
      <div className="media">
        <video id="video" autoPlay></video>
      </div>
    </>
  );
}

export default App;
