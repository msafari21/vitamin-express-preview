// Progressive enhancement: native values and change events remain authoritative.
let active;
let nextId = 0;
const widgets = new WeakMap();
const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7"/></svg>';

export function closeSelectMenu(restore = false) {
  if (!active) return;
  const current = active;
  active = null;
  if (current.menu.matches(':popover-open')) current.menu.hidePopover();
  current.trigger.setAttribute('aria-expanded', 'false');
  if (restore && current.trigger.isConnected) current.trigger.focus({preventScroll:true});
}

export function syncSelect(select) {
  const widget = widgets.get(select);
  if (!widget) return;
  const selected = select.selectedOptions[0];
  widget.text.textContent = selected?.textContent || '';
  widget.trigger.disabled = select.disabled;
  widget.trigger.setAttribute('aria-label', `${widget.label}: ${widget.text.textContent}`);
  widget.menu.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-checked', String(index === select.selectedIndex)));
}

function positionMenu(widget) {
  const rect = widget.trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop || 0;
  const left = viewport?.offsetLeft || 0;
  const height = viewport?.height || innerHeight;
  const width = viewport?.width || innerWidth;
  const below = top + height - rect.bottom - 14;
  const above = rect.top - top - 14;
  const up = below < Math.min(widget.menu.scrollHeight, 240) && above > below;
  widget.menu.style.width = `${Math.min(Math.max(rect.width, 240), width - 24)}px`;
  widget.menu.style.maxHeight = `${Math.max(44, Math.min(352, up ? above : below))}px`;
  widget.menu.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - parseFloat(widget.menu.style.width) - 12))}px`;
  widget.menu.style.top = `${up ? rect.top - widget.menu.getBoundingClientRect().height - 6 : rect.bottom + 6}px`;
}

function openMenu(widget, last = false) {
  closeSelectMenu();
  syncSelect(widget.select);
  active = widget;
  widget.menu.showPopover();
  positionMenu(widget);
  widget.trigger.setAttribute('aria-expanded', 'true');
  const options = [...widget.menu.querySelectorAll('button:not(:disabled)')];
  (last ? options.at(-1) : widget.menu.querySelector('[aria-checked="true"]:not(:disabled)') || options[0])?.focus({preventScroll:true});
  widget.menu.querySelector(':focus')?.scrollIntoView({block:'nearest'});
}

export function enhanceSelects(root = document) {
  if (!('showPopover' in HTMLElement.prototype)) return; // Older browsers keep working native controls.
  if (active && !active.trigger.isConnected) closeSelectMenu();
  for (const select of root.querySelectorAll('select:not([multiple])')) {
    if (widgets.has(select) || select.size > 1) continue;
    const labelCopy = select.labels?.[0]?.cloneNode(true);
    labelCopy?.querySelectorAll('select,input,button').forEach(node => node.remove());
    const label = select.getAttribute('aria-label') || labelCopy?.textContent.trim() || select.name || 'Options';
    const wrapper = document.createElement('div');
    wrapper.className = 'select-menu';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-menu-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<b></b>${chevron}`;
    const menu = document.createElement('div');
    menu.id = `select-menu-${++nextId}`;
    menu.className = 'select-menu-options';
    menu.setAttribute('popover', 'manual');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', menu.id);
    select.before(wrapper);
    wrapper.append(select, trigger, menu);
    select.hidden = true;
    const widget = {select, trigger, menu, wrapper, label, text:trigger.querySelector('b')};
    widgets.set(select, widget);
    [...select.options].forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'menuitemradio');
      button.dataset.value = option.value;
      button.disabled = option.disabled || option.parentElement.disabled === true;
      button.textContent = option.textContent;
      if (option.lang) button.lang = option.lang;
      button.addEventListener('click', () => {
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        syncSelect(select);
        closeSelectMenu(true);
        if (changed) {
          select.dispatchEvent(new Event('input', {bubbles:true}));
          select.dispatchEvent(new Event('change', {bubbles:true}));
        }
      });
      menu.append(button);
    });
    syncSelect(select);
    select.addEventListener('change', () => syncSelect(select));
    trigger.addEventListener('click', () => active === widget ? closeSelectMenu() : openMenu(widget));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(widget, event.key === 'ArrowUp'); }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSelectMenu(true); return; }
      const options = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = options.indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey) {
        const optionsAfter = [...options.slice(index + 1), ...options.slice(0, index + 1)];
        const match = optionsAfter.find(option => option.textContent.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
        if (match) { event.preventDefault(); match.focus(); }
      }
    });
    wrapper.addEventListener('focusout', () => setTimeout(() => {
      if (active === widget && !wrapper.contains(document.activeElement)) closeSelectMenu();
    }, 0));
  }
}

document.addEventListener('pointerdown', event => {
  if (active && !active.wrapper.contains(event.target)) closeSelectMenu();
}, true);
document.addEventListener('close', event => {
  if (active && event.target.contains(active.wrapper)) closeSelectMenu();
}, true);
document.addEventListener('scroll', event => {
  if (active && !active.menu.contains(event.target)) closeSelectMenu();
}, true);
window.addEventListener('resize', () => closeSelectMenu());
window.visualViewport?.addEventListener('resize', () => { if (active) positionMenu(active); });
