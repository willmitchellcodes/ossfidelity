// Self-repair after a deploy. GitHub Pages lets browsers cache files for ~10 minutes, so a
// visitor can briefly mix an old cached module with a new one ("does not provide an export…"),
// which leaves the page blank. If that happens, refetch every module fresh once and reload.
(function () {
  var base = (document.currentScript && document.currentScript.src || "").replace(/\/assets\/js\/heal\.js.*$/, "");
  var KEY = "ossf-healed";
  function seen() { try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return true; } }
  function mark() { try { sessionStorage.setItem(KEY, "1"); } catch (e) {} }
  window.addEventListener("error", function (ev) {
    var msg = String(ev && ev.message || "");
    if (!/does not provide an export|SyntaxError|Importing a module script failed/i.test(msg) || seen()) return;
    mark();
    fetch(base + "/assets/data/modules.json", { cache: "reload" })
      .then(function (r) { return r.json(); })
      .then(function (list) { return Promise.all(list.map(function (u) { return fetch(u, { cache: "reload" }); })); })
      .catch(function () {})
      .then(function () { location.reload(); });
  });
})();
