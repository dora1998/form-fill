"""Offline structural checks; these do not replace an Xcode build."""
import json
import pathlib
import plistlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
for relative in ["App/Info.plist", "SafariExtension/Info.plist"]:
    with (root / relative).open("rb") as stream:
        info = plistlib.load(stream)
    assert info["CFBundleIdentifier"] == "$(PRODUCT_BUNDLE_IDENTIFIER)"
    assert info["NSFaceIDUsageDescription"]
    assert info["ProfileKeychainAccessGroup"] == "$(AppIdentifierPrefix)dev.formfill.profiles"
with (root / "SafariExtension/Info.plist").open("rb") as stream:
    extension = plistlib.load(stream)["NSExtension"]
assert extension["NSExtensionPointIdentifier"] == "com.apple.Safari.web-extension"
resources = root / "SafariExtension/Resources"
for relative in ["App/FormFill.entitlements", "SafariExtension/FormFillExtension.entitlements"]:
    with (root / relative).open("rb") as stream:
        entitlements = plistlib.load(stream)
        assert entitlements["com.apple.security.application-groups"] == ["group.dev.formfill.app"]
        assert entitlements["keychain-access-groups"] == ["$(AppIdentifierPrefix)dev.formfill.profiles"]
manifest = json.loads((resources / "manifest.json").read_text())
assert manifest["manifest_version"] == 3
assert set(manifest["permissions"]) == {"activeTab", "scripting", "nativeMessaging", "clipboardWrite"}
assert "host_permissions" not in manifest
assert manifest["content_scripts"] == [{"matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle", "all_frames": False}]
for filename in manifest["background"]["scripts"] + [manifest["action"]["default_popup"], "content.js"]:
    assert (resources / filename).is_file(), filename
for filename in list(manifest["icons"].values()) + list(manifest["action"]["default_icon"].values()):
    assert (resources / filename).is_file(), filename
package = json.loads((root / "package.json").read_text())
assert package["packageManager"] == "pnpm@11.19.0"
assert "minimumReleaseAge: 4320" in (root / "pnpm-workspace.yaml").read_text()
assert "minimumReleaseAgeStrict: true" in (root / "pnpm-workspace.yaml").read_text()
assert (root / "pnpm-lock.yaml").is_file()
assert not (root / "package-lock.json").exists()
assert json.loads((root / "tsconfig.json").read_text())["compilerOptions"]["strict"] is True
assert (root / "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png").is_file()
popup = (resources / "popup.html").read_text()
for filename in re.findall(r'(?:src|href)="([^"]+)"', popup):
    assert (resources / filename).is_file(), filename
print("Scaffold checks passed (plist, manifest, permissions, resource references).")

# Validate the packaged extension too: Xcode flattens group resource directories.
if len(sys.argv) > 1:
    bundle = pathlib.Path(sys.argv[1])
    packaged = json.loads((bundle / "manifest.json").read_text())
    assert packaged == manifest, "Packaged manifest differs from source"
    references = packaged["background"]["scripts"] + [packaged["action"]["default_popup"], "content.js"]
    references += list(packaged["icons"].values()) + list(packaged["action"]["default_icon"].values())
    references += re.findall(r'(?:src|href)="([^"]+)"', (bundle / "popup.html").read_text())
    for filename in references:
        assert (bundle / filename).is_file(), f"Missing packaged resource: {filename}"
    assert not (bundle / "developer-ui.js").exists()
    assert not (bundle / "developer-page.js").exists()
    assert not list(bundle.rglob("*.ts")), "TypeScript source should not be shipped"
    print("Packaged Safari extension references passed.")
