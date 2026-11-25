// Adds to ios/App/App.xcodeproj:
//   - the "NorthcroftWidget" target (the home screen and lock screen widget), embedded in the app
//   - NorthcroftIntents.swift (Siri and Shortcuts) to the App target
//   - the Live Activities (workday, tasks, site trips) and Control Center buttons, in the widget
//   - the "NorthcroftWatch" Apple Watch app and the "NorthcroftNotify" notification extension
//   - the NC_APP_GROUP build setting on every target, which names the shared app group in the
//     entitlements and Info.plist files (so a test build can use its own group)
// Already done and committed; kept to redo it if the iOS project is ever made again with
// `npx cap add ios` (run add-share-extension.cjs first). Run from the repository root:
//   npx -y -p xcode@3.0.1 node scripts/ios/add-widget-and-intents.cjs
const path = require("path");
const xcode = require("xcode");

const PBX = path.join("ios", "App", "App.xcodeproj", "project.pbxproj");
const APP_ID = "com.northcroftme.qsteam";
const APP_GROUP = "group.com.northcroftme.qsteam";
const EXT = "NorthcroftWidget";
const INTENTS = "NorthcroftIntents.swift";

const proj = xcode.project(PBX);
proj.parseSync();
const objects = proj.hash.project.objects;
const q = (s) => `"${s}"`;
const unq = (s) => String(s ?? "").replace(/"/g, "");

const targets = () => Object.entries(objects.PBXNativeTarget).filter(([k, v]) => !k.endsWith("_comment") && typeof v === "object");
const targetNamed = (name) => targets().find(([, t]) => unq(t.name) === name);

function fileRef(name, type) {
  const id = proj.generateUuid();
  objects.PBXFileReference[id] = { isa: "PBXFileReference", lastKnownFileType: type, path: q(name), sourceTree: q("<group>") };
  objects.PBXFileReference[`${id}_comment`] = name;
  return id;
}

function configsOf(target) {
  const list = objects.XCConfigurationList[target.buildConfigurationList];
  return list.buildConfigurations.map((c) => objects.XCBuildConfiguration[c.value]);
}

function addToSources(target, ref, name) {
  const phase = target.buildPhases.find((p) => p.comment === "Sources");
  const buildFile = proj.generateUuid();
  objects.PBXBuildFile[buildFile] = { isa: "PBXBuildFile", fileRef: ref, fileRef_comment: name };
  objects.PBXBuildFile[`${buildFile}_comment`] = `${name} in Sources`;
  objects.PBXSourcesBuildPhase[phase.value].files.push({ value: buildFile, comment: `${name} in Sources` });
}

const appEntry = targetNamed("App");
if (!appEntry) throw new Error("No App target");
const app = appEntry[1];

// --- NC_APP_GROUP on the App and ShareExtension targets --------------------------------------------
for (const name of ["App", "ShareExtension"]) {
  const t = targetNamed(name);
  if (!t) continue;
  for (const c of configsOf(t[1])) c.buildSettings.NC_APP_GROUP = APP_GROUP;
}

// --- Siri and Shortcuts: NorthcroftIntents.swift in the App target ---------------------------------
const hasIntents = Object.entries(objects.PBXFileReference).some(([k, v]) => !k.endsWith("_comment") && unq(v.path) === INTENTS);
if (!hasIntents) {
  const appGroupId = Object.keys(objects.PBXGroup).find((k) => !k.endsWith("_comment") && objects.PBXGroup[k].path === "App");
  const ref = fileRef(INTENTS, "sourcecode.swift");
  objects.PBXGroup[appGroupId].children.push({ value: ref, comment: INTENTS });
  addToSources(app, ref, INTENTS);
}

// --- The widget target --------------------------------------------------------------------------------
if (targetNamed(EXT)) {
  console.log(`${EXT} is already in the project.`);
} else {
  const target = proj.addTarget(EXT, "app_extension", EXT, `${APP_ID}.widget`);

  const swiftRef = fileRef(`${EXT}.swift`, "sourcecode.swift");
  const plistRef = fileRef("Info.plist", "text.plist.xml");
  const entRef = fileRef(`${EXT}.entitlements`, "text.plist.entitlements");
  const groupId = proj.generateUuid();
  objects.PBXGroup[groupId] = {
    isa: "PBXGroup",
    children: [
      { value: swiftRef, comment: `${EXT}.swift` },
      { value: plistRef, comment: "Info.plist" },
      { value: entRef, comment: `${EXT}.entitlements` },
    ],
    path: EXT,
    sourceTree: q("<group>"),
  };
  objects.PBXGroup[`${groupId}_comment`] = EXT;
  const mainGroup = objects.PBXGroup[proj.getFirstProject().firstProject.mainGroup];
  mainGroup.children.splice(mainGroup.children.length - 1, 0, { value: groupId, comment: EXT });

  proj.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
  proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  addToSources(target.pbxNativeTarget, swiftRef, `${EXT}.swift`);

  // Build settings, matching the App target where it matters (versions must match for the App Store).
  // Widgets need iOS 17 here (containerBackground); on older iPhones the app works without it.
  const appRelease = configsOf(app).find((c) => c.name === "Release").buildSettings;
  for (const c of configsOf(target.pbxNativeTarget)) {
    const debug = c.name === "Debug";
    c.buildSettings = {
      CODE_SIGN_ENTITLEMENTS: `${EXT}/${EXT}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: appRelease.CURRENT_PROJECT_VERSION ?? 1,
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${EXT}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: "17.0",
      LD_RUNPATH_SEARCH_PATHS: q("$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"),
      MARKETING_VERSION: appRelease.MARKETING_VERSION ?? "1.0",
      NC_APP_GROUP: APP_GROUP,
      PRODUCT_BUNDLE_IDENTIFIER: `${APP_ID}.widget`,
      PRODUCT_NAME: q("$(TARGET_NAME)"),
      SKIP_INSTALL: "YES",
      SWIFT_EMIT_LOC_STRINGS: "YES",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: q("1,2"),
      ...(debug ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG", SWIFT_OPTIMIZATION_LEVEL: q("-Onone") } : { SWIFT_COMPILATION_MODE: "wholemodule", VALIDATE_PRODUCT: "YES" }),
    };
  }

  // The library leaves two "undefined" values on the .appex file reference; Xcode can't read those.
  const productRef = objects.PBXFileReference[target.pbxNativeTarget.productReference];
  delete productRef.fileEncoding;
  delete productRef.lastKnownFileType;

  // Build the widget before the app that embeds it (the library usually adds this already).
  const deps = app.dependencies ?? [];
  const already = deps.some((d) => objects.PBXTargetDependency?.[d.value]?.target === target.uuid);
  if (!already) proj.addTargetDependency(appEntry[0], [target.uuid]);

  // The library made a second "Copy Files" phase for the widget: move it into the existing
  // "Embed Foundation Extensions" step, next to the share extension, and drop the extra phase.
  const copyPhases = app.buildPhases
    .map((ph) => [ph, objects.PBXCopyFilesBuildPhase[ph.value]])
    .filter(([, v]) => v && String(v.dstSubfolderSpec) === "13");
  const embed = copyPhases.find(([ph]) => ph.comment === "Embed Foundation Extensions") ?? copyPhases[0];
  for (const [ph, v] of copyPhases) {
    if (ph === embed[0]) continue;
    for (const f of v.files) {
      const bf = objects.PBXBuildFile[f.value];
      if (bf) bf.settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
      f.comment = `${EXT}.appex in Embed Foundation Extensions`;
      objects.PBXBuildFile[`${f.value}_comment`] = f.comment;
      embed[1].files.push(f);
    }
    delete objects.PBXCopyFilesBuildPhase[ph.value];
    delete objects.PBXCopyFilesBuildPhase[`${ph.value}_comment`];
    app.buildPhases.splice(app.buildPhases.indexOf(ph), 1);
  }
}

// --- Live Activity, Control Center buttons and the shared Siri actions ------------------------------
// Shared/NorthcroftActionIntents.swift is built into both the App and the widget (the Control Center
// buttons run those actions); WorkdayLiveActivity.swift and NorthcroftControls.swift into the widget.
{
  const widget = targetNamed(EXT)[1];
  const hasFile = (name) => Object.entries(objects.PBXFileReference).find(([k, v]) => !k.endsWith("_comment") && unq(v.path) === name);
  const inSources = (target, ref) =>
    objects.PBXSourcesBuildPhase[target.buildPhases.find((p) => p.comment === "Sources").value].files.some(
      (f) => objects.PBXBuildFile[f.value]?.fileRef === ref,
    );

  // The "Shared" group with the actions file.
  let sharedGroupId = Object.keys(objects.PBXGroup).find((k) => !k.endsWith("_comment") && unq(objects.PBXGroup[k].path) === "Shared");
  if (!sharedGroupId) {
    sharedGroupId = proj.generateUuid();
    objects.PBXGroup[sharedGroupId] = { isa: "PBXGroup", children: [], path: "Shared", sourceTree: q("<group>") };
    objects.PBXGroup[`${sharedGroupId}_comment`] = "Shared";
    const mainGroup = objects.PBXGroup[proj.getFirstProject().firstProject.mainGroup];
    mainGroup.children.splice(mainGroup.children.length - 1, 0, { value: sharedGroupId, comment: "Shared" });
  }
  const ACTIONS = "NorthcroftActionIntents.swift";
  let actionsRef = hasFile(ACTIONS)?.[0];
  if (!actionsRef) {
    actionsRef = fileRef(ACTIONS, "sourcecode.swift");
    objects.PBXGroup[sharedGroupId].children.push({ value: actionsRef, comment: ACTIONS });
  }
  for (const t of [app, widget]) if (!inSources(t, actionsRef)) addToSources(t, actionsRef, ACTIONS);

  // The widget's own new files.
  const widgetGroupId = Object.keys(objects.PBXGroup).find((k) => !k.endsWith("_comment") && unq(objects.PBXGroup[k].path) === EXT);
  for (const name of ["WorkdayLiveActivity.swift", "NorthcroftControls.swift", "LiveActivityParts.swift", "TaskLiveActivity.swift", "TripLiveActivity.swift"]) {
    let ref = hasFile(name)?.[0];
    if (!ref) {
      ref = fileRef(name, "sourcecode.swift");
      objects.PBXGroup[widgetGroupId].children.push({ value: ref, comment: name });
    }
    if (!inSources(widget, ref)) addToSources(widget, ref, name);
  }
}

// --- The Apple Watch app ------------------------------------------------------------------------------
// "NorthcroftWatch": a SwiftUI watch app (watchOS 10 and later) embedded in the iPhone app under
// Watch/, built before it. Its iPhone app is named by NC_COMPANION_ID (so a test build can differ).
{
  const WATCH = "NorthcroftWatch";
  if (!targetNamed(WATCH)) {
    const target = proj.addTarget(WATCH, "application", WATCH, `${APP_ID}.watchkitapp`);
    const swiftRef = fileRef("NorthcroftWatchApp.swift", "sourcecode.swift");
    const plistRef = fileRef("Info.plist", "text.plist.xml");
    const assetsRef = fileRef("Assets.xcassets", "folder.assetcatalog");
    const groupId = proj.generateUuid();
    objects.PBXGroup[groupId] = {
      isa: "PBXGroup",
      children: [
        { value: swiftRef, comment: "NorthcroftWatchApp.swift" },
        { value: assetsRef, comment: "Assets.xcassets" },
        { value: plistRef, comment: "Info.plist" },
      ],
      path: WATCH,
      sourceTree: q("<group>"),
    };
    objects.PBXGroup[`${groupId}_comment`] = WATCH;
    const mainGroup = objects.PBXGroup[proj.getFirstProject().firstProject.mainGroup];
    mainGroup.children.splice(mainGroup.children.length - 1, 0, { value: groupId, comment: WATCH });

    proj.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    addToSources(target.pbxNativeTarget, swiftRef, "NorthcroftWatchApp.swift");
    const resId = target.pbxNativeTarget.buildPhases.find((p) => p.comment === "Resources").value;
    const resFile = proj.generateUuid();
    objects.PBXBuildFile[resFile] = { isa: "PBXBuildFile", fileRef: assetsRef, fileRef_comment: "Assets.xcassets" };
    objects.PBXBuildFile[`${resFile}_comment`] = "Assets.xcassets in Resources";
    objects.PBXResourcesBuildPhase[resId].files.push({ value: resFile, comment: "Assets.xcassets in Resources" });

    const appRelease = configsOf(app).find((c) => c.name === "Release").buildSettings;
    for (const c of configsOf(target.pbxNativeTarget)) {
      const debug = c.name === "Debug";
      c.buildSettings = {
        ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: appRelease.CURRENT_PROJECT_VERSION ?? 1,
        GENERATE_INFOPLIST_FILE: "YES",
        INFOPLIST_FILE: `${WATCH}/Info.plist`,
        INFOPLIST_KEY_CFBundleDisplayName: "Northcroft",
        INFOPLIST_KEY_UISupportedInterfaceOrientations: q("UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown"),
        LD_RUNPATH_SEARCH_PATHS: q("$(inherited) @executable_path/Frameworks"),
        MARKETING_VERSION: appRelease.MARKETING_VERSION ?? "1.0",
        NC_COMPANION_ID: APP_ID,
        PRODUCT_BUNDLE_IDENTIFIER: `${APP_ID}.watchkitapp`,
        PRODUCT_NAME: q("$(TARGET_NAME)"),
        SDKROOT: "watchos",
        SKIP_INSTALL: "YES",
        SWIFT_EMIT_LOC_STRINGS: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: "4",
        WATCHOS_DEPLOYMENT_TARGET: "10.0",
        ...(debug ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG", SWIFT_OPTIMIZATION_LEVEL: q("-Onone") } : { SWIFT_COMPILATION_MODE: "wholemodule", VALIDATE_PRODUCT: "YES" }),
      };
    }

    const productRef = objects.PBXFileReference[target.pbxNativeTarget.productReference];
    delete productRef.fileEncoding;
    delete productRef.lastKnownFileType;
    productRef.explicitFileType = "wrapper.application";
    // The library leaves a stray "in Copy Files" entry for the product that no step uses.
    for (const [k, v] of Object.entries(objects.PBXBuildFile)) {
      if (k.endsWith("_comment") || typeof v !== "object") continue;
      if (v.fileRef === target.pbxNativeTarget.productReference && objects.PBXBuildFile[`${k}_comment`] === `${WATCH}.app in Copy Files`) {
        delete objects.PBXBuildFile[k];
        delete objects.PBXBuildFile[`${k}_comment`];
      }
    }

    // Embed it in the iPhone app (Watch/) and build it first.
    const embedId = proj.generateUuid();
    const embedFile = proj.generateUuid();
    objects.PBXBuildFile[embedFile] = {
      isa: "PBXBuildFile",
      fileRef: target.pbxNativeTarget.productReference,
      fileRef_comment: `${WATCH}.app`,
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    };
    objects.PBXBuildFile[`${embedFile}_comment`] = `${WATCH}.app in Embed Watch Content`;
    objects.PBXCopyFilesBuildPhase[embedId] = {
      isa: "PBXCopyFilesBuildPhase",
      buildActionMask: 2147483647,
      dstPath: q("$(CONTENTS_FOLDER_PATH)/Watch"),
      dstSubfolderSpec: 16,
      files: [{ value: embedFile, comment: `${WATCH}.app in Embed Watch Content` }],
      name: q("Embed Watch Content"),
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects.PBXCopyFilesBuildPhase[`${embedId}_comment`] = "Embed Watch Content";
    app.buildPhases.push({ value: embedId, comment: "Embed Watch Content" });
    const deps = app.dependencies ?? [];
    if (!deps.some((d) => objects.PBXTargetDependency?.[d.value]?.target === target.uuid)) proj.addTargetDependency(appEntry[0], [target.uuid]);
  }
}


// --- Notifications with the sender's face ---------------------------------------------------------------
// "NorthcroftNotify": a notification service extension that turns each notification with a person
// behind it into a communication notification (their photo or initials), embedded next to the
// share extension and the widget.
{
  const NOTIFY = "NorthcroftNotify";
  if (!targetNamed(NOTIFY)) {
    const target = proj.addTarget(NOTIFY, "app_extension", NOTIFY, `${APP_ID}.notify`);
    const swiftRef = fileRef("NotificationService.swift", "sourcecode.swift");
    const plistRef = fileRef("Info.plist", "text.plist.xml");
    const groupId = proj.generateUuid();
    objects.PBXGroup[groupId] = {
      isa: "PBXGroup",
      children: [
        { value: swiftRef, comment: "NotificationService.swift" },
        { value: plistRef, comment: "Info.plist" },
      ],
      path: NOTIFY,
      sourceTree: q("<group>"),
    };
    objects.PBXGroup[`${groupId}_comment`] = NOTIFY;
    const mainGroup = objects.PBXGroup[proj.getFirstProject().firstProject.mainGroup];
    mainGroup.children.splice(mainGroup.children.length - 1, 0, { value: groupId, comment: NOTIFY });

    proj.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    addToSources(target.pbxNativeTarget, swiftRef, "NotificationService.swift");

    const appRelease = configsOf(app).find((c) => c.name === "Release").buildSettings;
    for (const c of configsOf(target.pbxNativeTarget)) {
      const debug = c.name === "Debug";
      c.buildSettings = {
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: appRelease.CURRENT_PROJECT_VERSION ?? 1,
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${NOTIFY}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: "15.0",
        LD_RUNPATH_SEARCH_PATHS: q("$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"),
        MARKETING_VERSION: appRelease.MARKETING_VERSION ?? "1.0",
        PRODUCT_BUNDLE_IDENTIFIER: `${APP_ID}.notify`,
        PRODUCT_NAME: q("$(TARGET_NAME)"),
        SKIP_INSTALL: "YES",
        SWIFT_EMIT_LOC_STRINGS: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: q("1,2"),
        ...(debug ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG", SWIFT_OPTIMIZATION_LEVEL: q("-Onone") } : { SWIFT_COMPILATION_MODE: "wholemodule", VALIDATE_PRODUCT: "YES" }),
      };
    }

    const productRef = objects.PBXFileReference[target.pbxNativeTarget.productReference];
    delete productRef.fileEncoding;
    delete productRef.lastKnownFileType;

    const deps = app.dependencies ?? [];
    if (!deps.some((d) => objects.PBXTargetDependency?.[d.value]?.target === target.uuid)) proj.addTargetDependency(appEntry[0], [target.uuid]);

    // Into "Embed Foundation Extensions" with the others (the library adds a second Copy Files step).
    const copyPhases = app.buildPhases
      .map((ph) => [ph, objects.PBXCopyFilesBuildPhase[ph.value]])
      .filter(([, v]) => v && String(v.dstSubfolderSpec) === "13");
    const embed = copyPhases.find(([ph]) => ph.comment === "Embed Foundation Extensions") ?? copyPhases[0];
    for (const [ph, v] of copyPhases) {
      if (ph === embed[0]) continue;
      for (const f of v.files) {
        const bf = objects.PBXBuildFile[f.value];
        if (bf) bf.settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
        f.comment = `${NOTIFY}.appex in Embed Foundation Extensions`;
        objects.PBXBuildFile[`${f.value}_comment`] = f.comment;
        embed[1].files.push(f);
      }
      delete objects.PBXCopyFilesBuildPhase[ph.value];
      delete objects.PBXCopyFilesBuildPhase[`${ph.value}_comment`];
      app.buildPhases.splice(app.buildPhases.indexOf(ph), 1);
    }
  }
}

// Keep Xcode's own spelling of these (the library drops the leading zero).
const attrs = proj.getFirstProject().firstProject.attributes;
attrs.LastSwiftUpdateCheck = "0920";
attrs.LastUpgradeCheck = "0920";

require("fs").writeFileSync(PBX, proj.writeSync());
console.log("Added the widget, Siri shortcuts and NC_APP_GROUP.");
