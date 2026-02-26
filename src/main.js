import "./styles.css";
import { initAppShell } from "./ui/appShell";

initAppShell(document.querySelector("#app")).catch((error) => {
  const root = document.querySelector("#app");
  if (root) {
    root.innerHTML = `<pre class="fatal-error">${String(error.message || error)}</pre>`;
  }
  // eslint-disable-next-line no-console
  console.error(error);
});
