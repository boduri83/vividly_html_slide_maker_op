/* Local progressive enhancement. No storage, analytics or external service calls. */
document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');
if (menuButton && navigation) {
  const closeMenu = () => {
    menuButton.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  };
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });
  const menuMedia = window.matchMedia('(min-width: 601px)');
  if (menuMedia.addEventListener) menuMedia.addEventListener('change', closeMenu);
  else menuMedia.addListener(closeMenu);
}

const editorImage = document.querySelector('#editor-image');
const editorFallback = document.querySelector('#editor-fallback');
if (editorImage && editorFallback) {
  const showEditor = () => {
    if (!editorImage.naturalWidth) return;
    editorImage.hidden = false;
    editorFallback.hidden = true;
    const caption = document.querySelector('#editor-caption');
    if (caption) caption.textContent = 'Vividly의 실제 편집 화면';
    const imageLink = document.querySelector('#editor-image-link');
    if (imageLink) imageLink.hidden = false;
  };
  const showBrand = () => {
    editorImage.hidden = true;
    editorFallback.hidden = false;
  };
  editorImage.addEventListener('load', showEditor);
  editorImage.addEventListener('error', showBrand);
  if (editorImage.complete) editorImage.naturalWidth ? showEditor() : showBrand();
}
