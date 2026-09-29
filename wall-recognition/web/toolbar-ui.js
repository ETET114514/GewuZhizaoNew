'use strict';
(() => {
  const tabs = [...document.querySelectorAll('#workspace-toolbar [role="tab"]')];
  function activate(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); activate(tabs[index], true);
    });
  }
})();
