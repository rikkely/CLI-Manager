import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initLogging } from "./lib/logger";

void initLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
