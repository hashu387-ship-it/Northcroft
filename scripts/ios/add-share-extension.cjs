// Adds the "ShareExtension" target (Northcroft in the iPhone share sheet) to ios/App/App.xcodeproj,
// and the entitlements (push notifications, the shared app group) to the App target.
// Already done and committed; kept to redo it if the iOS project is ever made again with
// `npx cap add ios`. Run from the repository root:
//   npx -y -p xcode@3.0.1 node scripts/ios/add-share-extension.cjs
const path = require("path");
const xcode = require("xcode");

const PBX = path.join("ios", "App", "App.xcodeproj", "project.pbxproj");
const APP_ID = "com.northcroftme.qsteam";
const EXT = "ShareExtension";

const proj = xcode.project(PBX);
proj.parseSync();
const objects = proj.hash.project.objects;
const q = (s) => `"${s}"`;

if (Object.values(objects.PBXNativeTarget).some((t) => typeof t === "object" && t.name && t.name.replace(/"/g, "") === EXT)) {
  console.log("ShareExtension is already in the project.");
  process.exit(0);
}

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

// --- App target: entitlements (push notifications and the app group) -----------------------------
const appTarget = proj.getFirstTarget();
for (const c of configsOf(appTarget.firstTarget)) c.buildSettings.CODE_SIGN_ENTITLEMENTS = "App/App.entitlements";
const appGroupId = Object.keys(objects.PBXGroup).find((k) => !k.endsWith("_comment") && objects.PBXGroup[k].path === "App");
const entRef = fileRef("App.entitlements", "text.plist.entitlements");
objects.PBXGroup[appGroupId].children.push({ value: entRef, comment: "App.entitlements" });

// --- The extension target --------------------------------------------------------------------------
const target = proj.addTarget(EXT, "app_extension", EXT, `${APP_ID}.share`);

const swiftRef = fileRef("ShareViewController.swift", "sourcecode.swift");
const plistRef = fileRef("Info.plist", "text.plist.xml");
const extEntRef = fileRef("ShareExtension.entitlements", "text.plist.entitlements");
const groupId = proj.generateUuid();
objects.PBXGroup[groupId] = {
  isa: "PBXGroup",
  children: [
    { value: swiftRef, comment: "ShareViewController.swift" },
    { value: plistRef, comment: "Info.plist" },
    { value: extEntRef, comment: "ShareExtension.entitlements" },
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
const sourcesId = target.pbxNativeTarget.buildPhases.find((p) => p.comment === "Sources").value;
const buildFile = proj.generateUuid();
objects.PBXBuildFile[buildFile] = { isa: "PBXBuildFile", fileRef: swiftRef, fileRef_comment: "ShareViewController.swift" };
objects.PBXBuildFile[`${buildFile}_comment`] = "ShareViewController.swift in Sources";
objects.PBXSourcesBuildPhase[sourcesId].files.push({ value: buildFile, comment: "ShareViewController.swift in Sources" });

// Build settings, matching the App target where it matters (versions must match for the App Store).
const appRelease = configsOf(appTarget.firstTarget).find((c) => c.name === "Release").buildSettings;
for (const c of configsOf(target.pbxNativeTarget)) {
  const debug = c.name === "Debug";
  c.buildSettings = {
    CODE_SIGN_ENTITLEMENTS: `${EXT}/${EXT}.entitlements`,
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: appRelease.CURRENT_PROJECT_VERSION ?? 1,
    GENERATE_INFOPLIST_FILE: "NO",
    INFOPLIST_FILE: `${EXT}/Info.plist`,
    IPHONEOS_DEPLOYMENT_TARGET: "15.0",
    LD_RUNPATH_SEARCH_PATHS: q("$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"),
    MARKETING_VERSION: appRelease.MARKETING_VERSION ?? "1.0",
    PRODUCT_BUNDLE_IDENTIFIER: `${APP_ID}.share`,
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

// Build the extension before the app that embeds it (the sections must exist for the library to fill them).
objects.PBXTargetDependency = objects.PBXTargetDependency || {};
objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
proj.addTargetDependency(appTarget.uuid, [target.uuid]);

// The embed step in the App target: name it the way Xcode does.
for (const [k, v] of Object.entries(objects.PBXCopyFilesBuildPhase)) {
  if (k.endsWith("_comment") || typeof v !== "object") continue;
  if (String(v.dstSubfolderSpec) === "13") {
    v.name = q("Embed Foundation Extensions");
    objects.PBXCopyFilesBuildPhase[`${k}_comment`] = "Embed Foundation Extensions";
    for (const ph of appTarget.firstTarget.buildPhases) if (ph.value === k) ph.comment = "Embed Foundation Extensions";
    for (const f of v.files) {
      const bf = objects.PBXBuildFile[f.value];
      if (bf) bf.settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
      f.comment = "ShareExtension.appex in Embed Foundation Extensions";
      objects.PBXBuildFile[`${f.value}_comment`] = f.comment;
    }
  }
}

// Keep Xcode's own spelling of these (the library drops the leading zero).
const attrs = proj.getFirstProject().firstProject.attributes;
attrs.LastSwiftUpdateCheck = "0920";
attrs.LastUpgradeCheck = "0920";

require("fs").writeFileSync(PBX, proj.writeSync());
console.log("Added ShareExtension and the App entitlements.");
