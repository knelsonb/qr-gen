// The two DOM helpers every app module uses.

export const $ = id => document.getElementById(id);

export function clear(element) {
  element.replaceChildren();
}
