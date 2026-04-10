import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PreviewPage from "./PreviewPage";
import "./styles/globals.css";

const isPreview = window.location.search.includes("preview=1");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPreview ? <PreviewPage /> : <App />}
  </React.StrictMode>
);
