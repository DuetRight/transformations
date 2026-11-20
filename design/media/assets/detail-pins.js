'use strict';

(() => {
  const attached = new WeakMap();
  const surfaceTolerance = 0.065; // metres, including millimetre-scale glass and bevels

  function isClearGlass(model, x, y, surface = model.surfaceFromPoint(x, y)) {
    if (!surface) return false;
    const [meshIndex, primitiveIndex] = surface.split(' ', 2).map(Number);
    const gltf = model.originalGltfJson;
    const primitive = gltf?.meshes[meshIndex]?.primitives[primitiveIndex];
    const material = gltf?.materials?.[primitive?.material];
    return material?.alphaMode === 'BLEND' &&
      (material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1) <= 0.3;
  }

  function surfaceVisible(model, hotspot, box) {
    if (!hotspot?.facingCamera) return null;
    const {x, y, z} = hotspot.canvasPosition;
    if (z < -1 || z > 1) return null;
    const inset = 14;
    if (x < inset || y < inset || x > box.width - inset || y > box.height - inset) return null;
    const px = box.left + x;
    const py = box.top + y;
    const hit = model.positionAndNormalFromPoint(px, py);
    if (!hit) return null;
    const anchor = hotspot.position;
    const delta = Math.hypot(hit.position.x - anchor.x, hit.position.y - anchor.y, hit.position.z - anchor.z);
    // A visible feature may be behind one of the room's frameless glass panels.
    // Hide the marker when the first opaque surface covers its anchor.
    return delta <= surfaceTolerance || isClearGlass(model, px, py) ? {x, y} : null;
  }

  // model-viewer returns the first surface, including clear shower glass. Use
  // the same sightline and the hardware bounds from the loaded glTF to reach
  // long drains and either roller without making nearby tile selectable.
  function fixtureMeshes(gltf, fixtures, points) {
    const meshes = new Map();
    function visit(index, parent) {
      const node = gltf.nodes[index];
      let local;
      if (node.matrix) {
        local = new DOMMatrix(node.matrix);
      } else {
        local = new DOMMatrix();
        if (node.translation) local.translateSelf(...node.translation);
        if (node.rotation) {
          const [x, y, z, w] = node.rotation;
          if (x || y || z) {
            const degrees = 2 * Math.acos(Math.min(1, Math.max(-1, w))) * 180 / Math.PI;
            local.rotateAxisAngleSelf(x, y, z, degrees);
          }
        }
        if (node.scale) local.scaleSelf(...node.scale);
      }
      const world = parent.multiply(local);
      const pin = fixtures.find(item => points[item.index].comparison.meshPrefixes.some(prefix => node.name?.startsWith(prefix)));
      if (pin && node.mesh !== undefined) {
        const mesh = gltf.meshes[node.mesh];
        const bounds = mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION]);
        const parts = meshes.get(node.mesh) || [];
        parts.push({pin, inverse:world.inverse(), bounds});
        meshes.set(node.mesh, parts);
      }
      node.children?.forEach(child => visit(child, world));
    }
    for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new DOMMatrix());
    return meshes;
  }

  function pickThroughGlass(model, meshes, glass) {
    const orbit = model.getCameraOrbit(), target = model.getCameraTarget();
    const angle = orbit.theta - model.turntableRotation;
    const flat = orbit.radius * Math.sin(orbit.phi);
    const eye = new DOMPoint(
      target.x + flat * Math.sin(angle),
      target.y + orbit.radius * Math.cos(orbit.phi),
      target.z + flat * Math.cos(angle)
    );
    let selected = null, nearest = Infinity;
    for (const parts of meshes.values()) for (const {pin, inverse, bounds} of parts) {
      const origin = inverse.transformPoint(eye);
      const surface = inverse.transformPoint(glass);
      for (const {min, max} of bounds) {
        if (!min || !max) continue;
        // Slab intersection in the primitive's local axes. t=1 is the glass.
        let near = 1, far = nearest;
        for (const [i, axis] of ['x','y','z'].entries()) {
          const delta = surface[axis] - origin[axis];
          if (Math.abs(delta) < 1e-9) {
            if (origin[axis] < min[i] || origin[axis] > max[i]) {
              far = 0;
              break;
            }
          } else {
            const a = (min[i] - origin[axis]) / delta, b = (max[i] - origin[axis]) / delta;
            near = Math.max(near, Math.min(a,b));
            far = Math.min(far, Math.max(a,b));
            if (near > far) break;
          }
        }
        if (near <= far && near < nearest) {
          nearest = near;
          selected = pin;
        }
      }
    }
    return selected;
  }

  function attachFixturePicking(model, pins, points, focusPoint, signal) {
    const fixtures = pins.filter(pin => points[pin.index].comparison);
    if (!fixtures.length) return;
    let tap = null, meshes = null;
    model.addEventListener('pointerdown', event => {
      tap = event.isPrimary && event.button === 0 && !model.closest('.comparing-detail') &&
        !event.composedPath().some(el => el.classList?.contains('dr-detail-pin'))
        ? {id:event.pointerId, x:event.clientX, y:event.clientY} : null;
    }, {signal, capture:true});
    model.addEventListener('pointermove', event => {
      if (tap && Math.hypot(event.clientX-tap.x, event.clientY-tap.y) > 6) tap = null;
    }, {signal, capture:true});
    model.addEventListener('pointercancel', () => { tap = null; }, {signal});
    model.addEventListener('pointerup', event => {
      const start = tap;
      tap = null;
      if (!start || start.id !== event.pointerId || !model.loaded ||
          Math.hypot(event.clientX-start.x, event.clientY-start.y) > 6) return;
      const x = event.clientX, y = event.clientY;
      const surface = model.surfaceFromPoint(x,y);
      if (!surface) return;
      const meshIndex = Number(surface.split(' ',1)[0]);
      meshes ??= fixtureMeshes(model.originalGltfJson, fixtures, points);
      let selected = meshes.get(meshIndex)?.[0]?.pin;
      if (!selected && isClearGlass(model, x, y, surface)) {
        const glass = model.positionAndNormalFromPoint(x,y)?.position;
        if (glass) selected = pickThroughGlass(model, meshes, glass);
      }
      if (selected) focusPoint(selected.index);
    }, {signal});
  }

  function attach(model, points, focusPoint) {
    attached.get(model)?.();
    const controller = new AbortController();
    const {signal} = controller;
    const pins = [];
    let frame = 0;
    let nextUpdate = 0;
    let observer = null;
    let resize = null;
    let disposal = null;

    function destroy() {
      controller.abort();
      observer?.disconnect();
      resize?.disconnect();
      disposal?.disconnect();
      cancelAnimationFrame(frame);
      for (const {button} of pins) button.remove();
      attached.delete(model);
    }

    function setVisible(pin, visible) {
      if (pin.visible === visible) return;
      if (!visible && document.activeElement === pin.button) {
        const menus = model.closest('.project-player')?.querySelector('.point-buttons');
        menus?.children[pin.index]?.focus({preventScroll: true});
      }
      pin.visible = visible;
      pin.button.dataset.shown = String(visible);
      pin.button.tabIndex = visible ? 0 : -1;
      pin.button.setAttribute('aria-hidden', String(!visible));
    }

    function displayPosition(pin, anchor, occupied, separation, box) {
      if (!anchor) return null;
      let x = anchor.x, y = anchor.y;
      for (const other of occupied) {
        const dx = x - other.x, dy = y - other.y, distance = Math.hypot(dx,dy);
        if (distance >= separation) continue;
        if (!points[pin.index].comparison) return null;
        // Keep both adjacent pieces of hardware selectable on a narrow phone.
        // The visible leader connects the displaced marker to its original pin.
        x = other.x + separation * (distance ? dx / distance : 1);
        y = other.y + separation * (distance ? dy / distance : 0);
      }
      const inset = separation / 2;
      x = Math.max(inset, Math.min(box.width - inset, x));
      y = Math.max(inset, Math.min(box.height - inset, y));
      const dx = x - anchor.x, dy = y - anchor.y;
      if (dx !== (pin.dx || 0) || dy !== (pin.dy || 0)) {
        pin.dx = dx;
        pin.dy = dy;
        pin.button.style.setProperty('--pin-x', dx + 'px');
        pin.button.style.setProperty('--pin-y', dy + 'px');
        pin.button.style.setProperty('--pin-distance', Math.hypot(dx,dy) + 'px');
        pin.button.style.setProperty('--pin-direction', Math.atan2(-dy,-dx) + 'rad');
        if (!pin.button.firstElementChild) {
          const leader = document.createElement('span');
          leader.className = 'dr-pin-leader';
          leader.setAttribute('aria-hidden','true');
          pin.button.append(leader);
        }
      }
      return {x,y};
    }

    function update(now) {
      frame = 0;
      if (signal.aborted || !model.isConnected || !model.loaded) return;
      if (now < nextUpdate) {
        schedule();
        return;
      }
      const box = model.getBoundingClientRect();
      if (!box.width || !box.height) {
        for (const pin of pins) setVisible(pin, false);
        return;
      }
      nextUpdate = now + 100;
      const occupied = [];
      const separation = (pins[0]?.button.offsetWidth || 29) + 1;
      for (const pin of pins) {
        const hotspot = model.queryHotspot(pin.button.slot);
        const screen = surfaceVisible(model, hotspot, box);
        const display = displayPosition(pin, screen, occupied, separation, box);
        setVisible(pin, Boolean(display));
        if (display) occupied.push(display);
      }
      if (model.autoRotate && model.modelIsVisible) schedule();
    }

    function schedule() {
      if (!frame && !signal.aborted) frame = requestAnimationFrame(update);
    }

    (points || []).forEach((point, index) => {
      if (!point.pin?.position || !point.pin?.normal) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dr-detail-pin';
      button.slot = 'hotspot-design-detail-' + (index + 1);
      button.dataset.position = point.pin.position;
      button.dataset.normal = point.pin.normal;
      button.dataset.shown = 'false';
      button.tabIndex = -1;
      button.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-label', 'Show detail ' + (index + 1) + ', ' + point.label);
      button.title = point.label;
      button.textContent = String(index + 1);
      let start = null;
      let dragged = false;
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const orbit = model.getCameraOrbit();
        start = {x:event.clientX, y:event.clientY, id:event.pointerId, orbit};
        dragged = false;
        button.setPointerCapture(event.pointerId);
      }, {signal});
      button.addEventListener('pointermove', event => {
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) <= 6) return;
        dragged = true;
        // Hotspot slots are above model-viewer's drag surface. Continue the
        // same orbit when a visitor starts a drag directly on the marker.
        const rate = Math.PI / Math.max(240, model.clientHeight * 0.80);
        const theta = start.orbit.theta - dx * rate;
        const phi = Math.max(0.04, Math.min(Math.PI - 0.04, start.orbit.phi - dy * rate));
        model.cameraOrbit = theta + 'rad ' + phi + 'rad ' + start.orbit.radius + 'm';
        model.jumpCameraToGoal();
      }, {signal});
      button.addEventListener('pointercancel', () => { dragged = true; start = null; }, {signal});
      button.addEventListener('pointerup', event => {
        if (start?.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) dragged = true;
        start = null;
      }, {signal});
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!dragged || event.detail === 0) focusPoint(index);
        start = null;
        dragged = false;
      }, {signal});
      button.addEventListener('hotspot-visibility', schedule, {signal});
      pins.push({button, index, visible:false});
      model.append(button);
    });

    // Resolve collisions in favor of details that have an installation photo.
    // The original indices still control the marker labels and keyboard order.
    pins.sort((a,b) => Number(Boolean(points[b.index].comparison)) - Number(Boolean(points[a.index].comparison)));
    attachFixturePicking(model, pins, points, focusPoint, signal);
    if (pins.length) {
      for (const name of ['load', 'camera-change', 'model-visibility']) {
        model.addEventListener(name, schedule, {signal});
      }
      resize = new ResizeObserver(schedule);
      resize.observe(model);
      observer = new MutationObserver(schedule);
      observer.observe(model, {attributes:true, attributeFilter:['auto-rotate', 'camera-orbit', 'camera-target']});
      // The player appends the element immediately after installing the pins.
      // Observe its slot before the asset loads so failed loads also clean up.
      queueMicrotask(() => {
        if (!signal.aborted && model.parentElement) {
          disposal = new MutationObserver(() => { if (!model.isConnected) destroy(); });
          disposal.observe(model.parentElement, {childList:true});
        }
      });
      schedule();
    }
    attached.set(model, destroy);
    return {destroy};
  }

  window.DuetRightDetails = {attach};
})();
