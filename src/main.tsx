import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Tag platform early so CSS can conditionally skip expensive effects (e.g. backdrop-filter blur)
if (/linux/i.test(navigator.platform) || /linux/i.test(navigator.userAgent)) {
  document.documentElement.dataset.platform = "linux";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
