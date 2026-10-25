/**
 * iOS only raises the keyboard for a focus() that runs inside the tap's own handler, but the search
 * page mounts (and focuses its box) a render later. Call this from the tap: it focuses an invisible
 * stand-in input right away, so the keyboard comes up, and the real box takes the focus over
 * (moving focus between inputs keeps the keyboard). The stand-in removes itself once it loses focus.
 */
export function primeKeyboard(): void {
  if (typeof document === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  // 16px: smaller text makes iOS zoom the page in on focus
  input.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;pointer-events:none;';
  document.body.appendChild(input);
  const remove = () => input.remove();
  input.addEventListener('blur', remove, { once: true });
  input.focus({ preventScroll: true });
  // In case the search page never takes the focus over
  setTimeout(() => {
    if (document.activeElement === input) input.blur();
    remove();
  }, 2500);
}
