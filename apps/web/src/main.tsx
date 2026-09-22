import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import App from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Reset the document defaults xterm's stylesheet does not cover.
document.body.style.margin = "0";
document.documentElement.style.background = "#0b0b0d";
