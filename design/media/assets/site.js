'use strict';
{
const designRoot = document.querySelector('.dr-our-design') || document;
const filters = [...designRoot.querySelectorAll('[data-filter]')];
for (const button of filters) {
  button.addEventListener('click', () => {
    const group = button.dataset.filter;
    for (const item of filters) item.setAttribute('aria-pressed', String(item === button));
    let shown = 0;
    for (const card of designRoot.querySelectorAll('.card[data-location]')) {
      card.hidden = (group === 'west' && card.dataset.location !== 'West Seattle') ||
        (group === 'completed' && card.dataset.completed !== 'true');
      if (!card.hidden) shown++;
    }
    designRoot.querySelector('#filter-status').textContent = shown + ' projects shown';
  });
}
for (const slider of designRoot.querySelectorAll('.compare-stage input')) {
  function setSplit() {
    slider.parentElement.style.setProperty('--split', slider.value + '%');
    slider.setAttribute('aria-valuetext', slider.value + ' percent ' + (slider.dataset.leftLabel || 'before'));
    slider.parentElement.querySelector('.badge.left').hidden = slider.value === '0';
    slider.parentElement.querySelector('.badge.right').hidden = slider.value === '100';
  }
  slider.addEventListener('input', setSplit);
  setSplit();
}
const photos = designRoot.querySelectorAll('[data-enlarge]');
if (photos.length && typeof HTMLDialogElement !== 'undefined') {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-lightbox';
  dialog.setAttribute('aria-label', 'Project photographs and drawings');
  const controls = document.createElement('div');
  controls.className = 'lightbox-controls';
  function control(text, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    return button;
  }
  const previous = control('←', 'Previous image');
  const next = control('→', 'Next image');
  const close = control('Close ×', 'Close image viewer');
  const position = document.createElement('span');
  const large = document.createElement('img');
  const caption = document.createElement('p');
  caption.setAttribute('aria-live', 'polite');
  controls.append(previous, position, next, close);
  dialog.append(controls, large, caption);
  document.body.append(dialog);
  let group = [];
  let index = 0;
  let opener;
  function showPhoto(step) {
    index = (index + step + group.length) % group.length;
    const photo = group[index];
    const description = photo.dataset.caption || photo.closest('figure')?.querySelector('figcaption')?.textContent || '';
    const alt = photo.querySelector('img')?.alt || description;
    large.alt = alt;
    large.src = photo.href;
    caption.textContent = description || alt;
    position.textContent = (index + 1) + ' / ' + group.length;
    previous.hidden = next.hidden = position.hidden = group.length < 2;
  }
  previous.addEventListener('click', () => showPhoto(-1));
  next.addEventListener('click', () => showPhoto(1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || group.length < 2) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      showPhoto(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('viewing-image');
    opener?.focus({preventScroll:true});
  });
  for (const photo of photos) {
    photo.addEventListener('click', event => {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = photo;
      const section = photo.closest('.paired-images, .gallery, .observation-photos, .reader-body, .compare-originals');
      group = section ? [...section.querySelectorAll('[data-enlarge]')] : [photo];
      index = group.indexOf(photo);
      showPhoto(0);
      dialog.showModal();
      document.body.classList.add('viewing-image');
      close.focus({preventScroll:true});
    });
  }
}
for (const panel of designRoot.querySelectorAll('.options-block')) {
  const choices = panel.querySelectorAll('[data-variant]');
  for (const choice of choices) {
    choice.addEventListener('click', () => {
      for (const item of choices) {
        const selected = item === choice;
        item.setAttribute('aria-pressed', String(selected));
        document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
      }
    });
  }
}
}
