// Gira dentro l'iframe del messaggio HTML: è l'unico script ammesso dalla sua CSP.
// Avvisa la finestra principale dei clic sui link e dell'altezza del contenuto.
(function () {
  var post = function (data) {
    parent.postMessage(data, "*");
  };

  var onLink = function (e) {
    var link = e.target && e.target.closest ? e.target.closest("a, area") : null;
    if (!link) return;
    var href = (link.getAttribute("href") || link.getAttribute("xlink:href") || "").trim();
    // Le ancore interne scorrono il messaggio; il resto non deve mai navigare nel riquadro.
    if (href.charAt(0) === "#") return;
    e.preventDefault();
    if (href) post({ type: "missiva-link", href: href });
  };
  document.addEventListener("click", onLink, true);
  document.addEventListener("auxclick", function (e) {
    if (e.button === 1) onLink(e);
  }, true);

  var measure = function () {
    post({ type: "missiva-height", height: Math.ceil(document.documentElement.scrollHeight) });
  };
  new ResizeObserver(measure).observe(document.documentElement);
  // Le immagini cambiano l'altezza man mano che arrivano.
  document.addEventListener("load", measure, true);
  addEventListener("load", measure);
})();
