import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./themes.css";
import { ThemeProvider } from "./themes/ThemeProvider";
if (new URLSearchParams(location.search).get("nativeSmoke") === "1") {
  void import("./audio/native-smoke").then(module => {
    Object.defineProperty(window, "__prismNativeChecks", { value: module.runNativeSmoke });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider><App /></ThemeProvider>
  </React.StrictMode>,
);
