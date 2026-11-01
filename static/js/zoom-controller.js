export function createMapZoomController({
  container,
  zoomInput,
  zoomValue,
  zoomOutBtn,
  zoomInBtn,
  zoomResetBtn,
  minZoom = 1,
  maxZoom = 5,
  step = 0.25,
}) {
  let currentZoom = 1;
  let isDragging = false;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;

  const setZoom = (nextZoom) => {
    currentZoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
    container.classList.toggle("is-zoomed", currentZoom > 1);
    const svg = container.querySelector("svg");
    if (svg) {
      const centerX = container.scrollWidth ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : .5;
      const centerY = container.scrollHeight ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight : .5;
      svg.style.width = `${currentZoom * 100}%`;
      svg.style.height = `${currentZoom * 100}%`;
      requestAnimationFrame(() => {
        container.scrollLeft = centerX * container.scrollWidth - container.clientWidth / 2;
        container.scrollTop = centerY * container.scrollHeight - container.clientHeight / 2;
      });
    }
    if (zoomValue) zoomValue.textContent = `${Math.round(currentZoom * 100)}%`;
    if (zoomInput) zoomInput.value = String(currentZoom);
    if (zoomOutBtn) zoomOutBtn.disabled = currentZoom <= minZoom;
    if (zoomInBtn) zoomInBtn.disabled = currentZoom >= maxZoom;
    if (zoomResetBtn) zoomResetBtn.disabled = currentZoom === 1;
  };

  zoomOutBtn?.addEventListener("click", () => setZoom(currentZoom - step));
  zoomInBtn?.addEventListener("click", () => setZoom(currentZoom + step));
  zoomResetBtn?.addEventListener("click", () => setZoom(1));
  zoomInput?.addEventListener("input", (event) => setZoom(Number(event.target.value)));

  container.addEventListener("pointerdown", (event) => {
    if (currentZoom <= 1 || event.button !== 0) return;
    isDragging = true;
    hasDragged = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    scrollStartX = container.scrollLeft;
    scrollStartY = container.scrollTop;
    container.classList.add("is-dragging");
  });

  window.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasDragged = true;
    }
    container.scrollLeft = scrollStartX - dx;
    container.scrollTop = scrollStartY - dy;
  });

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    container.classList.remove("is-dragging");
  };
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);

  return {
    getZoom: () => currentZoom,
    setZoom,
    reset: () => setZoom(1),
    hasDragged: () => hasDragged,
    clearDragged: () => { hasDragged = false; },
    isDragging: () => isDragging,
  };
}
