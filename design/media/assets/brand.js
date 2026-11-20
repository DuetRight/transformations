(() => {
  const portfolioHost = document.body.dataset.portfolioOrigin;
  // Preserve old bookmarked rooms and close-ups when opening the public mirror.
  const nativePage = document.body.dataset.nativePage;
  if (nativePage && location.host === portfolioHost) {
    const destination = new URL(nativePage);
    destination.search = location.search;
    destination.hash = location.hash;
    location.replace(destination.href);
    return;
  }
  if (portfolioHost && location.host !== portfolioHost) {
    for (const link of document.querySelectorAll('a[data-local-home]')) {
      link.setAttribute('href', link.dataset.localHome);
    }
  }
  const header = document.querySelector('[data-brand-nav]');
  if (!header) return;
  const menu = header.querySelector('.dr-primary');
  const button = header.querySelector('.dr-menu-toggle');
  const groups = [...menu.querySelectorAll('.dr-drop')];
  function closeGroups(except) {
    for (const group of groups) if (group !== except) group.open = false;
  }
  function setMenu(open) {
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close main menu' : 'Open main menu');
    menu.classList.toggle('is-open', open);
    if (!open) closeGroups();
  }
  button.addEventListener('click', () => setMenu(button.getAttribute('aria-expanded') !== 'true'));
  for (const group of groups) {
    group.addEventListener('toggle', () => { if (group.open) closeGroups(group); });
    group.addEventListener('focusout', event => { if (!group.contains(event.relatedTarget)) group.open = false; });
  }
  document.addEventListener('click', event => { if (!header.contains(event.target)) setMenu(false); });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = groups.find(group => group.open);
    if (open) { open.open = false; open.querySelector('summary').focus(); }
    else if (menu.classList.contains('is-open')) { setMenu(false); button.focus(); }
  });
  matchMedia('(min-width:992px)').addEventListener('change', () => setMenu(false));
})();
