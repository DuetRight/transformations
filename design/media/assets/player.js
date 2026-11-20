'use strict';
{
const designRoot = document.querySelector('.dr-our-design') || document;
const script = document.currentScript;
const viewerUrl = new URL(script.dataset.module, document.baseURI).href;
for (const player of designRoot.querySelectorAll('.project-player')) {
  const scenes = JSON.parse(player.querySelector('.scene-data').textContent);
  const slot = player.querySelector('.model-slot');
  const stage = player.querySelector('.player-stage');
  const message = player.querySelector('.player-message');
  const retry = player.querySelector('.retry-scene');
  const poster = player.querySelector('.scene-poster');
  const photo = player.querySelector('.scene-photo');
  const hint = player.querySelector('.player-hint');
  const controls = player.querySelector('.camera-actions');
  const walkControls = player.querySelector('.walk-actions');
  const mediumButtons = player.querySelectorAll('[data-medium]');
  const expand = player.querySelector('.expand-scene');
  const dragHint = hint.textContent;
  const spin = controls.querySelector('[data-camera="spin"]');
  const pointPanel = player.querySelector('.point-panel');
  const pointButtons = player.querySelector('.point-buttons');
  const pointNote = player.querySelector('.point-note');
  const compareBar = player.querySelector('.compare-bar');
  const closeComparison = player.querySelector('.close-comparison');
  const stackComparison = player.querySelector('.stack-comparison');
  const reference = player.querySelector('.detail-reference');
  const modelCaption = player.querySelector('.model-caption');
  const roomLinks = [...designRoot.querySelectorAll('[data-inspect-room]')].filter(link =>
    scenes.some(s => s.key === link.dataset.inspectRoom));
  const compareRoomTab = player.querySelector('[data-medium="room"]');
  const comparisons = new Map();
  scenes.forEach((entry, index) => {
    if (entry.walk) return;
    if (entry.roomComparison) comparisons.set(entry.roomComparison.key, {index, comparison:entry.roomComparison});
    entry.points?.forEach((point, pointIndex) => {
      if (point.comparison) comparisons.set(point.comparison.key, {index, pointIndex, point, comparison:point.comparison});
    });
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let comparison = null;
  let frameAspect = 4 / 3;
  let overscan = 1;
  let animateOnLoad = false;
  let roomCameraLimits;
  const projectionResize = new ResizeObserver(applyPhotoProjection);

  function applyPhotoProjection() {
    if (!model) return;
    const projection = comparison?.frameProjection;
    if (!projection) {
      model.style.removeProperty('transform');
      return;
    }
    const w = model.clientWidth, h = model.clientHeight;
    if (!w || !h) return;
    // A crop away from the optical center has a different perspective from
    // a centered zoom. Map the centered camera into the installation photo.
    // The recorded matrix uses fractions of the frame; CSS uses pixels.
    const [a, b, c] = projection;
    const matrix = [
      a[0], b[0] * h / w, 0, c[0] / w,
      a[1] * w / h, b[1], 0, c[1] / h,
      0, 0, 1, 0,
      a[2] * w, b[2] * h, 0, c[2]
    ];
    model.style.transform = 'translate(-50%, -50%) matrix3d(' + matrix.join(',') + ')';
  }

  stackComparison?.addEventListener('click', () => {
    const stacked = player.classList.toggle('stacked-comparison');
    stackComparison.setAttribute('aria-pressed', String(stacked));
  });

  function setComparison(next) {
    comparison = next;
    if (!compareBar) return;
    if (next?.frameProjection) projectionResize.observe(slot);
    else projectionResize.disconnect();
    applyPhotoProjection();
    const fullRoom = Boolean(next && next === scene.roomComparison);
    if (fullRoom !== player.classList.contains('comparing-room')) {
      player.classList.toggle('stacked-comparison', fullRoom);
      stackComparison.setAttribute('aria-pressed', String(fullRoom));
    }
    player.classList.toggle('comparing-room', fullRoom);
    player.classList.toggle('comparing-detail', Boolean(next));
    compareBar.hidden = reference.hidden = modelCaption.hidden = !next;
    if (next) {
      frameAspect = Number.isFinite(next.aspect) && next.aspect > 0 ? next.aspect : 4 / 3;
      const radians = next.roll * Math.PI / 180;
      // Inverse-rotate the frame's four corners. The larger horizontal or
      // vertical extent sets the margin for either portrait or landscape.
      overscan = Math.abs(Math.cos(radians)) +
        Math.max(frameAspect, 1 / frameAspect) * Math.abs(Math.sin(radians));
      const [dx, dy] = next.frameOffset || [0, 0];
      overscan *= 1 + 2 * Math.max(Math.abs(dx), Math.abs(dy));
      player.style.setProperty('--room-offset-x', (dx * 100) + '%');
      player.style.setProperty('--room-offset-y', (dy * 100) + '%');
      player.style.setProperty('--detail-aspect', String(frameAspect));
      player.style.setProperty('--detail-overscan', String(overscan));
      player.style.setProperty('--detail-roll', next.roll + 'deg');
      compareBar.querySelector('.compare-title').textContent = next.title;
      const image = reference.querySelector('img');
      image.alt = next.photoAlt;
      image.style.filter = next.photoBrightness ? `brightness(${next.photoBrightness})` : '';
      const photoLabel = next.photoLabel || (next.photoBrightness ? 'Installation photo' : 'Installation photograph');
      reference.querySelector('figcaption').textContent = photoLabel + (next.photoBrightness ? ' · brightened' : '');
      image.src = next.photo;
      poster.src = next.render;
      poster.alt = next.renderAlt;
    } else {
      player.style.removeProperty('--room-offset-x');
      player.style.removeProperty('--room-offset-y');
      player.style.removeProperty('--detail-aspect');
      player.style.removeProperty('--detail-overscan');
      player.style.removeProperty('--detail-roll');
      if (model && roomCameraLimits) Object.assign(model, roomCameraLimits);
      poster.src = scene.poster;
      poster.alt = scene.title + ' — Blender rendering';
    }
  }

  function frameComparison(immediate) {
    const selected = comparison;
    const view = model;
    applyPhotoProjection();
    // Updating a camera limit makes model-viewer snap to its current goal.
    // Apply it before the camera move, while the goal is still the room.
    const radius = parseFloat(selected.orbit.trim().split(/\s+/)[2]);
    view.minCameraOrbit = `auto auto ${radius / 3}m`;
    view.maxCameraOrbit = `auto auto ${Math.max(radius * 3, view.getCameraOrbit().radius)}m`;
    view.minFieldOfView = '3deg';
    // Some fixture views include the tank and the floor and exceed the default
    // 30-degree field. Allow the camera its registered framing plus roll margin.
    const halfAngle = parseFloat(selected.fov) * Math.PI / 360;
    const fullField = 360 / Math.PI * Math.atan(Math.tan(halfAngle) * overscan);
    view.maxFieldOfView = Math.max(30, fullField + 0.1) + 'deg';
    view.interpolationDecay = 105;
    function apply() {
      if (comparison !== selected || model !== view) return;
      // model-viewer widens its vertical FoV for narrow panes. Account for
      // that adjustment and the extra image margin needed for camera roll.
      const adjust = Math.max(1, view.getIdealAspect() / frameAspect);
      view.fieldOfView = (360 / Math.PI * Math.atan(Math.tan(halfAngle) * overscan / adjust)) + 'deg';
      view.cameraTarget = selected.target;
      view.cameraOrbit = selected.orbit;
    }
    if (immediate || reducedMotion.matches) {
      apply();
      view.jumpCameraToGoal();
    } else {
      // Let the new aspect ratio and initial room view reach the screen
      // before beginning the camera move into the fixture.
      requestAnimationFrame(() => requestAnimationFrame(apply));
    }
  }

  function writeView(key, index, push, anchor = false) {
    if (location.protocol === 'file:') return;
    const url = new URL(location.href);
    if (key) url.searchParams.set('view', key);
    else url.searchParams.delete('view');
    if (anchor) url.hash = 'model';
    const state = {...history.state, drScene:index};
    if (push && (url.href !== location.href || index !== scenes.indexOf(scene))) {
      history.replaceState({...history.state, drScene:scenes.indexOf(scene)}, '');
      history.pushState(state, '', url);
    } else history.replaceState(state, '', url);
  }

  function roomAddress(nextScene) {
    if (comparison) writeView(nextScene.key, scenes.indexOf(nextScene), false);
  }

  function chooseScene(index, anchor = false) {
    const next = scenes[index];
    if (roomLinks.length || comparisons.size) writeView(next.key, index, true, anchor);
    if (ready && next === scene && !scene.walk) {
      medium = 'model';
      camera('reset');
      updateMedium();
    } else show(index);
  }

  function inspect(key, record = true) {
    const selection = comparisons.get(key);
    if (!selection) return;
    const next = selection.comparison;
    if (record) writeView(key, selection.index, true, true);
    if (scene !== scenes[selection.index] || loadSequence === 0 ||
        (!ready && stage.getAttribute('aria-busy') === 'false')) {
      show(selection.index, next, record);
    } else {
      medium = 'model';
      setSpin(false);
      model?.resetTurntableRotation();
      setComparison(next);
      updateMedium();
      if (ready) frameComparison(false);
      else animateOnLoad = record;
    }
    selectPoint(selection.point ? pointButtons.children[selection.pointIndex] : null);
    if (selection.point) pointNote.textContent = selection.point.note;
    if (record && !player.classList.contains('expanded-player')) {
      player.scrollIntoView({block:'start', behavior:'instant'});
    }
  }
  function setSpin(on) {
    if (model) model.autoRotate = on;
    spin.textContent = on ? 'Pause rotation' : 'Play rotation';
    spin.setAttribute('aria-pressed',String(on));
  }
  function selectPoint(active) {
    for (const b of pointButtons.querySelectorAll('button')) b.setAttribute('aria-pressed',String(b === active));
    if (!active) pointNote.textContent = '';
  }
  function listPoints() {
    pointButtons.replaceChildren();
    pointNote.textContent = '';
    const positions = scene.walk?.stops || scene.points || [];
    pointButtons.ariaLabel = scene.walk ? 'Walk to a location' : 'Inspect a design detail';
    for (const pt of positions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pt.label;
      b.setAttribute('aria-pressed','false');
      b.addEventListener('click', () => {
        if (!model || !ready) return;
        if (scene.walk) {
          walk?.go(pt.key);
          return;
        }
        if (pt.comparison) {
          const fromPin = document.activeElement?.classList.contains('dr-detail-pin');
          inspect(pt.comparison.key);
          if (fromPin) closeComparison.focus({preventScroll:true});
          return;
        }
        roomAddress(scene);
        if (comparison) setComparison(null);
        setSpin(false);
        model.resetTurntableRotation();
        selectPoint(b);
        model.cameraTarget = pt.target;
        model.fieldOfView = 'auto';
        model.cameraOrbit = pt.orbit;
        if (reducedMotion.matches) model.jumpCameraToGoal();
        pointNote.textContent = pt.note;
      });
      pointButtons.append(b);
    }
  }
  let scene = scenes[0];
  let medium = 'model';
  let model = null;
  let walk = null;
  const walkIndex = scenes.findIndex(s => s.walk);
  let lastOrbitIndex = 0;
  let loadSequence = 0;
  let ready = false;
  let expandedInPage = false;
  const scriptFailures = new Map();
  const failedLoads = new Map();

  function retryUrl(path, attempts) {
    if (!attempts) return path;
    const url = new URL(path, document.baseURI);
    url.searchParams.set('retry', String(attempts));
    return url.href;
  }

  async function loadScript(url) {
    const attempts = scriptFailures.get(url) || 0;
    try {
      await import(retryUrl(url, attempts));
    } catch (error) {
      scriptFailures.set(url,attempts + 1);
      throw error;
    }
  }

  function updateMedium() {
    const interactive = medium === 'model';
    const inside = Boolean(scene.walk);
    player.querySelector('.player-basis').textContent = interactive ? (comparison?.basis || scene.basis) : scene.photoBasis;
    slot.hidden = !interactive;
    poster.hidden = !interactive || ready;
    photo.hidden = interactive;
    if (!interactive) {
      photo.src = scene.photo;
      photo.alt = scene.photoAlt;
    }
    player.querySelector('.player-feedback').hidden = !interactive || ready;
    if (comparison) modelCaption.textContent = ready ? 'Interactive model' : 'Blender rendering';
    controls.hidden = !interactive || inside;
    if (walkControls) walkControls.hidden = !interactive || !inside;
    pointPanel.classList.toggle('walk-points',inside);
    pointPanel.hidden = !interactive || !ready || !(scene.points?.length || inside);
    hint.textContent = interactive ? (inside ? 'Tap a floor circle or choose a stop · Drag to look around' : dragHint) : photo.alt;
    if (compareRoomTab) compareRoomTab.hidden = !scene.roomComparison;
    for (const button of mediumButtons) {
      const isRoomPair = comparison && comparison === scene.roomComparison;
      const selected = interactive && inside ? 'walk' : (isRoomPair ? 'room' : medium);
      button.setAttribute('aria-pressed', String(button.dataset.medium === selected));
    }
    for (const button of controls.querySelectorAll('button')) button.disabled = !ready;
    for (const button of walkControls?.querySelectorAll('button') || []) button.disabled = !ready;
  }

  function currentStop(key, stop) {
    const index = scene.walk.stops.findIndex(item => item.key === key);
    selectPoint(pointButtons.children[index]);
    pointNote.textContent = stop.note || stop.label;
  }

  function failure(sequence) {
    if (sequence !== loadSequence) return;
    ready = false;
    walk?.destroy();
    walk = null;
    model?.remove();
    model = null;
    stage.setAttribute('aria-busy','false');
    message.textContent = location.protocol === 'file:' ? 'Use the local preview launcher to turn the model.' : 'Showing the render. The interactive model could not open.';
    retry.hidden = false;
    updateMedium();
  }

  async function show(sceneIndex, detail = null, animate = false) {
    const sequence = ++loadSequence;
    animateOnLoad = animate;
    walk?.destroy();
    walk = null;
    scene = scenes[sceneIndex];
    for (const link of roomLinks) {
      const room = scenes.find(s => s.key === link.dataset.inspectRoom);
      if (scene === room || (room.tourGroup && room.tourGroup === scene.tourGroup)) {
        link.setAttribute('aria-current', 'true');
      } else link.removeAttribute('aria-current');
    }
    if (!scene.walk) lastOrbitIndex = sceneIndex;
    else if (scene.tourGroup) lastOrbitIndex = scenes.findIndex(s => !s.walk && s.tourGroup === scene.tourGroup);
    if (select) select.value = String(sceneIndex);
    setSpin(false);
    model?.remove();
    model = null;
    ready = false;
    medium = 'model';
    if (detail || comparison || player.classList.contains('comparing-detail')) setComparison(detail);
    else {
      poster.src = scene.poster;
      poster.alt = scene.title + ' — Blender rendering';
    }
    player.querySelector('[data-medium="photo"]').textContent = scene.photoLabel;
    player.querySelector('.scene-description').textContent = scene.description;
    player.querySelector('.scene-limits').textContent = scene.limits;
    listPoints();
    message.textContent = 'Opening the 3D model…';
    retry.hidden = true;
    stage.setAttribute('aria-busy','true');
    updateMedium();
    try {
      const scripts = [loadScript(viewerUrl)];
      if (scene.walk) scripts.push(loadScript(new URL('walk.js',script.src).href));
      else if (scene.points?.length && scene.model.includes('/rooms/')) {
        // The named camera buttons still work when the optional map pins cannot load.
        scripts.push(loadScript(new URL(script.dataset.pins || 'detail-pins.js',script.src).href).catch(() => {}));
      }
      await Promise.all(scripts);
      if (sequence !== loadSequence) return;
      const next = document.createElement('model-viewer');
      model = next;
      next.alt = scene.title + '. Interactive Blender model.';
      next.tabIndex = 0;
      if (scene.minRadius && !scene.walk) next.setAttribute('min-camera-orbit', 'auto auto ' + scene.minRadius);
      roomCameraLimits = {
        minCameraOrbit: next.minCameraOrbit, maxCameraOrbit: next.maxCameraOrbit,
        minFieldOfView: next.minFieldOfView, maxFieldOfView: next.maxFieldOfView,
        interpolationDecay: next.interpolationDecay
      };
      if (scene.exposure) next.setAttribute('exposure',String(scene.exposure));
      if (scene.environment) next.setAttribute('environment-image',scene.environment);
      for (const [name,value] of Object.entries({'camera-controls':'','camera-orbit':scene.orbit,'loading':'eager','interaction-prompt':'none','shadow-intensity':'0.6','touch-action':'pan-y','rotation-per-second':'18deg','auto-rotate-delay':'0'})) {
        next.setAttribute(name,value);
      }
      // The default marker intercepts drags that start at the exact center.
      const panMarker = document.createElement('span');
      panMarker.slot = 'pan-target';
      panMarker.className = 'pan-marker';
      panMarker.setAttribute('aria-hidden','true');
      next.append(panMarker);
      if (scene.walk) {
        walk = window.DuetRightWalk.attach(next, scene.walk, {onStop:currentStop});
      } else if (scene.points?.length && scene.model.includes('/rooms/')) {
        window.DuetRightDetails?.attach(next, scene.points, index => pointButtons.children[index]?.click());
      }
      function enableLoadedModel() {
        if (sequence !== loadSequence || ready || model !== next || !next.loaded) return;
        ready = true;
        stage.setAttribute('aria-busy','false');
        if (comparison) frameComparison(!animateOnLoad);
        updateMedium();
      }
      next.addEventListener('load', enableLoadedModel, {once:true});
      next.addEventListener('model-visibility', enableLoadedModel);
      next.addEventListener('progress', event => {
        if (event.detail.totalProgress === 1) requestAnimationFrame(enableLoadedModel);
      });
      next.addEventListener('error', () => {
        if (sequence !== loadSequence) return;
        // model-viewer caches the rejected GLB request by URL.
        failedLoads.set(scene.model,(failedLoads.get(scene.model) || 0) + 1);
        failure(sequence);
      }, {once:true});
      next.addEventListener('keydown', event => {
        const direction = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if (!direction || !ready || scene.walk) return;
        event.preventDefault();
        event.stopPropagation();
        const orbit = next.getCameraOrbit();
        const phi = Math.max(.04,Math.min(Math.PI - .04, orbit.phi + .12 * direction[1]));
        next.cameraOrbit = (orbit.theta + .15 * direction[0]) + 'rad ' + phi + 'rad ' + orbit.radius + 'm';
        next.jumpCameraToGoal();
      },true);
      next.src = retryUrl(scene.model,failedLoads.get(scene.model));
      slot.replaceChildren(next);
    } catch {
      failure(sequence);
    }
  }

  function camera(action) {
    if (!ready || !model) return;
    if (action === 'spin') {
      setSpin(!model.autoRotate);
      return;
    }
    if (action === 'closer' || action === 'farther') {
      model.zoom(action === 'closer' ? 2 : -2);
    } else {
      roomAddress(scene);
      if (comparison) setComparison(null);
      setSpin(false);
      model.resetTurntableRotation();
      selectPoint(null);
      model.cameraTarget = 'auto auto auto';
      model.fieldOfView = 'auto';
      model.cameraOrbit = action === 'top' ? '0deg 0deg 105%' : scene.orbit;
      model.jumpCameraToGoal();
    }
  }
  for (const button of controls.querySelectorAll('button')) {
    button.addEventListener('click', () => camera(button.dataset.camera));
  }
  for (const button of mediumButtons) {
    button.addEventListener('click', () => {
      const choice = button.dataset.medium;
      if (choice === 'room' && scene.roomComparison) return inspect(scene.roomComparison.key);
      if (choice === 'model' && comparison && comparison === scene.roomComparison) return chooseScene(scenes.indexOf(scene));
      if (choice === 'walk' && !scene.walk) {
        const matching = scenes.findIndex(s => s.walk && s.tourGroup === scene.tourGroup);
        return chooseScene(matching === -1 ? walkIndex : matching);
      }
      if (choice === 'model' && scene.walk) return chooseScene(lastOrbitIndex);
      if (comparison && choice === 'photo') {
        roomAddress(scene);
        if (model && ready) camera('reset');
        else setComparison(null);
      }
      medium = choice === 'walk' ? 'model' : choice;
      if (medium === 'photo') setSpin(false);
      updateMedium();
    });
  }
  for (const button of walkControls?.querySelectorAll('button') || []) {
    button.addEventListener('click', () => {
      if (!ready || !walk) return;
      if (button.dataset.walk === 'start') walk.reset();
      else walk.turn(button.dataset.walk === 'left' ? 40 : -40);
    });
  }
  const select = player.querySelector('.scene-select');
  select?.addEventListener('change', () => chooseScene(Number(select.value)));
  retry.addEventListener('click', () => {
    if (comparison) inspect(comparison.key, false);
    else show(select ? Number(select.value) : 0);
  });

  closeComparison?.addEventListener('click', () => {
    const button = pointButtons.querySelector('[aria-pressed="true"]');
    roomAddress(scene);
    if (ready) camera('reset');
    else {
      setComparison(null);
      updateMedium();
    }
    (ready && button ? button : select)?.focus({preventScroll:true});
  });

  for (const link of [...roomLinks, ...designRoot.querySelectorAll('[data-inspect-closeup]')]) {
    const key = link.dataset.inspectCloseup;
    if (key && !comparisons.has(key)) continue;
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      event.preventDefault();
      if (key) {
        inspect(key);
        closeComparison.focus({preventScroll:true});
      } else {
        chooseScene(scenes.findIndex(s => s.key === link.dataset.inspectRoom), true);
        player.scrollIntoView({block:'start', behavior:'instant'});
        select?.focus({preventScroll:true});
      }
    });
  }

  function expandedState() {
    const open = document.fullscreenElement === player || expandedInPage;
    expand.textContent = open ? 'Close expanded view' : 'Expand';
    expand.setAttribute('aria-pressed',String(open));
    player.classList.toggle('expanded-player',open);
  }
  function fallbackExpanded(open) {
    expandedInPage = open;
    document.body.classList.toggle('expanded-player-open',open);
    expandedState();
    expand.focus({preventScroll:true});
  }
  expand.addEventListener('click', async () => {
    if (document.fullscreenElement === player) {await document.exitFullscreen();return}
    if (expandedInPage) {fallbackExpanded(false);return}
    try {
      if (!player.requestFullscreen) {fallbackExpanded(true);return}
      await player.requestFullscreen();
    } catch {fallbackExpanded(true)}
  });
  document.addEventListener('fullscreenchange',expandedState);
  player.addEventListener('keydown',event=>{
    if (event.key === 'Escape' && expandedInPage) fallbackExpanded(false);
    if (event.key === 'Tab' && expandedInPage) {
      const items = [...player.querySelectorAll('button:not(:disabled),select,model-viewer,summary')].filter(el=>el.offsetParent);
      if (event.shiftKey && document.activeElement === items[0]) {event.preventDefault();items.at(-1).focus()}
      if (!event.shiftKey && document.activeElement === items.at(-1)) {event.preventDefault();items[0].focus()}
    }
  });
  function readAddress() {
    const requested = new URLSearchParams(location.search).get('view');
    if (comparisons.has(requested)) return inspect(requested, false);
    if (!requested && scenes[0].roomComparison) return inspect(scenes[0].roomComparison.key, false);
    const stored = history.state?.drScene;
    const fallback = Number.isInteger(stored) && scenes[stored] ? stored : 0;
    const index = requested === 'walk' ? walkIndex : scenes.findIndex(s => s.key && s.key === requested);
    const selected = index < 0 ? fallback : index;
    if (!loadSequence || comparison || scene !== scenes[selected]) show(selected);
  }
  if (roomLinks.length || comparisons.size) window.addEventListener('popstate', readAddress);
  readAddress();
}
}
