/* Indoor floor navigation for the published DuetRight bathroom model.
   Coordinates are glTF metres, with Y up. Stops are supplied by the scene. */
(function () {
  'use strict';

  const radiansToDegrees = 180 / Math.PI;
  const turningRadius = 0.05;
  const metres = numbers => numbers.map(number => `${number}m`).join(' ');

  function attach(model, walk, callbacks = {}) {
    const minPolar = walk.minPolar ?? 62;
    const clampPitch = angle => Math.max(minPolar, Math.min(118, angle));
    const stops = new Map(walk.stops.map(stop => [stop.key, stop]));
    const markers = new Map();
    const floorY = stop => Number.isFinite(stop.floorY) ? stop.floorY : 0;
    // Less than half a typical stair rise, so a tread never selects its neighbor above or below.
    const floorTolerance = 0.07;
    const start = stops.has(walk.start) ? walk.start : walk.stops[0].key;
    const events = new AbortController();
    const listen = (element, event, fn) => element.addEventListener(event, fn, {signal: events.signal});
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let current = start;
    let pendingHeading = null;
    let visibilityTimer;
    let pointer = null;
    let resizeObserver;
    const markerStyle = {
      border: '2px solid white', borderRadius: '50%', padding: '0', minWidth: '0',
      width: '30px', height: '18px', background: 'rgba(4, 94, 103, .75)',
      boxShadow: '0 0 0 2px rgba(31,35,36,.78), 0 1px 4px rgba(0,0,0,.45)', cursor: 'pointer',
    };

    for (const [name, value] of Object.entries({
      'camera-controls': '', 'disable-pan': '', 'disable-zoom': '', 'disable-tap': '',
      'orbit-sensitivity': '-0.7', 'interpolation-decay': reducedMotion.matches ? '0' : '120',
      'min-camera-orbit': `-Infinity ${minPolar}deg 0.05m`, 'max-camera-orbit': 'Infinity 118deg 0.05m',
      'min-field-of-view': '30deg', 'max-field-of-view': '100deg', 'field-of-view': '75deg',
      'environment-image': walk.environment || 'neutral', 'exposure': String(walk.exposure ?? 1), 'shadow-intensity': '0',
      'touch-action': 'none', 'interaction-prompt': 'none',
    })) model.setAttribute(name, value);
    model.removeAttribute('auto-rotate');
    model.style.touchAction = 'none';

    function visibleMarkers() {
      if (!model.loaded || events.signal.aborted) return;
      const bounds = model.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      for (const [key, button] of markers) {
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - bounds.left;
        const y = rect.top + rect.height / 2 - bounds.top;
        const stop = stops.get(key);
        let visible = current !== key && x > 0 && x < bounds.width && y > 0 && y < bounds.height;
        if (visible && typeof model.positionAndNormalFromPoint === 'function') {
          const hit = model.positionAndNormalFromPoint(x + bounds.left, y + bounds.top);
          visible = Boolean(hit && Math.abs(hit.position.y - floorY(stop)) <= floorTolerance && Math.hypot(hit.position.x - stop.position[0], hit.position.z - stop.position[1]) < 0.35);
        }
        button.style.visibility = visible ? 'visible' : 'hidden';
        button.tabIndex = visible ? 0 : -1;
        button.setAttribute('aria-hidden', String(!visible));
      }
    }

    function scheduleMarkers(delay = 100) {
      clearTimeout(visibilityTimer);
      visibilityTimer = setTimeout(visibleMarkers, delay);
    }

    function orient(yaw, pitch, immediate) {
      pendingHeading = [yaw, clampPitch(pitch)];
      model.cameraOrbit = `${yaw}deg ${pendingHeading[1]}deg ${turningRadius}m`;
      if ((immediate || reducedMotion.matches) && model.loaded) model.jumpCameraToGoal();
      scheduleMarkers(130);
    }

    function go(key, immediate = false) {
      const stop = stops.get(key);
      if (!stop || events.signal.aborted) return;
      current = key;
      const eye = [stop.position[0], floorY(stop) + walk.eyeHeight, stop.position[1]];
      const direction = stop.look.map((value, axis) => value - eye[axis]);
      const yaw = Math.atan2(-direction[0], -direction[2]) * radiansToDegrees;
      const pitch = Math.acos(-direction[1] / Math.hypot(...direction)) * radiansToDegrees;
      model.cameraTarget = metres(eye);
      model.fieldOfView = '75deg';
      orient(yaw, pitch, immediate);
      callbacks.onStop?.(key, stop);
    }

    function turn(degrees, tilt = 0) {
      if (!model.loaded || events.signal.aborted) return;
      const orbit = model.getCameraOrbit();
      const [yaw, pitch] = pendingHeading || [orbit.theta * radiansToDegrees, orbit.phi * radiansToDegrees];
      orient(yaw + degrees, pitch + tilt, reducedMotion.matches);
    }

    for (const stop of stops.values()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'walk-floor-stop';
      button.slot = `hotspot-floor-${stop.key}`;
      button.dataset.position = metres([stop.position[0], floorY(stop) + 0.01, stop.position[1]]);
      button.dataset.normal = '0m 1m 0m';
      button.setAttribute('aria-label', `Walk to ${stop.label}`);
      button.title = `Walk to ${stop.label}`;
      button.style.visibility = 'hidden';
      Object.assign(button.style, markerStyle);
      for (const event of ['pointerdown', 'pointerup']) listen(button, event, e => e.stopPropagation());
      listen(button, 'click', event => { event.stopPropagation(); go(stop.key); });
      model.appendChild(button);
      markers.set(stop.key, button);
    }
    const ring = document.createElement('span');
    ring.slot = 'hotspot-floor-pointer';
    ring.dataset.position = '0m -5m 0m';
    ring.dataset.normal = '0m 1m 0m';
    ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, markerStyle, {background: 'transparent', width: '24px', height: '13px', pointerEvents: 'none', visibility: 'hidden'});
    model.appendChild(ring);

    function nearbyStop(pos, includeCurrent = false) {
      let nearest = null, distance = 1.2;
      for (const stop of stops.values()) {
        if ((!includeCurrent && stop.key === current) || Math.abs(pos.y - floorY(stop)) > floorTolerance) continue;
        const d = Math.hypot(pos.x - stop.position[0], pos.z - stop.position[1]);
        if (d < distance) { distance = d; nearest = stop; }
      }
      return nearest;
    }
    function hitFloor(event) {
      if (!model.loaded || typeof model.positionAndNormalFromPoint !== 'function') return null;
      const hit = model.positionAndNormalFromPoint(event.clientX, event.clientY);
      return hit && hit.normal.y > 0.8 && nearbyStop(hit.position, true) ? hit.position : null;
    }
    listen(model, 'pointermove', event => {
      if (pointer || event.pointerType !== 'mouse') return;
      const pos = hitFloor(event);
      ring.style.visibility = pos ? 'visible' : 'hidden';
      if (pos) model.updateHotspot({name: ring.slot, position: metres([pos.x, pos.y + 0.012, pos.z])});
    });
    listen(model, 'pointerleave', () => { ring.style.visibility = 'hidden'; });
    listen(model, 'pointercancel', () => { pointer = null; });
    listen(model, 'pointerdown', event => {
      pendingHeading = null;
      ring.style.visibility = 'hidden';
      pointer = event.isPrimary && event.button === 0 ? [event.clientX, event.clientY] : null;
    });
    listen(model, 'pointerup', event => {
      const down = pointer;
      pointer = null;
      if (!down || !event.isPrimary || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 8) return;
      const pos = hitFloor(event);
      if (!pos) return;
      const nearest = nearbyStop(pos);
      if (nearest) go(nearest.key);
    });
    listen(model, 'camera-change', event => {
      if (event.detail?.source === 'user-interaction') pendingHeading = null;
      scheduleMarkers();
    });
    listen(model, 'keydown', event => {
      if (event.target !== model) return;
      const offset = {ArrowLeft:[15,0], ArrowRight:[-15,0], ArrowUp:[0,8], ArrowDown:[0,-8]}[event.key];
      if (!offset) return;
      event.preventDefault(); event.stopPropagation(); turn(...offset);
    });
    listen(model, 'load', () => { go(current, true); scheduleMarkers(300); });
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => scheduleMarkers());
      resizeObserver.observe(model);
    }
    go(start,true);
    return {
      go, turn, reset: () => go(start,true), get here() { return current; },
      destroy() {
        events.abort(); clearTimeout(visibilityTimer); resizeObserver?.disconnect();
        for (const button of markers.values()) button.remove();
        ring.remove();
      },
    };
  }
  window.DuetRightWalk = {attach};
})();
