function createUnityInstance(canvas, config, onProgress) {
  onProgress = onProgress || function () {};

  function showBanner(msg, type) {
    if (!showBanner.aborted && config.showBanner) {
      if (type === "error") showBanner.aborted = true;
      return config.showBanner(msg, type);
    }
    switch (type) {
      case "error":   console.error(msg); break;
      case "warning": console.warn(msg);   break;
      default:        console.log(msg);
    }
  }

  function errorHandler(e) {
    const reason = e.reason || e.error;
    let msg = reason ? reason.toString() : (e.message || e.reason || "");
    let stack = reason && reason.stack ? reason.stack.toString() : "";
    msg += "\n" + (stack = stack.startsWith(msg) ? stack.substring(msg.length) : stack).trim();
    if (Module.stackTraceRegExp && Module.stackTraceRegExp.test(msg)) {
      logError(msg, e.filename || (reason && (reason.fileName || reason.sourceURL)) || "", e.lineno || (reason && (reason.lineNumber || reason.line)) || 0);
    }
  }

  function ensureConfigOption(obj, key, fallback) {
    if (obj[key] === undefined || obj[key] === null) {
      console.warn(`Config option "${key}" is missing or empty. Falling back to default value: "${fallback}". Consider updating your WebGL template to include the missing config option.`);
      obj[key] = fallback;
    }
  }

  const Module = {
    canvas: canvas,
    webglContextAttributes: { preserveDrawingBuffer: false, powerPreference: 2 },
    cacheControl: url => url === Module.dataUrl ? "must-revalidate" : "no-store",
    streamingAssetsUrl: "StreamingAssets",
    downloadProgress: {},
    deinitializers: [],
    intervals: {},
    setInterval: (cb, ms) => {
      const id = window.setInterval(cb, ms);
      Module.intervals[id] = true;
      return id;
    },
    clearInterval: id => {
      delete Module.intervals[id];
      window.clearInterval(id);
    },
    preRun: [],
    postRun: [],
    print: console.log,
    printErr: msg => {
      console.error(msg);
      if (typeof msg === "string" && msg.indexOf("wasm streaming compile failed") !== -1) {
        if (msg.toLowerCase().indexOf("mime") !== -1) {
          showBanner(`HTTP Response Header "Content-Type" configured incorrectly on the server for file ${Module.codeUrl}, should be "application/wasm". Startup time performance will suffer.`, "warning");
        } else {
          showBanner(`WebAssembly streaming compilation failed! This can happen for example if "Content-Encoding" HTTP header is incorrectly enabled on the server for file ${Module.codeUrl}, but the file is not pre-compressed on disk (or vice versa). Check the Network tab in browser Devtools to debug server header configuration.`, "warning");
        }
      }
    },
    locateFile: url => url,
    disabledCanvasEvents: ["contextmenu", "dragstart"]
  };

  ensureConfigOption(config, "companyName", "Unity");
  ensureConfigOption(config, "productName", "WebGL Player");
  ensureConfigOption(config, "productVersion", "1.0");

  for (const key in config) Module[key] = config[key];

  Module.streamingAssetsUrl = new URL(Module.streamingAssetsUrl, document.URL).href;

  const disabledEvents = Module.disabledCanvasEvents.slice();

  function preventDefault(e) { e.preventDefault(); }
  disabledEvents.forEach(ev => canvas.addEventListener(ev, preventDefault));

  window.addEventListener("error", errorHandler);
  window.addEventListener("unhandledrejection", errorHandler);

  Module.deinitializers.push(() => {
    Module.disableAccessToMediaDevices?.();
    disabledEvents.forEach(ev => canvas.removeEventListener(ev, preventDefault));
    window.removeEventListener("error", errorHandler);
    window.removeEventListener("unhandledrejection", errorHandler);
    for (const id in Module.intervals) window.clearInterval(id);
    Module.intervals = {};
  });

  Module.QuitCleanup = () => {
    Module.deinitializers.forEach(fn => fn());
    Module.deinitializers = [];
    if (typeof Module.onQuit === "function") Module.onQuit();
  };

  let savedWidth = "", savedHeight = "";
  document.addEventListener("webkitfullscreenchange", () => {
    if (document.webkitCurrentFullScreenElement === canvas) {
      if (canvas.style.width) {
        savedWidth = canvas.style.width;
        savedHeight = canvas.style.height;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
      }
    } else if (savedWidth) {
      canvas.style.width = savedWidth;
      canvas.style.height = savedHeight;
      savedHeight = savedWidth = "";
    }
  });

  const unityInterface = {
    Module: Module,
    SetFullscreen: () => { if (Module.SetFullscreen) Module.SetFullscreen.apply(Module, arguments); else Module.print("Failed to set Fullscreen mode: Player not loaded yet."); },
    SendMessage: () => { if (Module.SendMessage) Module.SendMessage.apply(Module, arguments); else Module.print("Failed to execute SendMessage: Player not loaded yet."); },
    Quit: () => new Promise((resolve, reject) => { Module.shouldQuit = true; Module.onQuit = resolve; })
  };

  function logError(msg, filename, lineno) {
    if (msg.indexOf("fullscreen error") !== -1) return;
    if (Module.startupErrorHandler) Module.startupErrorHandler(msg, filename, lineno);
    else if (Module.errorHandler) Module.errorHandler(msg, filename, lineno);
    else {
      console.log("Invoking error handler due to\n" + msg);
      if (typeof dump === "function") dump("Invoking error handler due to\n" + msg);
      if (!logError.didShowErrorMessage) {
        let displayMsg = "An error occurred running the Unity content on this page. See your browser JavaScript console for more info. The error was:\n" + msg;
        if (displayMsg.indexOf("DISABLE_EXCEPTION_CATCHING") !== -1) {
          displayMsg = "An exception has occurred, but exception handling has been disabled in this build. If you are the developer of this content, enable exceptions in your project WebGL player settings to be able to catch the exception or see the stack trace.";
        } else if (displayMsg.indexOf("Cannot enlarge memory arrays") !== -1) {
          displayMsg = "Out of memory. If you are the developer of this content, try allocating more memory to your WebGL build in the WebGL player settings.";
        } else if (!displayMsg.includes("Invalid array buffer length") && !displayMsg.includes("Invalid typed array length") && !displayMsg.includes("out of memory") && !displayMsg.includes("could not allocate memory")) {
          displayMsg = "The browser could not allocate enough memory for the WebGL content. If you are the developer of this content, try allocating less memory to your WebGL build in the WebGL player settings.";
        }
        alert(displayMsg);
        logError.didShowErrorMessage = true;
      }
    }
  }

  // ... (the rest of the code continues with download progress, UnityCache, cachedFetch, pako inflate integration, fetchWithProgress, dataUrl handling, etc.)

  // Final promise that initializes everything
  return new Promise((resolve, reject) => {
    if (!Module.SystemInfo.hasWebGL) return reject("Your browser does not support WebGL.");
    if (!Module.SystemInfo.hasWasm) return reject("Your browser does not support WebAssembly.");

    if (Module.SystemInfo.hasWebGL === 1) Module.print('Warning: Your browser does not support "WebGL 2" Graphics API, switching to "WebGL 1"');

    Module.startupErrorHandler = reject;
    onProgress(0);

    Module.postRun.push(() => {
      onProgress(1);
      delete Module.startupErrorHandler;
      resolve(unityInterface);
    });

    // Start loading framework + code + data
    loadAllAssets();
  });
}
