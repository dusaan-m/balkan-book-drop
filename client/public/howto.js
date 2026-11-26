function initHowto() {
  const dialog = document.getElementById('howto-dialog');
  const openBtn = document.getElementById('howto-toggle');
  if (!dialog || !openBtn || typeof dialog.showModal !== 'function') {
    return;
  }

  function openModal() {
    dialog.showModal();
    const form = dialog.querySelector('.howto-form');
    if (form) {
      form.scrollTop = 0;
    }
  }

  openBtn.addEventListener('click', openModal);

  // Require both mousedown and mouseup on the backdrop, so a text-drag that ends outside
  // the content area doesn't close the dialog.
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', (e) => {
    downOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('mouseup', (e) => {
    if (downOnBackdrop && e.target === dialog) {
      dialog.close();
    }
    downOnBackdrop = false;
  });

  dialog.addEventListener('close', () => {
    try {
      localStorage.setItem('bookdrop-howto-seen', '1');
    } catch (_) {}
  });

  let seen = null;
  try {
    seen = localStorage.getItem('bookdrop-howto-seen');
  } catch (_) {}
  const hasKeyParam = new URLSearchParams(location.search).has('key');
  if (!seen && !hasKeyParam) {
    openModal();
  }
}

document.addEventListener('DOMContentLoaded', initHowto);
