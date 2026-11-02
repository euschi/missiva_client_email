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
    // Il testo visibile serve a riconoscere i link che dicono una cosa e ne fanno un'altra.
    if (href) post({ type: "missiva-link", href: href, text: (link.textContent || "").trim().slice(0, 200) });
  };
  document.addEventListener("click", onLink, true);
  document.addEventListener("auxclick", function (e) {
    if (e.button === 1) onLink(e);
  }, true);

  // Passandoci sopra, la finestra principale mostra dove porta davvero il link.
  var hovered = null;
  document.addEventListener("mouseover", function (e) {
    var link = e.target && e.target.closest ? e.target.closest("a[href], area[href]") : null;
    var href = link ? link.getAttribute("href") : null;
    if (href === hovered) return;
    hovered = href;
    post({ type: "missiva-hover", href: href });
  }, true);
  document.addEventListener("mouseleave", function () {
    hovered = null;
    post({ type: "missiva-hover", href: null });
  });

  var measure = function () {
    post({ type: "missiva-height", height: Math.ceil(document.documentElement.scrollHeight) });
  };
  new ResizeObserver(measure).observe(document.documentElement);
  // Le immagini cambiano l'altezza man mano che arrivano.
  document.addEventListener("load", measure, true);
  addEventListener("load", measure);
})();
