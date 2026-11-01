(function () {
  "use strict";

  var state = {
    app: null, scene: null, root: null, targets: [], selected: null, selectedHam: null,
    tab: "inspect", freecam: false, freecamSpeed: 5, keys: Object.create(null),
    limitsRemoved: false, placementValidationOff: false, savedBounds: null, savedDeleteStray: null, globalCollisionOff: false, allowInstancedDuplicate: false, firstPerson: false, consoleMode: false, aiKeepAlive: false, aiSnapshots: new WeakMap(),
    uploadedDataUrl: null, uploadedName: "", customBackgroundMaterial: null,
    customBackgroundTexture: null, followHam: null, savedCamera: null, aiPaused: new WeakSet(),
    originalBackgroundPattern: null, cameraTimer: null, modCameraParent: null, savedCameraBounds: null,
    lastTick: 0, lastListRefresh: 0, statusTimer: null, lastUndo: null, savedSceneCollisions: null, freecamMeshCollisions: null, cameraBoundsBypass: false, environmentDetectionOff: new Set(), tubeCheckPrototypes: new WeakSet()
  };
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };
  var num = function (v, fallback) { var n = Number(v); return Number.isFinite(n) ? n : (fallback || 0); };
  var round = function (v) { return Math.round((Number(v) || 0) * 1000) / 1000; };
  var ns = function () { return window.z0 || window.B || null; };
  var app = function () { var n = ns(); return n && n.app ? n.app : null; };
  var scene = function () { var a = app(); return a && a.graphicsHelper ? a.graphicsHelper.scene : null; };
  var helper = function () { var a = app(); return a && a.graphicsHelper ? a.graphicsHelper : null; };
  var isVec = function (v) { return !!v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number"; };
  var copyVec = function (v) { return isVec(v) ? { x: v.x, y: v.y, z: v.z } : { x: 0, y: 0, z: 0 }; };
  var setText = function (id, text) { var el = $(id); if (el) el.textContent = String(text); };
  function status(message, error) {
    var el = $("hhm-status");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("hhm-error", !!error);
    el.classList.add("hhm-status-on");
    clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(function () { el.classList.remove("hhm-status-on"); }, 4200);
  }
  function safeName(obj, fallback) {
    try {
      if (obj && typeof obj.getName === "function") {
        var n = obj.getName();
        if (n && n !== "Object") return String(n);
      }
    } catch (e) {}
    return String((obj && (obj.name || obj.shapeName || obj.id || obj.constructor && obj.constructor.name)) || fallback || "Object");
  }
  function getHamsters() {
    var n = ns(), all = n && n.z1062 && Array.isArray(n.z1062.activeObjects) ? n.z1062.activeObjects : [];
    return all.filter(function (h) { return h && !h.isMenuItem && h.isOnScene !== false; });
  }
  function labelHam(h, i) {
    var nickname = "";
    try { nickname = h._options && h._options.propHamName && h._options.propHamName.value !== undefined ? "" : ""; } catch (e) {}
    try { nickname = h.hamName || h.nm || ""; } catch (e) {}
    return "Hamster " + (i + 1) + (nickname ? " — " + nickname : "");
  }
  function objectAlias(obj, fallback) {
    var raw = String((obj && (obj.shapeName || obj.name || obj.nm || obj.id)) || fallback || "object");
    var key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    var aliases = { w2a:"smalltransparentwheel", h:"hamster", c4:"3x2cage", c3:"2x2cage", c2:"1x2cage", c1:"singlecage", f1:"foodbowl", w1:"wheel", b1:"waterbottle" };
    if (aliases[key]) return aliases[key];
    // Give every object a readable label without exposing the raw internal identifier.
    var pretty = raw.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return pretty.replace(/\\b\\w/g, function (ch) { return ch.toUpperCase(); }) || "Object";
  }
  function buildTargets() {
    var a = app(), sc = scene(), items = [], seen = new Set();
    function add(obj, kind, label) {
      if (!obj || seen.has(obj)) return;
      seen.add(obj);
      items.push({ obj: obj, kind: kind, label: label || safeName(obj) });
    }
    if (a && Array.isArray(a.objsOnScene)) {
      a.objsOnScene.forEach(function (o, i) { if (o && o.isOnScene !== false) add(o, "item", objectAlias(o, "Item " + (i + 1))); });
    }
    getHamsters().forEach(function (h, i) { add(h, "hamster", labelHam(h, i)); });
    if (sc && Array.isArray(sc.meshes)) {
      sc.meshes.forEach(function (m, i) {
        if (!m || m.isDisposed && m.isDisposed() || m.name === "Background" || m.name === "testTouchMesh") return;
        if (m.parent) return;
        if (m.isVisible === false && !m.isPickable) return;
        add(m, "mesh", "Mesh: " + objectAlias(m, "Mesh " + (i + 1)));
      });
    }
    // Keep object controls responsive even in a large scene.
    if (items.length > 700) items = items.slice(0, 700);
    state.targets = items;
    var sel = $("hhm-target");
    if (sel) {
      var prev = state.selected && state.targets.findIndex(function (t) { return t.obj === state.selected.obj; });
      var current = prev >= 0 ? prev : -1;
      sel.innerHTML = "";
      items.forEach(function (t, i) {
        var opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = t.label + (t.kind === "hamster" ? " [HAM]" : t.kind === "mesh" ? " [MESH]" : " [ITEM]");
        sel.appendChild(opt);
      });
      if (current >= 0) sel.value = String(current);
      else if (items.length) sel.value = "0";
      state.selected = items.length ? items[Number(sel.value) || 0] : null;
    }
    refreshHamsterPickers();
    return items;
  }
  function refreshHamsterPickers() {
    var list = getHamsters();
    ["hhm-hamster", "hhm-perspective-hamster"].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      var old = sel.value;
      sel.innerHTML = "";
      list.forEach(function (h, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = labelHam(h, i);
        sel.appendChild(o);
      });
      if (list.length) {
        var preserve = old !== "" && Number(old) < list.length ? Number(old) : 0;
        sel.value = String(preserve);
      }
    });
    state.selectedHam = list[Math.min(Number(($("hhm-hamster") || {}).value || 0), Math.max(0, list.length - 1))] || null;
    var hamCount = $("hhm-ham-count");
    if (hamCount) hamCount.textContent = list.length + " in scene";
  }
  function pickTarget() {
    var sel = $("hhm-target");
    if (!sel) return null;
    state.selected = state.targets[Number(sel.value)] || null;
    populateTransformFields();
    return state.selected;
  }
  function getObj() { return state.selected && state.selected.obj; }
  function getTargetPos(t) {
    var o = t && t.obj;
    if (!o) return { x: 0, y: 0, z: 0 };
    if (t.kind === "hamster" && o.physics && o.physics.frontBody && o.physics.frontBody.body && o.physics.frontBody.body.position) {
      var p = o.position || o.mesh && o.mesh.position;
      if (isVec(p)) return copyVec(p);
    }
    if (isVec(o.position)) return copyVec(o.position);
    if (o.mesh && isVec(o.mesh.position)) return copyVec(o.mesh.position);
    return { x: 0, y: 0, z: 0 };
  }
  function getTargetRot(t) {
    var o = t && t.obj;
    if (!o) return { x: 0, y: 0, z: 0 };
    try {
      var r = o.rotation;
      if (isVec(r)) return { x: r.x, y: r.y, z: r.z };
    } catch (e) {}
    if (o.mesh && isVec(o.mesh.rotation)) return copyVec(o.mesh.rotation);
    return { x: 0, y: 0, z: 0 };
  }
  function getTargetScale(t) {
    var o = t && t.obj;
    if (!o) return { x: 1, y: 1, z: 1 };
    if (t.kind === "hamster" && typeof o.size === "number") {
      var hamScale = o.size / 0.144;
      return { x: hamScale, y: hamScale, z: hamScale };
    }
    if (o.mesh && isVec(o.mesh.scaling)) return copyVec(o.mesh.scaling);
    if (isVec(o.scaling)) return copyVec(o.scaling);
    if (o.shape && o.shape.inst && isVec(o.shape.inst.scaling)) return copyVec(o.shape.inst.scaling);
    if (typeof o.size === "number") return { x: o.size, y: o.size, z: o.size };
    return { x: 1, y: 1, z: 1 };
  }
  function setPos(t, v) {
    var o = t && t.obj;
    if (!o) return;
    if (t.kind === "mesh") { o.position.copyFromFloats(v.x, v.y, v.z); return; }
    if (typeof o.setPosition === "function") { o.setPosition(v.x, v.y, v.z); return; }
    if (o.position && typeof o.position.copyFromFloats === "function") o.position.copyFromFloats(v.x, v.y, v.z);
    else if (o.mesh && o.mesh.position) o.mesh.position.copyFromFloats(v.x, v.y, v.z);
  }
  function setRot(t, v) {
    var o = t && t.obj;
    if (!o) return;
    if (t.kind === "mesh") { o.rotation.copyFromFloats(v.x, v.y, v.z); return; }
    if (typeof o.setRotation === "function") { o.setRotation(v.x, v.y, v.z); return; }
    if (o.rotation && typeof o.rotation.copyFromFloats === "function") o.rotation.copyFromFloats(v.x, v.y, v.z);
    else if (o.mesh && o.mesh.rotation) o.mesh.rotation.copyFromFloats(v.x, v.y, v.z);
  }
  function setScale(t, v) {
    var o = t && t.obj;
    if (!o) return;
    if (t.kind === "mesh") { o.scaling.copyFromFloats(v.x, v.y, v.z); return; }
    if (t.kind === "hamster") {
      // HammyHome's default hamster size is 0.144 world units. The inspector shows
      // this as a 1.0 multiplier so applying an unchanged transform is harmless.
      if (Math.abs(v.x - v.y) < 0.001 && Math.abs(v.y - v.z) < 0.001 && v.x > 0.01) {
        o.size = 0.144 * v.x;
      } else if (o.mesh && o.mesh.scaling) {
        // Non-uniform sizing is visual-only; the game's physics body is still uniform.
        o.mesh.scaling.copyFromFloats(v.x, v.y, v.z);
      }
      return;
    }
    if (typeof o.setScale === "function") {
      var before = copyVec(o.scaling);
      o.setScale(v.x, v.y, v.z);
      var changed = !!(o.scaling && (o.scaling.x !== before.x || o.scaling.y !== before.y || o.scaling.z !== before.z));
      if (!changed && o.mesh && o.mesh.scaling) o.mesh.scaling.copyFromFloats(v.x, v.y, v.z);
      return;
    }
    if (o.scaling && o.scaling.copyFromFloats) o.scaling.copyFromFloats(v.x, v.y, v.z);
    else if (o.mesh && o.mesh.scaling) o.mesh.scaling.copyFromFloats(v.x, v.y, v.z);
  }
  function readXYZ(prefix, scale) {
    var unit = scale ? 1 : 1;
    return {
      x: num($(prefix + "-x").value) * unit,
      y: num($(prefix + "-y").value) * unit,
      z: num($(prefix + "-z").value) * unit
    };
  }
  function writeXYZ(prefix, v, multiplier) {
    multiplier = multiplier || 1;
    ["x", "y", "z"].forEach(function (axis) {
      var el = $(prefix + "-" + axis);
      if (el) el.value = String(round((v && v[axis] || 0) * multiplier));
    });
  }
  function populateTransformFields() {
    var t = state.selected;
    if (!t) { setText("hhm-selected-label", "No selectable object found yet."); return; }
    setText("hhm-selected-label", t.label);
    writeXYZ("hhm-pos", getTargetPos(t));
    var r = getTargetRot(t);
    writeXYZ("hhm-rot", { x: r.x * 180 / Math.PI, y: r.y * 180 / Math.PI, z: r.z * 180 / Math.PI });
    writeXYZ("hhm-scale", getTargetScale(t));
    var off = !!(t.obj && t.obj.__hhCollisionOff);
    if ($("hhm-collision")) $("hhm-collision").checked = !off;
    if ($("hhm-visible")) $("hhm-visible").checked = !((t.kind === "mesh" ? t.obj.isVisible : t.obj.mesh && t.obj.mesh.isVisible) === false);
  }
  function captureUndo(t) {
    if (!t) return;
    state.lastUndo = { target: t, pos: getTargetPos(t), rot: getTargetRot(t), scale: getTargetScale(t) };
    var b = $("hhm-undo");
    if (b) b.disabled = false;
  }
  function applyTransform() {
    var t = state.selected;
    if (!t) return status("Select an object first.", true);
    captureUndo(t);
    setPos(t, readXYZ("hhm-pos", false));
    var r = readXYZ("hhm-rot", false);
    setRot(t, { x: r.x * Math.PI / 180, y: r.y * Math.PI / 180, z: r.z * Math.PI / 180 });
    setScale(t, readXYZ("hhm-scale", true));
    status("Transform applied to " + t.label + ".");
  }
  function undoTransform() {
    var u = state.lastUndo;
    if (!u || !u.target || !u.target.obj) return status("No transform to undo.", true);
    setPos(u.target, u.pos); setRot(u.target, u.rot); setScale(u.target, u.scale);
    state.selected = u.target;
    populateTransformFields();
    status("Previous transform restored.");
  }
  function findBodyShapes(o) {
    var out = [], seen = new Set();
    function scan(v, depth) {
      if (!v || (typeof v !== "object" && typeof v !== "function") || seen.has(v) || depth > 4) return;
      seen.add(v);
      var sh = v.shapes;
      if (sh) {
        if (Array.isArray(sh)) sh.forEach(function (x) { if (x) out.push(x); });
        else {
          var cur = sh, count = 0, local = new Set();
          while (cur && typeof cur === "object" && !local.has(cur) && count++ < 80) {
            local.add(cur);
            if ("collidesWith" in cur || "belongsTo" in cur) out.push(cur);
            cur = cur.next || null;
          }
        }
      }
      if (depth === 4) return;
      Object.keys(v).slice(0, 60).forEach(function (k) {
        if (/^(scene|mesh|material|texture|world|parent|_parent|pubsub|observables|onChangeObservable|skeleton|bones)$/i.test(k)) return;
        var child = v[k];
        if (child && typeof child === "object" && (child.body || child.shapes || /Body$/.test(k) || /physics/i.test(k))) scan(child, depth + 1);
      });
    }
    scan(o && o.physics, 0);
    scan(o && o.body, 0);
    return Array.from(new Set(out));
  }
  function setCollision(t, enabled) {
    var o = t && t.obj;
    if (!o) return;
    o.__hhCollisionOff = !enabled;
    if (t.kind === "mesh") {
      o.checkCollisions = !!enabled;
      o.isPickable = !!enabled;
    }
    if ("intersectsWith" in o) {
      if (!enabled && o.__hhIntersectsWith === undefined) o.__hhIntersectsWith = o.intersectsWith;
      if (enabled && o.__hhIntersectsWith !== undefined) { o.intersectsWith = o.__hhIntersectsWith; delete o.__hhIntersectsWith; }
      else if (!enabled) o.intersectsWith = 0;
    }
    if ("intersectGroup" in o) {
      if (!enabled && o.__hhIntersectGroup === undefined) o.__hhIntersectGroup = o.intersectGroup;
      if (enabled && o.__hhIntersectGroup !== undefined) { o.intersectGroup = o.__hhIntersectGroup; delete o.__hhIntersectGroup; }
      else if (!enabled) o.intersectGroup = 0;
    }
    var shapes = findBodyShapes(o);
    shapes.forEach(function (s) {
      if (!enabled) {
        if (s.__hhSavedCollidesWith === undefined && "collidesWith" in s) s.__hhSavedCollidesWith = s.collidesWith;
        if ("collidesWith" in s) s.collidesWith = 0;
      } else if (s.__hhSavedCollidesWith !== undefined) {
        s.collidesWith = s.__hhSavedCollidesWith;
        delete s.__hhSavedCollidesWith;
      }
    });
    status(enabled ? "Collision restored." : "Collision disabled for selected object.");
  }
  function setVisible(t, visible) {
    var o = t && t.obj;
    if (!o) return;
    if (t.kind === "mesh") o.isVisible = !!visible;
    else if (o.mesh) o.mesh.isVisible = !!visible;
    if (o.shape && o.shape.inst) o.shape.inst.isVisible = !!visible;
    if (Array.isArray(o.wearables)) o.wearables.forEach(function (w) { if (w.shape && w.shape.inst) w.shape.inst.isVisible = !!visible; });
    status(visible ? "Object shown." : "Object hidden.");
  }
  function applyGlobalCollision(enabled) {
    state.globalCollisionOff = !enabled;
    var sc = scene();
    if (sc && Array.isArray(sc.meshes)) {
      // Keep this global switch to Babylon mesh flags. Changing every hamster's OIMO body
      // collision masks at once can destabilize the game's physics world; the per-object
      // inspector still exposes the deeper collision flags for individual targets.
      sc.meshes.forEach(function (m) {
        if (!m || (typeof m.isDisposed === "function" && m.isDisposed())) return;
        if (!m.__hhGlobalCollisionSaved) {
          m.__hhGlobalCollisionSaved = { checkCollisions: m.checkCollisions, isPickable: m.isPickable };
        }
        if (!enabled) {
          m.checkCollisions = false; m.isPickable = false;
        } else {
          var saved = m.__hhGlobalCollisionSaved;
          m.checkCollisions = saved.checkCollisions; m.isPickable = saved.isPickable;
          delete m.__hhGlobalCollisionSaved;
        }
      });
    }
    buildTargets();
    if ($("hhm-global-collision")) $("hhm-global-collision").checked = enabled;
    status(enabled ? "Global collision handling restored for Babylon meshes." : "Global collision/picking disabled for Babylon meshes.");
  }
  function selectedHamster() {
    var list = getHamsters();
    state.selectedHam = list[Number(($("hhm-hamster") || {}).value || 0)] || null;
    return state.selectedHam;
  }
  function hamsterBodyNear(h, x, y, z) {
    if (!h || !h.physics || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    var bodies = [h.physics.frontBody, h.physics.middleBody, h.physics.rearBody, h.physics.headBody];
    var limit = Math.max(0.18, (Number(h.size) || 0.18) * 2.5), limit2 = limit * limit;
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i] && bodies[i].body, p = body && body.position;
      if (!p) continue;
      var dx = p.x - x, dy = p.y - y, dz = p.z - z;
      if (dx * dx + dy * dy + dz * dz <= limit2) return true;
    }
    return false;
  }
  function installTubeDetectionHooks() {
    var n = ns();
    if (!n) return;
    Object.keys(n).forEach(function (key) {
      var ctor = n[key], proto = typeof ctor === "function" && ctor.prototype;
      if (!proto || !Object.prototype.hasOwnProperty.call(proto, "isInTube") || typeof proto.isInTube !== "function" || state.tubeCheckPrototypes.has(proto)) return;
      var original = proto.isInTube;
      try {
        proto.isInTube = function (x, y, z) {
          var skip = false;
          state.environmentDetectionOff.forEach(function (h) {
            if (!skip && hamsterBodyNear(h, x, y, z)) skip = true;
          });
          if (skip) return false;
          return original.apply(this, arguments);
        };
        proto.__hhOriginalIsInTube = original;
        state.tubeCheckPrototypes.add(proto);
      } catch (e) {}
    });
  }
  function setEnvironmentDetection(h, enabled) {
    if (!h) return status("No hamster is selected.", true);
    if (!h.__hhBeddingDetectionMethods) {
      h.__hhBeddingDetectionMethods = {
        front: typeof h.getBeddingHeightFront === "function" ? h.getBeddingHeightFront : null,
        rear: typeof h.getBeddingHeightRear === "function" ? h.getBeddingHeightRear : null
      };
      ["Front", "Rear"].forEach(function (which) {
        var key = which.toLowerCase(), method = h.__hhBeddingDetectionMethods[key];
        if (!method) return;
        h["getBeddingHeight" + which] = function () {
          if (state.environmentDetectionOff.has(h)) {
            var obj = h.currentObject, floor = obj && typeof obj.floorY === "number" ? obj.floorY :
              obj && obj.cage && typeof obj.cage.floorY === "number" ? obj.cage.floorY :
              obj && obj.parent && typeof obj.parent.floorY === "number" ? obj.parent.floorY : 0;
            return floor;
          }
          return method.apply(h, arguments);
        };
      });
    }
    if (enabled) state.environmentDetectionOff.delete(h);
    else state.environmentDetectionOff.add(h);
    h._beddingHeightFrameNumFront = -1;
    h._beddingHeightFrameNumRear = -1;
    installTubeDetectionHooks();
    var toggle = $("hhm-environment-detection");
    if (toggle && selectedHamster() === h) toggle.checked = !!enabled;
    status(enabled ? "Tube and bedding detection enabled for selected hamster." : "Tube and bedding detection disabled for selected hamster.");
  }
  function setHamAI(h, paused) {
    if (!h) return status("No hamster is selected.", true);
    if (!h.__hhHsmPatch && Array.isArray(h.hsm)) {
      h.__hhHsmPatch = [];
      h.hsm.forEach(function (machine) {
        if (!machine || typeof machine.update !== "function") return;
        var original = machine.update;
        machine.__hhOriginalUpdate = original;
        machine.update = function () {
          if (h.__hhAiPaused) return { actions: { length: 0, getAtIndex: function () { return null; } } };
          return original.apply(this, arguments);
        };
        h.__hhHsmPatch.push(machine);
      });
    }
    h.__hhAiPaused = !!paused;
    state.aiPaused[paused ? "add" : "delete"](h);
    if ($("hhm-ai-paused")) $("hhm-ai-paused").checked = !!paused;
    status(paused ? "Selected hamster AI state machines paused." : "Selected hamster AI resumed.");
  }
  function resumeAllAI() {
    getHamsters().forEach(function (h) {
      h.__hhAiPaused = false;
      if (Array.isArray(h.__hhHsmPatch)) {
        h.__hhHsmPatch.forEach(function (m) {
          if (m.__hhOriginalUpdate) { m.update = m.__hhOriginalUpdate; delete m.__hhOriginalUpdate; }
        });
        delete h.__hhHsmPatch;
      }
    });
    if ($("hhm-ai-paused")) $("hhm-ai-paused").checked = false;
    status("All hamster AI state machines resumed.");
  }
  function getHamsterLevelEntries(h) {
    if (!h || !h.levels) return [];
    return Object.keys(h.levels).map(function (name) {
      var lvl = h.levels[name];
      return { name: name, level: lvl };
    }).filter(function (x) {
      return x.level && typeof x.level.value === "number" && typeof x.level.maxValue === "number";
    }).slice(0, 8);
  }
  function populateHamAI() {
    var h = selectedHamster();
    setText("hhm-ham-ai-label", h ? labelHam(h, Number(($("hhm-hamster") || {}).value || 0)) : "No hamsters currently in the scene.");
    var b = $("hhm-ai-paused");
    if (b) b.checked = !!(h && h.__hhAiPaused);
    var env = $("hhm-environment-detection");
    if (env) env.checked = !!h && !state.environmentDetectionOff.has(h);
    if (!h) return;
    ["speed", "walkSpeed", "runSpeedFrac", "strength", "avoidForceMax", "focusDist", "minStandDist", "maxStepHeight"].forEach(function (key) {
      var el = $("hhm-ai-" + key);
      if (el && typeof h[key] === "number") el.value = String(round(h[key]));
    });
    var levels = getHamsterLevelEntries(h), wrap = $("hhm-levels");
    if (!wrap) return;
    wrap.innerHTML = "";
    levels.forEach(function (entry) {
      var row = document.createElement("label");
      row.className = "hhm-stat";
      var title = document.createElement("span");
      title.textContent = entry.name;
      var range = document.createElement("input");
      range.type = "range"; range.min = "0"; range.max = String(Math.max(1, entry.level.maxValue)); range.step = "1";
      range.value = String(clamp(entry.level.value, 0, entry.level.maxValue));
      range.addEventListener("input", function () {
        entry.level.value = Number(range.value);
        var out = row.querySelector("output"); if (out) out.textContent = range.value + " / " + entry.level.maxValue;
      });
      var out = document.createElement("output");
      out.textContent = round(entry.level.value) + " / " + entry.level.maxValue;
      row.appendChild(title); row.appendChild(range); row.appendChild(out); wrap.appendChild(row);
    });
    var wearable = $("hhm-clothing-slot");
    if (wearable) wearable.disabled = !Array.isArray(h.wearables) || !h.wearables.length;
  }
  function applyHamAI() {
    var h = selectedHamster();
    if (!h) return status("No hamster is selected.", true);
    ["speed", "walkSpeed", "runSpeedFrac", "strength", "avoidForceMax", "focusDist", "minStandDist", "maxStepHeight"].forEach(function (key) {
      var el = $("hhm-ai-" + key);
      if (el && typeof h[key] === "number") h[key] = clamp(num(el.value, h[key]), -100, 100);
    });
    getHamsterLevelEntries(h).forEach(function (entry) {
      if (typeof entry.level.value === "number") entry.level.value = clamp(entry.level.value, 0, entry.level.maxValue);
    });
    state.aiSnapshots.set(h, { speed:h.speed, walkSpeed:h.walkSpeed, runSpeedFrac:h.runSpeedFrac, strength:h.strength, avoidForceMax:h.avoidForceMax, focusDist:h.focusDist, minStandDist:h.minStandDist, maxStepHeight:h.maxStepHeight });
    status("AI movement parameters applied" + (state.aiKeepAlive ? " and locked against game resets." : "."));
  }
  function camera() { var h = helper(), sc = h && h.scene; return (sc && sc.activeCamera) || (h && h.camera) || null; }
  function saveCamera() {
    var c = camera();
    if (!c || state.savedCamera) return;
    state.savedCamera = {
      position: copyVec(c.position),
      rotation: copyVec(c.rotation),
      quaternion: c.rotationQuaternion && typeof c.rotationQuaternion.clone === "function" ? c.rotationQuaternion.clone() : null,
      parent: c.parent || null,
      speed: c.speed,
      inertia: c.inertia,
      checkCollisions: c.checkCollisions,
      applyGravity: c.applyGravity,
      radius: c.radius, alpha: c.alpha, beta: c.beta, target: c.getTarget && c.getTarget() ? copyVec(c.getTarget()) : null
    };
  }
  function restoreCamera() {
    var c = camera(), s = state.savedCamera;
    if (!c || !s) return;
    if (c.parent) c.parent = null;
    if (c.position && c.position.copyFromFloats) c.position.copyFromFloats(s.position.x, s.position.y, s.position.z);
    c.rotationQuaternion = s.quaternion && s.quaternion.clone ? s.quaternion.clone() : null;
    if (c.rotation && c.rotation.copyFromFloats) c.rotation.copyFromFloats(s.rotation.x, s.rotation.y, s.rotation.z);
    if ("speed" in s) c.speed = s.speed;
    if ("inertia" in s) c.inertia = s.inertia;
    if ("checkCollisions" in s) c.checkCollisions = s.checkCollisions;
    if ("applyGravity" in s) c.applyGravity = s.applyGravity;
    if (typeof s.radius === "number") c.radius = s.radius;
    if (typeof s.alpha === "number") c.alpha = s.alpha;
    if (typeof s.beta === "number") c.beta = s.beta;
    if (s.target && c.setTarget && window.BABYLON) c.setTarget(new window.BABYLON.Vector3(s.target.x, s.target.y, s.target.z));
    if (typeof s.fov === "number") c.fov = s.fov;
    if (typeof s.mode !== "undefined") c.mode = s.mode;
    if (s.parent) c.parent = s.parent;
    state.savedCamera = null;
  }
  function enforceFreecamBypass() {
    if (!state.freecam) return;
    var c = camera(), gh = helper(), sc = scene(), B = window.BABYLON;
    [c, sc && sc.activeCamera].forEach(function (cam) {
      if (!cam) return;
      cam.checkCollisions = false; cam.applyGravity = false;
      if (cam.parent) cam.parent = null;
    });
    if (sc) {
      if (state.savedSceneCollisions === null) state.savedSceneCollisions = sc.collisionsEnabled;
      sc.collisionsEnabled = false;
      if (!state.freecamMeshCollisions) state.freecamMeshCollisions = new Map();
      (sc.meshes || []).forEach(function (m) {
        if (!m || typeof m.checkCollisions !== "boolean") return;
        if (!state.freecamMeshCollisions.has(m)) state.freecamMeshCollisions.set(m, m.checkCollisions);
        m.checkCollisions = false;
      });
    }
    if (gh && B) {
      if (gh.camBoundsMin && gh.camBoundsMin.copyFromFloats) gh.camBoundsMin.copyFromFloats(-1e9, -1e9, -1e9);
      if (gh.camBoundsMax && gh.camBoundsMax.copyFromFloats) gh.camBoundsMax.copyFromFloats(1e9, 1e9, 1e9);
    }
  }
  function enforceCameraBoundsBypass() {
    if (!state.cameraBoundsBypass) return;
    var gh = helper();
    if (!gh) return;
    // HammyHome clamps its orbit/zoom camera against these vectors on every pointer move.
    // Keep both camera position and zoom animator bounds expanded after freecam is turned off so
    // ordinary zoom cannot bring the invisible cage barrier back during this session.
    if (gh.camBoundsMin) {
      if (gh.camBoundsMin.copyFromFloats) gh.camBoundsMin.copyFromFloats(-1e9, -1e9, -1e9);
      else { gh.camBoundsMin.x = -1e9; gh.camBoundsMin.y = -1e9; gh.camBoundsMin.z = -1e9; }
    }
    if (gh.camBoundsMax) {
      if (gh.camBoundsMax.copyFromFloats) gh.camBoundsMax.copyFromFloats(1e9, 1e9, 1e9);
      else { gh.camBoundsMax.x = 1e9; gh.camBoundsMax.y = 1e9; gh.camBoundsMax.z = 1e9; }
    }
    // The stock zoom animator separately clamps activeCamera.position.z each render frame.
    // Expand those limits too; changing only camBoundsMin/Max does not remove the zoom barrier.
    if (typeof gh.minCameraZoomPos === "number") gh.minCameraZoomPos = -1e9;
    if (typeof gh.maxCameraZoomPos === "number") gh.maxCameraZoomPos = 1e9;
    if (state.freecam && typeof gh.zoomForce === "number") gh.zoomForce = 0;
  }
  function restoreFreecamBypass() {
    var sc = scene();
    if (sc && state.savedSceneCollisions !== null) sc.collisionsEnabled = state.savedSceneCollisions;
    state.savedSceneCollisions = null;
    if (sc && state.freecamMeshCollisions) state.freecamMeshCollisions.forEach(function (was, mesh) {
      if (mesh && !(mesh.isDisposed && mesh.isDisposed())) mesh.checkCollisions = was;
    });
    state.freecamMeshCollisions = null;
    // Deliberately do not restore camBoundsMin/Max: the bypass is sticky for the current
    // session and must survive normal camera zoom after freecam is disabled.
    state.savedCameraBounds = null;
    enforceCameraBoundsBypass();
  }
  function worldRotationQuaternion(mesh, B) {
    if (!mesh || !B || !B.Quaternion) return null;
    try {
      if (mesh.computeWorldMatrix) mesh.computeWorldMatrix(true);
      if (mesh.getAbsoluteRotationQuaternion) {
        var abs = mesh.getAbsoluteRotationQuaternion();
        if (abs && abs.clone) return abs.clone();
      }
      if (mesh.rotationQuaternion && mesh.rotationQuaternion.clone) return mesh.rotationQuaternion.clone();
      if (mesh.rotation && B.Quaternion.RotationYawPitchRoll)
        return B.Quaternion.RotationYawPitchRoll(mesh.rotation.y || 0, mesh.rotation.x || 0, mesh.rotation.z || 0);
    } catch (e) {}
    return null;
  }
  function setFirstPersonPose(c, h, hm, B) {
    if (!c || !h || !hm || !B || !B.Vector3) return false;
    try {
      if (hm.computeWorldMatrix) hm.computeWorldMatrix(true);
      var height = num(h.eyeHeight, 0.08), offset = new B.Vector3(0, height, 0.055), worldPos;
      if (hm.getWorldMatrix && B.Vector3.TransformCoordinates) {
        worldPos = B.Vector3.TransformCoordinates(offset, hm.getWorldMatrix());
      } else {
        var p = (hm.getAbsolutePosition && hm.getAbsolutePosition()) || hm.position || h.position;
        if (!p) return false;
        var q0 = worldRotationQuaternion(hm, B);
        if (q0 && offset.rotateByQuaternionToRef) {
          var rotated = new B.Vector3(0, 0, 0);
          offset.rotateByQuaternionToRef(q0, rotated);
          worldPos = new B.Vector3(p.x + rotated.x, p.y + rotated.y, p.z + rotated.z);
        } else worldPos = new B.Vector3(p.x, p.y + height, p.z - 0.055);
      }
      if (c.parent) c.parent = null;
      if (c.position && c.position.copyFrom) c.position.copyFrom(worldPos);
      else if (c.position && c.position.copyFromFloats) c.position.copyFromFloats(worldPos.x, worldPos.y, worldPos.z);
      var q = worldRotationQuaternion(hm, B);
      if (q) {
        // The hamster model faces the opposite local-forward axis from the Babylon camera.
        var yawFix = B.Quaternion.RotationAxis(new B.Vector3(0, 1, 0), Math.PI);
        c.rotationQuaternion = q.multiply(yawFix);
      }
      else if (hm.rotation && c.rotation && c.rotation.copyFromFloats)
        c.rotation.copyFromFloats(hm.rotation.x || 0, hm.rotation.y || 0, hm.rotation.z || 0);
      return true;
    } catch (e) { return false; }
  }
  function setFreecam(enabled) {
    var c = camera(), canvas = $("mainCanvas");
    if (!c) return status("Camera is not ready yet.", true);
    if (enabled) {
      saveCamera(); state.followHam = null; state.firstPerson = false; state.freecam = true;
      if ($("hhm-first-person")) $("hhm-first-person").checked = false;
      if ($("hhm-perspective")) $("hhm-perspective").checked = false;
      var gh = helper();
      if (gh && gh.camBoundsMin && gh.camBoundsMax && !state.cameraBoundsBypass) {
        state.savedCameraBounds = { min: copyVec(gh.camBoundsMin), max: copyVec(gh.camBoundsMax) };
      }
      state.cameraBoundsBypass = true;
      enforceCameraBoundsBypass();
      if (c.parent) c.parent = null;
      c.rotationQuaternion = null; c.inertia = 0;
      c.checkCollisions = false; c.applyGravity = false;
      enforceFreecamBypass();
      c.speed = num(($("hhm-cam-speed") || {}).value, 5);
      if (canvas) canvas.classList.add("hhm-freecam-cursor");
      status("Freecam enabled. Click “Lock mouse” for mouse-look; use WASD, Q/E and Shift.");
    } else {
      state.freecam = false; state.keys = Object.create(null);
      if (document.pointerLockElement && canvas && document.exitPointerLock) document.exitPointerLock();
      document.body.classList.remove("hhm-pointer-locked");
      if (canvas) canvas.classList.remove("hhm-freecam-cursor");
      restoreFreecamBypass();
      restoreCamera();
      status("Freecam disabled; camera pose restored. Cage-boundary bypass remains active for normal zoom this session.");
    }
    if (state.freecam) {
      // The checkbox otherwise retains keyboard focus and prevents WASD from reaching freecam.
      var active = document.activeElement;
      if (active && typeof active.blur === "function") active.blur();
      if (canvas && typeof canvas.focus === "function") canvas.focus();
    }
    if ($("hhm-freecam")) $("hhm-freecam").checked = state.freecam;
  }
  function togglePerspective(enabled) {
    var c = camera(), h = getHamsters()[Number(($("hhm-perspective-hamster") || {}).value || 0)];
    if (!c) return status("Camera is not ready yet.", true);
    if (enabled && h) {
      saveCamera();
      if (state.freecam) { state.freecam = false; restoreFreecamBypass(); }
      state.followHam = h;
      state.firstPerson = !!(($('hhm-first-person') || {}).checked);
      if (c.parent) c.parent = null;
      status("Hamster perspective enabled. Choose another hamster or turn it off to restore the camera.");
    } else {
      if (c.parent) c.parent = null;
      state.followHam = null; state.firstPerson = false;
      if ($("hhm-first-person")) $("hhm-first-person").checked = false;
      if ($("hhm-perspective")) $("hhm-perspective").checked = false;
      if (!state.freecam) restoreCamera();
      status("Hamster perspective disabled.");
    }
  }
  function tickCamera() {
    var c = camera(), sc = scene();
    if (!c || !sc || !window.BABYLON) return;
    if (state.freecam) {
      enforceFreecamBypass();
      var now = performance.now(), dt = state.lastTick ? clamp((now - state.lastTick) / 1000, 0, 0.05) : 0.016;
      var speed = num(($("hhm-cam-speed") || {}).value, 5) * (state.keys.Shift ? 3 : 1) * dt;
      var B = window.BABYLON;
      var forward = c.getDirection ? c.getDirection(new B.Vector3(0, 0, 1)) : new B.Vector3(0, 0, 1);
      var right = c.getDirection ? c.getDirection(new B.Vector3(1, 0, 0)) : new B.Vector3(1, 0, 0);
      if (state.keys.w || state.keys.ArrowUp) c.position.addInPlace(forward.scale(speed));
      if (state.keys.s || state.keys.ArrowDown) c.position.subtractInPlace(forward.scale(speed));
      if (state.keys.d || state.keys.ArrowRight) c.position.addInPlace(right.scale(speed));
      if (state.keys.a || state.keys.ArrowLeft) c.position.subtractInPlace(right.scale(speed));
      if (state.keys.e) c.position.y += speed;
      if (state.keys.q) c.position.y -= speed;
      state.lastTick = now;
      enforceFreecamBypass();
    } else if (state.followHam) {
      var h = state.followHam;
      if (h.isOnScene === false) { state.followHam = null; restoreCamera(); return; }
      var p = h.mesh && h.mesh.position || h.position;
      if (p && c.position) {
        // Keep camera unparented so HammyHome's Z-based zoom/orbit remains intact.
        // First person follows the hamster world rotation and sets an actual world pose.
        var hm = h.mesh || h;
        if (state.firstPerson) {
          setFirstPersonPose(c, h, hm, window.BABYLON);
        } else {
          if (c.parent) c.parent = null;
          c.position.copyFromFloats(p.x, p.y + 0.12, p.z - 0.22);
          var r = hm && hm.rotation ? hm.rotation : h.rotation;
          if (hm && hm.rotationQuaternion && hm.rotationQuaternion.clone) c.rotationQuaternion = hm.rotationQuaternion.clone();
          else {
            c.rotationQuaternion = null;
            if (isVec(r) && c.rotation) c.rotation.copyFromFloats(r.x, r.y, r.z);
          }
        }
      }
    }
  }
  function setLimitsRemoved(enabled) {
    var a = app(), h = helper();
    state.limitsRemoved = !!enabled;
    if (!a || !h) return status("Game scene is not ready yet.", true);
    if (enabled) {
      if (!state.savedBounds) {
        state.savedBounds = {
          min: h.camBoundsMin && copyVec(h.camBoundsMin),
          max: h.camBoundsMax && copyVec(h.camBoundsMax)
        };
      }
      var B = window.BABYLON;
      if (h.camBoundsMin && B) h.camBoundsMin.copyFromFloats(-100000, -100000, -100000);
      if (h.camBoundsMax && B) h.camBoundsMax.copyFromFloats(100000, 100000, 100000);
      if (!state.savedDeleteStray) {
        state.savedDeleteStray = a.deleteStrayParts;
        a.deleteStrayParts = function () {};
      }
      state.targets.forEach(function (t) {
        var o = t.obj;
        if (o && o.boundsMin && o.boundsMax && isVec(o.boundsMin) && isVec(o.boundsMax)) {
          if (!o.__hhBoundsSaved) o.__hhBoundsSaved = { min: copyVec(o.boundsMin), max: copyVec(o.boundsMax) };
          o.boundsMin.x = o.boundsMin.y = o.boundsMin.z = -100000;
          o.boundsMax.x = o.boundsMax.y = o.boundsMax.z = 100000;
        }
      });
      status("Placement/camera bounds greatly expanded; stray-part cleanup disabled.");
    } else {
      if (state.savedBounds) {
        if (h.camBoundsMin && state.savedBounds.min) h.camBoundsMin.copyFromFloats(state.savedBounds.min.x, state.savedBounds.min.y, state.savedBounds.min.z);
        if (h.camBoundsMax && state.savedBounds.max) h.camBoundsMax.copyFromFloats(state.savedBounds.max.x, state.savedBounds.max.y, state.savedBounds.max.z);
        state.savedBounds = null;
      }
      if (state.savedDeleteStray) { a.deleteStrayParts = state.savedDeleteStray; state.savedDeleteStray = null; }
      state.targets.forEach(function (t) {
        var o = t.obj;
        if (o && o.__hhBoundsSaved && o.boundsMin && o.boundsMax) {
          var s = o.__hhBoundsSaved;
          o.boundsMin.x = s.min.x; o.boundsMin.y = s.min.y; o.boundsMin.z = s.min.z;
          o.boundsMax.x = s.max.x; o.boundsMax.y = s.max.y; o.boundsMax.z = s.max.z;
          delete o.__hhBoundsSaved;
        }
      });
      status("Original placement/camera bounds restored.");
    }
    if ($("hhm-limits")) $("hhm-limits").checked = state.limitsRemoved;
  }

  function setPlacementValidationOff(enabled) {
    state.placementValidationOff = !!enabled;
    var a = app(), patched = 0;
    if (a && !a.__hhValidationOriginals) {
      a.__hhValidationOriginals = {};
      Object.keys(a).forEach(function (k) {
        if (!/valid|placement|bound|limit|inside|overlap/i.test(k) || typeof a[k] !== "function") return;
        if (/deleteStrayParts/i.test(k)) return;
        var original = a[k]; a.__hhValidationOriginals[k] = original;
        a[k] = function () { if (state.placementValidationOff && /valid|placement|inside|overlap/i.test(k)) return true; return original.apply(this, arguments); };
        patched++;
      });
    }
    status(enabled ? "Placement validation bypass enabled for discovered app-level validators (" + patched + " newly patched). Some hard-coded UI rules may remain." : "Placement validation bypass disabled. Reload the game to fully restore wrapped validators.");
  }
  function setAIKeepAlive(enabled) {
    state.aiKeepAlive = !!enabled;
    if (enabled) getHamsters().forEach(function (h) { state.aiSnapshots.set(h, { speed:h.speed, walkSpeed:h.walkSpeed, runSpeedFrac:h.runSpeedFrac, strength:h.strength, avoidForceMax:h.avoidForceMax, focusDist:h.focusDist, minStandDist:h.minStandDist, maxStepHeight:h.maxStepHeight }); });
    status(enabled ? "AI movement fields will be re-applied each frame to resist game resets." : "AI movement field lock disabled.");
  }
  function consoleCommand(line) {
    var parts = String(line || "").trim().split(/\s+/); if (!parts[0]) return "";
    var cmd = parts[0], a = app(), hamsters = getHamsters();
    if (/^(help|\?)$/i.test(cmd)) return "Commands: help | list | maximumStepHeight (step height) (hamster #) | speed (value) (hamster #) | walkSpeed (value) (hamster #) | aiPause (on|off) (hamster #) | timescale (value) | freecam (on|off) | limits (on|off) | placementValidation (on|off) | firstPerson (on|off) (hamster #) | backgroundColor (#hex)";
    if (/^list$/i.test(cmd)) return hamsters.map(function(h,i){return (i+1)+": "+labelHam(h,i);}).join("\\n") || "No hamsters found.";
    if (/^(maximumStepHeight|stepHeight|speed|walkSpeed)$/i.test(cmd)) {
      var value = Number(parts[1]), idx = Math.max(1, Number(parts[2] || 1))-1, h = hamsters[idx];
      if (!h || !Number.isFinite(value)) return "Usage: "+cmd+" (value) (hamster #)";
      var key = /^maximumStepHeight|stepHeight$/i.test(cmd) ? "maxStepHeight" : cmd;
      h[key] = value; var snap = state.aiSnapshots.get(h) || {}; snap[key] = value; state.aiSnapshots.set(h,snap); return "Hamster "+(idx+1)+" "+key+" = "+value;
    }
    if (/^aiPause$/i.test(cmd)) { var idx2=Math.max(1,Number(parts[2]||1))-1; if(!hamsters[idx2])return "Hamster index not found."; setHamAI(hamsters[idx2], /^on|true|1$/i.test(parts[1]||"on")); return "AI pause updated for hamster "+(idx2+1); }
    if (/^timescale$/i.test(cmd)) { if(!a)return "Game not ready."; a.timeScale=Number(parts[1]); return "Time scale = "+a.timeScale; }
    if (/^freecam$/i.test(cmd)) { setFreecam(/^on|true|1$/i.test(parts[1])); return "Freecam updated."; }
    if (/^limits$/i.test(cmd)) { setLimitsRemoved(/^on|true|1$/i.test(parts[1])); return "Limits updated."; }
    if (/^placementValidation$/i.test(cmd)) { setPlacementValidationOff(/^off|false|0$/i.test(parts[1])); return "Placement validation updated."; }
    if (/^firstPerson$/i.test(cmd)) { var idx3=Math.max(1,Number(parts[2]||1))-1; var sel=$("hhm-perspective-hamster"); if(sel)sel.value=String(idx3); togglePerspective(/^on|true|1$/i.test(parts[1])); state.firstPerson=/^on|true|1$/i.test(parts[1]); return "First person updated."; }
    if (/^backgroundColor$/i.test(cmd) && /^#[0-9a-f]{6}$/i.test(parts[1]||"")) { $("hhm-bg-color").value=parts[1]; applyBackgroundColor(); return "Background color updated."; }
    return "Unknown command. Type help.";
  }
  function setConsoleMode(enabled) {
    state.consoleMode = !!enabled;
    var panel = $("hhm-panel"), toggle = $("hhm-toggle"), consoleBox = $("hhm-console");
    if (panel) panel.style.display = enabled ? "none" : "";
    if (toggle) toggle.style.display = enabled ? "none" : "";
    if (consoleBox) consoleBox.style.display = enabled ? "block" : "none";
    status(enabled ? "Console mode enabled. Use the command prompt; type help." : "Console mode disabled.");
  }

  function createTexture(data, name) {
    var sc = scene(), B = window.BABYLON;
    if (!sc || !B || !data) throw new Error("Scene or image data unavailable.");
    return new B.Texture(data, sc, true, false, B.Texture.TRILINEAR_SAMPLINGMODE, function () {}, function () {});
  }
  function makeImageMaterial(tex, name) {
    var B = window.BABYLON, sc = scene();
    var mat = new B.StandardMaterial(name, sc);
    mat.diffuseTexture = tex; mat.diffuseColor = B.Color3.White();
    mat.emissiveColor = B.Color3.White(); mat.specularColor = B.Color3.Black();
    mat.disableLighting = true; mat.backFaceCulling = false;
    if (tex) { tex.hasAlpha = true; mat.useAlphaFromDiffuseTexture = true; }
    return mat;
  }
  function applyBackgroundImage() {
    var a = app(), B = window.BABYLON;
    if (!a || !a.background || !a.background.mesh) return status("Game background is not ready.", true);
    if (!state.uploadedDataUrl) return status("Choose a PNG file first.", true);
    try {
      if (!a.background.__hhOriginalMaterial) a.background.__hhOriginalMaterial = a.background.mesh.material;
      if (a.background.__hhCustomTexture) a.background.__hhCustomTexture.dispose();
      var tex = createTexture(state.uploadedDataUrl, "hhCustomBackgroundTexture");
      var mat = makeImageMaterial(tex, "hhCustomBackgroundMaterial");
      a.background.__hhCustomTexture = tex; a.background.__hhCustomMaterial = mat;
      a.background.mesh.material = mat; a.background.mesh.isPickable = false;
      if (a.background.mesh.position) a.background.mesh.position.z = 2.01;
      status("Custom PNG background applied: " + state.uploadedName);
    } catch (e) { status("Could not apply background: " + e.message, true); }
  }
  function restoreBackground() {
    var a = app();
    if (!a || !a.background || !a.background.mesh || !a.background.__hhOriginalMaterial) return status("No custom background is active.", true);
    a.background.mesh.material = a.background.__hhOriginalMaterial;
    if (a.background.__hhCustomTexture) a.background.__hhCustomTexture.dispose();
    delete a.background.__hhCustomTexture; delete a.background.__hhCustomMaterial;
    delete a.background.__hhOriginalMaterial;
    status("Original HammyHome background restored.");
  }
  function getWearableMesh(w) {
    if (!w) return null;
    if (w.mesh && w.mesh.material !== undefined) return w.mesh;
    if (w.shape && w.shape.inst && w.shape.inst.material !== undefined) return w.shape.inst;
    return null;
  }
  function applyHamsterClothing() {
    var h = selectedHamster(), B = window.BABYLON, sc = scene();
    if (!h || !Array.isArray(h.wearables)) return status("Select a hamster with clothing slots first.", true);
    if (!state.uploadedDataUrl) return status("Choose a PNG file first.", true);
    var slot = ($("hhm-clothing-slot") || {}).value || "shirt";
    var wearable = typeof h.getWearableByType === "function" ? h.getWearableByType(slot) : h.wearables.find(function (w) { return w.type === slot; });
    var mesh = getWearableMesh(wearable);
    if (!wearable || !mesh) return status("This hamster has no active " + slot + " mesh. Try another clothing slot.", true);
    try {
      if (!wearable.__hhOriginalMaterial) wearable.__hhOriginalMaterial = mesh.material;
      if (wearable.__hhCustomTexture) wearable.__hhCustomTexture.dispose();
      var tex = createTexture(state.uploadedDataUrl, "hhCustomClothingTexture");
      var mat = makeImageMaterial(tex, "hhCustomClothingMaterial");
      wearable.__hhCustomTexture = tex; wearable.__hhCustomMaterial = mat;
      mesh.material = mat;
      status("PNG applied to the hamster's " + slot + ". Use a UV-compatible clothing texture for the cleanest result.");
    } catch (e) { status("Could not apply clothing PNG: " + e.message, true); }
  }
  function restoreHamsterClothing() {
    var h = selectedHamster(), slot = ($("hhm-clothing-slot") || {}).value || "shirt";
    var wearable = h && typeof h.getWearableByType === "function" ? h.getWearableByType(slot) : null;
    var mesh = getWearableMesh(wearable);
    if (!wearable || !mesh || !wearable.__hhOriginalMaterial) return status("No custom texture is active on that clothing slot.", true);
    mesh.material = wearable.__hhOriginalMaterial;
    if (wearable.__hhCustomTexture) wearable.__hhCustomTexture.dispose();
    delete wearable.__hhOriginalMaterial; delete wearable.__hhCustomTexture; delete wearable.__hhCustomMaterial;
    status("Original " + slot + " material restored.");
  }
  function editableMaterialMesh(mesh) {
    if (!mesh) return null;
    // Babylon InstancedMesh exposes material through a getter; its source mesh owns the material.
    if (mesh.sourceMesh && typeof mesh.sourceMesh.material !== "undefined") return mesh.sourceMesh;
    return mesh;
  }
  function applyItemTexture() {
    var t = state.selected;
    if (!t || !state.uploadedDataUrl) return status("Select an item/mesh and choose a PNG first.", true);
    var requested = t.kind === "mesh" ? t.obj : (t.obj.mesh || t.obj.shape && t.obj.shape.inst);
    var mesh = editableMaterialMesh(requested);
    if (!mesh || mesh.material === undefined) return status("The selected simulator item does not expose an editable mesh material.", true);
    try {
      if (!mesh.__hhOriginalMaterial) mesh.__hhOriginalMaterial = mesh.material;
      if (mesh.__hhCustomTexture) mesh.__hhCustomTexture.dispose();
      var tex = createTexture(state.uploadedDataUrl, "hhCustomItemTexture");
      mesh.material = makeImageMaterial(tex, "hhCustomItemMaterial");
      mesh.__hhCustomTexture = tex;
      mesh.__hhCustomTextureOwner = mesh;
      status(mesh !== requested ? "PNG applied to the source mesh; all instances sharing it will change. Use Restore mesh material to undo." : "PNG applied to selected mesh. Use Restore mesh material to undo.");
    } catch (e) { status("Could not apply PNG: " + e.message, true); }
  }
  function restoreItemTexture() {
    var t = state.selected;
    var requested = t && (t.kind === "mesh" ? t.obj : t.obj.mesh || t.obj.shape && t.obj.shape.inst);
    var mesh = editableMaterialMesh(requested);
    if (!mesh || !mesh.__hhOriginalMaterial) return status("No custom mesh material to restore.", true);
    mesh.material = mesh.__hhOriginalMaterial;
    if (mesh.__hhCustomTexture) mesh.__hhCustomTexture.dispose();
    delete mesh.__hhCustomTexture; delete mesh.__hhOriginalMaterial; delete mesh.__hhCustomTextureOwner;
    status("Original mesh material restored.");
  }
  function applyBackgroundColor() {
    var a = app(), color = $("hhm-bg-color").value;
    if (!a || !a.background) return;
    a.background.colorHex = color;
    if (a.background.mesh && a.background.__hhOriginalMaterial) {
      // Keep image background when active; scene clear color still follows the chosen color.
      a.background.colorHex = color;
    }
    status("Background color updated.");
  }
  function applyPattern() {
    var a = app(), pat = ($("hhm-bg-pattern") || {}).value || "none";
    if (!a || !a.background || typeof a.background.setPattern !== "function") return status("Background patterns unavailable.", true);
    try {
      var bg = a.background;
      if (pat === "none") {
        // The original app's setPattern("none") asks PatternTextureManager for a texture
        // that does not exist in this capture. Restore the baseline material without that call.
        var base = state.originalBackgroundPattern;
        if (base) {
          bg.texture = base.texture;
          if (bg.material) bg.material.diffuseTexture = base.diffuseTexture;
          bg.selectedOption = base.selectedOption;
          bg.patternName = "none";
          if (bg._colors) {
            if (base.hadPatternColor) bg._colors.pattern = base.patternColor;
            else delete bg._colors.pattern;
          }
        } else {
          bg.texture = null;
          if (bg.material) bg.material.diffuseTexture = null;
          if (bg._colors) delete bg._colors.pattern;
          bg.patternName = "none"; bg.selectedOption = null;
        }
        Object.keys(bg._options || {}).forEach(function (k) { bg._options[k].value = "0"; });
        status("Background pattern cleared.");
      } else {
        bg.setPattern(pat); bg.patternName = pat;
        status("Background pattern: " + pat);
      }
    } catch (e) { status("Pattern could not be applied: " + e.message, true); }
  }
  function exportPreset() {
    var a = app(), rows = [];
    if (a && Array.isArray(a.objsOnScene)) {
      a.objsOnScene.forEach(function (o, i) {
        if (!o || !o.position) return;
        var target = { obj: o, kind: "item" };
        rows.push({ name: safeName(o), id: o.id || null, shapeName: o.shapeName || null,
          position: getTargetPos(target), rotation: getTargetRot(target), scale: getTargetScale(target) });
      });
    }
    var payload = {
      format: "hammyhome-mod-preset", version: 1, createdAt: new Date().toISOString(),
      timeScale: a ? a.timeScale : 1, paused: a ? !!a.paused : false,
      backgroundColor: a && a.background ? a.background.colorHex : null,
      backgroundPattern: a && a.background ? a.background.patternName : null,
      transforms: rows
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "hammyhome-mod-preset.json"; document.body.appendChild(link);
    link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    status("Mod preset exported as JSON.");
  }
  function importPreset(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        if (data.format !== "hammyhome-mod-preset" || !Array.isArray(data.transforms)) throw new Error("That file is not a HammyHome mod preset.");
        var a = app(), matched = 0;
        if (a && Number.isFinite(data.timeScale)) a.timeScale = data.timeScale;
        if (a && typeof data.paused === "boolean") a.paused = data.paused;
        if (a && a.background && data.backgroundColor) a.background.colorHex = data.backgroundColor;
        if (a && a.background && data.backgroundPattern && typeof a.background.setPattern === "function") {
          try { a.background.setPattern(data.backgroundPattern); } catch (ignorePatternError) {}
        }
        var candidates = [];
        if (a && Array.isArray(a.objsOnScene)) candidates = a.objsOnScene;
        data.transforms.forEach(function (record) {
          var o = candidates.find(function (x) { return record.id && x.id === record.id; });
          if (!o) o = candidates.find(function (x) { return record.shapeName && x.shapeName === record.shapeName && safeName(x) === record.name; });
          if (!o) o = candidates.find(function (x) { return safeName(x) === record.name; });
          if (!o) return;
          var t = { obj: o, kind: "item" };
          if (record.position) setPos(t, record.position);
          if (record.rotation) setRot(t, record.rotation);
          if (record.scale) setScale(t, record.scale);
          matched++;
        });
        if ($("hhm-time-scale")) $("hhm-time-scale").value = String(a ? a.timeScale : 1);
        if ($("hhm-paused")) $("hhm-paused").checked = !!(a && a.paused);
        buildTargets(); populateTransformFields();
        status("Preset imported; matched " + matched + " placed item(s).");
      } catch (e) { status("Preset import failed: " + e.message, true); }
    };
    reader.readAsText(file);
  }
  function importShareLink(rawLink) {
    var input = (rawLink || "").trim();
    if (!input) return status("Paste a HammyHome share link first.", true);
    try {
      if (!/^https?:\/\//i.test(input)) input = "https://" + input;
      var u = new URL(input);
      var host = u.hostname.toLowerCase();
      if (host !== "hammyhome.com" && host !== "www.hammyhome.com")
        throw new Error("Use a link from hammyhome.com.");
      var payload = u.searchParams.get("hh");
      if (!payload && u.hash) payload = new URLSearchParams(u.hash.replace(/^#/, "")).get("hh");
      if (!payload) throw new Error("The link does not contain an hh= share payload.");
      if (payload.length > 2000000) throw new Error("This share link is too large to import safely.");
      var decoded = decodeURIComponent(payload);
      var n = ns();
      if (!n || !n.z1073 || typeof n.z1073.ConvertCrushedQueryStringToJSON !== "function")
        throw new Error("The game parser is not ready yet; wait for the home to finish loading and retry.");
      var parsed = n.z1073.ConvertCrushedQueryStringToJSON(decoded);
      if (!parsed || !Array.isArray(parsed.names) || !Array.isArray(parsed.props))
        throw new Error("The hh= value could not be parsed as a HammyHome home.");
      // Let the original HammyHome loader instantiate the imported home. Re-encode one
      // URL layer because its startup parser performs one additional decodeURIComponent().
      var query = "?hh=" + encodeURIComponent(payload);
      status("Share link validated. Reloading this local build with the imported home…");
      window.location.assign(window.location.pathname + query);
    } catch (e) {
      status("Share link import failed: " + (e && e.message ? e.message : String(e)), true);
    }
  }
  function duplicateSelectedMesh() {
    var t = state.selected, o = t && t.obj;
    if (!o || t.kind !== "mesh") return status("Select a Babylon mesh to duplicate.", true);
    if (o.sourceMesh && !state.allowInstancedDuplicate) return status("This is an instanced mesh. Enable 'Allow instanced mesh duplication' first.", true);
    if (!o.sourceMesh && typeof o.clone !== "function") return status("This mesh cannot be duplicated.", true);
    try {
      var copy = o.sourceMesh ? o.sourceMesh.createInstance((o.name || "instance") + "_modCopy") : o.clone(o.name + "_modCopy");
      if (!copy) return status("This mesh cannot be duplicated.", true);
      if (copy.position && o.position) copy.position.addInPlace(new window.BABYLON.Vector3(0.25, 0, 0));
      copy.isPickable = true; copy.checkCollisions = o.checkCollisions;
      buildTargets();
      status("Mesh duplicated. The duplicate is a runtime copy and may not be saved by the original game.");
    } catch (e) { status("Duplicate failed: " + e.message, true); }
  }
  function createUI() {
    if ($("hhm-toggle")) return;
    var style = document.createElement("style");
    style.id = "hhm-styles";
    style.textContent = `
      #hhm-toggle{position:fixed;z-index:100000;left:12px;top:12px;border:1px solid #a95b16;border-radius:10px;background:#25221f;color:#fff;font:700 13px/1.1 Muli,Arial,sans-serif;letter-spacing:.07em;padding:11px 14px;box-shadow:0 3px 14px #0005;cursor:pointer;touch-action:manipulation}
      #hhm-panel{position:fixed;z-index:100001;top:58px;left:10px;width:min(455px,calc(100vw - 20px));max-height:calc(100dvh - 70px);overflow:auto;box-sizing:border-box;border:1px solid #d8c5ad;border-radius:14px;background:#fbf7ef;color:#2d2924;font:13px/1.35 Muli,Arial,sans-serif;box-shadow:0 12px 38px #0006;display:none;touch-action:auto;overscroll-behavior:contain}
      #hhm-panel.hhm-open{display:block}#hhm-panel *{box-sizing:border-box}#hhm-panel input,#hhm-panel select,#hhm-panel button{font:inherit;touch-action:auto}
      .hhm-head{position:sticky;top:0;z-index:5;background:#292623;color:#fff;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:13px 13px 0 0}
      .hhm-title{font-size:16px;font-weight:800;letter-spacing:.01em}.hhm-subtitle{font-size:11px;color:#d8caba;margin-top:2px}
      .hhm-close{color:#fff;background:#514840;border:0;border-radius:8px;padding:7px 10px;cursor:pointer}
      .hhm-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;padding:7px;background:#e9dfd1;position:sticky;top:56px;z-index:4}
      .hhm-tab{border:0;border-radius:7px;padding:8px 2px;background:transparent;color:#4b4137;font-weight:800;font-size:11px;cursor:pointer}
      .hhm-tab.active{background:#fff;color:#9a4d12;box-shadow:0 1px 4px #0001}
      .hhm-body{padding:12px}.hhm-page{display:none}.hhm-page.active{display:block}
      .hhm-section{border:1px solid #e5d9c9;background:#fffdf9;border-radius:10px;padding:10px;margin-bottom:10px}
      .hhm-section h3{font-size:13px;font-weight:800;margin-bottom:8px;color:#8e4b16}
      .hhm-muted{color:#766c61;font-size:11px;line-height:1.45}.hhm-note{background:#f4eadb;border-radius:7px;padding:8px;font-size:11px;margin-top:7px}
      .hhm-field{display:flex;flex-direction:column;gap:4px;min-width:0}.hhm-field span,.hhm-label{font-size:11px;font-weight:700;color:#55493e}
      .hhm-field input,.hhm-field select,.hhm-field textarea,.hhm-select,.hhm-number{width:100%;min-width:0;border:1px solid #d7c9b7;background:#fff;border-radius:6px;padding:7px;color:#2a2927;outline-color:#cb7b33}
      .hhm-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.hhm-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .hhm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hhm-row>*{min-width:0}.hhm-btn{border:1px solid #b96a27;border-radius:7px;background:#c4772d;color:#fff;padding:8px 10px;font-weight:800;cursor:pointer}
      .hhm-btn.secondary{border-color:#d4c7b8;background:#f4eee6;color:#51463b}.hhm-btn.dark{border-color:#292623;background:#292623;color:#fff}.hhm-btn:disabled{opacity:.45;cursor:not-allowed}
      .hhm-check{display:flex;align-items:center;gap:7px;font-weight:700;font-size:12px;margin:6px 0}.hhm-check input{accent-color:#b96722;width:16px;height:16px}
      .hhm-slider{width:100%;accent-color:#b96722}.hhm-stat{display:grid;grid-template-columns:74px 1fr auto;gap:7px;align-items:center;margin:7px 0;font-size:11px}.hhm-stat output{font-variant-numeric:tabular-nums;color:#6b5844;white-space:nowrap}
      .hhm-status{position:sticky;bottom:0;padding:0 12px;max-height:0;overflow:hidden;transition:max-height .15s,padding .15s;background:#262320;color:#fff;border-radius:0 0 12px 12px;font-size:12px}
      .hhm-status.hhm-status-on{max-height:110px;padding:10px 12px}.hhm-status.hhm-error{background:#792f22}
      .hhm-pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#ede3d6;color:#6c4a2c;font-size:10px;font-weight:800}
      .hhm-file{width:100%;font-size:11px}.hhm-share-link{min-height:68px;resize:vertical;font:11px/1.4 monospace}.hhm-freecam-cursor{cursor:crosshair!important}body.hhm-pointer-locked #hhm-panel,body.hhm-pointer-locked #hhm-toggle{visibility:hidden!important;pointer-events:none!important}
      @media(max-width:420px){.hhm-tabs{grid-template-columns:repeat(5,minmax(0,1fr))}.hhm-tab{font-size:10px}.hhm-body{padding:8px}.hhm-section{padding:8px}}
    `;
    document.head.appendChild(style);
    var panel = document.createElement("div");
    panel.id = "hhm-panel";
    panel.innerHTML = `
      <div class="hhm-head"><div><div class="hhm-title">HammyHome Mod Menu</div><div class="hhm-subtitle">!! THIS IS A VERY EARLY BETA, EXPECT BUGS !!</div></div><button id="hhm-close" class="hhm-close" type="button">Close ✕</button></div>
      <div class="hhm-tabs">
        <button class="hhm-tab active" data-tab="inspect">INSPECT</button>
        <button class="hhm-tab" data-tab="hamsters">HAMSTERS</button>
        <button class="hhm-tab" data-tab="camera">CAMERA</button>
        <button class="hhm-tab" data-tab="world">WORLD</button>
        <button class="hhm-tab" data-tab="assets">OTHER</button>
      </div>
      <div class="hhm-body">
        <section class="hhm-page active" data-page="inspect">
          <div class="hhm-section">
            <h3>Scene selector</h3>
            <label class="hhm-field"><span>Placed items, hamsters and root meshes</span><select id="hhm-target" class="hhm-select"></select></label>
            <div id="hhm-selected-label" class="hhm-muted" style="margin-top:7px">Waiting for scene…</div>
            <div class="hhm-row" style="margin-top:8px"><button class="hhm-btn secondary" id="hhm-refresh" type="button">Refresh list</button><button class="hhm-btn secondary" id="hhm-undo" type="button" disabled>Undo transform</button><button class="hhm-btn secondary" id="hhm-duplicate" type="button">Duplicate mesh</button></div>
            <label class="hhm-check"><input id="hhm-instanced-duplicate" type="checkbox"> Allow duplicating instanced meshes</label>
          </div>
          <div class="hhm-section">
            <h3>Position</h3>
            <div class="hhm-grid3">
              <label class="hhm-field"><span>X</span><input id="hhm-pos-x" type="number" step="0.05"></label>
              <label class="hhm-field"><span>Y</span><input id="hhm-pos-y" type="number" step="0.05"></label>
              <label class="hhm-field"><span>Z</span><input id="hhm-pos-z" type="number" step="0.05"></label>
            </div>
          </div>
          <div class="hhm-section">
            <h3>Rotation · degrees</h3>
            <div class="hhm-grid3">
              <label class="hhm-field"><span>X</span><input id="hhm-rot-x" type="number" step="5"></label>
              <label class="hhm-field"><span>Y</span><input id="hhm-rot-y" type="number" step="5"></label>
              <label class="hhm-field"><span>Z</span><input id="hhm-rot-z" type="number" step="5"></label>
            </div>
          </div>
          <div class="hhm-section">
            <h3>Size / scale</h3>
            <div class="hhm-grid3">
              <label class="hhm-field"><span>Width · X</span><input id="hhm-scale-x" type="number" step="0.1" min="0.01"></label>
              <label class="hhm-field"><span>Height · Y</span><input id="hhm-scale-y" type="number" step="0.1" min="0.01"></label>
              <label class="hhm-field"><span>Depth · Z</span><input id="hhm-scale-z" type="number" step="0.1" min="0.01"></label>
            </div>
            <div class="hhm-row" style="margin-top:9px"><button class="hhm-btn" id="hhm-apply-transform" type="button">Apply transform</button><button class="hhm-btn secondary" id="hhm-unit-scale" type="button">Set scale to 1</button></div>
          </div>
          <div class="hhm-section">
            <h3>Object state</h3>
            <label class="hhm-check"><input id="hhm-visible" type="checkbox" checked> Visible</label>
            <label class="hhm-check"><input id="hhm-collision" type="checkbox" checked> Collision / picking enabled where supported</label>
            <div class="hhm-note">Hamster positioning uses its physics body. Scaling a hamster changes its displayed mesh and size parameter; the simulator's internal physics dimensions may not perfectly follow custom scaling.</div>
          </div>
        </section>

        <section class="hhm-page" data-page="hamsters">
          <div class="hhm-section">
            <h3>Hamster controls <span id="hhm-ham-count" class="hhm-pill">0 in scene</span></h3>
            <label class="hhm-field"><span>Select hamster</span><select id="hhm-hamster" class="hhm-select"></select></label>
            <div id="hhm-ham-ai-label" class="hhm-muted" style="margin:7px 0">Waiting for hamster instances…</div>
            <label class="hhm-check"><input id="hhm-ai-paused" type="checkbox"> Pause selected hamster AI state machines</label>
            <label class="hhm-check"><input id="hhm-environment-detection" type="checkbox" checked> Let game detect tubes and bedding for selected hamster</label>
            <label class="hhm-check"><input id="hhm-ai-keepalive" type="checkbox"> Lock movement fields against AI resets</label>
            <div class="hhm-note">Turn off tube/bedding detection to make AI checks treat the selected hamster as outside those features. This does not remove tube or bedding objects from the scene.</div>
            <div class="hhm-note">Pauses the selected hamster's AI state updates. Its body can still respond to the shared physics world.</div>
          </div>
          <div class="hhm-section">
            <h3>Movement & behaviour</h3>
            <div class="hhm-grid2">
              <label class="hhm-field"><span>Speed multiplier</span><input id="hhm-ai-speed" type="number" min="0" max="9999" step="0.1"></label>
              <label class="hhm-field"><span>Walk speed</span><input id="hhm-ai-walkSpeed" type="number" min="0" max="9999" step="0.1"></label>
              <label class="hhm-field"><span>Run speed fraction</span><input id="hhm-ai-runSpeedFrac" type="number" min="0" max="9999" step="0.1"></label>
              <label class="hhm-field"><span>Strength</span><input id="hhm-ai-strength" type="number" min="0" max="9999" step="0.1"></label>
              <label class="hhm-field"><span>Avoidance force max</span><input id="hhm-ai-avoidForceMax" type="number" min="0" max="9999" step="0.1"></label>
              <label class="hhm-field"><span>Focus distance</span><input id="hhm-ai-focusDist" type="number" min="0" max="9999" step="0.05"></label>
              <label class="hhm-field"><span>Minimum stand distance</span><input id="hhm-ai-minStandDist" type="number" min="0" max="9999" step="0.05"></label>
              <label class="hhm-field"><span>Maximum step height</span><input id="hhm-ai-maxStepHeight" type="number" min="0" max="9999" step="0.05"></label>
            </div>
            <div class="hhm-row" style="margin-top:9px"><button class="hhm-btn" id="hhm-apply-ai" type="button">Apply AI controls</button><button class="hhm-btn secondary" id="hhm-resume-ai" type="button">Resume all AI</button></div>
          </div>
          <div class="hhm-section"><h3>Needs / levels</h3><div id="hhm-levels"><div class="hhm-muted">Select a hamster to show any editable needs exposed by the game.</div></div></div>
          <div class="hhm-section">
            <h3>Clothing slot</h3>
            <label class="hhm-field"><span>Target wearable</span><select id="hhm-clothing-slot" class="hhm-select"><option value="shirt">Shirt</option><option value="onesie">Onesie</option><option value="hat">Hat</option><option value="bow">Bow</option></select></label>
          </div>
        </section>

        <section class="hhm-page" data-page="camera">
          <div class="hhm-section">
            <h3>Freecam</h3>
            <label class="hhm-check"><input id="hhm-freecam" type="checkbox"> Enable freecam</label>
            <label class="hhm-field"><span>Move speed</span><input id="hhm-cam-speed" type="range" class="hhm-slider" min="0.2" max="30" step="0.2" value="5"></label>
            <label class="hhm-field"><span>Field of view · <output id="hhm-fov-value">75°</output></span><input id="hhm-fov" type="range" class="hhm-slider" min="-120" max="120" step="1" value="75"></label>
            <div class="hhm-muted">W/A/S/D or arrow keys: move · Q/E: down/up · Shift: 3× speed · Esc: release mouse lock.</div>
            <div class="hhm-row" style="margin-top:8px"><button class="hhm-btn" id="hhm-lock-mouse" type="button">Lock mouse for look</button><button class="hhm-btn secondary" id="hhm-reset-camera" type="button">Restore camera</button></div>
          </div>
          <div class="hhm-section">
            <h3>Hamster perspective</h3>
            <label class="hhm-field"><span>Follow hamster</span><select id="hhm-perspective-hamster" class="hhm-select"></select></label>
            <label class="hhm-check"><input id="hhm-perspective" type="checkbox"> View from selected hamster</label>
            <label class="hhm-check"><input id="hhm-first-person" type="checkbox"> First-person / eye-level view</label>
            <div class="hhm-note">First-person mode places the camera at the hamster's approximate eye height and follows its heading. Exact skeletal eye tracking depends on the model rig.</div>
          </div>
        </section>

        <section class="hhm-page" data-page="world">
          <div class="hhm-section">
            <h3>Simulation</h3>
            <label class="hhm-check"><input id="hhm-paused" type="checkbox"> Pause simulation</label>
            <label class="hhm-field"><span>Time scale <output id="hhm-timescale-value">1×</output></span><input id="hhm-time-scale" type="range" class="hhm-slider" min="-4" max="4" step="0.1" value="1"></label>
            <div class="hhm-row" style="margin-top:8px"><button class="hhm-btn secondary" data-timescale="0.25">¼×</button><button class="hhm-btn secondary" data-timescale="1">1×</button><button class="hhm-btn secondary" data-timescale="2">2×</button><button class="hhm-btn secondary" data-timescale="4">4×</button></div>
          </div>
          <div class="hhm-section">
            <h3>Remove limits</h3>
            <label class="hhm-check"><input id="hhm-limits" type="checkbox"> Remove camera/item bounds and disable stray-part cleanup</label>
            <label class="hhm-check"><input id="hhm-placement-validation" type="checkbox"> Disable discovered placement validation</label>
            <div class="hhm-note">Attempts to bypass app-level placement validators as well as exposed bounds. Rules hard-coded into UI event handlers may still apply.</div>
          </div>
          <div class="hhm-section">
            <h3>Global collision switches</h3>
            <label class="hhm-check"><input id="hhm-global-collision" type="checkbox" checked> Global collision/picking enabled where supported</label>
            <div class="hhm-muted">Collision flags differ between ordinary Babylon meshes, placed items and OIMO bodies. The menu toggles exposed flags; not every internal constraint can be bypassed uniformly.</div>
          </div>
          <div class="hhm-section">
            <h3>Background colour & pattern</h3>
            <div class="hhm-grid2">
              <label class="hhm-field"><span>Colour</span><input id="hhm-bg-color" type="color" value="#ebebeb"></label>
              <label class="hhm-field"><span>Pattern</span><select id="hhm-bg-pattern" class="hhm-select"><option value="none">None</option><option value="squares">Squares</option><option value="circles">Circles</option><option value="chevron">Chevron</option><option value="flannel">Flannel</option></select></label>
            </div>
            <div class="hhm-row" style="margin-top:8px"><button id="hhm-apply-bg" class="hhm-btn" type="button">Apply colour</button><button id="hhm-apply-pattern" class="hhm-btn secondary" type="button">Apply pattern</button></div>
          </div>
        </section>

        <section class="hhm-page" data-page="assets">
          <div class="hhm-section">
            <h3>Custom PNG</h3>
            <label class="hhm-field"><span>Choose PNG image</span><input id="hhm-png" class="hhm-file" type="file" accept="image/png"></label>
            <div id="hhm-png-label" class="hhm-muted" style="margin:6px 0">No image selected.</div>
            <div class="hhm-grid2">
              <button class="hhm-btn" id="hhm-apply-clothing" type="button">Apply to hamster clothing</button>
              <button class="hhm-btn" id="hhm-apply-bg-image" type="button">Use as background</button>
              <button class="hhm-btn secondary" id="hhm-apply-item-image" type="button">Apply to selected mesh</button>
              <button class="hhm-btn secondary" id="hhm-restore-clothing" type="button">Restore clothing</button>
              <button class="hhm-btn secondary" id="hhm-restore-bg" type="button">Restore background</button>
              <button class="hhm-btn secondary" id="hhm-restore-item" type="button">Restore mesh material</button>
            </div>
            <div class="hhm-note"><strong>Background upload disclaimer:</strong> HammyHome's background handling flips uploaded images vertically. Your background PNG will appear vertically flipped; flip it before upload if you want the original orientation. Clothing PNGs should use the garment's UV layout to avoid stretching. Applying a PNG replaces that slot's material at runtime; restore buttons return its captured material. Image changes are local and are not automatically saved by HammyHome.</div>
          </div>
          <div class="hhm-section">
            <h3>Mod presets</h3>
            <div class="hhm-row"><button class="hhm-btn" id="hhm-export" type="button">Export preset JSON</button><label class="hhm-btn secondary" for="hhm-import-file" style="cursor:pointer">Import preset JSON</label><input id="hhm-import-file" type="file" accept=".json,application/json" style="display:none"></div>
            <div class="hhm-muted" style="margin-top:7px">Exports placed-item transforms, background colour, and simulation settings. Presets match objects by saved ID or name, so a different home may not match every item.</div>
            <div style="border-top:1px solid #eee0cf;margin-top:10px;padding-top:10px">
              <label class="hhm-field"><span>HammyHome share-link importer</span><textarea id="hhm-share-link" class="hhm-share-link" placeholder="Paste a link such as https://hammyhome.com/?hh=…"></textarea></label>
              <div class="hhm-row" style="margin-top:7px"><button class="hhm-btn" id="hhm-import-link" type="button">Load share link</button></div>
              <div class="hhm-muted" style="margin-top:6px">Loads the shared home in this local build. It reloads the game using the share payload; copy/export any current layout first if needed.</div>
            </div>
          </div>
          <div class="hhm-section">
            <h3>Quick utilities</h3>
            <div class="hhm-row"><button class="hhm-btn secondary" id="hhm-refresh-assets" type="button">Refresh object list</button><button class="hhm-btn secondary" id="hhm-show-all" type="button">Show all objects</button></div>
          </div>
        </section>
      </div>
      <div id="hhm-status" class="hhm-status" role="status">Mod menu initialized.</div>
    `;
    document.body.appendChild(panel);
    var toggle = document.createElement("button");
    toggle.id = "hhm-toggle"; toggle.type = "button"; toggle.textContent = "M";
    toggle.setAttribute("aria-controls", "hhm-panel"); toggle.setAttribute("aria-expanded", "false");
    document.body.appendChild(toggle);
    var consoleBox = document.createElement("div"); consoleBox.id = "hhm-console";
    consoleBox.style.cssText = "display:none;position:fixed;z-index:100005;left:2vw;right:2vw;bottom:2vh;max-height:45vh;overflow:auto;background:#111;color:#c9f7c9;border:1px solid #6b8;border-radius:8px;padding:10px;font:13px/1.4 monospace";
    consoleBox.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px"><strong>HammyHome Console</strong><button id="hhm-console-exit" type="button">Exit console</button></div><pre id="hhm-console-log" style="white-space:pre-wrap;max-height:24vh;overflow:auto"></pre><form id="hhm-console-form" style="display:flex;gap:6px"><span>&gt;</span><input id="hhm-console-input" autocomplete="off" style="flex:1;background:#222;color:#fff;border:1px solid #687;padding:6px" placeholder="Type help"><button type="submit">Run</button></form>';
    document.body.appendChild(consoleBox);
    $("hhm-console-form").addEventListener("submit", function(ev){ ev.preventDefault(); var input=$("hhm-console-input"), log=$("hhm-console-log"), line=input.value; if(!line.trim())return; var result; try{result=consoleCommand(line);}catch(err){result="ERROR: "+err.message;} log.textContent += "> "+line+"\\n"+String(result)+"\\n"; log.scrollTop=log.scrollHeight; input.value=""; });
    $("hhm-console-exit").addEventListener("click", function(){setConsoleMode(false);});
    toggle.addEventListener("click", function () {
      var open = !panel.classList.contains("hhm-open");
      panel.classList.toggle("hhm-open", open); toggle.setAttribute("aria-expanded", String(open));
      if (open) { buildTargets(); populateTransformFields(); populateHamAI(); }
    });
    $("hhm-close").addEventListener("click", function () {
      panel.classList.remove("hhm-open"); toggle.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".hhm-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.getAttribute("data-tab");
        document.querySelectorAll(".hhm-tab").forEach(function (x) { x.classList.toggle("active", x === b); });
        document.querySelectorAll(".hhm-page").forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-page") === state.tab); });
      });
    });
    $("hhm-target").addEventListener("change", pickTarget);
    $("hhm-refresh").addEventListener("click", function () { buildTargets(); populateTransformFields(); status("Object list refreshed."); });
    $("hhm-refresh-assets").addEventListener("click", function () { buildTargets(); populateTransformFields(); populateHamAI(); status("Object list refreshed."); });
    $("hhm-apply-transform").addEventListener("click", applyTransform);
    $("hhm-undo").addEventListener("click", undoTransform);
    $("hhm-unit-scale").addEventListener("click", function () { writeXYZ("hhm-scale", { x: 1, y: 1, z: 1 }); applyTransform(); });
    $("hhm-collision").addEventListener("change", function () { if (state.selected) setCollision(state.selected, this.checked); });
    $("hhm-visible").addEventListener("change", function () { if (state.selected) setVisible(state.selected, this.checked); });
    $("hhm-duplicate").addEventListener("click", duplicateSelectedMesh);
    $("hhm-instanced-duplicate").addEventListener("change", function(){ state.allowInstancedDuplicate=this.checked; status(this.checked?"Instanced duplication enabled using source-mesh instances.":"Instanced duplication disabled."); });
    $("hhm-placement-validation").addEventListener("change", function(){setPlacementValidationOff(this.checked);});
    $("hhm-ai-keepalive").addEventListener("change", function(){setAIKeepAlive(this.checked);});
    $("hhm-first-person").addEventListener("change", function(){ state.firstPerson=this.checked; if(this.checked){$("hhm-perspective").checked=true; togglePerspective(true);} else if(state.followHam){togglePerspective(true);} });
    $("hhm-hamster").addEventListener("change", populateHamAI);
    $("hhm-ai-paused").addEventListener("change", function () { setHamAI(selectedHamster(), this.checked); });
    $("hhm-environment-detection").addEventListener("change", function () { setEnvironmentDetection(selectedHamster(), this.checked); });
    $("hhm-apply-ai").addEventListener("click", applyHamAI);
    $("hhm-resume-ai").addEventListener("click", resumeAllAI);
    $("hhm-freecam").addEventListener("change", function () { setFreecam(this.checked); });
    $("hhm-lock-mouse").addEventListener("click", function () {
      var canvas = $("mainCanvas");
      if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
      else status("Pointer lock is not supported by this browser.", true);
    });
    $("hhm-reset-camera").addEventListener("click", function () { state.followHam = null; state.freecam = false; restoreFreecamBypass(); restoreCamera(); $("hhm-freecam").checked = false; $("hhm-first-person").checked = false; $("hhm-perspective").checked = false; status("Camera restored."); });
    $("hhm-perspective-hamster").addEventListener("change", function () { if ($("hhm-perspective").checked) togglePerspective(true); });
    $("hhm-perspective").addEventListener("change", function () { togglePerspective(this.checked); });
    $("hhm-cam-speed").addEventListener("input", function () { var c = camera(); if (c && state.freecam) c.speed = num(this.value, 5); });
    $("hhm-fov").addEventListener("input", function () { var deg = num(this.value, 75), c = camera(); setText("hhm-fov-value", deg + "°"); if (c) c.fov = deg * Math.PI / 180; });
    $("hhm-paused").addEventListener("change", function () { var a = app(); if (a) { a.paused = this.checked; status(this.checked ? "Simulation paused." : "Simulation resumed."); } });
    $("hhm-time-scale").addEventListener("input", function () {
      var a = app(), value = num(this.value, 1);
      setText("hhm-timescale-value", value.toFixed(1).replace(/\.0$/, "") + "×");
      if (a) a.timeScale = value;
    });
    document.querySelectorAll("[data-timescale]").forEach(function (b) {
      b.addEventListener("click", function () { var a = app(), value = num(b.getAttribute("data-timescale"), 1); if (a) a.timeScale = value; $("hhm-time-scale").value = String(value); setText("hhm-timescale-value", value + "×"); });
    });
    $("hhm-limits").addEventListener("change", function () { buildTargets(); setLimitsRemoved(this.checked); });
    $("hhm-global-collision").addEventListener("change", function () { applyGlobalCollision(this.checked); });
    $("hhm-bg-color").addEventListener("change", applyBackgroundColor);
    $("hhm-apply-bg").addEventListener("click", applyBackgroundColor);
    $("hhm-apply-pattern").addEventListener("click", applyPattern);
    $("hhm-png").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.type !== "image/png" && !/\.png$/i.test(file.name)) return status("Choose a PNG image.", true);
      if (file.size > 15 * 1024 * 1024) return status("PNG is larger than 15 MB; choose a smaller image.", true);
      var r = new FileReader();
      r.onload = function () {
        var im = new Image();
        im.onload = function () {
          state.uploadedDataUrl = String(r.result); state.uploadedName = file.name;
          setText("hhm-png-label", file.name + " · " + im.naturalWidth + "×" + im.naturalHeight);
          status("PNG loaded locally. Choose what to apply it to.");
        };
        im.onerror = function () { status("Could not read that PNG.", true); };
        im.src = String(r.result);
      };
      r.readAsDataURL(file);
    });
    $("hhm-apply-clothing").addEventListener("click", applyHamsterClothing);
    $("hhm-apply-bg-image").addEventListener("click", applyBackgroundImage);
    $("hhm-apply-item-image").addEventListener("click", applyItemTexture);
    $("hhm-restore-clothing").addEventListener("click", restoreHamsterClothing);
    $("hhm-restore-bg").addEventListener("click", restoreBackground);
    $("hhm-restore-item").addEventListener("click", restoreItemTexture);
    $("hhm-export").addEventListener("click", exportPreset);
    $("hhm-import-file").addEventListener("change", function () { importPreset(this.files && this.files[0]); this.value = ""; });
    $("hhm-import-link").addEventListener("click", function () { importShareLink($("hhm-share-link").value); });
    $("hhm-share-link").addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") importShareLink(this.value); });
    $("hhm-show-all").addEventListener("click", function () {
      state.targets.forEach(function (t) { setVisible(t, true); });
      status("Attempted to show all discovered scene objects.");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("hhm-open") && document.pointerLockElement !== $("mainCanvas")) {
        panel.classList.remove("hhm-open"); toggle.setAttribute("aria-expanded", "false");
      }
      if (state.freecam && !panelContainsControl(document.activeElement)) {
        var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        state.keys[k] = true;
        // Apply a small immediate step as well as per-frame motion. This makes single key taps
        // responsive even when a browser pauses animation frames, while held keys remain smooth.
        if (!e.repeat && /^(w|a|s|d|q|e|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(k)) {
          var c = camera(), B = window.BABYLON, step = num(($("hhm-cam-speed") || {}).value, 5) * 0.035;
          if (c && B) {
            var f = c.getDirection ? c.getDirection(new B.Vector3(0, 0, 1)) : new B.Vector3(0, 0, 1);
            var r = c.getDirection ? c.getDirection(new B.Vector3(1, 0, 0)) : new B.Vector3(1, 0, 0);
            if (k === "w" || k === "ArrowUp") c.position.addInPlace(f.scale(step));
            else if (k === "s" || k === "ArrowDown") c.position.subtractInPlace(f.scale(step));
            else if (k === "d" || k === "ArrowRight") c.position.addInPlace(r.scale(step));
            else if (k === "a" || k === "ArrowLeft") c.position.subtractInPlace(r.scale(step));
            else if (k === "e") c.position.y += step;
            else if (k === "q") c.position.y -= step;
          }
        }
        if (/^(w|a|s|d|q|e|ArrowUp|ArrowDown|ArrowLeft|ArrowRight| )$/.test(k)) e.preventDefault();
      }
      if (e.shiftKey && (e.key === "M" || e.key === "m")) {
        if (state.consoleMode) setConsoleMode(false); else { panel.classList.toggle("hhm-open"); toggle.setAttribute("aria-expanded", String(panel.classList.contains("hhm-open"))); }
      }
      if (e.shiftKey && (e.key === "C" || e.key === "c")) { e.preventDefault(); setConsoleMode(!state.consoleMode); if(state.consoleMode) setTimeout(function(){ $("hhm-console-input").focus(); },0); }
    });
    document.addEventListener("keyup", function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; state.keys[k] = false;
    });
    window.addEventListener("blur", function () { state.keys = Object.create(null); });
    document.addEventListener("pointerlockchange", function () {
      document.body.classList.toggle("hhm-pointer-locked", document.pointerLockElement === $("mainCanvas"));
    });
    // The game uses wheel input for camera zoom and may restore its cage bounds. Ignore it entirely in freecam.
    document.addEventListener("wheel", function (e) {
      if (!state.freecam) return;
      e.preventDefault(); e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, { capture: true, passive: false });
    document.addEventListener("mousemove", function (e) {
      var canvas = $("mainCanvas"), c = camera();
      if (!state.freecam || !c || document.pointerLockElement !== canvas) return;
      c.rotation.y += e.movementX * 0.0022;
      c.rotation.x = clamp(c.rotation.x + e.movementY * 0.0022, -Math.PI * 0.48, Math.PI * 0.48);
    });
    // Camera controls use a small timer because this app can temporarily suspend Babylon's
    // render observable while UI transitions occur. This also keeps follow mode responsive.
    state.attachFrame = function () {};
    buildTargets();
  }
  function connectApp() {
    var a = app();
    if (!a || !a.graphicsHelper || !a.graphicsHelper.scene) return false;
    if (state.app === a && state.scene === a.graphicsHelper.scene) return true;
    state.app = a; state.scene = a.graphicsHelper.scene;
    installTubeDetectionHooks();
    if (!state.originalBackgroundPattern && a.background) {
      var bg0 = a.background, colors0 = bg0._colors || {};
      state.originalBackgroundPattern = {
        patternName: bg0.patternName || "none", texture: bg0.texture || null,
        diffuseTexture: bg0.material ? bg0.material.diffuseTexture || null : null,
        selectedOption: bg0.selectedOption || null,
        hadPatternColor: Object.prototype.hasOwnProperty.call(colors0, "pattern"),
        patternColor: colors0.pattern,
        optionValues: Object.keys(bg0._options || {}).reduce(function (acc, k) { acc[k] = bg0._options[k].value; return acc; }, {})
      };
    }
    buildTargets();
    var bg = $("hhm-bg-color");
    if (bg && a.background && a.background.colorHex) bg.value = a.background.colorHex;
    if ($("hhm-paused")) $("hhm-paused").checked = !!a.paused;
    if ($("hhm-time-scale")) $("hhm-time-scale").value = String(a.timeScale || 1);
    if ($("hhm-timescale-value")) $("hhm-timescale-value").textContent = (a.timeScale || 1) + "×";
    if (state.attachFrame) state.attachFrame();
    status("Connected to HammyHome scene.");
    return true;
  }
  function panelContainsControl(el) {
    return !!(el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && $("hhm-panel") && $("hhm-panel").contains(el));
  }
  function installBrowserConsoleAPI() {
    // Expose callable helpers in DevTools' real JavaScript console.
    window.hhConsole = function (line) {
      try { var result = consoleCommand(line); console.log("[HammyHome Mod]", result); return result; }
      catch (e) { console.error("[HammyHome Mod]", e); return String(e); }
    };
    window.maximumStepHeight = function (value, hamsterNumber) { return window.hhConsole("maximumStepHeight " + value + " " + (hamsterNumber || 1)); };
    window.hammySpeed = function (value, hamsterNumber) { return window.hhConsole("speed " + value + " " + (hamsterNumber || 1)); };
    window.hammyWalkSpeed = function (value, hamsterNumber) { return window.hhConsole("walkSpeed " + value + " " + (hamsterNumber || 1)); };
    window.hammyCommand = window.hhConsole;
    window.hhHelp = function () { return window.hhConsole("help"); };
  }
  function start() {
    installBrowserConsoleAPI();
    createUI();
    connectApp();
    if (!state.cameraTimer) state.cameraTimer = window.setInterval(function () {
      if (state.cameraBoundsBypass) enforceCameraBoundsBypass();
      if (state.freecam || state.followHam) tickCamera();
    }, 16);
    window.setInterval(function () {
      // Enforce locked AI fields independently of camera mode; the original AI may rewrite
      // these values during its own update loop, so reapply them continuously.
      if (state.aiKeepAlive) getHamsters().forEach(function (ham) {
        var snap = state.aiSnapshots.get(ham);
        if (snap) Object.keys(snap).forEach(function (k) { if (typeof snap[k] === "number") ham[k] = snap[k]; });
      });
      if (!connectApp()) return;
      if (state.cameraBoundsBypass) enforceCameraBoundsBypass();
      if (state.attachFrame) state.attachFrame();
      var now = Date.now();
      if (now - state.lastListRefresh > 2200) {
        state.lastListRefresh = now;
        var open = $("hhm-panel") && $("hhm-panel").classList.contains("hhm-open");
        if (open) {
          buildTargets();
          var active = document.activeElement;
          var editing = active && panelContainsControl(active);
          if (!editing) populateHamAI();
        }
      }
    }, 750);
    window.addEventListener("beforeunload", function () {
      resumeAllAI();
      if (state.freecam) { state.freecam = false; restoreFreecamBypass(); restoreCamera(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
