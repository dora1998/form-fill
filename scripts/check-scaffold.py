"""Offline structural checks; these do not replace an Xcode build."""
import json
import pathlib
import plistlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
for relative in ["App/Info.plist", "SafariExtension/Info.plist"]:
    with (root / relative).open("rb") as stream:
        info = plistlib.load(stream)
    assert info["CFBundleIdentifier"] == "$(PRODUCT_BUNDLE_IDENTIFIER)"
with (root / "SafariExtension/Info.plist").open("rb") as stream:
    extension = plistlib.load(stream)["NSExtension"]
assert extension["NSExtensionPointIdentifier"] == "com.apple.Safari.web-extension"
resources = root / "SafariExtension/Resources"
manifest = json.loads((resources / "manifest.json").read_text())
assert manifest["manifest_version"] == 3
assert set(manifest["permissions"]) == {"activeTab", "scripting", "nativeMessaging"}
assert "host_permissions" not in manifest
for filename in manifest["background"]["scripts"] + [manifest["action"]["default_popup"], "content.js"]:
    assert (resources / filename).is_file(), filename
popup = (resources / "popup.html").read_text()
for filename in re.findall(r'(?:src|href)="([^"]+)"', popup):
    assert (resources / filename).is_file(), filename
print("Scaffold checks passed (plist, manifest, permissions, resource references).")
