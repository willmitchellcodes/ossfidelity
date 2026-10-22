// Category and host filters for the Browse table.
const rows = [...document.querySelectorAll("#board tbody tr")];
const state = { cat: "all", host: "all" };
document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
  const key = b.dataset.cat !== undefined ? "cat" : "host";
  state[key] = b.dataset[key];
  document.querySelectorAll(`.filters button[data-${key}]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  for (const r of rows) {
    const host = r.dataset.host;
    const hostOk = state.host === "all" || host === state.host;
    r.hidden = !((state.cat === "all" || r.dataset.cat === state.cat) && hostOk);
  }
}));
